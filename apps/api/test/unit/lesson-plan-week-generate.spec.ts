import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { LessonPlanningService } from '../../src/modules/school/lms/lesson-planning.service';

/**
 * Bulk weekly planning.
 *
 * The rules this suite defends:
 *
 *  - Pressing it twice must not double a teacher's week. A scheduled lesson that
 *    already carries a plan is skipped, because the only thing worse than
 *    writing twenty plans by hand is finding forty the next morning.
 *  - It drafts; it never approves. Every plan comes out `draft` at version 1.
 *  - The plan belongs to whoever actually teaches the lesson — a substitute, or
 *    the timetabled teacher — not to the head of department who pressed it.
 *  - Scheme-of-work links (outcomes, objectives) carry through, or coverage
 *    reporting would show a planned week as uncovered.
 *  - It refuses, with something a teacher can act on, when the week has no
 *    lessons or the course has no subject.
 */

const MONDAY = new Date('2026-02-02T00:00:00.000Z'); // a Monday

function build(opts: {
  offering?: any;
  lessons?: any[];
  schemeWeek?: any;
  permissions?: string[];
} = {}) {
  const {
    offering = {
      id: 'co_1',
      organizationId: 'org_1',
      subjectId: 'sub_1',
      classId: 'cls_1',
      termId: 'term_1',
      subject: { name: 'Mathematics' },
    },
    lessons = [],
    schemeWeek = null,
    permissions = [PERMISSIONS.school.manageLessonPlans],
  } = opts;

  const createdPlans: any[] = [];
  const lessonUpdates: any[] = [];
  const outcomeLinks: any[] = [];
  const objectiveLinks: any[] = [];
  const revisions: any[] = [];

  const prisma = {
    client: {
      courseOffering: {
        findFirst: jest.fn(async (a: any) => (a.where?.id === offering?.id ? offering : null)),
      },
      scheduledLesson: {
        findMany: jest.fn(async () => lessons),
        update: jest.fn(async (a: any) => {
          lessonUpdates.push(a);
          return {};
        }),
      },
      schemeOfWorkWeek: { findFirst: jest.fn(async () => schemeWeek) },
      lessonPlan: {
        create: jest.fn(async (a: any) => {
          const row = { id: `lp_${createdPlans.length + 1}`, ...a.data };
          createdPlans.push(row);
          return row;
        }),
        findUnique: jest.fn(async (a: any) => createdPlans.find((p) => p.id === a.where.id) ?? null),
      },
      lessonPlanOutcome: {
        createMany: jest.fn(async (a: any) => {
          outcomeLinks.push(...a.data);
          return { count: a.data.length };
        }),
      },
      lessonPlanObjective: {
        createMany: jest.fn(async (a: any) => {
          objectiveLinks.push(...a.data);
          return { count: a.data.length };
        }),
      },
      lessonPlanRevision: {
        create: jest.fn(async (a: any) => {
          revisions.push(a.data);
          return {};
        }),
      },
    },
  } as any;

  const audit = { record: jest.fn(async () => ({})) } as any;
  const tenant = { organizationId: 'org_1', userId: 'user_1', store: { permissions } } as any;
  const identity = { isSelfTeacher: jest.fn(async () => false) } as any;

  const svc = new LessonPlanningService(prisma, tenant, audit, identity);
  return { svc, prisma, audit, createdPlans, lessonUpdates, outcomeLinks, objectiveLinks, revisions };
}

function lesson(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sl_1',
    courseOfferingId: 'co_1',
    plannedDate: new Date('2026-02-03T08:00:00.000Z'),
    teacherPartnerId: 'staff_timetabled',
    lessonPlanId: null,
    status: 'scheduled',
    ...overrides,
  };
}

const SCHEME_WEEK = {
  id: 'sw_1',
  weekNumber: 5,
  weekStart: MONDAY,
  items: [
    {
      id: 'it_1',
      title: 'Adding fractions',
      order: 0,
      plannedPeriods: 1,
      topicId: 'top_1',
      unitId: 'unit_1',
      learningOutcomeId: 'out_1',
      learningObjectiveId: 'obj_1',
    },
    {
      id: 'it_2',
      title: 'Subtracting fractions',
      order: 1,
      plannedPeriods: 1,
      topicId: 'top_1',
      unitId: 'unit_1',
      learningOutcomeId: 'out_1',
      learningObjectiveId: 'obj_2',
    },
  ],
};

describe('lesson plans — generate a week', () => {
  it('drafts one plan per unplanned lesson', async () => {
    const { svc, createdPlans } = build({
      lessons: [lesson({ id: 'sl_1' }), lesson({ id: 'sl_2' })],
      schemeWeek: SCHEME_WEEK,
    });

    const r = await svc.generateWeekPlans({
      courseOfferingId: 'co_1',
      weekStart: MONDAY.toISOString(),
    });

    expect(r.created).toBe(2);
    expect(r.skipped).toBe(0);
    expect(createdPlans).toHaveLength(2);
  });

  it('is idempotent: a lesson that already has a plan is skipped, not duplicated', async () => {
    const { svc, createdPlans } = build({
      lessons: [
        lesson({ id: 'sl_1', lessonPlanId: 'lp_existing' }),
        lesson({ id: 'sl_2' }),
      ],
      schemeWeek: SCHEME_WEEK,
    });

    const r = await svc.generateWeekPlans({
      courseOfferingId: 'co_1',
      weekStart: MONDAY.toISOString(),
    });

    expect(r.created).toBe(1);
    expect(r.skipped).toBe(1);
    expect(createdPlans).toHaveLength(1);
  });

  it('a second run over a fully planned week creates nothing', async () => {
    const { svc, createdPlans } = build({
      lessons: [
        lesson({ id: 'sl_1', lessonPlanId: 'lp_a' }),
        lesson({ id: 'sl_2', lessonPlanId: 'lp_b' }),
      ],
      schemeWeek: SCHEME_WEEK,
    });

    const r = await svc.generateWeekPlans({
      courseOfferingId: 'co_1',
      weekStart: MONDAY.toISOString(),
    });

    expect(r.created).toBe(0);
    expect(r.skipped).toBe(2);
    expect(createdPlans).toEqual([]);
  });

  it('drafts only — never approves', async () => {
    const { svc, createdPlans } = build({ lessons: [lesson()], schemeWeek: SCHEME_WEEK });
    await svc.generateWeekPlans({ courseOfferingId: 'co_1', weekStart: MONDAY.toISOString() });
    expect(createdPlans[0].workflowStatus).toBe('draft');
    expect(createdPlans[0].version).toBe(1);
  });

  it('attributes the plan to the lesson’s own teacher, not the caller', async () => {
    const { svc, createdPlans } = build({
      lessons: [lesson({ teacherPartnerId: 'staff_substitute' })],
      schemeWeek: SCHEME_WEEK,
    });

    await svc.generateWeekPlans({
      courseOfferingId: 'co_1',
      weekStart: MONDAY.toISOString(),
      teacherPartnerId: 'staff_hod',
    });

    expect(createdPlans[0].teacherPartnerId).toBe('staff_substitute');
  });

  it('falls back to the named teacher when the lesson names none', async () => {
    const { svc, createdPlans } = build({
      lessons: [lesson({ teacherPartnerId: null })],
      schemeWeek: SCHEME_WEEK,
    });

    await svc.generateWeekPlans({
      courseOfferingId: 'co_1',
      weekStart: MONDAY.toISOString(),
      teacherPartnerId: 'staff_hod',
    });

    expect(createdPlans[0].teacherPartnerId).toBe('staff_hod');
  });

  it('titles each plan from the scheme item it delivers', async () => {
    const { svc, createdPlans } = build({
      lessons: [lesson({ id: 'sl_1' }), lesson({ id: 'sl_2' })],
      schemeWeek: SCHEME_WEEK,
    });

    await svc.generateWeekPlans({ courseOfferingId: 'co_1', weekStart: MONDAY.toISOString() });

    expect(createdPlans[0].title).toBe('Adding fractions');
    expect(createdPlans[1].title).toBe('Subtracting fractions');
  });

  it('shares the last scheme item when a week has more lessons than items', async () => {
    const { svc, createdPlans } = build({
      lessons: [lesson({ id: 'sl_1' }), lesson({ id: 'sl_2' }), lesson({ id: 'sl_3' })],
      schemeWeek: SCHEME_WEEK,
    });

    await svc.generateWeekPlans({ courseOfferingId: 'co_1', weekStart: MONDAY.toISOString() });

    expect(createdPlans).toHaveLength(3);
    expect(createdPlans[2].title).toBe('Subtracting fractions');
  });

  it('still drafts a usable plan when there is no scheme week', async () => {
    const { svc, createdPlans } = build({ lessons: [lesson()], schemeWeek: null });

    const r = await svc.generateWeekPlans({
      courseOfferingId: 'co_1',
      weekStart: MONDAY.toISOString(),
    });

    expect(r.created).toBe(1);
    expect(r.schemeWeek).toBeNull();
    expect(createdPlans[0].title).toContain('Mathematics');
    expect(createdPlans[0].schemeOfWorkWeekId).toBeUndefined();
  });

  it('carries the scheme’s outcome and objective links onto the plan', async () => {
    const { svc, outcomeLinks, objectiveLinks } = build({
      lessons: [lesson()],
      schemeWeek: SCHEME_WEEK,
    });

    await svc.generateWeekPlans({ courseOfferingId: 'co_1', weekStart: MONDAY.toISOString() });

    // One distinct outcome across both items, two distinct objectives.
    expect(outcomeLinks.map((l) => l.learningOutcomeId)).toEqual(['out_1']);
    expect(objectiveLinks.map((l) => l.learningObjectiveId).sort()).toEqual(['obj_1', 'obj_2']);
  });

  it('links each new plan to its scheduled lesson', async () => {
    const { svc, lessonUpdates } = build({ lessons: [lesson({ id: 'sl_9' })], schemeWeek: SCHEME_WEEK });

    await svc.generateWeekPlans({ courseOfferingId: 'co_1', weekStart: MONDAY.toISOString() });

    expect(lessonUpdates).toHaveLength(1);
    expect(lessonUpdates[0].where).toEqual({ id: 'sl_9' });
    expect(lessonUpdates[0].data.lessonPlanId).toBe('lp_1');
  });

  it('snapshots every plan it creates', async () => {
    const { svc, revisions } = build({ lessons: [lesson()], schemeWeek: SCHEME_WEEK });
    await svc.generateWeekPlans({ courseOfferingId: 'co_1', weekStart: MONDAY.toISOString() });
    expect(revisions).toHaveLength(1);
    expect(revisions[0].version).toBe(1);
  });

  it('snaps any date inside the week to that week’s Monday', async () => {
    const { svc, createdPlans } = build({ lessons: [lesson()], schemeWeek: SCHEME_WEEK });

    // A Thursday.
    await svc.generateWeekPlans({
      courseOfferingId: 'co_1',
      weekStart: '2026-02-05T15:00:00.000Z',
    });

    expect(new Date(createdPlans[0].weekOf).getUTCDay()).toBe(1);
  });

  it('refuses a week with no lessons, and says what to do about it', async () => {
    const { svc } = build({ lessons: [] });
    await expect(
      svc.generateWeekPlans({ courseOfferingId: 'co_1', weekStart: MONDAY.toISOString() }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      svc.generateWeekPlans({ courseOfferingId: 'co_1', weekStart: MONDAY.toISOString() }),
    ).rejects.toThrow(/timetable/i);
  });

  it('refuses an offering with no subject', async () => {
    const { svc } = build({
      offering: { id: 'co_1', organizationId: 'org_1', subjectId: null, subject: null },
      lessons: [lesson()],
    });
    await expect(
      svc.generateWeekPlans({ courseOfferingId: 'co_1', weekStart: MONDAY.toISOString() }),
    ).rejects.toThrow(/subject/i);
  });

  it('refuses an unknown offering', async () => {
    const { svc } = build({ lessons: [lesson()] });
    await expect(
      svc.generateWeekPlans({ courseOfferingId: 'nope', weekStart: MONDAY.toISOString() }),
    ).rejects.toThrow(NotFoundException);
  });

  it('refuses a caller holding neither the departmental nor the owner grant', async () => {
    const { svc } = build({ permissions: [], lessons: [lesson()], schemeWeek: SCHEME_WEEK });
    await expect(
      svc.generateWeekPlans({ courseOfferingId: 'co_1', weekStart: MONDAY.toISOString() }),
    ).rejects.toThrow();
  });

  it('records what it did, for the audit trail', async () => {
    const { svc, audit } = build({ lessons: [lesson()], schemeWeek: SCHEME_WEEK });
    await svc.generateWeekPlans({ courseOfferingId: 'co_1', weekStart: MONDAY.toISOString() });
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0][0].newValues).toMatchObject({
      reason: 'generate-week',
      created: 1,
      skipped: 0,
    });
  });
});
