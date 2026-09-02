/**
 * Phase 1 domain rules — ADR-018 (enrollment lifecycle) and ADR-019 (grouping).
 *
 * These are the rules that must hold identically in the single-learner command,
 * the bulk importer and the validation preview, so they live in pure modules and
 * are tested here without a database.
 */
import {
  describeGrouping,
  resolveGroupingMode,
  validateGrouping,
  type GroupingModeValue,
} from '../../src/modules/school/enrollment/grouping';
import {
  ENROLLMENT_TRANSITIONS,
  canTransition,
  closeReasonFor,
  holdsPlacement,
  profileStatusFor,
  transitionError,
  type EnrollmentStatusValue,
} from '../../src/modules/school/enrollment/enrollment-fsm';

const CLASS_P5 = 'class-p5';
const CLASS_P6 = 'class-p6';

const sectionA = { id: 'sec-a', classId: CLASS_P5, name: 'A' };
const sectionB = { id: 'sec-b', classId: CLASS_P5, name: 'B' };
const sectionOtherClass = { id: 'sec-x', classId: CLASS_P6, name: 'A' };

const streamFlat = { id: 'str-blue', classId: CLASS_P5, sectionId: null, name: 'Blue' };
const streamUnderA = { id: 'str-red', classId: CLASS_P5, sectionId: sectionA.id, name: 'Red' };
const streamOtherClass = { id: 'str-y', classId: CLASS_P6, sectionId: null, name: 'Green' };

const base = (mode: GroupingModeValue) => ({ mode, cohortClassId: CLASS_P5 });

describe('grouping modes (ADR-019)', () => {
  describe('NONE', () => {
    it('accepts a placement with no subdivision', () => {
      expect(validateGrouping(base('NONE')).ok).toBe(true);
    });

    it('rejects a section or a stream', () => {
      const r = validateGrouping({ ...base('NONE'), sectionId: sectionA.id, section: sectionA });
      expect(r.ok).toBe(false);
      expect(r.errors.join(' ')).toContain('not subdivided');
    });
  });

  describe('SECTION_ONLY', () => {
    it('requires a section', () => {
      const r = validateGrouping(base('SECTION_ONLY'));
      expect(r.ok).toBe(false);
      expect(r.errors.join(' ')).toContain('choose a section');
    });

    it('accepts a section of the cohort class', () => {
      expect(validateGrouping({ ...base('SECTION_ONLY'), sectionId: sectionA.id, section: sectionA }).ok).toBe(true);
    });

    it('refuses a stream', () => {
      const r = validateGrouping({
        ...base('SECTION_ONLY'),
        sectionId: sectionA.id,
        section: sectionA,
        streamId: streamFlat.id,
        stream: streamFlat,
      });
      expect(r.ok).toBe(false);
      expect(r.errors.join(' ')).toContain('sections only');
    });

    it('refuses a section belonging to another class', () => {
      const r = validateGrouping({ ...base('SECTION_ONLY'), sectionId: sectionOtherClass.id, section: sectionOtherClass });
      expect(r.ok).toBe(false);
      expect(r.errors.join(' ')).toContain('different class');
    });
  });

  describe('STREAM_ONLY', () => {
    it('requires a stream and refuses a section', () => {
      const r = validateGrouping({ ...base('STREAM_ONLY'), sectionId: sectionA.id, section: sectionA });
      expect(r.ok).toBe(false);
      expect(r.errors.join(' ')).toContain('choose a stream');
      expect(r.errors.join(' ')).toContain('streams only');
    });

    it('accepts a stream of the cohort class', () => {
      expect(validateGrouping({ ...base('STREAM_ONLY'), streamId: streamFlat.id, stream: streamFlat }).ok).toBe(true);
    });

    it('refuses a stream from another class', () => {
      const r = validateGrouping({ ...base('STREAM_ONLY'), streamId: streamOtherClass.id, stream: streamOtherClass });
      expect(r.ok).toBe(false);
      expect(r.errors.join(' ')).toContain('different class');
    });
  });

  describe('SECTION_AND_STREAM', () => {
    it('accepts a stream that belongs to the selected section', () => {
      const r = validateGrouping({
        ...base('SECTION_AND_STREAM'),
        sectionId: sectionA.id,
        section: sectionA,
        streamId: streamUnderA.id,
        stream: streamUnderA,
      });
      expect(r.ok).toBe(true);
    });

    it('refuses a stream from a different section of the same class', () => {
      const r = validateGrouping({
        ...base('SECTION_AND_STREAM'),
        sectionId: sectionB.id,
        section: sectionB,
        streamId: streamUnderA.id,
        stream: streamUnderA,
      });
      expect(r.ok).toBe(false);
      expect(r.errors.join(' ')).toContain('different section');
    });

    it('refuses a stream that is not attached to any section', () => {
      const r = validateGrouping({
        ...base('SECTION_AND_STREAM'),
        sectionId: sectionA.id,
        section: sectionA,
        streamId: streamFlat.id,
        stream: streamFlat,
      });
      expect(r.ok).toBe(false);
      expect(r.errors.join(' ')).toContain('not attached to a section');
    });

    it('requires both parts', () => {
      const r = validateGrouping({ ...base('SECTION_AND_STREAM'), sectionId: sectionA.id, section: sectionA });
      expect(r.ok).toBe(false);
      expect(r.errors.join(' ')).toContain('choose a stream');
    });
  });

  it('reports a missing section rather than silently accepting the id', () => {
    const r = validateGrouping({ ...base('SECTION_ONLY'), sectionId: 'ghost', section: null });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('was not found');
  });

  it('resolves the effective mode: cohort override wins, then programme, then SECTION_ONLY', () => {
    expect(resolveGroupingMode('STREAM_ONLY', 'SECTION_ONLY')).toBe('STREAM_ONLY');
    expect(resolveGroupingMode(null, 'SECTION_AND_STREAM')).toBe('SECTION_AND_STREAM');
    expect(resolveGroupingMode(null, null)).toBe('SECTION_ONLY');
  });

  it('describes a grouping tuple for previews', () => {
    expect(describeGrouping(sectionA, streamUnderA)).toBe('A / Red');
    expect(describeGrouping(null, null)).toBe('no subdivision');
  });
});

describe('enrollment lifecycle (ADR-018)', () => {
  it('allows the ordinary school movements', () => {
    expect(canTransition('PENDING', 'ACTIVE')).toBe(true);
    expect(canTransition('ACTIVE', 'SUSPENDED')).toBe(true);
    expect(canTransition('ACTIVE', 'WITHDRAWN')).toBe(true);
    expect(canTransition('ACTIVE', 'TRANSFERRED')).toBe(true);
    expect(canTransition('ACTIVE', 'COMPLETED')).toBe(true);
    expect(canTransition('WITHDRAWN', 'ACTIVE')).toBe(true);
    expect(canTransition('TRANSFERRED', 'ACTIVE')).toBe(true);
  });

  it('treats COMPLETED and CANCELLED as terminal', () => {
    expect(ENROLLMENT_TRANSITIONS.COMPLETED).toHaveLength(0);
    expect(ENROLLMENT_TRANSITIONS.CANCELLED).toHaveLength(0);
    expect(canTransition('COMPLETED', 'ACTIVE')).toBe(false);
    expect(transitionError('COMPLETED', 'ACTIVE')).toContain('terminal');
  });

  it('refuses a jump straight from PENDING to WITHDRAWN', () => {
    expect(canTransition('PENDING', 'WITHDRAWN')).toBe(false);
    expect(transitionError('PENDING', 'WITHDRAWN')).toContain('ACTIVE, CANCELLED');
  });

  it('keeps a suspended learner on the class roll', () => {
    expect(holdsPlacement('SUSPENDED')).toBe(true);
    expect(holdsPlacement('ACTIVE')).toBe(true);
    expect(holdsPlacement('PENDING')).toBe(true);
    expect(holdsPlacement('WITHDRAWN')).toBe(false);
    expect(holdsPlacement('TRANSFERRED')).toBe(false);
    expect(holdsPlacement('COMPLETED')).toBe(false);
  });

  it('names the reason a placement was closed', () => {
    expect(closeReasonFor('WITHDRAWN')).toBe('WITHDRAWAL');
    expect(closeReasonFor('TRANSFERRED')).toBe('TRANSFER_OUT');
    expect(closeReasonFor('COMPLETED')).toBe('COMPLETION');
    expect(closeReasonFor('ACTIVE')).toBeNull();
  });

  it('projects a profile status for every membership status', () => {
    const statuses: EnrollmentStatusValue[] = ['ACTIVE', 'SUSPENDED', 'WITHDRAWN', 'TRANSFERRED', 'COMPLETED', 'CANCELLED'];
    for (const s of statuses) expect(profileStatusFor(s)).toBeTruthy();
    // PENDING is not yet a pupil, so the profile is deliberately left alone.
    expect(profileStatusFor('PENDING')).toBeNull();
  });
});
