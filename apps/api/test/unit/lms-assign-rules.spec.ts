import { BadRequestException } from '@nestjs/common';
import { ModAssignPlugin } from '../../src/modules/school/lms/moodle/plugins/adapters.plugins';

/**
 * L2/L3 — mod_assign submission rules.
 *
 * `cutoffDate` and `maxAttempts` were stored but never enforced: work could be
 * handed in indefinitely after the deadline a teacher set, and a pupil could
 * resubmit past their attempt limit. Blind marking likewise had a setting and no
 * behaviour.
 */
function build(opts: { instance?: any; existing?: any; profiles?: any[] } = {}) {
  const {
    instance = { id: 'inst_1', maxAttempts: 1, submissionTypes: ['online_text', 'file'], blindMarking: false },
    existing = null,
    profiles = [],
  } = opts;

  const upserted: any[] = [];
  const db: any = {
    modAssign: { findFirst: jest.fn(async () => instance) },
    modAssignSubmission: {
      findFirst: jest.fn(async () => existing),
      findMany: jest.fn(async () => (existing ? [existing] : [])),
      upsert: jest.fn(async (a: any) => { const row = { id: 'sub_1', ...a.create }; upserted.push(row); return row; }),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    studentProfile: { findMany: jest.fn(async () => profiles) },
    file: { findMany: jest.fn(async () => []) },
    studentAssessment: { upsert: jest.fn(async () => ({ id: 'sa_1' })) },
    assessment: { findFirst: jest.fn(async () => ({ id: 'a1', maxScore: 100 })) },
  };
  const prisma = { client: { ...db, $transaction: jest.fn(async (cb: any) => cb(db)) } } as any;

  const lmsFiles = { attach: jest.fn(async () => ({ id: 'f1' })) } as any;
  const plugin = new ModAssignPlugin(
    prisma, { organizationId: 'org_1' } as any, { register: jest.fn() } as any,
    { setScore: jest.fn() } as any, lmsFiles,
  );
  return { plugin, upserted, lmsFiles, db };
}

const CM: any = { id: 'cm_1', instanceId: 'inst_1', courseOfferingId: 'course_1', assessmentId: 'a1', cutoffAt: null };
const CTX: any = { organizationId: 'org_1', studentProfileId: 'sp_alice' };

describe('mod_assign submission rules', () => {
  describe('cut-off date', () => {
    it('refuses a submission after the cut-off', async () => {
      const { plugin } = build({
        instance: { id: 'inst_1', maxAttempts: 1, submissionTypes: ['online_text'], cutoffDate: new Date(Date.now() - 86400000) },
      });
      await expect(plugin.action(CTX, CM, 'submit', { content: 'late work' }))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a submission before the cut-off', async () => {
      const { plugin, upserted } = build({
        instance: { id: 'inst_1', maxAttempts: 1, submissionTypes: ['online_text'], cutoffDate: new Date(Date.now() + 86400000) },
      });
      await plugin.action(CTX, CM, 'submit', { content: 'on time' });
      expect(upserted).toHaveLength(1);
    });

    it('honours a cut-off held on the spine when the instance has none', async () => {
      const { plugin } = build({ instance: { id: 'inst_1', maxAttempts: 1, submissionTypes: ['online_text'] } });
      await expect(
        plugin.action(CTX, { ...CM, cutoffAt: new Date(Date.now() - 1000) }, 'submit', { content: 'late' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('attempt limits', () => {
    it('refuses a resubmission once the limit is used up', async () => {
      const { plugin } = build({
        instance: { id: 'inst_1', maxAttempts: 1, submissionTypes: ['online_text'] },
        existing: { id: 'sub_1', attemptNo: 1, status: 'submitted' },
      });
      await expect(plugin.action(CTX, CM, 'submit', { content: 'again' }))
        .rejects.toThrow(/all 1 submission attempt/);
    });

    it('allows unlimited attempts when maxAttempts is 0', async () => {
      const { plugin, upserted } = build({
        instance: { id: 'inst_1', maxAttempts: 0, submissionTypes: ['online_text'] },
        existing: { id: 'sub_1', attemptNo: 9, status: 'submitted' },
      });
      await plugin.action(CTX, CM, 'submit', { content: 'again' });
      expect(upserted).toHaveLength(1);
    });

    it('lets a draft be completed without consuming an attempt', async () => {
      const { plugin, upserted } = build({
        instance: { id: 'inst_1', maxAttempts: 1, submissionTypes: ['online_text'] },
        existing: { id: 'sub_1', attemptNo: 1, status: 'draft' },
      });
      await plugin.action(CTX, CM, 'submit', { content: 'finished' });
      expect(upserted).toHaveLength(1);
    });
  });

  describe('submission types', () => {
    it('refuses files when the assignment accepts text only', async () => {
      const { plugin } = build({ instance: { id: 'inst_1', maxAttempts: 1, submissionTypes: ['online_text'] } });
      await expect(plugin.action(CTX, CM, 'submit', { content: 'x', attachments: ['f1'] }))
        .rejects.toThrow(/does not accept file submissions/);
    });

    it('refuses an entirely empty submission', async () => {
      // Otherwise a pupil "submits" nothing and the teacher sees a row with no work.
      const { plugin } = build();
      await expect(plugin.action(CTX, CM, 'submit', {})).rejects.toThrow(/Submit some work/);
    });

    it('re-homes attachments into the course submission area', async () => {
      const { plugin, lmsFiles } = build();
      await plugin.action(CTX, CM, 'submit', { content: 'essay', attachments: ['f1', 'f2'] });
      expect(lmsFiles.attach).toHaveBeenCalledTimes(2);
      expect(lmsFiles.attach).toHaveBeenCalledWith(expect.objectContaining({
        area: 'submission', courseOfferingId: 'course_1', studentProfileId: 'sp_alice',
      }));
    });
  });

  describe('blind marking', () => {
    const profiles = [{ id: 'sp_alice', admissionNo: 'A1', partner: { name: 'Alice Doe' } }];

    it('withholds pupil names until the work is marked', async () => {
      const { plugin } = build({
        instance: { id: 'inst_1', blindMarking: true },
        existing: { id: 'sub_1', studentProfileId: 'sp_alice', status: 'submitted', attachments: [] },
        profiles,
      });
      const view: any = await plugin.viewForTeacher(CTX, CM);
      expect(view.submissions[0].studentName).toBeNull();
      expect(view.submissions[0].admissionNo).toBeNull();
    });

    it('reveals the name once marked', async () => {
      const { plugin } = build({
        instance: { id: 'inst_1', blindMarking: true },
        existing: { id: 'sub_1', studentProfileId: 'sp_alice', status: 'graded', attachments: [] },
        profiles,
      });
      const view: any = await plugin.viewForTeacher(CTX, CM);
      expect(view.submissions[0].studentName).toBe('Alice Doe');
    });

    it('shows names normally when blind marking is off', async () => {
      const { plugin } = build({
        instance: { id: 'inst_1', blindMarking: false },
        existing: { id: 'sub_1', studentProfileId: 'sp_alice', status: 'submitted', attachments: [] },
        profiles,
      });
      const view: any = await plugin.viewForTeacher(CTX, CM);
      expect(view.submissions[0].studentName).toBe('Alice Doe');
    });
  });

  describe('student view', () => {
    it('reports the window as closed after the cut-off', async () => {
      const { plugin } = build({
        instance: { id: 'inst_1', maxAttempts: 2, cutoffDate: new Date(Date.now() - 1000) },
      });
      const view: any = await plugin.viewForStudent(CTX, CM);
      expect(view.canSubmit).toBe(false);
      expect(view.maxAttempts).toBe(2);
    });

    it('reports it open when there is no cut-off', async () => {
      const { plugin } = build();
      const view: any = await plugin.viewForStudent(CTX, CM);
      expect(view.canSubmit).toBe(true);
    });
  });
});
