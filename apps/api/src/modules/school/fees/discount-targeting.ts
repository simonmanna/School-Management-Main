import { BadRequestException } from '@nestjs/common';

/**
 * Who a Discount applies to — `Discount.appliesTo`.
 *
 *   { allStudents?: true,
 *     studentProfileIds?: string[], classIds?: string[], gradeLevelIds?: string[],
 *     feeCodes?: string[] }
 *
 * The WHO axes (students, classes, grade levels) decide which pupils get the
 * discount; `feeCodes` only narrows which fee lines it touches. A discount with
 * no WHO axis and no explicit `allStudents: true` applies to nobody.
 *
 * It used to be the other way round: an empty filter matched everyone, and the
 * Discounts page never sent a filter, so creating "SIBLING 10%" discounted every
 * pupil in the school. A school-wide concession is still possible — it just has
 * to be asked for.
 */
export interface DiscountTarget {
  studentProfileId: string;
  classId: string;
  gradeLevelId: string;
}

const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : []);

/** True when the filter names at least one pupil, class or grade level, or opts in to everyone. */
export function isDiscountTargeted(appliesTo: unknown): boolean {
  if (!appliesTo || typeof appliesTo !== 'object') return false;
  const a = appliesTo as Record<string, unknown>;
  if (a.allStudents === true) return true;
  return list(a.studentProfileIds).length > 0 || list(a.classIds).length > 0 || list(a.gradeLevelIds).length > 0;
}

export function assertDiscountTargeted(appliesTo: unknown): void {
  if (!isDiscountTargeted(appliesTo)) {
    throw new BadRequestException(
      'Say who this discount is for: pick pupils, classes or grade levels, or set allStudents to apply it to the whole school.',
    );
  }
}

/** True when a Discount.appliesTo filter matches this pupil and fee line. */
export function discountApplies(appliesTo: unknown, target: DiscountTarget, feeCode: string): boolean {
  if (!isDiscountTargeted(appliesTo)) return false;
  const a = appliesTo as Record<string, unknown>;
  const studentIds = list(a.studentProfileIds);
  const classIds = list(a.classIds);
  const gradeLevelIds = list(a.gradeLevelIds);
  const feeCodes = list(a.feeCodes);
  if (studentIds.length && !studentIds.includes(target.studentProfileId)) return false;
  if (classIds.length && !classIds.includes(target.classId)) return false;
  if (gradeLevelIds.length && !gradeLevelIds.includes(target.gradeLevelId)) return false;
  if (feeCodes.length && !feeCodes.includes(feeCode)) return false;
  return true;
}
