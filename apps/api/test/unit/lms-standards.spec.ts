import { BadRequestException } from '@nestjs/common';
import { ModScormPlugin, ModWorkshopPlugin } from '../../src/modules/school/lms/moodle/plugins/standards.plugins';

/**
 * L8 — the behaviour behind the standards plugins' settings.
 *
 * Both had settings stored and ignored: SCORM took the latest raw score whatever
 * its `gradingMethod` said and allowed unlimited attempts; a workshop accepted
 * peer assessments during the submission phase, so reviewers marked half-finished
 * drafts.
 */
function scorm(opts: { instance?: any; tracks?: any[] } = {}) {
  const {
    instance = { id: 'i1', maxAttempts: 0, gradingMethod: 'highest', maxScore: 100 },
    tracks = [],
  } = opts;
  const setScore = jest.fn();
  const db: any = {
    modScorm: { findFirst: jest.fn(async () => instance) },
    scormTrack: {
      findMany: jest.fn(async () => tracks),
      upsert: jest.fn(async () => ({})),
      findFirst: jest.fn(async () => null),
    },
    assessment: { findFirst: jest.fn(async () => ({ id: 'a1', maxScore: 100 })) },
    studentAssessment: { upsert: jest.fn(async () => ({ id: 'sa1' })) },
  };
  const prisma = { client: { ...db, $transaction: jest.fn(async (cb: any) => cb(db)) } } as any;
  const plugin = new ModScormPlugin(prisma, { organizationId: 'org_1' } as any, { register: jest.fn() } as any, { setScore } as any);
  return { plugin, setScore };
}

function workshop(opts: { instance?: any; submissions?: any[]; allocations?: any[] } = {}) {
  const {
    instance = { id: 'w1', phase: 'submission', numReviewers: 2 },
    submissions = [],
    allocations = [],
  } = opts;
  const setScore = jest.fn();
  const created: any[] = [];
  const db: any = {
    modWorkshop: { findFirst: jest.fn(async () => instance), update: jest.fn(async () => ({})) },
    modWorkshopSubmission: {
      findMany: jest.fn(async () => submissions),
      findFirst: jest.fn(async () => null),
      create: jest.fn(async (a: any) => ({ id: 's_new', ...a.data })),
      update: jest.fn(async (a: any) => ({ id: a.where.id, ...a.data })),
    },
    modWorkshopAllocation: {
      findMany: jest.fn(async () => allocations),
      findFirst: jest.fn(async (a: any) => allocations.find((x) => x.id === a.where.id) ?? null),
      create: jest.fn(async (a: any) => { const r = { id: `al_${created.length}`, ...a.data }; created.push(r); return r; }),
      update: jest.fn(async (a: any) => ({ id: a.where.id, ...a.data })),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
    assessment: { findFirst: jest.fn(async () => ({ id: 'a1', maxScore: 100 })) },
    studentAssessment: { upsert: jest.fn(async () => ({ id: 'sa1' })) },
  };
  const prisma = { client: { ...db, $transaction: jest.fn(async (cb: any) => cb(db)) } } as any;
  const plugin = new ModWorkshopPlugin(prisma, { organizationId: 'org_1' } as any, { register: jest.fn() } as any, { setScore } as any);
  return { plugin, setScore, created };
}

const CM: any = { id: 'cm_1', instanceId: 'i1', courseOfferingId: 'c1', assessmentId: 'a1' };
const CTX: any = { organizationId: 'org_1', studentProfileId: 'sp_alice' };

describe('mod_scorm', () => {
  describe('attempt ceiling', () => {
    it('refuses an attempt beyond maxAttempts', async () => {
      const { plugin } = scorm({ instance: { id: 'i1', maxAttempts: 2, gradingMethod: 'highest' } });
      await expect(plugin.action(CTX, CM, 'commit', { attempt: 3, cmi: {} }))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows unlimited attempts when maxAttempts is 0', async () => {
      const { plugin } = scorm({ instance: { id: 'i1', maxAttempts: 0, gradingMethod: 'highest' } });
      await expect(plugin.action(CTX, CM, 'commit', { attempt: 99, cmi: {} })).resolves.toMatchObject({ ok: true });
    });
  });

  describe('grading method', () => {
    const tracks = [
      { attempt: 1, scoreRaw: 40 },
      { attempt: 2, scoreRaw: 80 },
      { attempt: 3, scoreRaw: 60 },
    ];

    it('takes the highest by default — re-opening a package cannot lower the mark', async () => {
      const { plugin, setScore } = scorm({ instance: { id: 'i1', maxAttempts: 0, gradingMethod: 'highest' }, tracks });
      await plugin.action(CTX, CM, 'commit', { attempt: 3, cmi: { 'cmi.core.score.raw': 60 } });
      expect(setScore).toHaveBeenCalledWith(expect.objectContaining({ score: 80 }), expect.anything());
    });

    it('honours "first"', async () => {
      const { plugin, setScore } = scorm({ instance: { id: 'i1', maxAttempts: 0, gradingMethod: 'first' }, tracks });
      await plugin.action(CTX, CM, 'commit', { attempt: 3, cmi: { 'cmi.core.score.raw': 60 } });
      expect(setScore).toHaveBeenCalledWith(expect.objectContaining({ score: 40 }), expect.anything());
    });

    it('honours "last"', async () => {
      const { plugin, setScore } = scorm({ instance: { id: 'i1', maxAttempts: 0, gradingMethod: 'last' }, tracks });
      await plugin.action(CTX, CM, 'commit', { attempt: 3, cmi: { 'cmi.core.score.raw': 60 } });
      expect(setScore).toHaveBeenCalledWith(expect.objectContaining({ score: 60 }), expect.anything());
    });

    it('honours "average"', async () => {
      const { plugin, setScore } = scorm({ instance: { id: 'i1', maxAttempts: 0, gradingMethod: 'average' }, tracks });
      await plugin.action(CTX, CM, 'commit', { attempt: 3, cmi: { 'cmi.core.score.raw': 60 } });
      expect(setScore).toHaveBeenCalledWith(expect.objectContaining({ score: 60 }), expect.anything());
    });

    it('posts no mark when the package reported no score', async () => {
      const { plugin, setScore } = scorm({ tracks: [] });
      await plugin.action(CTX, CM, 'commit', { attempt: 1, cmi: { 'cmi.core.lesson_status': 'incomplete' } });
      expect(setScore).not.toHaveBeenCalled();
    });
  });
});

describe('mod_workshop', () => {
  describe('phases', () => {
    it('refuses a submission outside the submission phase', async () => {
      const { plugin } = workshop({ instance: { id: 'i1', phase: 'assessment', numReviewers: 2 } });
      await expect(plugin.action(CTX, CM, 'submit', { title: 'x' }))
        .rejects.toThrow(/not accepting submissions/);
    });

    it('refuses an assessment during the submission phase — reviewers would mark drafts', async () => {
      const { plugin } = workshop({ instance: { id: 'i1', phase: 'submission', numReviewers: 2 } });
      await expect(plugin.action(CTX, CM, 'assess', { allocationId: 'al_1', grade: 8 }))
        .rejects.toThrow(/not accepting assessments/);
    });

    it('accepts a submission in the right phase', async () => {
      const { plugin } = workshop();
      await expect(plugin.action(CTX, CM, 'submit', { title: 'My essay' })).resolves.toMatchObject({ id: 's_new' });
    });
  });

  describe('peer allocation', () => {
    const submissions = [
      { id: 's1', studentProfileId: 'sp_a' },
      { id: 's2', studentProfileId: 'sp_b' },
      { id: 's3', studentProfileId: 'sp_c' },
    ];

    it('gives every submission the configured number of reviewers', async () => {
      const { plugin, created } = workshop({ instance: { id: 'i1', phase: 'submission', numReviewers: 2 }, submissions });
      const result: any = await plugin.action(CTX, CM, 'autoAllocate', {});
      expect(result.perSubmission).toBe(2);
      expect(created).toHaveLength(6); // 3 submissions × 2 reviewers
    });

    it('never allocates a pupil to review their own work', async () => {
      const { plugin, created } = workshop({ instance: { id: 'i1', phase: 'submission', numReviewers: 2 }, submissions });
      await plugin.action(CTX, CM, 'autoAllocate', {});
      const byId = new Map(submissions.map((s) => [s.id, s.studentProfileId]));
      for (const a of created) {
        expect(a.reviewerProfileId).not.toBe(byId.get(a.submissionId));
      }
    });

    it('refuses to allocate with fewer than two submissions', async () => {
      const { plugin } = workshop({ submissions: [{ id: 's1', studentProfileId: 'sp_a' }] });
      await expect(plugin.action(CTX, CM, 'autoAllocate', {})).rejects.toThrow(/at least two submissions/);
    });
  });

  describe('reviewer ownership', () => {
    it('refuses a pupil filling in someone else\'s allocated review', async () => {
      const { plugin } = workshop({
        instance: { id: 'i1', phase: 'assessment', numReviewers: 2 },
        allocations: [{ id: 'al_1', reviewerProfileId: 'sp_someone_else', submissionId: 's1' }],
      });
      await expect(plugin.action(CTX, CM, 'assess', { allocationId: 'al_1', grade: 9 }))
        .rejects.toThrow(/allocated to someone else/);
    });

    it('accepts the allocated reviewer', async () => {
      const { plugin } = workshop({
        instance: { id: 'i1', phase: 'assessment', numReviewers: 2 },
        allocations: [{ id: 'al_1', reviewerProfileId: 'sp_alice', submissionId: 's1' }],
      });
      await expect(plugin.action(CTX, CM, 'assess', { allocationId: 'al_1', grade: 9 })).resolves.toBeTruthy();
    });
  });

  describe('closing the workshop', () => {
    it('averages the peer reviews into the assessment spine', async () => {
      const { plugin, setScore } = workshop({
        instance: { id: 'i1', phase: 'assessment', numReviewers: 2 },
        submissions: [{ id: 's1', studentProfileId: 'sp_a' }],
        allocations: [{ id: 'al_1', grade: 8, submittedAt: new Date() }, { id: 'al_2', grade: 6, submittedAt: new Date() }],
      });
      await plugin.action(CTX, CM, 'setPhase', { phase: 'grading' });
      expect(setScore).toHaveBeenCalledWith(expect.objectContaining({ score: 7 }), expect.anything());
    });

    it('leaves an unreviewed submission UNMARKED rather than scoring it zero', async () => {
      const { plugin, setScore } = workshop({
        instance: { id: 'i1', phase: 'assessment', numReviewers: 2 },
        submissions: [{ id: 's1', studentProfileId: 'sp_a' }],
        allocations: [], // nobody reviewed it
      });
      await plugin.action(CTX, CM, 'setPhase', { phase: 'grading' });
      expect(setScore).not.toHaveBeenCalled();
    });

    it('rejects an unknown phase', async () => {
      const { plugin } = workshop();
      await expect(plugin.action(CTX, CM, 'setPhase', { phase: 'whenever' })).rejects.toThrow(/Unknown workshop phase/);
    });
  });
});
