import { TERMINOLOGY_DEFAULTS } from '@erp/shared';
/**
 * Subdivision rules (ADR-029).
 *
 * A class is either subdivided or it is not. `Section` is the one subdivision
 * (shown to users under the school's own word — "Section", "House", a stream — whatever the school's
 * terminology says), so the choice is a boolean.
 *
 * Everything here is pure: the caller fetches the rows, this decides whether the
 * combination is legal. The rules are the part worth unit-testing, and they must
 * be identical whether they run in placement, bulk import or preview.
 */

export interface SectionRef {
  id: string;
  classId: string;
  name?: string;
  isActive?: boolean;
}

export interface SubdivisionInput {
  /** Whether this cohort's class is subdivided at all. */
  allowsSubdivision: boolean;
  /** The class the annual cohort belongs to. */
  cohortClassId: string;
  /**
   * Whether the class has any ACTIVE section to choose from. A subdivided class
   * that has not created its sections yet still accepts a class-only placement:
   * the brief (§10) makes the stream optional, and there is nothing to choose.
   */
  classHasActiveSections: boolean;
  /** Requested section id, or null/undefined when none was chosen. */
  sectionId?: string | null;
  /** The Section row for `sectionId`, or null when it could not be found. */
  section?: SectionRef | null;
  /** Singular label for error messages, from the school's terminology. */
  label?: string;
  /** Whether an inactive section may be used (e.g. repairing history). Default false. */
  allowInactive?: boolean;
}

export interface SubdivisionResult {
  ok: boolean;
  errors: string[];
  value: { sectionId: string | null };
}

const lower = (s: string): string => (s.length ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/**
 * Validate a subdivision choice for a placement.
 *
 * In the order a person would check them:
 *   1. A referenced section must exist.
 *   2. It must belong to the cohort's own class — what stops "P5 North" being
 *      chosen for a P6 learner.
 *   3. It must be active, unless explicitly allowed.
 *   4. An undivided class takes no section; a divided class with sections
 *      requires one.
 */
export function validateSubdivision(input: SubdivisionInput): SubdivisionResult {
  const errors: string[] = [];
  const label = input.label ?? TERMINOLOGY_DEFAULTS.section;
  const sectionId = input.sectionId ?? null;

  if (sectionId && !input.section) {
    errors.push(`${label} ${sectionId} was not found in this school.`);
  }
  if (input.section && input.section.classId !== input.cohortClassId) {
    errors.push(
      `${label} "${input.section.name ?? input.section.id}" belongs to a different class. ` +
        `A ${lower(label)} can only be chosen from the learner's own class.`,
    );
  }
  if (input.section && input.section.isActive === false && !input.allowInactive) {
    errors.push(
      `${label} "${input.section.name ?? input.section.id}" has been deactivated. ` +
        'Existing records keep it, but new placements cannot use it.',
    );
  }

  if (!input.allowsSubdivision && sectionId) {
    errors.push(`This class is not divided into ${lower(label)}s, so a ${lower(label)} cannot be chosen.`);
  }
  if (input.allowsSubdivision && !sectionId && input.classHasActiveSections) {
    errors.push(`This class is divided into ${lower(label)}s — choose one.`);
  }

  return { ok: errors.length === 0, errors, value: { sectionId } };
}

/**
 * Whether a cohort is subdivided.
 *
 * Precedence: the cohort's own override, then the class switch, then yes.
 */
export function resolveAllowsSubdivision(args: {
  cohortOverride?: boolean | null;
  classAllowsStreams?: boolean | null;
}): boolean {
  if (args.cohortOverride !== null && args.cohortOverride !== undefined) return args.cohortOverride;
  return args.classAllowsStreams !== false;
}

/** A one-line label for a placement's subdivision, for previews and messages. */
export function describeSubdivision(section?: { name?: string } | null): string {
  return section?.name ?? 'no subdivision';
}
