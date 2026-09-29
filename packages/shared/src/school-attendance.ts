/**
 * Which configured attendance status a register starts every pupil on, and
 * which one "All present" applies (audit R10).
 *
 * The catalog is school-configurable and its order is the school's choice. A
 * school that lists Absent first must not find every pupil pre-marked absent,
 * and a school whose "default" flag sits on a non-present status must not get
 * "All present" marking everyone with it. Only a status that counts as present
 * (and is not a late arrival) qualifies. If there is none, there is no default:
 * the teacher records each pupil explicitly.
 */
export interface AttendanceStatusLike {
  code: string;
  isDefault?: boolean | null;
  isPresent?: boolean | null;
  isLate?: boolean | null;
  isAbsent?: boolean | null;
  sortOrder?: number | null;
  active?: boolean | null;
}

export function pickPresentStatus<T extends AttendanceStatusLike>(statuses: readonly T[] | null | undefined): T | null {
  const usable = (statuses ?? [])
    .filter((s) => s.active !== false && s.isPresent === true && !s.isLate && !s.isAbsent)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  return usable.find((s) => s.isDefault) ?? usable[0] ?? null;
}
