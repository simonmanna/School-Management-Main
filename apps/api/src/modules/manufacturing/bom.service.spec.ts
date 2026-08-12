import { BomService, type ExplodableBom } from './bom.service';

/**
 * Pure explosion math — no DB. The scaling/scrap/yield arithmetic every
 * production order rests on.
 */
describe('BomService.explode', () => {
  const bom: ExplodableBom = {
    outputQuantity: 20,
    expectedYieldPct: 100,
    lines: [
      { componentProductId: 'flour', quantity: 10, uomId: 'kg' },
      { componentProductId: 'sugar', quantity: 6, uomId: null, scrapPct: 0 },
    ],
  };

  it('scales linearly for a partial batch (yield 20, order 50 → 2.5×)', () => {
    const r = BomService.explode(bom, 50);
    expect(r.materials.map((m) => Number(m.qtyPlanned))).toEqual([25, 15]);
  });

  it('is 1× at exactly one batch', () => {
    const r = BomService.explode(bom, 20);
    expect(r.materials.map((m) => Number(m.qtyPlanned))).toEqual([10, 6]);
  });

  it('applies per-line scrap % on top of the scaled quantity', () => {
    const withScrap: ExplodableBom = {
      outputQuantity: 10,
      lines: [{ componentProductId: 'flour', quantity: 10, scrapPct: 5 }],
    };
    // 1 batch → 10, +5% scrap → 10.5
    const r = BomService.explode(withScrap, 10);
    expect(Number(r.materials[0].qtyPlanned)).toBeCloseTo(10.5, 6);
  });

  it('carries uomId through verbatim (conversion happens later, in issue)', () => {
    const r = BomService.explode(bom, 20);
    expect(r.materials[0].uomId).toBe('kg');
    expect(r.materials[1].uomId).toBeNull();
  });

  it('computes expected output from the yield %', () => {
    const lowYield: ExplodableBom = {
      outputQuantity: 100,
      expectedYieldPct: 95,
      lines: [{ componentProductId: 'flour', quantity: 40 }],
    };
    const r = BomService.explode(lowYield, 100);
    expect(Number(r.expectedOutputQty)).toBe(95);
  });

  it('defaults yield to 100% when unset', () => {
    const r = BomService.explode(bom, 40);
    expect(Number(r.expectedOutputQty)).toBe(40);
  });

  it('preserves line sequence/order', () => {
    const r = BomService.explode(bom, 20);
    expect(r.materials.map((m) => m.componentProductId)).toEqual(['flour', 'sugar']);
  });

  it('rejects a non-positive output quantity', () => {
    expect(() => BomService.explode({ outputQuantity: 0, lines: [] }, 10)).toThrow();
  });

  it('handles fractional scaling without precision drift (yield 3, order 1)', () => {
    const b: ExplodableBom = {
      outputQuantity: 3,
      lines: [{ componentProductId: 'egg', quantity: 3 }],
    };
    const r = BomService.explode(b, 1);
    expect(Number(r.materials[0].qtyPlanned)).toBe(1);
  });
});
