/**
 * ADR-018 — StudentEnrollment lifecycle.
 *
 * Membership states, and what a movement does to the learner's open placement.
 * Pure so the transition table is unit-testable and so the identical rules run
 * in the single-learner command, the bulk importer and the validation preview.
 */

export type EnrollmentStatusValue =
  | 'PENDING'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'WITHDRAWN'
  | 'TRANSFERRED'
  | 'COMPLETED'
  | 'CANCELLED';

export const ENROLLMENT_STATUSES: readonly EnrollmentStatusValue[] = [
  'PENDING',
  'ACTIVE',
  'SUSPENDED',
  'WITHDRAWN',
  'TRANSFERRED',
  'COMPLETED',
  'CANCELLED',
] as const;

export type EnrollmentTypeValue = 'NEW' | 'CONTINUING' | 'REPEAT' | 'TRANSFER_IN' | 'RE_ENTRY';

export const ENROLLMENT_TYPES: readonly EnrollmentTypeValue[] = [
  'NEW',
  'CONTINUING',
  'REPEAT',
  'TRANSFER_IN',
  'RE_ENTRY',
] as const;

export type MovementReasonValue =
  | 'INITIAL_PLACEMENT'
  | 'TERM_ROLLOVER'
  | 'CLASS_CHANGE'
  | 'SECTION_CHANGE'
  | 'STREAM_CHANGE'
  | 'PROMOTION'
  | 'REPEAT'
  | 'LATE_ADMISSION'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'WITHDRAWAL'
  | 'RE_ENTRY'
  | 'SUSPENSION'
  | 'COMPLETION'
  | 'CORRECTION'
  | 'BACKFILL'
  /** Finished the ladder: a terminal grade promoted into nothing (brief §13). */
  | 'GRADUATION';

export const MOVEMENT_REASONS: readonly MovementReasonValue[] = [
  'INITIAL_PLACEMENT',
  'TERM_ROLLOVER',
  'CLASS_CHANGE',
  'SECTION_CHANGE',
  'STREAM_CHANGE',
  'PROMOTION',
  'REPEAT',
  'LATE_ADMISSION',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'WITHDRAWAL',
  'RE_ENTRY',
  'SUSPENSION',
  'COMPLETION',
  'CORRECTION',
  'BACKFILL',
  'GRADUATION',
] as const;

/**
 * Allowed status transitions.
 *
 * COMPLETED and CANCELLED are terminal: a learner who finished the year or
 * whose enrollment was voided does not come back on the same row — they get a
 * new academic year's enrollment. WITHDRAWN and TRANSFERRED reopen to ACTIVE
 * because re-entry within the same year is an ordinary school event and the
 * history stays intact either way (placements are append-only).
 *
 * SUSPENDED → COMPLETED: a pupil suspended in the last weeks of the year still
 * finished it. Without this edge promotion, repeat and graduation all failed
 * for every suspended learner and the year-end rollover silently skipped them
 * (E2E audit L1).
 */
export const ENROLLMENT_TRANSITIONS: Readonly<Record<EnrollmentStatusValue, readonly EnrollmentStatusValue[]>> = {
  PENDING: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['SUSPENDED', 'WITHDRAWN', 'TRANSFERRED', 'COMPLETED'],
  SUSPENDED: ['ACTIVE', 'WITHDRAWN', 'TRANSFERRED', 'COMPLETED', 'CANCELLED'],
  WITHDRAWN: ['ACTIVE'],
  TRANSFERRED: ['ACTIVE'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransition(from: EnrollmentStatusValue, to: EnrollmentStatusValue): boolean {
  return ENROLLMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function transitionError(from: EnrollmentStatusValue, to: EnrollmentStatusValue): string {
  const allowed = ENROLLMENT_TRANSITIONS[from] ?? [];
  return (
    `Cannot move an enrollment from '${from}' to '${to}'. ` +
    (allowed.length ? `Allowed from '${from}': ${allowed.join(', ')}.` : `'${from}' is a terminal state.`)
  );
}

/**
 * Statuses in which the learner is still a member of a class and therefore
 * holds an OPEN placement. A suspended pupil is still on the class roll — they
 * are excluded from marking by participation status, not by losing their seat.
 */
export const PLACEMENT_HOLDING_STATUSES: readonly EnrollmentStatusValue[] = ['PENDING', 'ACTIVE', 'SUSPENDED'];

/**
 * Statuses from which a learner may move on to next year (promote, repeat,
 * graduate). COMPLETED is the year already closed ("Mark the year complete",
 * then promote). A WITHDRAWN or TRANSFERRED learner left the school: promoting
 * them used to mint an ACTIVE next-year enrollment for a pupil who is gone
 * (E2E audit L1). PENDING never sat in a class; CANCELLED never existed.
 */
export const PROGRESSABLE_STATUSES: readonly EnrollmentStatusValue[] = ['ACTIVE', 'SUSPENDED', 'COMPLETED'];

export function canProgress(status: EnrollmentStatusValue): boolean {
  return PROGRESSABLE_STATUSES.includes(status);
}

/** Statuses an enrollment may be CREATED in. Every other status is reached through the FSM. */
export const CREATABLE_STATUSES: readonly EnrollmentStatusValue[] = ['PENDING', 'ACTIVE'];

/** Leaving a school and coming back: needs the re-entry grant, not just enrollment write. */
export function isReactivation(from: EnrollmentStatusValue, to: EnrollmentStatusValue): boolean {
  return (from === 'WITHDRAWN' || from === 'TRANSFERRED') && to === 'ACTIVE';
}

export function holdsPlacement(status: EnrollmentStatusValue): boolean {
  return PLACEMENT_HOLDING_STATUSES.includes(status);
}

/** The movement reason that closes a placement when the enrollment reaches `to`. */
export function closeReasonFor(to: EnrollmentStatusValue): MovementReasonValue | null {
  switch (to) {
    case 'WITHDRAWN':
      return 'WITHDRAWAL';
    case 'TRANSFERRED':
      return 'TRANSFER_OUT';
    case 'COMPLETED':
      return 'COMPLETION';
    case 'CANCELLED':
      return 'CORRECTION';
    default:
      return null;
  }
}

/** The `StudentProfile.status` projection for a membership status. */
export function profileStatusFor(status: EnrollmentStatusValue): string | null {
  switch (status) {
    case 'PENDING':
      return null; // not yet a pupil — leave the profile untouched
    case 'ACTIVE':
      return 'active';
    case 'SUSPENDED':
      return 'suspended';
    case 'WITHDRAWN':
    case 'CANCELLED':
      return 'withdrawn';
    case 'TRANSFERRED':
      return 'transferred';
    case 'COMPLETED':
      // `alumni` is a legacy value the enum keeps only for old rows.
      return 'graduated';
    default:
      return null;
  }
}
