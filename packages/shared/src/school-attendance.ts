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

/**
 * The colour a status is drawn in. The school's configured colour wins; this is
 * the fallback for a status saved without one (or with a placeholder grey), so a
 * register never renders as a row of identical chips: present reads green,
 * absent red, late amber, excused yellow, anything else slate.
 */
const STATUS_PALETTE: Record<string, string> = {
  present: '#16a34a',
  absent: '#dc2626',
  late: '#f59e0b',
  excused: '#eab308',
  sick: '#0ea5e9',
  holiday: '#8b5cf6',
  suspended: '#be123c',
};
const PLACEHOLDER_COLORS = new Set(['#000', '#000000', '#fff', '#ffffff', '#6b7280', '#808080', 'gray', 'grey']);

export interface AttendanceStatusColorLike {
  code: string;
  color?: string | null;
  isPresent?: boolean | null;
  isLate?: boolean | null;
  isAbsent?: boolean | null;
  isExcused?: boolean | null;
}

export function attendanceStatusColor(status: AttendanceStatusColorLike | null | undefined, code?: string): string {
  const raw = (status?.color ?? '').trim();
  if (raw && !PLACEHOLDER_COLORS.has(raw.toLowerCase())) return raw;
  const key = (status?.code ?? code ?? '').toLowerCase();
  if (STATUS_PALETTE[key]) return STATUS_PALETTE[key];
  // No configured colour and an unknown code: fall back on what the status means.
  if (status?.isExcused) return STATUS_PALETTE.excused;
  if (status?.isLate) return STATUS_PALETTE.late;
  if (status?.isAbsent) return STATUS_PALETTE.absent;
  if (status?.isPresent) return STATUS_PALETTE.present;
  return '#64748b';
}
