import { BadRequestException } from '@nestjs/common';
import {
  checkReading,
  classifyConfidence,
  computeBottleConfig,
  remainingMlFromWeight,
  weightFromRemainingMl,
} from './beverage-math';

describe('beverage-math', () => {
  // Jameson 750ml whiskey: empty 420g, full 1135g.
  const JAMESON = { containerVolumeMl: 750, emptyBottleWeightG: 420, fullBottleWeightG: 1135 };

  describe('computeBottleConfig', () => {
    it('computes liquid weight and conversion factor (750/420/1135)', () => {
      const cfg = computeBottleConfig(JAMESON);
      expect(cfg.effectiveEmptyWeightG).toBe(420);
      expect(cfg.liquidWeightG).toBe(715); // 1135 - 420
      expect(cfg.conversionFactorMlPerG).toBeCloseTo(750 / 715, 8); // ≈ 1.0489510
    });

    it('prefers the actual (measured) empty weight over the nominal', () => {
      const cfg = computeBottleConfig({ ...JAMESON, actualEmptyWeightG: 423 });
      expect(cfg.effectiveEmptyWeightG).toBe(423);
      expect(cfg.liquidWeightG).toBe(712); // 1135 - 423
    });

    it('rejects empty >= full', () => {
      expect(() => computeBottleConfig({ ...JAMESON, fullBottleWeightG: 420 })).toThrow(BadRequestException);
    });

    it('rejects a non-positive volume', () => {
      expect(() => computeBottleConfig({ ...JAMESON, containerVolumeMl: 0 })).toThrow(BadRequestException);
    });

    it('rejects missing weights', () => {
      expect(() => computeBottleConfig({ containerVolumeMl: 750 })).toThrow(BadRequestException);
    });
  });

  describe('remainingMlFromWeight', () => {
    const { conversionFactorMlPerG: f } = computeBottleConfig(JAMESON);

    it('converts a weighed bottle to remaining ml', () => {
      // 810g gross → 390g liquid → 390 * 1.04895 ≈ 409 ml
      expect(remainingMlFromWeight(810, 420, f)).toBeCloseTo(409.09, 1);
    });

    it('floors at 0 when at/below tare', () => {
      expect(remainingMlFromWeight(400, 420, f)).toBe(0);
    });

    it('round-trips with weightFromRemainingMl', () => {
      const w = weightFromRemainingMl(409.09, 420, f);
      expect(remainingMlFromWeight(w, 420, f)).toBeCloseTo(409.09, 2);
    });
  });

  describe('checkReading', () => {
    it('flags below-tare weights as impossible', () => {
      expect(checkReading(400, 420, 1135).outOfRange).toBe(true);
    });
    it('flags over-full weights as impossible', () => {
      expect(checkReading(1200, 420, 1135).outOfRange).toBe(true);
    });
    it('accepts a normal partial weight', () => {
      expect(checkReading(810, 420, 1135).outOfRange).toBe(false);
    });
  });

  describe('classifyConfidence', () => {
    it('GOOD within tolerance', () => {
      expect(classifyConfidence(3, 5)).toBe('GOOD');
      expect(classifyConfidence(-5, 5)).toBe('GOOD');
    });
    it('SUSPICIOUS beyond tolerance', () => {
      expect(classifyConfidence(9, 5)).toBe('SUSPICIOUS');
    });
    it('OUT_OF_RANGE overrides tolerance', () => {
      expect(classifyConfidence(1, 5, true)).toBe('OUT_OF_RANGE');
    });
  });
});
