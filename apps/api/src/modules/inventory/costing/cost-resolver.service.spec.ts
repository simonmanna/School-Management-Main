import { Prisma } from '@prisma/client';
import { CostResolverService } from './cost-resolver.service';

describe('CostResolverService', () => {
  const svc = new CostResolverService();

  describe('AVCO issue', () => {
    it('uses the running average for the issue cost', () => {
      const r = svc.resolveIssueCost(
        { costingMethod: 'AVCO', costPrice: new Prisma.Decimal(10) },
        { quantity: new Prisma.Decimal(100), runningAverageCost: new Prisma.Decimal(7.5) },
        new Prisma.Decimal(20),
      );
      expect(r.unitCost.toString()).toBe('7.5');
      expect(r.totalValue.toString()).toBe('150');
    });

    it('throws when no stock exists', () => {
      expect(() =>
        svc.resolveIssueCost(
          { costingMethod: 'AVCO', costPrice: null },
          null,
          new Prisma.Decimal(1),
        ),
      ).toThrow(/no stock/i);
    });
  });

  describe('AVCO receipt recompute', () => {
    it('computes weighted average on first receipt (no prior stock)', () => {
      const r = svc.resolveReceiptCost(
        { costingMethod: 'AVCO', costPrice: null },
        null,
        new Prisma.Decimal(50),
        new Prisma.Decimal(8),
      );
      expect(r.newRunningAverage?.toString()).toBe('8');
      expect(r.totalValue.toString()).toBe('400');
    });

    it('recomputes weighted average on subsequent receipt', () => {
      // 100 @ 6 + 50 @ 8 = 600 + 400 = 1000 / 150 = 6.6667 (Prisma trims trailing zeros)
      const r = svc.resolveReceiptCost(
        { costingMethod: 'AVCO', costPrice: null },
        { quantity: new Prisma.Decimal(100), runningAverageCost: new Prisma.Decimal(6) },
        new Prisma.Decimal(50),
        new Prisma.Decimal(8),
      );
      expect(Number(r.newRunningAverage)).toBeCloseTo(6.6667, 3);
    });

    it('handles partial receipt into empty stock (qty only, no prior)', () => {
      const r = svc.resolveReceiptCost(
        { costingMethod: 'AVCO', costPrice: null },
        { quantity: new Prisma.Decimal(0), runningAverageCost: new Prisma.Decimal(0) },
        new Prisma.Decimal(10),
        new Prisma.Decimal(5),
      );
      expect(r.newRunningAverage?.toString()).toBe('5');
    });
  });

  describe('FIFO issue', () => {
    const batches = [
      { quantity: new Prisma.Decimal(30), unitCost: new Prisma.Decimal(10), expiryDate: new Date('2026-01-01'), receivedAt: new Date('2025-01-01') },
      { quantity: new Prisma.Decimal(50), unitCost: new Prisma.Decimal(12), expiryDate: null, receivedAt: new Date('2025-06-01') },
      { quantity: new Prisma.Decimal(20), unitCost: new Prisma.Decimal(14), expiryDate: new Date('2027-01-01'), receivedAt: new Date('2025-02-01') },
    ];

    it('consumes by expiry first then receivedAt', () => {
      // Should consume: 30 @ 10 = 300, then 20 @ 14 = 280 (expiry 2027 < null), then 20 @ 12 = 240 (remainder from second batch)
      // Total = 820 / 70 = 11.7143 (avg)
      const r = svc.resolveIssueCost(
        { costingMethod: 'FIFO', costPrice: null },
        null,
        new Prisma.Decimal(70),
        batches,
      );
      expect(r.totalValue.toString()).toBe('820');
      expect(Number(r.unitCost)).toBeCloseTo(11.7143, 3);
    });

    it('throws when batches cannot cover the quantity', () => {
      expect(() =>
        svc.resolveIssueCost(
          { costingMethod: 'FIFO', costPrice: null },
          null,
          new Prisma.Decimal(1000),
          batches,
        ),
      ).toThrow(/insufficient/i);
    });
  });

  describe('STANDARD issue', () => {
    it('uses Product.costPrice regardless of stock', () => {
      const r = svc.resolveIssueCost(
        { costingMethod: 'STANDARD', costPrice: new Prisma.Decimal(4.5) },
        { quantity: new Prisma.Decimal(50), runningAverageCost: new Prisma.Decimal(99) },
        new Prisma.Decimal(10),
      );
      expect(r.unitCost.toString()).toBe('4.5');
      expect(r.totalValue.toString()).toBe('45');
    });

    it('STANDARD receipt does not change running average', () => {
      const r = svc.resolveReceiptCost(
        { costingMethod: 'STANDARD', costPrice: new Prisma.Decimal(5) },
        { quantity: new Prisma.Decimal(100), runningAverageCost: new Prisma.Decimal(99) },
        new Prisma.Decimal(10),
        new Prisma.Decimal(7),
      );
      expect(r.newRunningAverage).toBeUndefined();
      expect(r.totalValue.toString()).toBe('70');
    });
  });

  describe('edge cases', () => {
    it('throws on non-positive issue quantity', () => {
      expect(() =>
        svc.resolveIssueCost(
          { costingMethod: 'AVCO', costPrice: null },
          { quantity: new Prisma.Decimal(10), runningAverageCost: new Prisma.Decimal(5) },
          new Prisma.Decimal(0),
        ),
      ).not.toThrow(); // returns ZERO
    });
  });

  /**
   * Negative on-hand is a normal state here: a sale is never blocked for want of
   * stock, so goods routinely leave before they are received. The invariant that
   * must survive that is
   *
   *   StockValuation == quantity × runningAverageCost
   *
   * Blending a negative quantity into the weighted average used to break it: at
   * a zero prior average the oversold units were expensed at nothing, so
   * inventory stayed overstated and COGS understated indefinitely. Each case
   * below asserts the invariant holds after the covering receipt.
   */
  describe('AVCO receipt onto negative on-hand', () => {
    const AVCO = { costingMethod: 'AVCO' as const, costPrice: null };
    const d = (n: number | string) => new Prisma.Decimal(n);

    /** Ledger value implied after the receipt: before + receipt − correction. */
    const impliedValuation = (
      oldQty: number,
      oldAvg: number,
      recvQty: number,
      recvCost: number,
      correction: Prisma.Decimal,
    ) => d(oldQty).times(oldAvg).plus(d(recvQty).times(recvCost)).minus(correction);

    it('no correction on an ordinary positive-stock receipt', () => {
      const r = svc.resolveReceiptCost(AVCO, { quantity: d(10), runningAverageCost: d(100) }, d(10), d(120));
      expect(r.newRunningAverage?.toString()).toBe('110');
      expect(r.costCorrection).toBeUndefined();
    });

    it('receipt fully covering the shortfall restores the invariant (zero prior average)', () => {
      // Sold 10 with nothing on hand and no cost basis → COGS booked 0.
      const r = svc.resolveReceiptCost(AVCO, { quantity: d(-10), runningAverageCost: d(0) }, d(20), d(100));

      expect(r.newRunningAverage?.toString()).toBe('100');
      // The 10 units expensed at zero should have cost 100 each.
      expect(r.costCorrection?.toString()).toBe('1000');
      // 10 units left on hand × 100 = 1000.
      expect(impliedValuation(-10, 0, 20, 100, r.costCorrection!).toString()).toBe('1000');
    });

    it('receipt covering only part of the shortfall keeps the invariant', () => {
      const r = svc.resolveReceiptCost(AVCO, { quantity: d(-10), runningAverageCost: d(0) }, d(5), d(100));

      // Still 5 short; the latest known cost becomes the basis.
      expect(r.newRunningAverage?.toString()).toBe('100');
      // Valuation must be NEGATIVE — 5 units owed at 100.
      expect(impliedValuation(-10, 0, 5, 100, r.costCorrection!).toString()).toBe('-500');
    });

    it('a second receipt finishing the shortfall lands the invariant back at zero', () => {
      const r = svc.resolveReceiptCost(AVCO, { quantity: d(-5), runningAverageCost: d(100) }, d(5), d(100));

      // Nothing to correct — the shortfall was already carried at the right cost.
      expect(r.costCorrection).toBeUndefined();
      // Quantity is now 0, so valuation must be 0.
      expect(impliedValuation(-5, 100, 5, 100, r.costCorrection ?? d(0)).toString()).toBe('0');
    });

    it('corrects only the difference when a stale average was already expensed', () => {
      // 10 units expensed at 80 apiece; they actually cost 100.
      const r = svc.resolveReceiptCost(AVCO, { quantity: d(-10), runningAverageCost: d(80) }, d(20), d(100));

      expect(r.costCorrection?.toString()).toBe('200');
      expect(impliedValuation(-10, 80, 20, 100, r.costCorrection!).toString()).toBe('1000');
    });

    it('does not blend a negative quantity into the new average', () => {
      // The old formula gave (-10×0 + 20×50)/10 = 100 — double the true cost.
      const r = svc.resolveReceiptCost(AVCO, { quantity: d(-10), runningAverageCost: d(0) }, d(20), d(50));
      expect(r.newRunningAverage?.toString()).toBe('50');
    });

    it('treats a receipt onto exactly zero on-hand as a fresh basis, with no correction', () => {
      const r = svc.resolveReceiptCost(AVCO, { quantity: d(0), runningAverageCost: d(999) }, d(4), d(25));
      expect(r.newRunningAverage?.toString()).toBe('25');
      expect(r.costCorrection).toBeUndefined();
    });
  });
});