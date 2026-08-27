import { LmsOrphanCheckService } from '../../src/modules/school/lms/moodle/maintenance/orphan-check.service';

/**
 * L0.4 — the reconciler ADR-014 made a condition of its own decision.
 *
 * `CourseModule.instanceId` is an untyped polymorphic FK, so the database cannot
 * catch a module whose instance row was deleted. Such a module renders on the
 * course page, 404s when opened, and is counted in completion percentages no
 * student can ever satisfy.
 */
function build(opts: {
  modules: Array<{ id: string; activityType: string; instanceId: string; courseOfferingId?: string }>;
  live: Record<string, string[]>;
  registered?: string[];
}) {
  const { modules, live, registered = Object.keys(live) } = opts;
  const rows = modules.map((m) => ({ courseOfferingId: 'course_1', ...m }));

  const updateMany = jest.fn(async () => ({ count: 1 }));
  const sectionUpdate = jest.fn(async () => ({}));
  const prisma = {
    raw: {
      courseModule: { findMany: jest.fn(async () => rows), updateMany },
      courseSection: {
        findMany: jest.fn(async () => [{ id: 'sec_1', sequence: modules.map((m) => m.id) }]),
        update: sectionUpdate,
      },
    },
  } as any;

  const registry = {
    has: (t: string) => registered.includes(t),
    get: (t: string) => ({
      liveInstanceIds: jest.fn(async (ids: string[]) => new Set(ids.filter((i) => (live[t] ?? []).includes(i)))),
    }),
  } as any;

  const tenant = { organizationId: 'org_1', run: (_s: any, cb: any) => cb() } as any;
  return { svc: new LmsOrphanCheckService(prisma, tenant, registry), updateMany, sectionUpdate };
}

describe('LMS orphan check', () => {
  it('reports nothing when every instance is alive', async () => {
    const { svc } = build({
      modules: [{ id: 'cm_1', activityType: 'quiz', instanceId: 'q1' }],
      live: { quiz: ['q1'] },
    });
    await expect(svc.scan('org_1')).resolves.toEqual([]);
  });

  it('flags a module whose instance row was deleted', async () => {
    const { svc } = build({
      modules: [
        { id: 'cm_1', activityType: 'quiz', instanceId: 'q1' },
        { id: 'cm_2', activityType: 'quiz', instanceId: 'q_gone' },
      ],
      live: { quiz: ['q1'] },
    });
    const orphans = await svc.scan('org_1');
    expect(orphans).toHaveLength(1);
    expect(orphans[0]).toMatchObject({ courseModuleId: 'cm_2', reason: 'missing_instance' });
  });

  it('flags a module naming an activity type no plugin serves any more', async () => {
    const { svc } = build({
      modules: [{ id: 'cm_1', activityType: 'oldthing', instanceId: 'x' }],
      live: {},
      registered: ['quiz'],
    });
    const orphans = await svc.scan('org_1');
    expect(orphans[0]).toMatchObject({ courseModuleId: 'cm_1', reason: 'unregistered_type' });
  });

  it('queries each plugin once per type, not once per module', async () => {
    const live = { quiz: ['q1', 'q2', 'q3'] };
    const registry: any = {
      has: () => true,
      get: jest.fn(() => ({ liveInstanceIds: jest.fn(async (ids: string[]) => new Set(ids)) })),
    };
    const prisma = {
      raw: {
        courseModule: {
          findMany: jest.fn(async () =>
            ['q1', 'q2', 'q3'].map((i, n) => ({ id: `cm_${n}`, courseOfferingId: 'c1', activityType: 'quiz', instanceId: i })),
          ),
        },
      },
    } as any;
    const svc = new LmsOrphanCheckService(prisma, { organizationId: 'org_1' } as any, registry);
    await svc.scan('org_1');
    // One plugin lookup for the whole `quiz` group — a 200-activity course must
    // not become 200 round trips every night.
    expect(registry.get).toHaveBeenCalledTimes(1);
    void live;
  });

  describe('repair', () => {
    it('re-verifies before deleting, so a stale id cannot remove healthy work', async () => {
      const { svc, updateMany } = build({
        modules: [{ id: 'cm_healthy', activityType: 'quiz', instanceId: 'q1' }],
        live: { quiz: ['q1'] },
      });
      // cm_healthy is NOT an orphan; asking to repair it must be a no-op.
      await expect(svc.repair('org_1', ['cm_healthy'])).resolves.toEqual({ removed: 0 });
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('soft-deletes a confirmed orphan and drops it from the section sequence', async () => {
      const { svc, updateMany, sectionUpdate } = build({
        modules: [{ id: 'cm_dead', activityType: 'quiz', instanceId: 'q_gone' }],
        live: { quiz: [] },
      });
      await expect(svc.repair('org_1', ['cm_dead'])).resolves.toEqual({ removed: 1 });
      expect(updateMany).toHaveBeenCalled();
      // A course page with a gap where the activity used to be is still broken.
      expect(sectionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { sequence: [] } }),
      );
    });

    it('does nothing for an empty list', async () => {
      const { svc, updateMany } = build({ modules: [], live: {} });
      await expect(svc.repair('org_1', [])).resolves.toEqual({ removed: 0 });
      expect(updateMany).not.toHaveBeenCalled();
    });
  });
});
