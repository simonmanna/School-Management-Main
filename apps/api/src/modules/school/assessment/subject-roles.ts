/**
 * Subject role classification — which subjects are compulsory, principal or
 * core for a given grading system.
 *
 * Kept here, as plain functions with no Prisma/Nest dependency, for the same
 * reason `grade-bands.ts` is: the result kernel needs these to build a UCE or
 * PLE aggregate, and importing the examinations vertical to get them would
 * create a module cycle. `ReportCardTemplateService` imports them from here so
 * a card and a published result classify a subject identically.
 */

/** UCE: English and Mathematics must not be F9 for the candidate to qualify. */
export function isCompulsorySubject(name: string): boolean {
  return /english|mathematics/i.test(name);
}

/**
 * UACE subsidiary detection.
 *
 * Under UACE a candidate takes 3–4 principal subjects plus compulsory
 * subsidiaries (typically General Paper and Sub-ICT); only principals count
 * toward the best-3 aggregate. Schools tag subsidiaries with a `SUB-` code
 * prefix — names alone are unreliable, since many schools call a principal
 * subject "GP" too. No other system has the concept.
 */
export function isSubsidiarySubject(
  name: string,
  code: string | undefined,
  system: string,
): boolean {
  if (system !== 'UACE') return false;
  if (!code) return false;
  return /^sub-/i.test(code);
}

/**
 * PLE: the four papers the aggregate is built from.
 *
 * `Subject.isCore` is the authority and is what the result kernel uses. This
 * name-based check is the fallback for surfaces that hold a subject name but
 * not the row — and it is deliberately narrow, because `isCore` defaults to
 * `true` for every subject, so a school that never curated the flag would
 * otherwise have every subject counted as core.
 */
export function isPleCoreSubject(name: string, code?: string): boolean {
  const hay = `${name} ${code ?? ''}`;
  return /english|math|science|social|\bsst\b/i.test(hay);
}
