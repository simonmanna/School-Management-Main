/**
 * ADR-019 — Section and Stream grouping modes.
 *
 * Section and Stream are NOT merged. A school configures which of them it
 * actually uses, and every placement, timetable slot, offering and roster
 * carries the same validated tuple.
 *
 * Everything here is pure: the caller fetches the rows, this decides whether the
 * combination is legal. That split is deliberate — the rules are the part worth
 * unit-testing, and they must be identical whether they run in the placement
 * service, the bulk importer or the validation preview.
 */

export type GroupingModeValue = 'NONE' | 'SECTION_ONLY' | 'STREAM_ONLY' | 'SECTION_AND_STREAM';

export const GROUPING_MODES: readonly GroupingModeValue[] = [
  'NONE',
  'SECTION_ONLY',
  'STREAM_ONLY',
  'SECTION_AND_STREAM',
] as const;

/** The minimal shape of the rows the rules need. */
export interface SectionRef {
  id: string;
  classId: string;
  name?: string;
}

export interface StreamRef {
  id: string;
  classId: string;
  sectionId: string | null;
  name?: string;
}

export interface GroupingInput {
  mode: GroupingModeValue;
  /** The class the annual cohort belongs to. */
  cohortClassId: string;
  /** Requested section id, or null/undefined when none was chosen. */
  sectionId?: string | null;
  /** Requested stream id, or null/undefined when none was chosen. */
  streamId?: string | null;
  /** The Section row for `sectionId`, or null when it could not be found. */
  section?: SectionRef | null;
  /** The Stream row for `streamId`, or null when it could not be found. */
  stream?: StreamRef | null;
}

export interface GroupingResult {
  ok: boolean;
  errors: string[];
  /** The tuple to persist once the input is legal. */
  value: { sectionId: string | null; streamId: string | null };
}

/**
 * Validate a section/stream selection against a grouping mode.
 *
 * The rules, in the order a person would check them:
 *
 *  1. A referenced section/stream must exist.
 *  2. It must belong to the cohort's own class — this is what stops a teacher
 *     picking "P5 Blue" for a P6 learner.
 *  3. The mode says which of the two are required and which are forbidden.
 *  4. In SECTION_AND_STREAM the stream must hang off the selected section.
 */
export function validateGrouping(input: GroupingInput): GroupingResult {
  const errors: string[] = [];
  const sectionId = input.sectionId ?? null;
  const streamId = input.streamId ?? null;

  if (sectionId && !input.section) {
    errors.push(`Section ${sectionId} was not found in this school.`);
  }
  if (streamId && !input.stream) {
    errors.push(`Stream ${streamId} was not found in this school.`);
  }
  if (input.section && input.section.classId !== input.cohortClassId) {
    errors.push(
      `Section "${input.section.name ?? input.section.id}" belongs to a different class than this cohort. ` +
        'Sections and streams are always tied to the same annual class cohort.',
    );
  }
  if (input.stream && input.stream.classId !== input.cohortClassId) {
    errors.push(
      `Stream "${input.stream.name ?? input.stream.id}" belongs to a different class than this cohort. ` +
        'Sections and streams are always tied to the same annual class cohort.',
    );
  }

  switch (input.mode) {
    case 'NONE':
      if (sectionId) errors.push('This class is not subdivided, so a section cannot be chosen.');
      if (streamId) errors.push('This class is not subdivided, so a stream cannot be chosen.');
      break;

    case 'SECTION_ONLY':
      if (!sectionId) errors.push('This class is organised into sections — choose a section.');
      if (streamId) errors.push('This class uses sections only, so a stream cannot be chosen.');
      break;

    case 'STREAM_ONLY':
      if (!streamId) errors.push('This class is organised into streams — choose a stream.');
      if (sectionId) errors.push('This class uses streams only, so a section cannot be chosen.');
      break;

    case 'SECTION_AND_STREAM':
      if (!sectionId) errors.push('This class is organised into sections and streams — choose a section.');
      if (!streamId) errors.push('This class is organised into sections and streams — choose a stream.');
      if (input.stream && sectionId) {
        if (input.stream.sectionId === null) {
          errors.push(
            `Stream "${input.stream.name ?? input.stream.id}" is not attached to a section. ` +
              'In section-and-stream mode every stream must belong to one section.',
          );
        } else if (input.stream.sectionId !== sectionId) {
          errors.push(
            `Stream "${input.stream.name ?? input.stream.id}" belongs to a different section than the one selected.`,
          );
        }
      }
      break;

    default:
      errors.push(`Unknown grouping mode "${String(input.mode)}".`);
  }

  return { ok: errors.length === 0, errors, value: { sectionId, streamId } };
}

/**
 * The effective mode for a cohort: the cohort's own override wins, then the
 * programme default, then SECTION_ONLY (what most Ugandan schools run).
 */
export function resolveGroupingMode(
  cohortMode: GroupingModeValue | null | undefined,
  programmeMode: GroupingModeValue | null | undefined,
): GroupingModeValue {
  return cohortMode ?? programmeMode ?? 'SECTION_ONLY';
}

/** A one-line label for a grouping tuple, used in previews and error messages. */
export function describeGrouping(section?: { name?: string } | null, stream?: { name?: string } | null): string {
  const parts = [section?.name, stream?.name].filter(Boolean);
  return parts.length ? parts.join(' / ') : 'no subdivision';
}
