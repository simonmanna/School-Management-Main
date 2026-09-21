import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { TeachingAccessService } from './teaching-access.service';
import { SchemeOfWorkService } from './scheme-of-work.service';
import { deliveryStats, isTaught } from './lesson-delivery.service';
import type { AttachOfferingResourceDto } from './teaching.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

export type OutcomeCoverageState = 'not_planned' | 'planned' | 'delivered' | 'assessed';

/**
 * Where one outcome has reached.
 *
 * Deliberately a ladder, not four independent flags: an outcome that has been
 * assessed was necessarily taught, and reporting "60% planned, 20% assessed" as
 * separate percentages hides that the assessed ones are a subset. The state is
 * the furthest rung reached.
 */
export function outcomeState(input: { planned: boolean; delivered: boolean; assessed: boolean }): OutcomeCoverageState {
  if (input.assessed) return 'assessed';
  if (input.delivered) return 'delivered';
  if (input.planned) return 'planned';
  return 'not_planned';
}

export function coverageTotals(states: OutcomeCoverageState[]) {
  const total = states.length;
  const count = (s: OutcomeCoverageState) => states.filter((x) => x === s).length;
  const planned = total - count('not_planned');
  const delivered = count('delivered') + count('assessed');
  const assessed = count('assessed');
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  return {
    total,
    planned,
    delivered,
    assessed,
    notPlanned: count('not_planned'),
    plannedPct: pct(planned),
    deliveredPct: pct(delivered),
    assessedPct: pct(assessed),
  };
}

@Injectable()
export class TeachingWorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly access: TeachingAccessService,
    private readonly schemes: SchemeOfWorkService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  private get actor() {
    return this.tenant.userId ?? undefined;
  }

  /** The courses this teacher is responsible for right now. */
  async myCourses(teacherPartnerId?: string, termId?: string) {
    return this.access.offeringsForTeacher(teacherPartnerId, termId);
  }

  // ───────────────────────── Overview ─────────────────────────

  async overview(courseOfferingId: string) {
    await this.access.assertMayView(courseOfferingId);
    const offering = await this.access.offering(courseOfferingId);
    const now = new Date();

    const [lessons, plans, followUps, roster, resources, scheme, assessments] = await Promise.all([
      this.prisma.client.scheduledLesson.findMany({
        where: { courseOfferingId },
        select: { id: true, status: true, plannedDate: true, lessonPlanId: true, delivery: { select: { status: true, reflectedAt: true } } },
        orderBy: { plannedDate: 'asc' },
      }),
      this.prisma.client.lessonPlan.groupBy({
        by: ['workflowStatus'],
        where: { courseOfferingId },
        _count: { _all: true },
      }),
      this.prisma.client.lessonFollowUp.count({ where: { courseOfferingId, status: { in: ['open', 'in_progress'] } } }),
      this.prisma.client.courseEnrollment.count({ where: { courseOfferingId, status: 'ENROLLED' } }),
      this.prisma.client.courseOfferingResource.count({ where: { courseOfferingId } }),
      this.schemes.forOffering(courseOfferingId),
      this.assessments(courseOfferingId),
    ]);

    const stats = deliveryStats(lessons as any);
    const upcoming = lessons.filter((l: any) => l.plannedDate >= new Date(now.getTime() - DAY_MS) && l.status !== 'cancelled').slice(0, 5);
    const unreflected = lessons.filter((l: any) => isTaught(l.delivery) && !l.delivery?.reflectedAt).length;
    const unplanned = lessons.filter((l: any) => l.status !== 'cancelled' && !l.lessonPlanId).length;

    return {
      offering: {
        id: offering.id,
        code: offering.code,
        name: offering.name,
        status: offering.status,
        offeringType: offering.offeringType,
        subject: offering.subject?.name ?? null,
        className: offering.classCohort?.schoolClass?.name ?? null,
        section: offering.section?.name ?? null,
        term: { id: offering.term.id, name: offering.term.name, startDate: offering.term.startDate, endDate: offering.term.endDate },
        curriculum: offering.curriculum,
        teachers: offering.teachers
          .filter((t: any) => !t.effectiveTo)
          .map((t: any) => ({ id: t.teacherPartnerId, name: t.teacher?.partner?.name ?? t.teacherPartnerId, role: t.role, isResponsible: t.isResponsible })),
      },
      delivery: stats,
      lessonsNeedingPlan: unplanned,
      lessonsNeedingReflection: unreflected,
      plans: Object.fromEntries(plans.map((p: any) => [p.workflowStatus, p._count._all])),
      openFollowUps: followUps,
      learners: roster,
      resources,
      assessments: assessments.length,
      scheme: scheme ? { id: scheme.id, title: scheme.title, status: scheme.status, progress: scheme.progress } : null,
      upcoming,
    };
  }

  // ───────────────────────── Coverage ─────────────────────────

  /**
   * Curriculum coverage for one course, outcome by outcome.
   *
   * The chain is scheme → plan → delivery → evidence, and each rung is read
   * from typed rows: an outcome is "delivered" only when a plan claiming it was
   * taught, never because a teacher wrote its name in a free-text field.
   */
  async coverage(courseOfferingId: string) {
    await this.access.assertMayView(courseOfferingId);
    const offering = await this.access.offering(courseOfferingId);

    const outcomeWhere: any = {
      organizationId: this.org,
      deletedAt: null,
      OR: [
        ...(offering.subjectId ? [{ subjectId: offering.subjectId }] : []),
        ...(offering.curriculumId ? [{ topic: { curriculumId: offering.curriculumId } }] : []),
        ...(offering.competencyId ? [{ competencyId: offering.competencyId }] : []),
      ],
    };
    if (!outcomeWhere.OR.length) {
      return { outcomes: [], totals: coverageTotals([]), scheme: null, unmapped: 'This offering has no subject, curriculum or competency to measure against.' };
    }

    const [outcomes, planLinks, schemeItems, achievements, evidence, assessmentEvidence] = await Promise.all([
      this.prisma.client.learningOutcome.findMany({ where: outcomeWhere, orderBy: [{ order: 'asc' }, { title: 'asc' }] }),
      this.prisma.client.lessonPlanOutcome.findMany({
        where: { lessonPlan: { courseOfferingId } },
        select: {
          learningOutcomeId: true,
          lessonPlan: {
            select: {
              id: true,
              workflowStatus: true,
              scheduledLessons: { select: { status: true, delivery: { select: { status: true } } } },
            },
          },
        },
      }),
      this.prisma.client.schemeOfWorkItem.findMany({
        where: { week: { schemeOfWork: { courseOfferingId } }, learningOutcomeId: { not: null } },
        select: { learningOutcomeId: true, week: { select: { weekNumber: true } } },
      }),
      this.prisma.client.studentOutcomeAchievement.groupBy({
        by: ['learningOutcomeId', 'level'],
        where: { termId: offering.termId, student: { academicEnrollments: { some: { courseEnrollments: { some: { courseOfferingId } } } } } },
        _count: { _all: true },
      }),
      this.prisma.client.lessonDeliveryEvidence.findMany({
        where: { lessonDelivery: { scheduledLesson: { courseOfferingId } }, learningOutcomeId: { not: null } },
        select: { learningOutcomeId: true },
      }),
      this.prisma.client.assessmentOutcome.findMany({
        where: { assessment: { courseOfferingId, status: { notIn: ['draft', 'scheduled'] }, studentAssessments: { some: { effectiveScore: { not: null } } } } },
        select: { learningOutcomeId: true },
      }),
    ]);

    const plannedIds = new Set(planLinks.map((l: any) => l.learningOutcomeId));
    const deliveredIds = new Set(
      planLinks
        .filter((l: any) => l.lessonPlan.scheduledLessons.some((s: any) => s.status !== 'cancelled' && isTaught(s.delivery)))
        .map((l: any) => l.learningOutcomeId),
    );
    const evidencedIds = new Set([...evidence, ...assessmentEvidence].map((e: any) => e.learningOutcomeId));
    const achievedIds = new Set(
      achievements.filter((a: any) => ['met', 'exceeded'].includes(a.level)).map((a: any) => a.learningOutcomeId),
    );
    const schemeWeeks = new Map<string, number[]>();
    for (const item of schemeItems as any[]) {
      const list = schemeWeeks.get(item.learningOutcomeId) ?? [];
      list.push(item.week.weekNumber);
      schemeWeeks.set(item.learningOutcomeId, list);
    }

    const rows = outcomes.map((outcome: any) => {
      const planned = plannedIds.has(outcome.id) || schemeWeeks.has(outcome.id);
      const delivered = deliveredIds.has(outcome.id);
      const assessed = achievedIds.has(outcome.id) || evidencedIds.has(outcome.id);
      return {
        id: outcome.id,
        title: outcome.title,
        expectedLevel: outcome.expectedLevel,
        schemeWeeks: schemeWeeks.get(outcome.id) ?? [],
        planned,
        delivered,
        assessed,
        state: outcomeState({ planned, delivered, assessed }),
      };
    });

    const scheme = await this.schemes.forOffering(courseOfferingId);
    return {
      outcomes: rows,
      totals: coverageTotals(rows.map((r) => r.state)),
      scheme: scheme ? { id: scheme.id, title: scheme.title, status: scheme.status, progress: scheme.progress } : null,
    };
  }

  // ───────────────────────── Learners ─────────────────────────

  /**
   * The course roster with the two facts a teacher acts on: whether the learner
   * is turning up, and what was promised as follow-up for them.
   */
  async learners(courseOfferingId: string) {
    await this.access.assertMayView(courseOfferingId);
    const offering = await this.access.offering(courseOfferingId);
    const classId = offering.classId ?? offering.classCohort?.classId ?? null;

    const roster = await this.prisma.client.courseEnrollment.findMany({
      where: { courseOfferingId },
      include: {
        studentEnrollment: {
          include: {
            student: { include: { partner: true } },
            placements: { where: { effectiveTo: null }, include: { section: true } },
          },
        },
      },
      orderBy: { studentEnrollment: { student: { partner: { name: 'asc' } } } },
    });

    const studentIds = roster.map((r: any) => r.studentEnrollment.studentProfileId);
    const [attendance, followUps] = await Promise.all([
      classId && studentIds.length
        ? this.prisma.client.studentAttendance.findMany({
            where: {
              studentProfileId: { in: studentIds },
              classId,
              date: { gte: offering.term.startDate, lte: offering.term.endDate },
            },
            include: { statusConfig: true },
          })
        : Promise.resolve([]),
      studentIds.length
        ? this.prisma.client.lessonFollowUp.findMany({
            where: { courseOfferingId, studentProfileId: { in: studentIds }, status: { in: ['open', 'in_progress'] } },
          })
        : Promise.resolve([]),
    ]);

    const marked = new Map<string, { present: number; total: number }>();
    for (const row of attendance as any[]) {
      const bucket = marked.get(row.studentProfileId) ?? { present: 0, total: 0 };
      bucket.total += 1;
      if (row.statusConfig?.isPresent ?? ['present', 'late'].includes(row.status)) bucket.present += 1;
      marked.set(row.studentProfileId, bucket);
    }

    return roster.map((row: any) => {
      const studentProfileId = row.studentEnrollment.studentProfileId;
      const att = marked.get(studentProfileId);
      const placement = row.studentEnrollment.placements[0];
      return {
        courseEnrollmentId: row.id,
        studentProfileId,
        studentEnrollmentId: row.studentEnrollmentId,
        name: row.studentEnrollment.student?.partner?.name ?? studentProfileId,
        admissionNumber: row.studentEnrollment.student?.admissionNumber ?? null,
        source: row.source,
        status: row.status,
        section: placement?.section?.name ?? null,
        attendancePct: att && att.total ? Math.round((att.present / att.total) * 100) : null,
        attendanceMarkedDays: att?.total ?? 0,
        openFollowUps: followUps.filter((f: any) => f.studentProfileId === studentProfileId).length,
      };
    });
  }

  // ───────────────────────── Assessments ─────────────────────────

  /**
   * Assessments for this teaching context.
   *
   * `Assessment` does not carry an offering yet — that binding is Phase 4 work
   * (ADR-021/023) — so the context is resolved the way the rest of the system
   * still resolves it: subject + class + term, narrowed by section when the
   * offering is section-scoped.
   */
  async assessments(courseOfferingId: string) {
    await this.access.assertMayView(courseOfferingId);
    const rows = await this.prisma.client.assessment.findMany({
      where: {
        courseOfferingId,
      },
      select: {
        id: true, title: true, kind: true, status: true, dueAt: true, maxScore: true,
        sequence: true, teacherPartnerId: true,
        _count: { select: { studentAssessments: true } },
      },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
    });
    if (!rows.length) return [];

    // Marking progress, read rather than assumed: a minted row is not an entered
    // mark, and an entered mark is not an approved one.
    const ids = rows.map((r: any) => r.id);
    const [scored, approved] = await Promise.all([
      this.prisma.client.studentAssessment.groupBy({
        by: ['assessmentId'],
        where: { assessmentId: { in: ids }, effectiveScore: { not: null }, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.client.studentAssessment.groupBy({
        by: ['assessmentId'],
        where: { assessmentId: { in: ids }, approvalStatus: 'approved', deletedAt: null },
        _count: { _all: true },
      }),
    ]);
    const marked = new Map(scored.map((r: any) => [r.assessmentId, r._count._all]));
    const signedOff = new Map(approved.map((r: any) => [r.assessmentId, r._count._all]));
    return rows.map((row: any) => ({
      ...row,
      learners: row._count.studentAssessments,
      marked: marked.get(row.id) ?? 0,
      approved: signedOff.get(row.id) ?? 0,
    }));
  }

  // ───────────────────────── Resources ─────────────────────────

  async resources(courseOfferingId: string) {
    await this.access.assertMayView(courseOfferingId);
    return this.prisma.client.courseOfferingResource.findMany({
      where: { courseOfferingId },
      include: { learningResource: true },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async attachResource(courseOfferingId: string, dto: AttachOfferingResourceDto) {
    await this.access.assertMayTeach(courseOfferingId);
    const resource = await this.prisma.client.learningResource.findFirst({
      where: { id: dto.learningResourceId, deletedAt: null },
    });
    if (!resource) throw new NotFoundException('Learning resource not found');
    await this.prisma.client.courseOfferingResource.upsert({
      where: { courseOfferingId_learningResourceId: { courseOfferingId, learningResourceId: dto.learningResourceId } },
      create: {
        organizationId: this.org,
        courseOfferingId,
        learningResourceId: dto.learningResourceId,
        visibleToLearners: dto.visibleToLearners ?? false,
        order: dto.order ?? 0,
        addedById: this.actor,
      },
      update: { visibleToLearners: dto.visibleToLearners, order: dto.order },
    });
    return this.resources(courseOfferingId);
  }

  async detachResource(courseOfferingId: string, learningResourceId: string) {
    await this.access.assertMayTeach(courseOfferingId);
    const link = await this.prisma.client.courseOfferingResource.findFirst({
      where: { courseOfferingId, learningResourceId },
    });
    if (!link) throw new NotFoundException('That resource is not attached to this course.');
    await this.prisma.client.courseOfferingResource.delete({ where: { id: link.id } });
    return this.resources(courseOfferingId);
  }

  // ───────────────────────── Plan ↔ curriculum links ─────────────────────────

  async setPlanOutcomes(lessonPlanId: string, learningOutcomeIds: string[]) {
    const plan = await this.prisma.client.lessonPlan.findFirst({ where: { id: lessonPlanId } });
    if (!plan) throw new NotFoundException('Lesson plan not found');
    if (!plan.courseOfferingId) throw new BadRequestException('Attach this plan to a course offering first.');
    await this.access.assertMayTeach(plan.courseOfferingId);
    const unique = [...new Set(learningOutcomeIds)];
    const found = await this.prisma.client.learningOutcome.count({ where: { id: { in: unique }, deletedAt: null } });
    if (found !== unique.length) throw new BadRequestException('One or more outcomes do not exist.');
    await this.prisma.client.$transaction(async (tx: any) => {
      await tx.lessonPlanOutcome.deleteMany({ where: { lessonPlanId, learningOutcomeId: { notIn: unique.length ? unique : ['-'] } } });
      for (const learningOutcomeId of unique) {
        await tx.lessonPlanOutcome.upsert({
          where: { lessonPlanId_learningOutcomeId: { lessonPlanId, learningOutcomeId } },
          create: { organizationId: this.org, lessonPlanId, learningOutcomeId },
          update: {},
        });
      }
    });
    return this.prisma.client.lessonPlanOutcome.findMany({
      where: { lessonPlanId },
      include: { learningOutcome: true },
    });
  }

  async setPlanSchemeWeek(lessonPlanId: string, schemeOfWorkWeekId?: string) {
    const plan = await this.prisma.client.lessonPlan.findFirst({ where: { id: lessonPlanId } });
    if (!plan) throw new NotFoundException('Lesson plan not found');
    if (!plan.courseOfferingId) throw new BadRequestException('Attach this plan to a course offering first.');
    await this.access.assertMayTeach(plan.courseOfferingId);
    if (schemeOfWorkWeekId) {
      const week = await this.prisma.client.schemeOfWorkWeek.findFirst({
        where: { id: schemeOfWorkWeekId },
        include: { schemeOfWork: true },
      });
      if (!week) throw new NotFoundException('Scheme week not found');
      if (week.schemeOfWork.courseOfferingId !== plan.courseOfferingId) {
        throw new BadRequestException('That scheme week belongs to a different course.');
      }
    }
    return this.prisma.client.lessonPlan.update({
      where: { id: lessonPlanId },
      data: { schemeOfWorkWeekId: schemeOfWorkWeekId ?? null },
    });
  }

  /** Outcomes a teacher can pick from when writing a plan for this course. */
  async outcomeOptions(courseOfferingId: string) {
    await this.access.assertMayView(courseOfferingId);
    const offering = await this.access.offering(courseOfferingId);
    const or: any[] = [
      ...(offering.subjectId ? [{ subjectId: offering.subjectId }] : []),
      ...(offering.curriculumId ? [{ topic: { curriculumId: offering.curriculumId } }] : []),
      ...(offering.competencyId ? [{ competencyId: offering.competencyId }] : []),
    ];
    if (!or.length) return [];
    return this.prisma.client.learningOutcome.findMany({
      where: { organizationId: this.org, deletedAt: null, OR: or },
      include: { topic: { select: { id: true, title: true } } },
      orderBy: [{ order: 'asc' }, { title: 'asc' }],
    });
  }
}
