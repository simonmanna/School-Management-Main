import { BadRequestException } from '@nestjs/common';
import { BillingService } from '../../src/modules/school/fees/billing.service';
import { assertDiscountTargeted, discountApplies, isDiscountTargeted } from '../../src/modules/school/fees/discount-targeting';

/**
 * E2E audit F5 — discounts.
 *
 * 1. An empty `appliesTo` matched every pupil, and the Discounts page never sent
 *    one, so creating "SIBLING 10%" discounted the whole school.
 * 2. A fixed discount was added to EVERY matching fee line: 50,000 off a
 *    five-line structure took 250,000.
 */
const target = { studentProfileId: 'stu_amina', classId: 'cls_p3n', gradeLevelId: 'gl_p3' };

describe('discount targeting', () => {
  it('applies an untargeted discount to nobody', () => {
    expect(isDiscountTargeted({})).toBe(false);
    expect(isDiscountTargeted(null)).toBe(false);
    expect(isDiscountTargeted({ feeCodes: ['TUITION'] })).toBe(false); // narrows lines, not pupils
    expect(discountApplies({}, target, 'TUITION')).toBe(false);
  });

  it('refuses to save a discount that names no one', () => {
    expect(() => assertDiscountTargeted({})).toThrow(BadRequestException);
    expect(() => assertDiscountTargeted(undefined)).toThrow(BadRequestException);
    expect(() => assertDiscountTargeted({ allStudents: true })).not.toThrow();
    expect(() => assertDiscountTargeted({ studentProfileIds: ['stu_amina'] })).not.toThrow();
  });

  it('matches only the named pupils, classes or grade levels', () => {
    expect(discountApplies({ studentProfileIds: ['stu_amina'] }, target, 'TUITION')).toBe(true);
    expect(discountApplies({ studentProfileIds: ['stu_brian'] }, target, 'TUITION')).toBe(false);
    expect(discountApplies({ gradeLevelIds: ['gl_p3'], feeCodes: ['LUNCH'] }, target, 'TUITION')).toBe(false);
    expect(discountApplies({ allStudents: true }, target, 'TUITION')).toBe(true);
  });
});

describe('BillingService.computeLines — fixed discounts are once per pupil', () => {
  const service = new BillingService(
    {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
  );
  const compute = (components: any[], discounts: any[]) =>
    (service as any).computeLines(components, {}, discounts, [], { id: 'stu_amina', placement: { classId: 'cls_p3n', gradeLevelId: 'gl_p3' } });
  const five = ['TUITION', 'LUNCH', 'EXAMS', 'SPORTS', 'DEV'].map((code) => ({
    code, name: code, productId: `prod_${code}`, amount: 100_000, isOptional: false,
  }));
  const discountTotal = (lines: any[]) =>
    lines.reduce((t, l) => t + (l.unitPrice * l.discountPercent) / 100, 0);

  it('takes 50,000 off a five-line structure, not 250,000', () => {
    const lines = compute(five, [{ type: 'fixed_amount', value: 50_000, appliesTo: { studentProfileIds: ['stu_amina'] } }]);
    expect(discountTotal(lines)).toBeCloseTo(50_000, 2);
  });

  it('spreads a fixed discount over only the lines it names', () => {
    const lines = compute(five, [
      { type: 'fixed_amount', value: 30_000, appliesTo: { allStudents: true, feeCodes: ['TUITION', 'LUNCH'] } },
    ]);
    expect(discountTotal(lines)).toBeCloseTo(30_000, 2);
    expect(lines.find((l: any) => l.description === 'EXAMS').discountPercent).toBe(0);
  });

  it('gives an untargeted discount to no one', () => {
    const lines = compute(five, [
      { type: 'percentage', value: 10, appliesTo: {} },
      { type: 'fixed_amount', value: 50_000, appliesTo: {} },
    ]);
    expect(discountTotal(lines)).toBe(0);
  });

  it('still applies a percentage to every matching line', () => {
    const lines = compute(five, [{ type: 'percentage', value: 10, appliesTo: { gradeLevelIds: ['gl_p3'] } }]);
    expect(discountTotal(lines)).toBeCloseTo(50_000, 2);
  });
});
