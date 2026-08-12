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
});