import type { BandConfig } from './result-computation';

/**
 * Built-in grading bands for the result kernel, mirroring the Uganda scales in
 * examinations/grading.service.ts (PLE, UCE, UACE, CBC, generic). Kept here — as
 * plain data with no Prisma/Nest dependency — so the result module doesn't have
 * to import the examinations vertical (which would create a module cycle).
 * `resolveBands` prefers a registered GradingScale, then falls back to these.
 */

export function defaultBands(system: string): BandConfig[] {
  switch ((system ?? '').toUpperCase()) {
    // Nursery. Descriptors a parent can read, in the words a nursery teacher
    // uses; `gpa` is zero throughout and never printed, because a descriptor
    // system reports no GPA, aggregate, division or position (see
    // `isDescriptorSystem` in result-computation.ts).
    case 'ECD':
      return [
        { min: 80, max: 100, grade: 'Confident', gpa: 0, remark: 'Doing this confidently and on their own' },
        { min: 60, max: 79, grade: 'Developing', gpa: 0, remark: 'Doing this well, with a little help' },
        { min: 40, max: 59, grade: 'Beginning', gpa: 0, remark: 'Beginning to do this with help' },
        { min: 0, max: 39, grade: 'Support', gpa: 0, remark: 'Needs more time and practice' },
      ];
    case 'UACE':
      return [
        { min: 80, max: 100, grade: 'A', gpa: 4.0, points: 5, remark: 'Distinction' },
        { min: 70, max: 79, grade: 'B', gpa: 3.6, points: 6, remark: 'Distinction' },
        { min: 60, max: 69, grade: 'C', gpa: 3.2, points: 7, remark: 'Credit' },
        { min: 50, max: 59, grade: 'D', gpa: 2.8, points: 8, remark: 'Credit' },
        { min: 40, max: 49, grade: 'E', gpa: 2.4, points: 9, remark: 'Pass' },
        { min: 30, max: 39, grade: 'O', gpa: 2.0, points: 10, remark: 'Pass' },
        { min: 0, max: 29, grade: 'F', gpa: 0.0, points: 11, remark: 'Fail' },
      ];
    case 'CBC':
      return [
        { min: 80, max: 100, grade: 'A', gpa: 4.0, remark: 'Exceeding Expectations' },
        { min: 65, max: 79, grade: 'B', gpa: 3.0, remark: 'Meeting Expectations' },
        { min: 50, max: 64, grade: 'C', gpa: 2.0, remark: 'Approaching Expectations' },
        { min: 0, max: 49, grade: 'D', gpa: 1.0, remark: 'Below Expectations' },
      ];
    case 'PLE':
    case 'UCE':
    default:
      return [
        { min: 90, max: 100, grade: 'D1', gpa: 4.0, points: 1, remark: 'Distinction' },
        { min: 80, max: 89, grade: 'D2', gpa: 3.6, points: 2, remark: 'Distinction' },
        { min: 70, max: 79, grade: 'C3', gpa: 3.2, points: 3, remark: 'Credit' },
        { min: 65, max: 69, grade: 'C4', gpa: 2.8, points: 4, remark: 'Credit' },
        { min: 60, max: 64, grade: 'C5', gpa: 2.4, points: 5, remark: 'Credit' },
        { min: 50, max: 59, grade: 'C6', gpa: 2.0, points: 6, remark: 'Credit' },
        { min: 40, max: 49, grade: 'P7', gpa: 1.5, points: 7, remark: 'Pass' },
        { min: 35, max: 39, grade: 'P8', gpa: 1.0, points: 8, remark: 'Pass' },
        { min: 0, max: 34, grade: 'F9', gpa: 0.0, points: 9, remark: 'Fail' },
      ];
  }
}

/**
 * Resolve the bands to compute against: a registered GradingScale for the
 * system (name contains the system, org-scoped by the tenancy extension) wins;
 * otherwise the built-in default. `prismaClient` is the tenant-scoped client.
 */
export async function resolveBands(prismaClient: any, system: string): Promise<BandConfig[]> {
  // A scale registered FOR THIS SYSTEM wins over the school's default one.
  // The other order meant a primary school's default PLE scale was used for its
  // nursery classes too, so Top Class was graded D1–F9.
  const scale =
    (await prismaClient.gradingScale.findFirst({
      where: { name: { contains: system, mode: 'insensitive' } },
    })) ?? (await prismaClient.gradingScale.findFirst({ where: { isDefault: true } }));
  if (scale?.bands) return scale.bands as unknown as BandConfig[];
  return defaultBands(system);
}
