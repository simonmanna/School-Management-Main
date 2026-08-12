import { UomConversionService } from './uom-conversion.service';

describe('UomConversionService (pure math)', () => {
  describe('convertByFactor', () => {
    it('converts a smaller unit up to the reference (18 g → 0.018 kg)', () => {
      // factor = base units per 1 of this unit; g=0.001, kg=1
      expect(UomConversionService.convertByFactor(18, 0.001, 1).toString()).toBe('0.018');
    });

    it('converts the reference down to a smaller unit (2 kg → 2000 g)', () => {
      expect(Number(UomConversionService.convertByFactor(2, 1, 0.001))).toBe(2000);
    });

    it('converts a bigger unit to base (1 bag(50 kg) → 50 kg)', () => {
      expect(Number(UomConversionService.convertByFactor(1, 50, 1))).toBe(50);
    });

    it('throws when the target factor is not positive', () => {
      expect(() => UomConversionService.convertByFactor(1, 1, 0)).toThrow();
    });
  });

  describe('roundToStep', () => {
    it('rounds to a milli step', () => {
      expect(UomConversionService.roundToStep('0.0184', 0.001).toString()).toBe('0.018');
    });

    it('rounds pieces to whole units (half up)', () => {
      expect(Number(UomConversionService.roundToStep(2.6, 1))).toBe(3);
      expect(Number(UomConversionService.roundToStep(2.4, 1))).toBe(2);
    });

    it('does not round when the step is zero/negative', () => {
      expect(UomConversionService.roundToStep('1.23456', 0).toString()).toBe('1.23456');
    });
  });
});
