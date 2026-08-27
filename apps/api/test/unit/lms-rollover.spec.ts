import { CourseBackupService } from '../../src/modules/school/lms/moodle/backup/course-backup.service';

/**
 * L8 — course backup, restore and year rollover.
 *
 * The rule this suite defends: rollover carries STRUCTURE, never people.
 * A new term must not inherit last year's cohort, submissions, marks or
 * deadlines — each of those either corrupts the new gradebook or shows every
 * activity as overdue on day one.
 */
function build(opts: {
  offerings?: any[];
  sections?: any[];
  modules?: any[];
  existingTargetModules?: number;
} = {}) {
  const {
    offerings = [], sections = [], modules = [], existingTargetModules = 0,
  } = opts;

  const created: any[] = [];
  const sectionUpdates: any[] = [];
  const moduleUpdates: any[] = [];

  const prisma = {
    client: {
      courseOffering: {
        // Honour the actual where clause. A fallback to `offerings[0]` made the
        // "no matching target" case look like a match and hid the real behaviour.
        findFirst: jest.fn(async (a: any) => {
          const w = a.where ?? {};
          return offerings.find((o) =>
            (w.id === undefined || o.id === w.id) &&
            (w.termId === undefined || o.termId === w.termId) &&
            (w.subjectId === undefined || o.subjectId === w.subjectId) &&
            (w.classId === undefined || o.classId === w.classId)) ?? null;
        }),
        findMany: jest.fn(async (a: any) => {
          const termId = a.where.termId;
          return offerings.filter((o) => o.termId === termId);
        }),
        update: jest.fn(async () => ({})),
      },
      courseSection: {
        findMany: jest.fn(async () => sections),
        findFirst: jest.fn(async () => null),
        create: jest.fn(async (a: any) => ({ id: `new_sec_${a.data.sectionNo}`, ...a.data })),
        update: jest.fn(async (a: any) => { sectionUpdates.push(a); return {}; }),
      },
      courseModule: {
        findMany: jest.fn(async () => modules),
        count: jest.fn(async () => existingTargetModules),
        create: jest.fn(async (a: any) => { const row = { id: `new_${created.length}`, ...a.data }; created.push(row); return row; }),
        update: jest.fn(async (a: any) => { moduleUpdates.push(a); return {}; }),
      },
      courseModuleCompletion: { findMany: jest.fn(async () => [{ id: 'c1' }]) },
      modAssignSubmission: { findMany: jest.fn(async () => [{ id: 's1' }]) },
      $transaction: jest.fn(async (cb: any) => cb({})),
    },
  } as any;

  const exportInstance = jest.fn(async () => ({ name: 'Week 1 quiz' }));
  const importInstance = jest.fn(async () => ({ instanceId: 'new_inst' }));
  const registry = {
    has: () => true,
    get: () => ({
      exportInstance, importInstance,
      features: { gradable: false },
    }),
  } as any;

  const svc = new CourseBackupService(
    prisma,
    { organizationId: 'org_1' } as any,
    registry,
    { ensureActivityContext: jest.fn() } as any,
    { ensureAssessment: jest.fn(), fanout: jest.fn() } as any,
    { log: jest.fn() } as any,
  );
  return { svc, prisma, created, sectionUpdates, moduleUpdates, exportInstance, importInstance };
}

const OFFERING = { id: 'c_old', termId: 't1', subjectId: 'sub', classId: 'cls', sectionId: null, format: 'weeks', numSections: 14, summary: null, groupMode: 'none', completionEnabled: true, showGradesToStudents: true };
const SECTION = { id: 'sec_1', sectionNo: 1, name: 'Week 1', summary: null, visible: true, availability: null };
const MODULE = {
  id: 'cm_1', sectionId: 'sec_1', activityType: 'quiz', instanceId: 'inst_1', sequence: 0,
  visible: true, visibleOnPage: true, availability: null, groupMode: 'none',
  completionMode: 'manual', completionRules: {}, idnumber: null,
  openAt: new Date('2026-01-01'), dueAt: new Date('2026-03-01'), cutoffAt: null,
};

describe('LMS course backup and rollover', () => {
  describe('export', () => {
    it('omits user data by default', async () => {
      const { svc } = build({ offerings: [OFFERING], sections: [SECTION], modules: [MODULE] });
      const bundle = await svc.export('c_old');
      expect(bundle.formatVersion).toBe(1);
      expect(bundle.modules).toHaveLength(1);
      expect(bundle.userData).toBeUndefined();
    });

    it('includes user data only when asked', async () => {
      const { svc } = build({ offerings: [OFFERING], sections: [SECTION], modules: [MODULE] });
      const bundle = await svc.export('c_old', { includeUserData: true });
      expect(bundle.userData?.completions).toHaveLength(1);
      expect(bundle.userData?.submissions).toHaveLength(1);
    });

    it('records the source module id so availability rules can be remapped', async () => {
      const { svc } = build({ offerings: [OFFERING], sections: [SECTION], modules: [MODULE] });
      const bundle = await svc.export('c_old');
      expect(bundle.modules[0].sourceId).toBe('cm_1');
    });
  });

  describe('import', () => {
    const bundle: any = {
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      course: { format: 'weeks', numSections: 14, completionEnabled: true, showGradesToStudents: true },
      sections: [{ sectionNo: 1, name: 'Week 1', visible: true }],
      modules: [{
        sourceId: 'cm_1', activityType: 'quiz', instance: { name: 'Quiz' },
        spine: { sectionNo: 1, sequence: 0, visible: true, completionMode: 'manual',
                 openAt: '2026-01-01T00:00:00Z', dueAt: '2026-03-01T00:00:00Z', availability: null },
      }],
    };

    it('drops last year\'s dates — a stale deadline shows everything as overdue', async () => {
      const { svc, created } = build({ offerings: [{ ...OFFERING, id: 'c_new' }] });
      await svc.import('c_new', bundle);
      expect(created).toHaveLength(1);
      expect(created[0].dueAt).toBeNull();
      expect(created[0].openAt).toBeNull();
    });

    it('rejects an unknown bundle format rather than importing partially', async () => {
      const { svc } = build({ offerings: [{ ...OFFERING, id: 'c_new' }] });
      await expect(svc.import('c_new', { formatVersion: 99 } as any)).rejects.toThrow(/Unsupported bundle/);
    });

    it('remaps a completion condition onto the newly created module', async () => {
      const withRule = {
        ...bundle,
        modules: [
          bundle.modules[0],
          {
            sourceId: 'cm_2', activityType: 'quiz', instance: {},
            spine: {
              sectionNo: 1, sequence: 1, visible: true, completionMode: 'manual',
              // Points at the OLD id; left alone it would never be satisfiable,
              // silently locking the activity for the whole year.
              availability: { op: '&', c: [{ type: 'completion', cm: 'cm_1', e: 1 }] },
            },
          },
        ],
      };
      const { svc, moduleUpdates } = build({ offerings: [{ ...OFFERING, id: 'c_new' }] });
      await svc.import('c_new', withRule as any);
      const rewrite = moduleUpdates.find((u) => u.data.availability);
      expect(rewrite).toBeDefined();
      expect(rewrite.data.availability.c[0].cm).toBe('new_0'); // the new id, not 'cm_1'
    });

    it('skips a module whose plugin is not installed instead of failing the whole restore', async () => {
      const { svc } = build({ offerings: [{ ...OFFERING, id: 'c_new' }] });
      (svc as any).registry = { has: () => false };
      const result = await svc.import('c_new', bundle);
      expect(result.skipped).toBe(1);
      expect(result.modules).toBe(0);
    });
  });

  describe('rollover', () => {
    it('refuses a target that already has activities, so running it twice is safe', async () => {
      const { svc } = build({
        offerings: [OFFERING, { ...OFFERING, id: 'c_new', termId: 't2' }],
        existingTargetModules: 3,
      });
      const result = await svc.rollover({ fromTermId: 't1', toTermId: 't2' });
      expect(result.rolled).toHaveLength(0);
      expect(result.unmatched[0].reason).toMatch(/already has activities/);
    });

    it('reports a source with no counterpart rather than inventing one', async () => {
      // Guessing which class a course belongs to is how a year's data lands on
      // the wrong register.
      const { svc } = build({ offerings: [OFFERING] }); // no t2 offering at all
      const result = await svc.rollover({ fromTermId: 't1', toTermId: 't2' });
      expect(result.rolled).toHaveLength(0);
      expect(result.unmatched[0].reason).toMatch(/No matching course/);
    });

    it('never carries user data, even though export can', async () => {
      const { svc, prisma } = build({
        offerings: [OFFERING, { ...OFFERING, id: 'c_new', termId: 't2' }],
        sections: [SECTION], modules: [MODULE],
      });
      await svc.rollover({ fromTermId: 't1', toTermId: 't2' });
      // The completion/submission tables are the user-data reads; rollover must
      // never touch them.
      expect(prisma.client.courseModuleCompletion.findMany).not.toHaveBeenCalled();
      expect(prisma.client.modAssignSubmission.findMany).not.toHaveBeenCalled();
    });

    it('returns nothing when the source term has no courses', async () => {
      const { svc } = build({ offerings: [] });
      await expect(svc.rollover({ fromTermId: 't1', toTermId: 't2' })).resolves.toEqual({ rolled: [], unmatched: [] });
    });
  });
});
