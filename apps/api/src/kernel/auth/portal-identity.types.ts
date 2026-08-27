/**
 * The portal claim carried on an access token.
 *
 * Design note — what is and is NOT in the token:
 *
 * The claim carries only the caller's OWN, stable subject ids: a student's
 * `studentProfileId`, or a guardian's `guardianContactId` list. It deliberately
 * does NOT carry the list of children a guardian may see. That set is resolved
 * live from `StudentGuardian` on every check, so removing a guardianship takes
 * effect immediately rather than at the end of the access token's 15-minute life.
 * Revocation latency matters more here than one indexed lookup per request.
 */
export interface PortalClaim {
  kind: 'student' | 'guardian';
  /** Set iff kind === 'student'. */
  studentProfileId?: string;
  /** Set iff kind === 'guardian'. One entry per guardianship contact row. */
  guardianContactIds?: string[];
}

/** Resolved caller identity for school endpoints. Produced only from a verified token. */
export type SchoolPrincipal =
  | { kind: 'staff'; userId: string }
  | { kind: 'student'; userId: string; studentProfileId: string }
  | { kind: 'guardian'; userId: string; guardianContactIds: string[] };
