import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { TeachingAccessService } from './teaching-access.service';
import { weekStartOf } from './scheme-of-work.service';
import type {
  AddEvidenceDto,
  AttachLessonPlanDto,
  CreateFollowUpDto,
  DeliverLessonDto,
  GenerateWeekDto,
  ReflectLessonDto,
  UpdateFollowUpDto,
} from './teaching.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A lesson counts as taught once its delivery is recorded, not when it was planned. */
export function isTaught(delivery: { status?: string | null; completedAt?: Date | null } | null | undefined): boolean {
  if (!delivery) return false;
  return delivery.status === 'delivered' || delivery.status === 'partially_delivered';
}

/**
 * Scheduled versus delivered, for one set of lessons.
 *
 * `scheduled` counts lessons the timetable said would happen. Cancelled lessons
 * are reported separately rather than folded into either side: a cancelled
 * lesson is neither a delivery nor an outstanding one, and hiding it would make
 * a week of school closure look like a teacher who never turned up.
 */
export function deliveryStats(lessons: Array<{ status: string; delivery?: { status: string | null } | null }>) {
  const cancelled = lessons.filter((l) => l.status === 'cancelled').length;
  const scheduled = lessons.length - cancelled;
  const delivered = lessons.filter((l) => l.status !== 'cancelled' && isTaught(l.delivery)).length;
  return {
    scheduled,
    delivered,
    cancelled,
    outstanding: Math.max(0, scheduled - delivered),
    deliveryPct: scheduled ? Math.round((delivered / scheduled) * 100) : 0,
  };
}

@Injectable()
export class LessonDeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly access: TeachingAccessService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  private get actor() {
    return this.tenant.userId ?? undefined;
  }

  private lessonInclude = {
    delivery: { include: { evidence: true, followUps: true } },
    lessonPlan: {
      select: {
        id: true,
        title: true,
        workflowStatus: true,
        weekOf: true,
        schemeOfWorkWeekId: true,
        learningOutcomes: { include: { learningOutcome: true } },
      },
    },
  };

  // ───────────────────────── Weekly teaching view ─────────────────────────

  /**
   * One week of teaching for one course: what the timetable says, what was
   * scheduled from it, what was delivered, and which scheme week it belongs to.
   */
  async week(courseOfferingId: string, anyDateInWeek?: string) {
    await this.access.assertMayView(courseOfferingId);
    const offering = await this.access.offering(courseOfferingId);
    const start = weekStartOf(anyDateInWeek ? new Date(anyDateInWeek) : new Date());
    const end = new Date(start.getTime() + 7 * DAY_MS);

    const [slots, lessons, plans, scheme] = await Promise.all([
      this.prisma.client.timetableSlot.findMany({
        where: { courseOfferingId, type: 'lesson' },
        include: { period: true, subject: true, teacher: { include: { partner: true } } },
        orderBy: [{ dayOfWeek: 'asc' }, { periodId: 'asc' }],
      }),
      this.prisma.client.scheduledLesson.findMany({
        where: { courseOfferingId, plannedDate: { gte: start, lt: end } },
        include: this.lessonInclude,
        orderBy: { plannedDate: 'asc' },
      }),
      this.prisma.client.lessonPlan.findMany({
        where: { courseOfferingId, weekOf: { gte: start, lt: end } },
        select: { id: true, title: true, workflowStatus: true, weekOf: true, schemeOfWorkWeekId: true },
        orderBy: { weekOf: 'asc' },
      }),
      this.prisma.client.schemeOfWorkWeek.findFirst({
        where: { schemeOfWork: { courseOfferingId }, weekStart: { gte: start, lt: end } },
        include: { items: { orderBy: { order: 'asc' }, include: { learningOutcome: true } } },
      }),
    ]);

    return {
      offering: {
        id: offering.id,
        name: offering.name,
        code: offering.code,
        status: offering.status,
        subject: offering.subject?.name ?? null,
        className: offering.classCohort?.schoolClass?.name ?? null,
        section: offering.section?.name ?? null,
        stream: offering.stream?.name ?? null,
        termId: offering.termId,
      },
      weekStart: start.toISOString(),
      weekEnd: new Date(end.getTime() - DAY_MS).toISOString(),
      timetable: slots,
      lessons,
      plans,
      schemeWeek: scheme,
      stats: deliveryStats(lessons as any),
    };
  }

  /**
   * Materialise this week's lessons from the timetable.
   *
   * The timetable stays the schedule authority — this only creates the delivery
   * rows the week needs, and skips any slot/date pair that already has one, so a
   * teacher can press it twice without doubling their week.
   */
  async generateWeek(dto: GenerateWeekDto) {
    await this.access.assertMayTeach(dto.courseOfferingId);
    const start = weekStartOf(new Date(dto.weekStart));
    const slots = await this.prisma.client.timetableSlot.findMany({
      where: { courseOfferingId: dto.courseOfferingId, type: 'lesson' },
    });
    if (!slots.length) {
      throw new BadRequestException('This course has no timetable lessons. Add the offering to the timetable first.');
    }
    let created = 0;
    let existing = 0;
    for (const slot of slots) {
      const day = Math.min(Math.max(slot.dayOfWeek, 1), 7);
      const plannedDate = new Date(start.getTime() + (day - 1) * DAY_MS);
      const found = await this.prisma.client.scheduledLesson.findFirst({
        where: { courseOfferingId: dto.courseOfferingId, timetableSlotId: slot.id, plannedDate },
      });
      if (found) {
        existing++;
        continue;
      }
      await this.prisma.client.scheduledLesson.create({
        data: {
          organizationId: this.org,
          courseOfferingId: dto.courseOfferingId,
          timetableSlotId: slot.id,
          plannedDate,
          teacherPartnerId: slot.substituteTeacherId ?? slot.teacherPartnerId,
          teachingRoomId: slot.teachingRoomId,
          room: slot.room,
          status: 'scheduled',
        },
      });
      created++;
    }
    return { created, existing, weekStart: start.toISOString() };
  }

  private async lesson(scheduledLessonId: string) {
    const lesson = await this.prisma.client.scheduledLesson.findFirst({
      where: { id: scheduledLessonId },
      include: { ...this.lessonInclude, courseOffering: true },
    });
    if (!lesson) throw new NotFoundException(`Scheduled lesson ${scheduledLessonId} not found`);
    return lesson;
  }

  async getLesson(scheduledLessonId: string) {
    const lesson = await this.lesson(scheduledLessonId);
    await this.access.assertMayView(lesson.courseOfferingId);
    return lesson;
  }

  /** Attach (or detach) a plan, move the date, or call the lesson off. */
  async updateLesson(scheduledLessonId: string, dto: AttachLessonPlanDto) {
    const lesson = await this.lesson(scheduledLessonId);
    await this.access.assertMayTeach(lesson.courseOfferingId);
    if (dto.lessonPlanId) {
      const plan = await this.prisma.client.lessonPlan.findFirst({ where: { id: dto.lessonPlanId } });
      if (!plan) throw new NotFoundException('Lesson plan not found');
      if (plan.courseOfferingId !== lesson.courseOfferingId) {
        throw new BadRequestException('That lesson plan belongs to a different course.');
      }
    }
    const row = await this.prisma.client.scheduledLesson.update({
      where: { id: scheduledLessonId },
      data: {
        lessonPlanId: dto.lessonPlanId ?? undefined,
        status: dto.status,
        plannedDate: dto.plannedDate ? new Date(dto.plannedDate) : undefined,
      },
    });
    await this.audit.record({ entity: 'ScheduledLesson', entityId: row.id, action: 'update', oldValues: lesson, newValues: row });
    return this.getLesson(scheduledLessonId);
  }

  /**
   * Confirm what happened. One delivery per scheduled lesson, so pressing this
   * twice corrects the record instead of creating a second history.
   */
  async deliver(scheduledLessonId: string, dto: DeliverLessonDto) {
    const lesson = await this.lesson(scheduledLessonId);
    await this.access.assertMayTeach(lesson.courseOfferingId);
    if (lesson.status === 'cancelled' && dto.status !== 'cancelled') {
      throw new BadRequestException('This lesson is cancelled. Reinstate it before recording delivery.');
    }
    const status = dto.status ?? 'delivered';
    if (status === 'partially_delivered' && !dto.varianceReason) {
      throw new BadRequestException('Say why the lesson was only partly delivered.');
    }
    const attendance = dto.attendanceDate
      ? await this.attendanceSummary(lesson.courseOfferingId, dto.attendanceDate, dto.attendancePeriodId)
      : null;
    const done = status === 'delivered' || status === 'partially_delivered';

    const delivery = await this.prisma.client.lessonDelivery.upsert({
      where: { scheduledLessonId },
      create: {
        organizationId: this.org,
        scheduledLessonId,
        lessonPlanId: lesson.lessonPlanId,
        status,
        startedAt: new Date(),
        completedAt: done ? new Date() : null,
        deliveredById: this.actor,
        coveredContent: dto.coveredContent,
        varianceReason: dto.varianceReason,
        participationNote: dto.participationNote,
        attendanceSessionId: dto.attendanceSessionId,
        attendanceDate: dto.attendanceDate ? new Date(dto.attendanceDate) : null,
        attendancePeriodId: dto.attendancePeriodId,
        attendanceMarked: !!attendance && attendance.marked > 0,
        presentCount: attendance?.present ?? null,
        absentCount: attendance?.absent ?? null,
      },
      update: {
        status,
        lessonPlanId: lesson.lessonPlanId,
        completedAt: done ? new Date() : null,
        deliveredById: this.actor,
        coveredContent: dto.coveredContent,
        varianceReason: dto.varianceReason,
        participationNote: dto.participationNote,
        attendanceSessionId: dto.attendanceSessionId,
        ...(dto.attendanceDate
          ? {
              attendanceDate: new Date(dto.attendanceDate),
              attendancePeriodId: dto.attendancePeriodId,
              attendanceMarked: !!attendance && attendance.marked > 0,
              presentCount: attendance?.present ?? null,
              absentCount: attendance?.absent ?? null,
            }
          : {}),
      },
    });

    await this.prisma.client.scheduledLesson.update({
      where: { id: scheduledLessonId },
      data: { status: status === 'cancelled' ? 'cancelled' : done ? 'completed' : 'in_progress' },
    });
    await this.audit.record({ entity: 'LessonDelivery', entityId: delivery.id, action: 'update', newValues: delivery });
    return this.getLesson(scheduledLessonId);
  }

  /** Teacher reflection, recorded against the delivery it belongs to. */
  async reflect(scheduledLessonId: string, dto: ReflectLessonDto) {
    const lesson = await this.lesson(scheduledLessonId);
    await this.access.assertMayTeach(lesson.courseOfferingId);
    if (!lesson.delivery) {
      throw new BadRequestException('Record the lesson as delivered before reflecting on it.');
    }
    await this.prisma.client.lessonDelivery.update({
      where: { scheduledLessonId },
      data: {
        whatWorked: dto.whatWorked,
        whatDidntWork: dto.whatDidntWork,
        studentsNeedingSupport: dto.studentsNeedingSupport,
        followUpNote: dto.followUpNote,
        reflectedAt: new Date(),
      },
    });
    return this.getLesson(scheduledLessonId);
  }

  /**
   * Present/absent for the register this lesson points at.
   *
   * Counts are a cached summary for the teaching screens — `StudentAttendance`
   * remains the authoritative record, so this never writes attendance.
   */
  private async attendanceSummary(courseOfferingId: string, dateISO: string, periodId?: string) {
    const offering = await this.access.offering(courseOfferingId);
    const classId = offering.classId ?? offering.classCohort?.classId;
    if (!classId) return null;
    const day = new Date(dateISO);
    const from = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    const to = new Date(from.getTime() + DAY_MS);
    const rows = await this.prisma.client.studentAttendance.findMany({
      where: {
        classId,
        ...(offering.sectionId ? { sectionId: offering.sectionId } : {}),
        date: { gte: from, lt: to },
        ...(periodId ? { periodId } : {}),
      },
      include: { statusConfig: true },
    });
    const present = rows.filter((r: any) => r.statusConfig?.isPresent ?? ['present', 'late'].includes(r.status)).length;
    return { marked: rows.length, present, absent: rows.length - present };
  }

  /** Read-only view of the register behind a delivery. */
  async attendanceFor(scheduledLessonId: string) {
    const lesson = await this.lesson(scheduledLessonId);
    await this.access.assertMayView(lesson.courseOfferingId);
    const date = lesson.delivery?.attendanceDate ?? lesson.plannedDate;
    return {
      date,
      periodId: lesson.delivery?.attendancePeriodId ?? null,
      summary: await this.attendanceSummary(lesson.courseOfferingId, date.toISOString(), lesson.delivery?.attendancePeriodId ?? undefined),
    };
  }

  // ───────────────────────── Evidence ─────────────────────────

  async addEvidence(scheduledLessonId: string, dto: AddEvidenceDto) {
    const lesson = await this.lesson(scheduledLessonId);
    await this.access.assertMayTeach(lesson.courseOfferingId);
    if (!lesson.delivery) throw new BadRequestException('Record the lesson as delivered before attaching evidence.');
    if (dto.kind === 'ASSESSMENT' && !dto.assessmentId) throw new BadRequestException('Assessment evidence needs an assessment.');
    if (dto.kind === 'RESOURCE' && !dto.learningResourceId) throw new BadRequestException('Resource evidence needs a resource.');
    if (dto.kind === 'LINK' && !dto.url) throw new BadRequestException('Link evidence needs a URL.');
    if (dto.assessmentId) {
      const assessment = await this.prisma.client.assessment.findFirst({ where: { id: dto.assessmentId } });
      if (!assessment) throw new NotFoundException('Assessment not found');
    }
    await this.prisma.client.lessonDeliveryEvidence.create({
      data: {
        organizationId: this.org,
        lessonDeliveryId: lesson.delivery.id,
        kind: dto.kind,
        assessmentId: dto.assessmentId,
        learningResourceId: dto.learningResourceId,
        learningOutcomeId: dto.learningOutcomeId,
        url: dto.url,
        note: dto.note,
        createdById: this.actor,
      },
    });
    return this.getLesson(scheduledLessonId);
  }

  async removeEvidence(evidenceId: string) {
    const evidence = await this.prisma.client.lessonDeliveryEvidence.findFirst({
      where: { id: evidenceId },
      include: { lessonDelivery: { include: { scheduledLesson: true } } },
    });
    if (!evidence) throw new NotFoundException('Evidence not found');
    await this.access.assertMayTeach(evidence.lessonDelivery.scheduledLesson.courseOfferingId);
    await this.prisma.client.lessonDeliveryEvidence.delete({ where: { id: evidenceId } });
    return { deleted: true };
  }

  // ───────────────────────── Follow-up ─────────────────────────

  async listFollowUps(filters: { courseOfferingId?: string; status?: string; studentProfileId?: string }) {
    if (filters.courseOfferingId) await this.access.assertMayView(filters.courseOfferingId);
    return this.prisma.client.lessonFollowUp.findMany({
      where: {
        ...(filters.courseOfferingId ? { courseOfferingId: filters.courseOfferingId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.studentProfileId ? { studentProfileId: filters.studentProfileId } : {}),
      },
      include: { courseOffering: { select: { id: true, name: true, code: true } } },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async createFollowUp(dto: CreateFollowUpDto) {
    await this.access.assertMayTeach(dto.courseOfferingId);
    if (dto.studentProfileId) {
      const enrolled = await this.prisma.client.courseEnrollment.findFirst({
        where: {
          courseOfferingId: dto.courseOfferingId,
          studentEnrollment: { studentProfileId: dto.studentProfileId },
        },
      });
      if (!enrolled) throw new BadRequestException('That learner is not on this course roster.');
    }
    const row = await this.prisma.client.lessonFollowUp.create({
      data: {
        organizationId: this.org,
        courseOfferingId: dto.courseOfferingId,
        lessonDeliveryId: dto.lessonDeliveryId,
        studentProfileId: dto.studentProfileId,
        learningOutcomeId: dto.learningOutcomeId,
        action: dto.action.trim(),
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        createdById: this.actor,
      },
    });
    await this.audit.record({ entity: 'LessonFollowUp', entityId: row.id, action: 'create', newValues: row });
    return row;
  }

  async updateFollowUp(id: string, dto: UpdateFollowUpDto) {
    const current = await this.prisma.client.lessonFollowUp.findFirst({ where: { id } });
    if (!current) throw new NotFoundException('Follow-up not found');
    await this.access.assertMayTeach(current.courseOfferingId);
    const closing = dto.status === 'done' || dto.status === 'cancelled';
    const row = await this.prisma.client.lessonFollowUp.update({
      where: { id },
      data: {
        status: dto.status,
        action: dto.action?.trim(),
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        resolutionNote: dto.resolutionNote,
        resolvedAt: closing ? new Date() : dto.status ? null : undefined,
      },
    });
    await this.audit.record({ entity: 'LessonFollowUp', entityId: id, action: 'update', oldValues: current, newValues: row });
    return row;
  }
}
