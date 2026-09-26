/**
 * A released result is the school's answer to "what did this pupil get". Both
 * `published` and `locked` are released: locking freezes a published set, it
 * does not withdraw it (F16). Every authoritative reader uses this predicate.
 */
export const RELEASED_RESULT_STATUSES = ['published', 'locked'] as const;
export type ReleasedResultStatus = (typeof RELEASED_RESULT_STATUSES)[number];

export const releasedResultSetWhere = () => ({ status: { in: [...RELEASED_RESULT_STATUSES] } });

export const isReleasedStatus = (status: string | null | undefined): boolean =>
  !!status && (RELEASED_RESULT_STATUSES as readonly string[]).includes(status);

/** Pending (not yet released) result sets — at most one per scope. */
export const PENDING_RESULT_STATUSES = ['draft', 'computing', 'computed', 'approved'] as const;

/** Advisory-lock key shared by mark approval and result publication for a term. */
export const resultLockKey = (organizationId: string, termId: string) => `results:${organizationId}:${termId}`;
