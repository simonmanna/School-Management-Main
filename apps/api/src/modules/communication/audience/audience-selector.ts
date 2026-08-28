import { BadRequestException } from '@nestjs/common';

/**
 * Who a message is for, as data.
 *
 * A school broadcast is never addressed to a list of phone numbers — it is
 * addressed to "P5 East's parents" or "every boarder's guardian". The roster
 * changes daily, so the audience has to be resolved at SEND time from the
 * selector, not frozen into a contact list at compose time. A student who
 * transferred in yesterday must receive today's closure notice; one who withdrew
 * must not.
 *
 * This is a structured selector rather than the `scheme:arg` strings
 * RecipientResolverService uses for event rules, because the broadcast composer
 * needs to round-trip it through a form, count it before sending, and store it
 * on the broadcast for the audit trail.
 */

export const AUDIENCE_SCOPES = [
  'all',
  'class',
  'grade',
  'section',
  'stream',
  'campus',
  'house',
  'residence',
  'students',
  'staff',
  'department',
] as const;

export type AudienceScope = (typeof AUDIENCE_SCOPES)[number];

export const RECIPIENT_KINDS = ['guardians', 'students', 'both'] as const;
export type RecipientKind = (typeof RECIPIENT_KINDS)[number];

export interface AudienceSelector {
  scope: AudienceScope;
  /**
   * Meaning depends on scope: class/grade/section/stream/campus/department ids,
   * explicit studentProfile ids for 'students', or the literal house /
   * residence-type values. Ignored (and must be empty) for 'all' and 'staff'.
   */
  ids?: string[];
  /** Student-derived scopes only. Default 'guardians' — parents, not children. */
  recipients?: RecipientKind;
  /**
   * Send to the primary guardian alone. Default true: a family with a mother,
   * father and an uncle on file should not receive three copies (and three SMS
   * charges) of the same closure notice.
   */
  primaryGuardianOnly?: boolean;
  /** Restrict to guardians flagged `receivesStatements` — for fee-related sends. */
  statementRecipientsOnly?: boolean;
  /** Student statuses to include. Default ['active']. */
  studentStatus?: string[];
  /** 'staff'/'department' scope: teaching | non_teaching | admin | support. */
  staffCategory?: string[];
  /**
   * per_recipient (default): one message per reachable person, however many of
   *   their children match. The right shape for "school closed Friday".
   * per_student: one message per matching student, so `{{student.name}}` and
   *   `{{student.balance}}` mean something. The right shape for fee reminders,
   *   and the reason a parent of three legitimately gets three messages.
   */
  dedupe?: 'per_recipient' | 'per_student';
}

/**
 * Validate a selector from the wire. Throws with the specific problem rather
 * than resolving to an empty audience — "your broadcast reached 0 people" hours
 * later is a far worse failure than a rejected form.
 */
export function parseAudienceSelector(input: unknown): Required<
  Pick<AudienceSelector, 'scope' | 'ids' | 'recipients' | 'dedupe' | 'studentStatus'>
> &
  AudienceSelector {
  const s = (input ?? {}) as AudienceSelector;

  if (!s.scope || !AUDIENCE_SCOPES.includes(s.scope)) {
    throw new BadRequestException(`audience.scope must be one of: ${AUDIENCE_SCOPES.join(', ')}`);
  }
  const recipients = s.recipients ?? 'guardians';
  if (!RECIPIENT_KINDS.includes(recipients)) {
    throw new BadRequestException(`audience.recipients must be one of: ${RECIPIENT_KINDS.join(', ')}`);
  }

  const ids = (s.ids ?? []).filter((v) => typeof v === 'string' && v.length > 0);
  const needsIds = !['all', 'staff'].includes(s.scope);
  if (needsIds && ids.length === 0) {
    throw new BadRequestException(`audience.ids is required for scope '${s.scope}'`);
  }
  if (!needsIds && ids.length > 0 && s.scope === 'all') {
    throw new BadRequestException("audience.ids is not meaningful for scope 'all'");
  }

  const dedupe = s.dedupe ?? 'per_recipient';
  if (!['per_recipient', 'per_student'].includes(dedupe)) {
    throw new BadRequestException("audience.dedupe must be 'per_recipient' or 'per_student'");
  }

  const studentStatus = s.studentStatus?.length ? s.studentStatus : ['active'];

  return {
    ...s,
    scope: s.scope,
    ids,
    recipients,
    dedupe,
    studentStatus,
    primaryGuardianOnly: s.primaryGuardianOnly ?? true,
    statementRecipientsOnly: s.statementRecipientsOnly ?? false,
  };
}

/** Short human label for the audit log and the delivery report header. */
export function describeSelector(s: AudienceSelector, names?: Map<string, string>): string {
  const label = (id: string) => names?.get(id) ?? id;
  const list = (s.ids ?? []).map(label).join(', ');
  const who =
    s.scope === 'staff' || s.scope === 'department'
      ? 'staff'
      : s.recipients === 'both'
        ? 'guardians + students'
        : (s.recipients ?? 'guardians');
  switch (s.scope) {
    case 'all':
      return `All students → ${who}`;
    case 'students':
      return `${s.ids?.length ?? 0} selected student(s) → ${who}`;
    case 'staff':
      return s.staffCategory?.length ? `Staff (${s.staffCategory.join(', ')})` : 'All staff';
    case 'department':
      return `Department: ${list}`;
    default:
      return `${s.scope[0].toUpperCase()}${s.scope.slice(1)}: ${list} → ${who}`;
  }
}
