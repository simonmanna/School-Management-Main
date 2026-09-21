/**
 * Per-school display vocabulary (brief §2, ADR-029).
 *
 * Schools do not agree on what to call the parts of their academic structure.
 * The same subdivision of a class is a "Stream" in Uganda, a "Section" in much of
 * Asia, a "Class" in parts of Europe and a "House" where it maps to a pastoral
 * group. The same is true one level up: Grade, Class, Level, Year, Form.
 *
 * The DOMAIN never bends to this. Internally there is one `SchoolClass` and one
 * `Section`, whatever a school calls them, because the alternative is a schema
 * that has to be migrated when a school changes its mind about a word.
 *
 * Only the words bend. A school stores its overrides in
 * `SchoolProfile.terminology` and every label it sees is resolved through here.
 *
 * These defaults live in `@erp/shared` rather than in the web app on purpose:
 * the API uses them too, in validation and error messages. If they lived only in
 * the client, the server could say "choose a section" while the interface said
 * "choose a Stream", which is exactly the confusion this is meant to end.
 */

/** The vocabulary a school may override. */
export interface Terminology {
  /** The band above a grade: Pre-Primary, Primary, Secondary. */
  academicLevel: string;
  academicLevelPlural: string;
  /** The rung on the ladder: P4, Grade 6, Form 1. */
  gradeLevel: string;
  gradeLevelPlural: string;
  /** The teaching group: P4, Grade 6B. */
  class: string;
  classPlural: string;
  /** The subdivision of a class: North, 6A, Red. */
  section: string;
  sectionPlural: string;
  academicYear: string;
  academicYearPlural: string;
  term: string;
  termPlural: string;
  /** What the school calls the people it teaches. */
  learner: string;
  learnerPlural: string;
}

export type TerminologyKey = keyof Terminology;

/**
 * Ugandan-neutral English defaults.
 *
 * `section: 'Stream'` is the one that looks surprising. It is correct: the
 * database calls the subdivision `Section`, but almost every Ugandan school —
 * and the brief — calls it a Stream. The default therefore shows "Stream" while
 * the domain keeps `Section`, which is the whole point of this module.
 */
export const TERMINOLOGY_DEFAULTS: Readonly<Terminology> = Object.freeze({
  academicLevel: 'Level',
  academicLevelPlural: 'Levels',
  gradeLevel: 'Grade',
  gradeLevelPlural: 'Grades',
  class: 'Class',
  classPlural: 'Classes',
  section: 'Stream',
  sectionPlural: 'Streams',
  academicYear: 'Academic Year',
  academicYearPlural: 'Academic Years',
  term: 'Term',
  termPlural: 'Terms',
  learner: 'Pupil',
  learnerPlural: 'Pupils',
});

export const TERMINOLOGY_KEYS: readonly TerminologyKey[] = Object.freeze(
  Object.keys(TERMINOLOGY_DEFAULTS) as TerminologyKey[],
);

/** Longest label we will store. Long enough for "Advanced Secondary Section". */
const MAX_LABEL_LENGTH = 40;

export interface TerminologyValidationError {
  key: string;
  reason: string;
}

/**
 * Validate a terminology override submitted by a school.
 *
 * Rejects unknown keys rather than ignoring them: a typo like `sections` that is
 * silently dropped looks to the administrator exactly like a feature that does
 * not work.
 */
export function validateTerminology(raw: unknown): TerminologyValidationError[] {
  const errors: TerminologyValidationError[] = [];
  if (raw === null || raw === undefined) return errors;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return [{ key: '(root)', reason: 'Terminology must be an object of label overrides.' }];
  }

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(TERMINOLOGY_KEYS as string[]).includes(key)) {
      errors.push({
        key,
        reason:
          `"${key}" is not a terminology label. Valid labels: ` +
          TERMINOLOGY_KEYS.join(', ') + '.',
      });
      continue;
    }
    if (typeof value !== 'string') {
      errors.push({ key, reason: `"${key}" must be text.` });
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      errors.push({ key, reason: `"${key}" cannot be blank. Omit it to use the default.` });
      continue;
    }
    if (trimmed.length > MAX_LABEL_LENGTH) {
      errors.push({ key, reason: `"${key}" must be ${MAX_LABEL_LENGTH} characters or fewer.` });
    }
  }
  return errors;
}

/**
 * Merge a school's stored overrides over the defaults.
 *
 * Total by construction — it always returns a complete, usable vocabulary. A
 * malformed or partially malformed blob degrades to the defaults for the keys it
 * got wrong rather than throwing, because a bad label is never a good reason to
 * fail a page that was only trying to render a heading. Use
 * `validateTerminology` on the write path, where refusing IS the right answer.
 */
export function resolveTerminology(raw: unknown): Terminology {
  const out: Terminology = { ...TERMINOLOGY_DEFAULTS };
  if (raw === null || raw === undefined) return out;
  if (typeof raw !== 'object' || Array.isArray(raw)) return out;

  for (const key of TERMINOLOGY_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_LABEL_LENGTH) continue;
    out[key] = trimmed;
  }
  return out;
}

/**
 * Lower-case a label for mid-sentence use.
 *
 * Labels are stored capitalised because most uses are headings and buttons, but
 * "This Class is organised into Streams — choose a Stream" reads as though the
 * words were pasted in. Acronyms and deliberate internal capitals are left alone,
 * so "P4" and "McMillan House" survive.
 */
export function lowerLabel(label: string): string {
  if (label.length === 0) return label;
  const rest = label.slice(1);
  if (rest !== rest.toLowerCase()) return label;
  return label.charAt(0).toLowerCase() + rest;
}
