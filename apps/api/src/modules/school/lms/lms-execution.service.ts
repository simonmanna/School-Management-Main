import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { MarkingService } from '../assessment/marking.service';
import { AssessmentMintService } from '../assessment/assessment-mint.service';

const notFound = (what: string) => new NotFoundException(`${what} not found`);

/**
 * LMS execution + student layer (Phase 2-5):
 *  - ScheduledLesson / LessonDelivery (execution)
 *  - Discussions
 *  - HomeworkSubmission grading -> StudentAssessment bridge (Phase 3)
 *  - Evidence capture + computed objective mastery (Phase 4)
 *  - Coverage / mastery reporting (Phase 5)
 *
 * Default mastery policy weights (configurable later): ASSESSMENT 40, QUIZ 30,
 * ASSIGNMENT 20, OBSERVATION 10.
 */
@Injectable()
export class LmsExecutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly marking: MarkingService,
    private readonly mint: AssessmentMintService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  // ───────────── Phase 2: Scheduled lesson execution ─────────────

  async createScheduledLesson(dto: {
    courseOfferingId: string;
    plannedDate: string;
    timetableSlotId?: string;
    lessonPlanId?: string;
    teacherPartnerId?: string;
    teachingRoomId?: string;
    room?: string;
  }) {
    return this.prisma.client.scheduledLesson.create({
      data: {
        organizationId: this.org,
        courseOfferingId: dto.courseOfferingId,
        timetableSlotId: dto.timetableSlotId ?? null,
        lessonPlanId: dto.lessonPlanId ?? null,
        plannedDate: new Date(dto.plannedDate),
        teacherPartnerId: dto.teacherPartnerId ?? null,
        teachingRoomId: dto.teachingRoomId ?? null,
        room: dto.room ?? null,
        status: 'scheduled',
      },
    });
  }

  async listScheduledLessons(opts: { courseOfferingId?: string; from?: string; to?: string; status?: string } = {}) {
    return this.prisma.client.scheduledLesson.findMany({
      where: {
        organizationId: this.org,
        ...(opts.courseOfferingId ? { courseOfferingId: opts.courseOfferingId } : {}),
        ...(opts.status ? { status: opts.status } : {}),
        ...(opts.from || opts.to
          ? { plannedDate: { ...(opts.from ? { gte: new Date(opts.from) } : {}), ...(opts.to ? { lte: new Date(opts.to) } : {}) } }
          : {}),
      },
      include: { lessonPlan: { select: { title: true, workflowStatus: true } }, courseOffering: true },
      orderBy: { plannedDate: 'asc' },
    });
  }

  async deliver(dto: {
    scheduledLessonId: string;
    action: 'start' | 'complete' | 'cancel';
    reflection?: any;
    attendanceSessionId?: string;
    participationNote?: string;
  }) {
    const sl = await this.prisma.client.scheduledLesson.findFirst({
      where: { id: dto.scheduledLessonId, organizationId: this.org },
    });
    if (!sl) throw notFound('Scheduled lesson');

    if (dto.action === 'start') {
      await this.prisma.client.scheduledLesson.update({
        where: { id: sl.id },
        data: { status: 'in_progress' },
      });
      const delivery = await this.prisma.client.lessonDelivery.create({
        data: {
          organizationId: this.org,
          scheduledLessonId: sl.id,
          lessonPlanId: sl.lessonPlanId,
          startedAt: new Date(),
        },
      });
      return delivery;
    }

    if (dto.action === 'complete') {
      const delivery = await this.prisma.client.lessonDelivery.findFirst({
        where: { scheduledLessonId: sl.id, completedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      if (delivery) {
        await this.prisma.client.lessonDelivery.update({
          where: { id: delivery.id },
          data: {
            completedAt: new Date(),
            reflection: dto.reflection ?? null,
            attendanceSessionId: dto.attendanceSessionId ?? null,
            participationNote: dto.participationNote ?? null,
          },
        });
      }
      await this.prisma.client.scheduledLesson.update({
        where: { id: sl.id },
        data: { status: 'completed' },
      });
      return { completed: true, scheduledLessonId: sl.id };
    }

    // cancel
    await this.prisma.client.scheduledLesson.update({
      where: { id: sl.id },
      data: { status: 'cancelled' },
    });
    return { cancelled: true, scheduledLessonId: sl.id };
  }

  // ───────────── Phase 3: Discussions ─────────────

  async createDiscussion(dto: { title: string; body?: string; courseOfferingId?: string; lessonPlanId?: string; createdById?: string }) {
    return this.prisma.client.discussion.create({
      data: {
        organizationId: this.org,
        title: dto.title,
        body: dto.body ?? null,
        courseOfferingId: dto.courseOfferingId ?? null,
        lessonPlanId: dto.lessonPlanId ?? null,
        createdById: dto.createdById ?? null,
      },
    });
  }

  async listDiscussions(opts: { courseOfferingId?: string } = {}) {
    return this.prisma.client.discussion.findMany({
      where: { organizationId: this.org, deletedAt: null, ...(opts.courseOfferingId ? { courseOfferingId: opts.courseOfferingId } : {}) },
      include: { _count: { select: { posts: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getDiscussion(id: string) {
    const d = await this.prisma.client.discussion.findFirst({
      where: { id, organizationId: this.org, deletedAt: null },
      include: { posts: { orderBy: { createdAt: 'asc' } } },
    });
    if (!d) throw notFound('Discussion');
    return d;
  }

  async addPost(discussionId: string, dto: { body: string; authorId?: string; parentPostId?: string }) {
    const d = await this.prisma.client.discussion.findFirst({ where: { id: discussionId, organizationId: this.org, deletedAt: null } });
    if (!d) throw notFound('Discussion');
    return this.prisma.client.discussionPost.create({
      data: {
        organizationId: this.org,
        discussionId,
        body: dto.body,
        authorId: dto.authorId ?? null,
        parentPostId: dto.parentPostId ?? null,
      },
    });
  }

  async deleteDiscussion(id: string) {
    const d = await this.prisma.client.discussion.findFirst({ where: { id, organizationId: this.org } });
    if (!d) throw notFound('Discussion');
    await this.prisma.client.discussion.update({ where: { id }, data: { deletedAt: new Date() } });
    return { deleted: true, id };
  }

  // ───────────── Phase 3: Homework submit + grade bridge ─────────────

  async submitHomework(dto: { assignmentId: string; studentProfileId: string; content?: string; attachments?: any; submittedAt?: string }) {
    const org = this.org;
    const existing = await this.prisma.client.homeworkSubmission.findFirst({
      where: { assignmentId: dto.assignmentId, studentProfileId: dto.studentProfileId, organizationId: org },
    });
    const now = dto.submittedAt ? new Date(dto.submittedAt) : new Date();
    if (existing) {
      return this.prisma.client.homeworkSubmission.update({
        where: { id: existing.id },
        data: { content: dto.content ?? null, attachments: dto.attachments ?? Prisma.JsonNull, submittedAt: now, status: 'submitted' },
      });
    }
    return this.prisma.client.homeworkSubmission.create({
      data: {
        organizationId: org,
        assignmentId: dto.assignmentId,
        studentProfileId: dto.studentProfileId,
        content: dto.content ?? null,
        attachments: dto.attachments ?? Prisma.JsonNull,
        submittedAt: now,
        status: 'submitted',
      },
    });
  }

  /**
   * Grade a submission and bridge it to the gradebook via StudentAssessment.
   *
   * The score reaches the spine as a MarkEntry, then `recompute` derives
   * `effectiveScore` from it — the same discipline every other producer follows.
   * This used to write the derived columns directly across three unwrapped
   * calls, which left rows a later recompute would blank out.
   */
  async gradeHomework(dto: {
    submissionId: string;
    score: number;
    feedback?: string;
    gradedById?: string;
    maxScore?: number;
  }) {
    const sub = await this.prisma.client.homeworkSubmission.findFirst({
      where: { id: dto.submissionId, organizationId: this.org },
      include: { assignment: true },
    });
    if (!sub) throw notFound('Homework submission');
    const hw = sub.assignment;

    const maxScore = dto.maxScore != null
      ? new Prisma.Decimal(dto.maxScore)
      : (hw.maxScore ?? new Prisma.Decimal(100));
    if (dto.score < 0 || new Prisma.Decimal(dto.score).greaterThan(maxScore)) {
      throw new BadRequestException(`Score ${dto.score} is outside [0, ${maxScore.toString()}]`);
    }

    return this.prisma.client.$transaction(async (tx: any) => {
      // The homework already carries its assessment (minted when it was set).
      // This used to upsert by (sourceType, sourceRef) with no link on the
      // homework, so a second Assessment could appear behind the first. Older
      // homework, set before the link existed, is adopted rather than duplicated.
      const assessment = await this.mint.forHomework(tx, hw);

      const studentAssessment = await this.marking.postMark(tx, {
        assessmentId: assessment.id,
        studentProfileId: sub.studentProfileId,
        score: dto.score,
        source: 'homework',
        markerId: dto.gradedById ?? null,
        snapshot: {
          classId: hw.classId,
          sectionId: hw.sectionId ?? undefined,
          termId: assessment.termId ?? undefined,
        },
      });

      return tx.homeworkSubmission.update({
        where: { id: sub.id },
        data: {
          score: new Prisma.Decimal(dto.score),
          feedback: dto.feedback ?? null,
          gradedById: dto.gradedById ?? null,
          gradedAt: new Date(),
          status: 'graded',
          studentAssessmentId: studentAssessment.id,
        },
      });
    });
  }

  // ───────────── Phase 4: Evidence + computed mastery ─────────────

  async recordEvidence(dto: {
    studentProfileId: string;
    learningObjectiveId: string;
    sourceType: string;
    sourceId: string;
    normalizedScore?: number;
    proficiency?: string;
    observedAt?: string;
  }) {
    return this.prisma.client.learningObjectiveEvidence.create({
      data: {
        organizationId: this.org,
        studentProfileId: dto.studentProfileId,
        learningObjectiveId: dto.learningObjectiveId,
        sourceType: dto.sourceType,
        sourceId: dto.sourceId,
        normalizedScore: dto.normalizedScore != null ? new Prisma.Decimal(dto.normalizedScore) : null,
        proficiency: dto.proficiency ?? null,
        observedAt: dto.observedAt ? new Date(dto.observedAt) : new Date(),
      },
    });
  }

  /** Recompute objective mastery for a student from evidence using the default weighted policy. */
  async recomputeObjective(studentProfileId: string, learningObjectiveId: string) {
    const evidence = await this.prisma.client.learningObjectiveEvidence.findMany({
      where: { organizationId: this.org, studentProfileId, learningObjectiveId, normalizedScore: { not: null } },
    });
    const weights: Record<string, number> = { ASSESSMENT: 0.4, QUIZ: 0.3, ASSIGNMENT: 0.2, TEACHER_OBSERVATION: 0.1 };
    let total = 0;
    let wsum = 0;
    for (const e of evidence) {
      const w = weights[e.sourceType] ?? 0.1;
      total += Number(e.normalizedScore) * w;
      wsum += w;
    }
    const mastery = wsum > 0 ? total / wsum : 0;
    const row = await this.prisma.client.learningObjectiveProgress.upsert({
      where: { studentProfileId_learningObjectiveId: { studentProfileId, learningObjectiveId } },
      update: { masteryPct: new Prisma.Decimal(mastery), lastComputedAt: new Date() },
      create: { organizationId: this.org, studentProfileId, learningObjectiveId, masteryPct: new Prisma.Decimal(mastery) },
    });
    return row;
  }

  async recomputeCourseProgress(studentProfileId: string, courseOfferingId: string) {
    const plans = await this.prisma.client.lessonPlan.findMany({
      where: { organizationId: this.org, courseOfferingId, workflowStatus: 'approved' },
      select: { id: true, learningObjectives: { select: { learningObjectiveId: true } } },
    });
    const objIds = new Set<string>();
    plans.forEach((p) => p.learningObjectives.forEach((o) => objIds.add(o.learningObjectiveId)));
    if (!objIds.size) return { progressPct: 0 };
    const progress = await this.prisma.client.learningObjectiveProgress.findMany({
      where: { organizationId: this.org, studentProfileId, learningObjectiveId: { in: [...objIds] } },
    });
    const avg = progress.reduce((s, p) => s + Number(p.masteryPct), 0) / objIds.size;
    const row = await this.prisma.client.studentCourseProgress.upsert({
      where: { studentProfileId_courseOfferingId: { studentProfileId, courseOfferingId } },
      update: { progressPct: new Prisma.Decimal(avg), lastComputedAt: new Date() },
      create: { organizationId: this.org, studentProfileId, courseOfferingId, progressPct: new Prisma.Decimal(avg) },
    });
    return row;
  }

  // ───────────── Phase 5: Reporting ─────────────

  async objectiveMastery(opts: { learningObjectiveId?: string; studentProfileId?: string; termId?: string; classId?: string } = {}) {
    return this.prisma.client.learningObjectiveProgress.findMany({
      where: {
        organizationId: this.org,
        ...(opts.studentProfileId ? { studentProfileId: opts.studentProfileId } : {}),
        ...(opts.learningObjectiveId ? { learningObjectiveId: opts.learningObjectiveId } : {}),
      },
      orderBy: { masteryPct: 'desc' },
    });
  }

  async courseProgressList(opts: { courseOfferingId?: string } = {}) {
    return this.prisma.client.studentCourseProgress.findMany({
      where: { organizationId: this.org, ...(opts.courseOfferingId ? { courseOfferingId: opts.courseOfferingId } : {}) },
      orderBy: { progressPct: 'desc' },
    });
  }
}
