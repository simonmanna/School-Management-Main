import { Prisma } from '@prisma/client';
import {
  reconcileOriginal,
  applyAdjustments,
  computeEffective,
  percentageOf,
  clamp,
  rollupRubricFraction,
  latePenalty,
} from './assessment-math';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

describe('assessment-math (pure kernel)', () => {
  describe('reconcileOriginal', () => {
    it('is null with no marks', () => {
      expect(reconcileOriginal([])).toBeNull();
    });
    it('uses the first round when only first exists', () => {
      expect(reconcileOriginal([{ round: 'first', score: 68 }])!.toNumber()).toBe(68);
    });
    it('a blind second on its own does NOT become the mark implicitly — but is used when it is the only round', () => {
      // Only a second_blind present: it is the sole available mark.
      expect(reconcileOriginal([{ round: 'second_blind', score: 70 }])!.toNumber()).toBe(70);
    });
    it('first wins over a disagreeing blind second until reconciled', () => {
      expect(
        reconcileOriginal([
          { round: 'first', score: 60 },
          { round: 'second_blind', score: 80 },
        ])!.toNumber(),
      ).toBe(60);
    });
    it('reconciliation overrides both first and second', () => {
      expect(
        reconcileOriginal([
          { round: 'first', score: 60 },
          { round: 'second_blind', score: 80 },
          { round: 'reconciliation', score: 70 },
        ])!.toNumber(),
      ).toBe(70);
    });
  });

  describe('applyAdjustments', () => {
    it('additive deltas compose in sequence order', () => {
      const r = applyAdjustments(D(60), [
        { sequence: 2, delta: 5 },
        { sequence: 1, delta: -3 },
      ], 100);
      expect(r.toNumber()).toBe(62); // 60 - 3 + 5
    });
    it('a replacement overrides everything before it', () => {
      const r = applyAdjustments(D(60), [
        { sequence: 1, delta: 10 },
        { sequence: 2, replacementScore: 50 },
        { sequence: 3, delta: 4 },
      ], 100);
      expect(r.toNumber()).toBe(54); // ...→70→(replace 50)→54
    });
    it('clamps to [0, maxScore]', () => {
      expect(applyAdjustments(D(95), [{ sequence: 1, delta: 20 }], 100).toNumber()).toBe(100);
      expect(applyAdjustments(D(5), [{ sequence: 1, delta: -20 }], 100).toNumber()).toBe(0);
    });
  });

  describe('percentageOf', () => {
    it('is exact, not floaty, at band boundaries', () => {
      // 33/60 = 55% exactly; floats would drift here.
      expect(percentageOf(33, 60).toNumber()).toBe(55);
      expect(percentageOf(0, 0).toNumber()).toBe(0); // guard div-by-zero
    });
    it('keeps precision that a float would lose', () => {
      // 1/3 * 100 — Decimal keeps configured precision; assert to 6 dp.
      expect(percentageOf(1, 3).toDecimalPlaces(6).toString()).toBe('33.333333');
    });
  });

  describe('computeEffective', () => {
    it('no marks, no replacement → all null', () => {
      const r = computeEffective([], [], 100);
      expect(r.originalScore).toBeNull();
      expect(r.effectiveScore).toBeNull();
      expect(r.percentage).toBeNull();
    });
    it('marks only → original == effective, percentage derived', () => {
      const r = computeEffective([{ round: 'first', score: 45 }], [], 100);
      expect(r.originalScore!.toNumber()).toBe(45);
      expect(r.effectiveScore!.toNumber()).toBe(45);
      expect(r.percentage!.toNumber()).toBe(45);
    });
    it('marks + moderation → effective differs from original', () => {
      const r = computeEffective(
        [{ round: 'first', score: 48 }],
        [{ sequence: 1, kind: 'moderation', delta: 3 } as any],
        100,
      );
      expect(r.originalScore!.toNumber()).toBe(48);
      expect(r.effectiveScore!.toNumber()).toBe(51);
      expect(r.percentage!.toNumber()).toBe(51);
    });
    it('special consideration replacement with no marking round', () => {
      const r = computeEffective([], [{ sequence: 1, replacementScore: 40 }], 80);
      expect(r.originalScore).toBeNull();
      expect(r.effectiveScore!.toNumber()).toBe(40);
      expect(r.percentage!.toNumber()).toBe(50); // 40/80
    });
    it('reconciliation then scaling', () => {
      const r = computeEffective(
        [
          { round: 'first', score: 60 },
          { round: 'second_blind', score: 66 },
          { round: 'reconciliation', score: 63 },
        ],
        [{ sequence: 1, delta: 2 }],
        100,
      );
      expect(r.originalScore!.toNumber()).toBe(63);
      expect(r.effectiveScore!.toNumber()).toBe(65);
    });
  });

  describe('clamp', () => {
    it('bounds correctly', () => {
      expect(clamp(D(5), D(0), D(10)).toNumber()).toBe(5);
      expect(clamp(D(-1), D(0), D(10)).toNumber()).toBe(0);
      expect(clamp(D(11), D(0), D(10)).toNumber()).toBe(10);
    });
  });

  describe('rollupRubricFraction (A2)', () => {
    it('equal-weight criteria average their fractions', () => {
      // 8/10 and 6/10, equal weight → 0.7
      const f = rollupRubricFraction([
        { score: 8, maxScore: 10, weight: 1 },
        { score: 6, maxScore: 10, weight: 1 },
      ]);
      expect(f.toNumber()).toBe(0.7);
    });
    it('weights bias the average', () => {
      // 10/10 (w3) and 0/10 (w1) → 0.75
      const f = rollupRubricFraction([
        { score: 10, maxScore: 10, weight: 3 },
        { score: 0, maxScore: 10, weight: 1 },
      ]);
      expect(f.toNumber()).toBe(0.75);
    });
    it('a zero-max criterion contributes zero, no divide-by-zero', () => {
      const f = rollupRubricFraction([{ score: 5, maxScore: 0, weight: 1 }]);
      expect(f.toNumber()).toBe(0);
    });
    it('empty is zero', () => {
      expect(rollupRubricFraction([]).toNumber()).toBe(0);
    });
  });

  describe('latePenalty (A2)', () => {
    it('is an exact percentage of the raw score', () => {
      expect(latePenalty(80, 10).toNumber()).toBe(8);
    });
    it('never exceeds the raw score', () => {
      expect(latePenalty(50, 150).toNumber()).toBe(50);
    });
  });
});
