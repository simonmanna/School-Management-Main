import { ViewEnvelopeService } from '../../src/modules/school/lms/moodle/course/view-envelope.service';

/**
 * L1.1 — the display envelope, and the mark-release rule it enforces.
 *
 * Two things are load-bearing here:
 *  1. Activity NAMES. `CourseModule` has no name column — the name lives in the
 *     plugin's instance row — which is why the course page used to render
 *     "quiz · a3f8b21c".
 *  2. Mark RELEASE. A score reaches a learner only once moderation has approved
 *     it; an entered-but-unapproved mark must never appear, and must never be
 *     rendered as a zero.
 */
function build(opts: {
  summaries?: Record<string, { name: string; intro?: string | null }>;
  assessments?: any[];
  marks?: any[];
  completions?: any[];
} = {}) {
  const { summaries = {}, assessments = [], marks = [], completions = [] } = opts;

  const summariesFn = jest.fn(async (ids: string[]) =>
    new Map(ids.filter((i) => summaries[i]).map((i) => [i, summaries[i]])));

  const registry = {
    has: () => true,
    get: () => ({
      features: { gradable: true, icon: 'ListChecks', label: 'Quiz' },
      instanceSummaries: summariesFn,
    }),
  } as any;

  const prisma = {
    client: {
      assessment: { findMany: jest.fn(async () => assessments) },
      studentAssessment: { findMany: jest.fn(async () => marks) },
      courseModuleCompletion: { findMany: jest.fn(async () => completions), count: jest.fn(async () => 0) },
      courseModule: { findMany: jest.fn(async () => []) },
      studentProfile: { findMany: jest.fn(async () => []) },
      user: { findMany: jest.fn(async () => []) },
      subject: { findFirst: jest.fn(async () => ({ name: 'Mathematics' })) },
      schoolClass: { findFirst: jest.fn(async () => ({ name: 'S2 Blue' })) },
      term: { findFirst: jest.fn(async () => ({ name: 'Term 1' })) },
      academicYear: { findFirst: jest.fn(async () => ({ name: '2026' })) },
    },
  } as any;

  const caps = { effectiveAtCourse: jest.fn(async () => ({ 'lms/course:view': true, 'lms/grade:edit': false })) } as any;
  const portalIdentity = { principal: () => ({ kind: 'staff', userId: 'u1' }) } as any;
  const svc = new ViewEnvelopeService(prisma, { organizationId: 'org_1' } as any, registry, caps, portalIdentity);
  return { svc, summariesFn, prisma };
}

const MODULE = {
  id: 'cm_1', activityType: 'quiz', instanceId: 'inst_1', sectionId: 'sec_1', sequence: 0,
  visible: true, completionMode: 'automatic', completionRules: {}, assessmentId: 'a_1',
  openAt: null, dueAt: null, cutoffAt: null,
} as any;

describe('LMS view envelope', () => {
  describe('names', () => {
    it('resolves the activity name from the plugin instance', async () => {
      const { svc } = build({ summaries: { inst_1: { name: 'Week 1 quiz', intro: '<p>Go</p>' } } });
      const [v] = await svc.moduleViews([MODULE], { showGrades: false });
      expect(v.name).toBe('Week 1 quiz');
      expect(v.intro).toBe('<p>Go</p>');
      // No uuid fragment anywhere in what the client renders.
      expect(v.name).not.toContain(MODULE.id.slice(0, 8));
    });

    it('falls back to the type label when the instance row has gone', async () => {
      // An orphan: the nightly check reports it; the page must still be readable.
      const { svc } = build({ summaries: {} });
      const [v] = await svc.moduleViews([MODULE], { showGrades: false });
      expect(v.name).toBe('Quiz');
    });

    it('asks each plugin once per type, not once per module', async () => {
      const { svc, summariesFn } = build({ summaries: { a: { name: 'A' }, b: { name: 'B' } } });
      await svc.moduleViews(
        [{ ...MODULE, id: 'cm_a', instanceId: 'a' }, { ...MODULE, id: 'cm_b', instanceId: 'b' }],
        { showGrades: false },
      );
      expect(summariesFn).toHaveBeenCalledTimes(1);
      expect(summariesFn).toHaveBeenCalledWith(['a', 'b']);
    });
  });

  describe('grade release', () => {
    const assessments = [{ id: 'a_1', maxScore: 20, hiddenFromStudents: false }];

    it('withholds a mark that moderation has not approved', async () => {
      const { svc } = build({
        summaries: { inst_1: { name: 'Quiz' } },
        assessments,
        marks: [{ assessmentId: 'a_1', effectiveScore: 17, percentage: 85, approvalStatus: 'submitted', status: 'graded' }],
      });
      const [v] = await svc.moduleViews([MODULE], { studentProfileId: 'sp_1', showGrades: true });
      expect(v.grade?.released).toBe(false);
      // Null, never 0 — a pupil reads a zero as "I scored nothing".
      expect(v.grade?.score).toBeNull();
      expect(v.grade?.percentage).toBeNull();
      expect(v.grade?.maxScore).toBe(20);
    });

    it('releases an approved mark', async () => {
      const { svc } = build({
        summaries: { inst_1: { name: 'Quiz' } },
        assessments,
        marks: [{ assessmentId: 'a_1', effectiveScore: 17, percentage: 85, approvalStatus: 'approved', status: 'graded' }],
      });
      const [v] = await svc.moduleViews([MODULE], { studentProfileId: 'sp_1', showGrades: true });
      expect(v.grade).toMatchObject({ released: true, score: 17, percentage: 85, maxScore: 20 });
    });

    it('omits a column the teacher has hidden from students', async () => {
      const { svc } = build({
        summaries: { inst_1: { name: 'Quiz' } },
        assessments: [{ id: 'a_1', maxScore: 20, hiddenFromStudents: true }],
        marks: [{ assessmentId: 'a_1', effectiveScore: 17, approvalStatus: 'approved', status: 'graded' }],
      });
      const [v] = await svc.moduleViews([MODULE], { studentProfileId: 'sp_1', showGrades: true });
      expect(v.grade).toBeNull();
    });

    it('carries no grade at all when the course withholds grades', async () => {
      const { svc } = build({ summaries: { inst_1: { name: 'Quiz' } }, assessments });
      const [v] = await svc.moduleViews([MODULE], { studentProfileId: 'sp_1', showGrades: false });
      expect(v.grade).toBeNull();
    });
  });

  describe('completion', () => {
    it('reports incomplete when the student has no row yet', async () => {
      const { svc } = build({ summaries: { inst_1: { name: 'Quiz' } } });
      const [v] = await svc.moduleViews([MODULE], { studentProfileId: 'sp_1', showGrades: false });
      expect(v.completion).toMatchObject({ mode: 'automatic', state: 'incomplete' });
    });

    it('carries no completion block for an untracked activity', async () => {
      const { svc } = build({ summaries: { inst_1: { name: 'Quiz' } } });
      const [v] = await svc.moduleViews([{ ...MODULE, completionMode: 'none' }], {
        studentProfileId: 'sp_1', showGrades: false,
      });
      expect(v.completion).toBeNull();
    });
  });

  describe('course header', () => {
    it('composes a readable name — CourseOffering has no name column', async () => {
      const { svc } = build();
      const header = await svc.courseHeader({
        id: 'c1', subjectId: 's', classId: 'c', termId: 't', academicYearId: 'y',
        format: 'weeks', summary: null, visible: true, completionEnabled: true,
        showGradesToStudents: true, startDate: null, endDate: null,
      } as any);
      expect(header.name).toBe('Mathematics — S2 Blue (Term 1)');
      expect(header.subject).toBe('Mathematics');
    });
  });

  describe('capabilities', () => {
    it('returns only the capabilities actually held', async () => {
      const { svc } = build();
      await expect(svc.capabilitiesFor('c1')).resolves.toEqual(['lms/course:view']);
    });
  });
});
