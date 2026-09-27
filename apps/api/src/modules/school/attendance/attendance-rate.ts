/**
 * The one attendance-rate calculation (audit 2026-09-27 F08, invariants I-030,
 * I-031, ADR-032 P1).
 *
 * The defect it replaces: the seeded `late` status carries both `isPresent` and
 * `isLate`, and a summary counted it as present AND added `late × 0.5` again —
 * one late morning reported 150%. Five call sites each had their own formula.
 *
 * Here every marked session falls into exactly ONE bucket, checked in this
 * order: late → present → excused → absent → other. It then contributes:
 *   present  1 to attended, 1 to the denominator
 *   late     the school's late contribution (1 or 0.5), 1 to the denominator
 *   excused  0 attended; 1 to the denominator only if the school says so
 *   absent   0 attended, 1 to the denominator
 *   other    nothing (a status with no meaning configured is reported, not guessed)
 *
 * No clamp: the arithmetic cannot exceed 100. When the rate depends on a
 * choice the school has not made (a late mark, and no late policy yet), the
 * rate is null and `policyMissing` says why — it is never invented.
 */

export interface AttendanceStatusFlags {
  code?: string;
  isPresent?: boolean | null;
  isLate?: boolean | null;
  isAbsent?: boolean | null;
  isExcused?: boolean | null;
}

export interface AttendancePolicy {
  /** 1 or 0.5; null when the school has not chosen. */
  lateContribution: number | null;
  excusedInDenominator: boolean;
}

export type AttendanceBucket = 'late' | 'present' | 'excused' | 'absent' | 'other';

export interface AttendanceSummary {
  sessions: number;
  present: number;
  late: number;
  excused: number;
  absent: number;
  other: number;
  /** Sessions the rate is out of. */
  denominator: number;
  /** Sessions attended, weighted by the late policy (null when that policy is missing and needed). */
  attended: number | null;
  /** 0–100, two decimals; null when not computable. */
  rate: number | null;
  policyMissing: boolean;
}

export function bucketOf(flags: AttendanceStatusFlags | undefined | null, code?: string): AttendanceBucket {
  if (!flags) {
    // A code with no configuration row: only the conventional codes are known.
    if (code === 'late') return 'late';
    if (code === 'present') return 'present';
    if (code === 'excused') return 'excused';
    if (code === 'absent') return 'absent';
    return 'other';
  }
  if (flags.isLate) return 'late';
  if (flags.isPresent) return 'present';
  if (flags.isExcused) return 'excused';
  if (flags.isAbsent) return 'absent';
  return 'other';
}

/** Summarize (status code → count) pairs against the catalogue and the school's policy. */
export function summarizeAttendance(
  counts: Iterable<[string, number]>,
  catalog: Record<string, AttendanceStatusFlags | undefined>,
  policy: AttendancePolicy,
): AttendanceSummary {
  const out = { sessions: 0, present: 0, late: 0, excused: 0, absent: 0, other: 0 };
  for (const [code, n] of counts) {
    if (!n) continue;
    out.sessions += n;
    out[bucketOf(catalog[code], code)] += n;
  }
  const denominator = out.present + out.late + out.absent + (policy.excusedInDenominator ? out.excused : 0);
  const policyMissing = out.late > 0 && policy.lateContribution == null;
  const attended = policyMissing ? null : out.present + out.late * (policy.lateContribution ?? 1);
  const rate = attended == null || denominator === 0 ? null : Math.round((attended / denominator) * 10000) / 100;
  return { ...out, denominator, attended, rate, policyMissing };
}

/** Count a list of status codes. */
export function countCodes(codes: Iterable<string>): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of codes) m.set(c, (m.get(c) ?? 0) + 1);
  return m;
}

/** The school's attendance policy (ADR-032 P1). */
export async function loadAttendancePolicy(db: any): Promise<AttendancePolicy> {
  const profile = await db.schoolProfile.findFirst({
    select: { attendanceLateContribution: true, attendanceExcusedInDenominator: true },
  });
  const raw = profile?.attendanceLateContribution;
  return {
    lateContribution: raw == null ? null : Number(raw),
    excusedInDenominator: profile?.attendanceExcusedInDenominator ?? false,
  };
}
