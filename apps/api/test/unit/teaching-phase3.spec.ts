import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SchemeOfWorkService, schemeProgress, termWeekStarts, weekStartOf } from '../../src/modules/school/teaching/scheme-of-work.service';
import { LessonDeliveryService, deliveryStats, isTaught } from '../../src/modules/school/teaching/lesson-delivery.service';
import { coverageTotals, outcomeState } from '../../src/modules/school/teaching/teaching-workspace.service';
import { LessonPlanningService } from '../../src/modules/school/lms/lesson-planning.service';

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe('Phase 3 — week maths', () => {
  it('snaps any day to that week Monday', () => {
    expect(iso(weekStartOf(new Date('2026-09-02T11:00:00Z')))).toBe('2026-08-31'); // Wednesday
    expect(iso(weekStartOf(new Date('2026-08-31T00:00:00Z')))).toBe('2026-08-31'); // Monday itself
    expect(iso(weekStartOf(new Date('2026-09-06T23:59:00Z')))).toBe('2026-08-31'); // Sunday belongs to the week before
  });

  it('lays a term out in teaching weeks', () => {
    const weeks = termWeekStarts(new Date('2026-09-02T00:00:00Z'), new Date('2026-10-02T00:00:00Z'));
    expect(weeks.map(iso)).toEqual(['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']);
  });

  it('caps a mis-keyed term instead of generating hundreds of weeks', () => {
    const weeks = termWeekStarts(new Date('2026-01-01T00:00:00Z'), new Date('2036-01-01T00:00:00Z'));
    expect(weeks).toHaveLength(20);
  });
});

describe('Phase 3 — scheme-of-work progress', () => {
  const week = (n: number, planned: number, items: number, plans: Array<boolean>) => ({
    weekNumber: n,
    plannedPeriods: planned,
    items: Array.from({ length: items }, (_, i) => ({ id: `i${n}-${i}`, plannedPeriods: 1, learningOutcomeId: null })),
    lessonPlans: plans.map((delivered, i) => ({ id: `p${n}-${i}`, workflowStatus: 'approved', delivered })),
  });

  it('counts a week as covered only when its plans were actually taught', () => {
    const progress = schemeProgress([week(1, 4, 2, [true, true]), week(2, 4, 2, [true, false]), week(3, 4, 2, [false]), week(4, 4, 2, [])]);
    expect(progress.weeks.map((w) => w.state)).toEqual(['covered', 'partial', 'planned', 'open']);
    expect(progress.coveredWeeks).toBe(1);
    expect(progress.partialWeeks).toBe(1);
    // 1 covered + half of 1 partial, over 4 weeks.
    expect(progress.coveragePct).toBe(38);
  });

  it('takes the greater of the week total and its items when counting periods', () => {
    const progress = schemeProgress([week(1, 2, 5, [])]);
    expect(progress.totalPlannedPeriods).toBe(5);
  });

  it('reports an empty scheme as zero rather than dividing by zero', () => {
    expect(schemeProgress([]).coveragePct).toBe(0);
  });
});

describe('Phase 3 — scheduled versus delivered', () => {
  it('does not count a planned lesson as taught', () => {
    expect(isTaught(null)).toBe(false);
    expect(isTaught({ status: 'in_progress' })).toBe(false);
    expect(isTaught({ status: 'delivered' })).toBe(true);
    expect(isTaught({ status: 'partially_delivered' })).toBe(true);
  });

  it('keeps cancelled lessons out of both sides of the ratio', () => {
    const stats = deliveryStats([
      { status: 'completed', delivery: { status: 'delivered' } },
      { status: 'completed', delivery: { status: 'partially_delivered' } },
      { status: 'scheduled', delivery: null },
      { status: 'cancelled', delivery: null },
    ]);
    expect(stats).toEqual({ scheduled: 3, delivered: 2, cancelled: 1, outstanding: 1, deliveryPct: 67 });
  });
});

describe('Phase 3 — curriculum coverage', () => {
  it('reports the furthest rung an outcome reached', () => {
    expect(outcomeState({ planned: false, delivered: false, assessed: false })).toBe('not_planned');
    expect(outcomeState({ planned: true, delivered: false, assessed: false })).toBe('planned');
    expect(outcomeState({ planned: true, delivered: true, assessed: false })).toBe('delivered');
    expect(outcomeState({ planned: true, delivered: true, assessed: true })).toBe('assessed');
  });

  it('treats assessed outcomes as also delivered and planned', () => {
    const totals = coverageTotals(['assessed', 'delivered', 'planned', 'not_planned']);
    expect(totals).toMatchObject({ total: 4, planned: 3, delivered: 2, assessed: 1, plannedPct: 75, deliveredPct: 50, assessedPct: 25 });
  });
});

// ───────────────────────── Service guards ─────────────────────────

function schemeService(overrides: any = {}) {
  const client: any = {
    schemeOfWork: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    schemeOfWorkWeek: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    schemeOfWorkItem: { findFirst: jest.fn(), count: jest.fn(async () => 0), create: jest.fn(), delete: jest.fn() },
    lessonPlan: { count: jest.fn(async () => 0) },
    $transaction: jest.fn(async (cb: any) => cb(client)),
    ...overrides,
  };
  const access: any = {
    assertMayTeach: jest.fn(async () => undefined),
    assertMayView: jest.fn(async () => undefined),
    offering: jest.fn(async () => ({ id: 'off-1', name: 'P5 Maths', term: { startDate: new Date('2026-09-02'), endDate: new Date('2026-09-20') } })),
  };
  const service = new SchemeOfWorkService(
    { client } as any,
    { organizationId: 'org-1', userId: 'user-1' } as any,
    { record: jest.fn(), recordInTx: jest.fn() } as any,
    access,
  );
  return { service, client, access };
}

describe('Phase 3 — scheme-of-work service', () => {
  it('refuses a second scheme for the same course', async () => {
    const { service, client } = schemeService();
    client.schemeOfWork.findFirst.mockResolvedValue({ id: 'sow-1' });
    await expect(service.create({ courseOfferingId: 'off-1' })).rejects.toThrow('already has a scheme of work');
  });

  it('refuses to remove a week that lesson plans are written against', async () => {
    const { service, client } = schemeService();
    client.schemeOfWorkWeek.findFirst.mockResolvedValue({ id: 'w1', schemeOfWorkId: 'sow-1', schemeOfWork: { courseOfferingId: 'off-1' } });
    client.lessonPlan.count.mockResolvedValue(3);
    await expect(service.removeWeek('w1')).rejects.toThrow('3 lesson plan(s)');
  });

  it('checks the caller teaches the course before editing a week', async () => {
    const { service, client, access } = schemeService();
    client.schemeOfWorkWeek.findFirst.mockResolvedValue({ id: 'w1', schemeOfWorkId: 'sow-1', schemeOfWork: { courseOfferingId: 'off-9' } });
    access.assertMayTeach.mockRejectedValue(new ForbiddenException('You may only work on courses you teach'));
    await expect(service.updateWeek('w1', { theme: 'Fractions' })).rejects.toThrow(ForbiddenException);
  });
});

function deliveryService(overrides: any = {}) {
  const client: any = {
    scheduledLesson: { findFirst: jest.fn(), findMany: jest.fn(async () => []), create: jest.fn(), update: jest.fn() },
    lessonDelivery: { upsert: jest.fn(async ({ create }: any) => ({ id: 'del-1', ...create })), update: jest.fn() },
    lessonDeliveryEvidence: { create: jest.fn(), findFirst: jest.fn(), delete: jest.fn() },
    lessonFollowUp: { create: jest.fn(async ({ data }: any) => data), findFirst: jest.fn(), update: jest.fn(async ({ data }: any) => data), findMany: jest.fn() },
    lessonPlan: { findFirst: jest.fn(), findMany: jest.fn(async () => []) },
    timetableSlot: { findMany: jest.fn(async () => []) },
    schemeOfWorkWeek: { findFirst: jest.fn(async () => null) },
    courseEnrollment: { findFirst: jest.fn(async () => null) },
    studentAttendance: { findMany: jest.fn(async () => []) },
    ...overrides,
  };
  const access: any = {
    assertMayTeach: jest.fn(async () => undefined),
    assertMayView: jest.fn(async () => undefined),
    offering: jest.fn(async () => ({ id: 'off-1', classId: 'class-1', sectionId: null, classCohort: null, term: {} })),
  };
  const service = new LessonDeliveryService(
    { client } as any,
    { organizationId: 'org-1', userId: 'user-1' } as any,
    { record: jest.fn() } as any,
    access,
  );
  return { service, client, access };
}

describe('Phase 3 — lesson delivery service', () => {
  it('refuses to generate a week for a course with no timetable', async () => {
    const { service } = deliveryService();
    await expect(service.generateWeek({ courseOfferingId: 'off-1', weekStart: '2026-09-02' }))
      .rejects.toThrow('no timetable lessons');
  });

  it('creates one lesson per timetable slot and skips ones already there', async () => {
    const { service, client } = deliveryService();
    client.timetableSlot.findMany.mockResolvedValue([
      { id: 'slot-1', dayOfWeek: 1, teacherPartnerId: 't1', substituteTeacherId: null, teachingRoomId: null, room: null },
      { id: 'slot-2', dayOfWeek: 3, teacherPartnerId: 't1', substituteTeacherId: null, teachingRoomId: null, room: null },
    ]);
    client.scheduledLesson.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'existing' });
    const result = await service.generateWeek({ courseOfferingId: 'off-1', weekStart: '2026-09-02' });
    expect(result).toMatchObject({ created: 1, existing: 1, weekStart: '2026-08-31T00:00:00.000Z' });
    expect(client.scheduledLesson.create).toHaveBeenCalledTimes(1);
    // Monday slot on the Monday of that week.
    expect(client.scheduledLesson.create.mock.calls[0][0].data.plannedDate.toISOString()).toBe('2026-08-31T00:00:00.000Z');
  });

  it('demands a reason when a lesson was only partly delivered', async () => {
    const { service, client } = deliveryService();
    client.scheduledLesson.findFirst.mockResolvedValue({ id: 'sl-1', courseOfferingId: 'off-1', status: 'scheduled', lessonPlanId: null, delivery: null });
    await expect(service.deliver('sl-1', { status: 'partially_delivered' })).rejects.toThrow(BadRequestException);
  });

  it('will not record delivery against a cancelled lesson', async () => {
    const { service, client } = deliveryService();
    client.scheduledLesson.findFirst.mockResolvedValue({ id: 'sl-1', courseOfferingId: 'off-1', status: 'cancelled', lessonPlanId: null, delivery: null });
    await expect(service.deliver('sl-1', { status: 'delivered' })).rejects.toThrow('cancelled');
  });

  it('refuses a reflection before the lesson has been delivered', async () => {
    const { service, client } = deliveryService();
    client.scheduledLesson.findFirst.mockResolvedValue({ id: 'sl-1', courseOfferingId: 'off-1', status: 'scheduled', delivery: null });
    await expect(service.reflect('sl-1', { whatWorked: 'group work' })).rejects.toThrow('delivered before reflecting');
  });

  it('refuses evidence for a learner-less lesson and requires the right key per kind', async () => {
    const { service, client } = deliveryService();
    client.scheduledLesson.findFirst.mockResolvedValue({ id: 'sl-1', courseOfferingId: 'off-1', status: 'completed', delivery: { id: 'del-1' } });
    await expect(service.addEvidence('sl-1', { kind: 'ASSESSMENT' })).rejects.toThrow('needs an assessment');
    await expect(service.addEvidence('sl-1', { kind: 'LINK' })).rejects.toThrow('needs a URL');
  });

  it('refuses a follow-up for a learner who is not on the roster', async () => {
    const { service } = deliveryService();
    await expect(service.createFollowUp({ courseOfferingId: 'off-1', action: 'Extra practice', studentProfileId: 'stu-9' }))
      .rejects.toThrow('not on this course roster');
  });
});

describe('Phase 3 — a lesson plan must belong to a course offering', () => {
  function planningService(offering: any) {
    const client: any = {
      courseOffering: { findFirst: jest.fn(async () => offering) },
      lessonPlan: { create: jest.fn(async ({ data }: any) => ({ id: 'lp-1', ...data })), findUnique: jest.fn(async () => ({ id: 'lp-1' })) },
      lessonPlanObjective: { createMany: jest.fn() },
      lessonPlanOutcome: { createMany: jest.fn() },
      lessonPlanRevision: { create: jest.fn() },
      schemeOfWorkWeek: { findFirst: jest.fn(async () => null) },
    };
    const service = new LessonPlanningService(
      { client } as any,
      { organizationId: 'org-1', userId: 'user-1', store: { permissions: ['*'] }, permissions: ['*'] } as any,
      { record: jest.fn() } as any,
      { isSelfTeacher: jest.fn(async () => true) } as any,
    );
    return { service, client };
  }

  const live = { id: 'off-1', status: 'ACTIVE', subjectId: 'sub-1', classId: 'class-1', termId: 'term-1', curriculumId: 'cur-1', classCohort: null };

  it('rejects a plan with no offering', async () => {
    const { service } = planningService(live);
    await expect(service.createLessonPlan({ title: 'Fractions' })).rejects.toThrow('must belong to a course offering');
  });

  it('takes subject, class, term and curriculum from the offering', async () => {
    const { service, client } = planningService(live);
    await service.createLessonPlan({ courseOfferingId: 'off-1', title: 'Fractions' });
    expect(client.lessonPlan.create.mock.calls[0][0].data).toMatchObject({
      courseOfferingId: 'off-1', subjectId: 'sub-1', classId: 'class-1', termId: 'term-1', curriculumVersionId: 'cur-1',
    });
  });

  it('rejects a subject that contradicts the offering', async () => {
    const { service } = planningService(live);
    await expect(service.createLessonPlan({ courseOfferingId: 'off-1', subjectId: 'other', title: 'Fractions' }))
      .rejects.toThrow('does not match the course offering');
  });

  it('refuses to plan into a closed offering', async () => {
    const { service } = planningService({ ...live, status: 'CLOSED' });
    await expect(service.createLessonPlan({ courseOfferingId: 'off-1', title: 'Fractions' }))
      .rejects.toThrow('cannot take new lesson plans');
  });

  it('refuses a scheme week that belongs to another course', async () => {
    const { service, client } = planningService(live);
    client.schemeOfWorkWeek.findFirst.mockResolvedValue({ id: 'w1', schemeOfWork: { courseOfferingId: 'off-2' } });
    await expect(service.createLessonPlan({ courseOfferingId: 'off-1', title: 'Fractions', schemeOfWorkWeekId: 'w1' }))
      .rejects.toThrow('belongs to a different course');
  });
});
