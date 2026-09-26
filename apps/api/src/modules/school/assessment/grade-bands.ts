import { InvalidGradingScaleError, validateBands, type BandConfig, type BandRoundingName } from './result-computation';

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

export interface ResolvedScale {
  bands: BandConfig[];
  rounding: BandRoundingName;
  scaleId: string | null;
}

const KNOWN_SYSTEMS = ['UACE', 'UCE', 'PLE', 'CBC', 'ECD'];

/** The system a legacy scale serves, read from its name by whole token. */
export function inferScaleSystem(name: string): string | null {
  const tokens = (name ?? '').toUpperCase().split(/[^A-Z0-9]+/);
  if (/nursery/i.test(name ?? '')) return 'ECD';
  return KNOWN_SYSTEMS.find((s) => tokens.includes(s)) ?? null;
}

const DESCRIPTOR = ['ECD'];

/**
 * The scale to grade `system` against (F14):
 *   1. a registered scale for that system (the default one first);
 *   2. for a graded (non-descriptor) system, a school default scale that names
 *      no system — a school's own house scale;
 *   3. the built-in bands for the system.
 * A scale registered for another system is never borrowed, so nursery is never
 * graded on the primary PLE scale however the school's default is set. A scale
 * that cannot grade every percent is refused rather than silently used.
 */
export async function resolveScale(prismaClient: any, system: string): Promise<ResolvedScale> {
  const sys = (system || 'generic').toUpperCase();
  const scales: any[] = await prismaClient.gradingScale.findMany({ where: { deletedAt: null } });
  const systemOf = (s: any) => (s.system ? String(s.system).toUpperCase() : inferScaleSystem(s.name));
  const forSystem = scales.filter((s) => systemOf(s) === sys);
  const pick =
    forSystem.find((s) => s.isDefault) ??
    forSystem[0] ??
    (!DESCRIPTOR.includes(sys) ? scales.find((s) => s.isDefault && systemOf(s) === null) : undefined);
  if (!pick) return { bands: defaultBands(sys), rounding: 'none', scaleId: null };
  const errors = validateBands(pick.bands);
  if (errors.length) throw new InvalidGradingScaleError(`Grading scale "${pick.name}" is unusable: ${errors.join('; ')}`);
  return { bands: pick.bands as BandConfig[], rounding: (pick.bandRounding ?? 'none') as BandRoundingName, scaleId: pick.id };
}

/** Bands only — for callers that do not band (display tables). */
export async function resolveBands(prismaClient: any, system: string): Promise<BandConfig[]> {
  return (await resolveScale(prismaClient, system)).bands;
}
