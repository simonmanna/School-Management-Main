import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CourseOffering, LessonPlan } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';

const LP_WORKFLOW: Record<string, string[]> = {
  draft: ['submitted', 'archived'],
  submitted: ['needs_revision', 'approved'],
  needs_revision: ['submitted', 'draft'],
  approved: ['archived'],
  archived: ['draft'],
};

@Injectable()
export class LessonPlanningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  // ───────────── CourseOffering ─────────────

  /** Idempotent: one CourseOffering per (org, ay, term, subject, class, section). Teachers via join. */
  async upsertCourseOffering(dto: {
    academicYearId: string;
    termId: string;
    subjectId: string;
    classId: string;
    sectionId?: string;
    curriculumId: string;
    teacherPartnerIds?: string[];
  }): Promise<CourseOffering> {
    const org = this.org;
    const where = {
      organizationId: org,
      academicYearId: dto.academicYearId,
      termId: dto.termId,
      subjectId: dto.subjectId,
      classId: dto.classId,
      sectionId: dto.sectionId ?? null,
    };
    const existing = await this.prisma.client.courseOffering.findFirst({ where });
    let offering: CourseOffering;
    if (existing) {
      offering = await this.prisma.client.courseOffering.update({
        where: { id: existing.id },
        data: { curriculumId: dto.curriculumId, status: 'active' },
      });
    } else {
      offering = await this.prisma.client.courseOffering.create({
        data: {
          organizationId: org,
          academicYearId: dto.academicYearId,
          termId: dto.termId,
          subjectId: dto.subjectId,
          classId: dto.classId,
          sectionId: dto.sectionId,
          curriculumId: dto.curriculumId,
        },
      });
    }
    if (dto.teacherPartnerIds?.length) {
      for (const t of dto.teacherPartnerIds) {
        await this.prisma.client.courseOfferingTeacher.upsert({
          where: { courseOfferingId_teacherPartnerId: { courseOfferingId: offering.id, teacherPartnerId: t } },
          create: { organizationId: org, courseOfferingId: offering.id, teacherPartnerId: t, role: 'lead' },
          update: {},
        });
      }
    }
    return offering;
  }

  /** Idempotent creation from a TeacherAssignment × Term — collapses team-teaching into one offering. */
  async upsertFromTeacherAssignment(teacherAssignmentId: string, termId: string) {
    const ta = await this.prisma.client.teacherAssignment.findFirst({
      where: { id: teacherAssignmentId, organizationId: this.org },
    });
    if (!ta) throw new NotFoundException(`TeacherAssignment ${teacherAssignmentId} not found`);
    const curriculum = await this.prisma.client.curriculum.findFirst({
      where: { classId: ta.classId, academicYearId: ta.termId ? undefined : undefined },
      orderBy: { version: 'desc' },
    });
    // Resolve the latest published curriculum version for this class (best-effort).
    const latest = await this.prisma.client.curriculum.findFirst({
      where: { classId: ta.classId, organizationId: this.org },
      orderBy: [{ status: 'desc' }, { version: 'desc' }],
    });
    if (!latest) throw new BadRequestException(`No curriculum available for class ${ta.classId}`);
    return this.upsertCourseOffering({
      academicYearId: latest.academicYearId,
      termId,
      subjectId: ta.subjectId,
      classId: ta.classId,
      sectionId: ta.sectionId ?? undefined,
      curriculumId: latest.id,
      teacherPartnerIds: [ta.teacherPartnerId],
    });
  }

  async listCourseOfferings(termId?: string) {
    return this.prisma.client.courseOffering.findMany({
      where: { organizationId: this.org, ...(termId ? { termId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addTeacher(courseOfferingId: string, teacherPartnerId: string, role?: string) {
    const co = await this.prisma.client.courseOffering.findFirst({
      where: { id: courseOfferingId, organizationId: this.org },
    });
    if (!co) throw new NotFoundException('CourseOffering not found');
    return this.prisma.client.courseOfferingTeacher.upsert({
      where: { courseOfferingId_teacherPartnerId: { courseOfferingId, teacherPartnerId } },
      create: { organizationId: this.org, courseOfferingId, teacherPartnerId, role: role ?? 'lead' },
      update: { role: role ?? 'lead' },
    });
  }

  // ───────────── LessonPlan ─────────────

  private async snapshot(lpId: string, version: number, createdById?: string) {
    const lp = await this.prisma.client.lessonPlan.findUnique({
      where: { id: lpId },
      include: {
        learningObjectives: true,
        lessonPlanActivities: true,
        lessonPlanResources: true,
        lessonPlanAssessments: true,
        lessonPlanDifferentiations: true,
        lessonPlanReflections: true,
      },
    });
    if (!lp) return;
    await this.prisma.client.lessonPlanRevision.create({
      data: { organizationId: this.org, lessonPlanId: lpId, version, snapshot: lp as any, createdById },
    });
  }

  async createLessonPlan(dto: any) {
    const org = this.org;
    const lp = await this.prisma.client.lessonPlan.create({
      data: {
        organizationId: org,
        courseOfferingId: dto.courseOfferingId,
        curriculumVersionId: dto.curriculumVersionId,
        subjectId: dto.subjectId,
        classId: dto.classId,
        termId: dto.termId,
        teacherPartnerId: dto.teacherPartnerId,
        title: dto.title,
        weekOf: dto.weekOf ? new Date(dto.weekOf) : new Date(),
        objectives: dto.objectives,
        materials: dto.materials,
        unitId: dto.unitId,
        topicId: dto.topicId,
        subtopic: dto.subtopic,
        workflowStatus: 'draft',
        version: 1,
      },
    });
    await this.attachChildren(lp.id, dto);
    await this.snapshot(lp.id, 1, dto.teacherPartnerId);
    return this.prisma.client.lessonPlan.findUnique({ where: { id: lp.id }, include: this.lpInclude() });
  }

  private async attachChildren(lpId: string, dto: any) {
    if (dto.objectivesList?.length) {
      await this.prisma.client.lessonPlanObjective.createMany({
        data: dto.objectivesList.map((o: any) => ({ organizationId: this.org, lessonPlanId: lpId, learningObjectiveId: o.learningObjectiveId })),
      });
    }
    for (const a of dto.activities ?? []) {
      let learningActivityId = a.learningActivityId;
      if (!learningActivityId && a.title) {
        const act = await this.prisma.client.learningActivity.create({
          data: { organizationId: this.org, type: a.type ?? 'teacher_instruction', title: a.title, content: a.content ? JSON.parse(a.content) : {} },
        });
        learningActivityId = act.id;
      }
      if (learningActivityId) {
        await this.prisma.client.lessonPlanActivity.create({
          data: {
            organizationId: this.org,
            lessonPlanId: lpId,
            learningActivityId,
            sequence: a.sequence ?? 0,
            durationMin: a.durationMin,
            teacherInstructions: a.teacherInstructions,
            studentInstructions: a.studentInstructions,
          },
        });
      }
    }
    if (dto.resources?.length) {
      await this.prisma.client.lessonPlanResource.createMany({
        data: dto.resources.map((r: any) => ({ organizationId: this.org, lessonPlanId: lpId, learningResourceId: r.learningResourceId })),
      });
    }
    if (dto.assessments?.length) {
      await this.prisma.client.lessonPlanAssessment.createMany({
        data: dto.assessments.map((x: any) => ({ organizationId: this.org, lessonPlanId: lpId, kind: x.kind, prompt: x.prompt, sequence: x.sequence ?? 0 })),
      });
    }
    if (dto.differentiation?.length) {
      await this.prisma.client.lessonPlanDifferentiation.createMany({
        data: dto.differentiation.map((d: any) => ({
          organizationId: this.org,
          lessonPlanId: lpId,
          lessonPlanActivityId: d.lessonPlanActivityId,
          learningObjectiveId: d.learningObjectiveId,
          tier: d.tier,
          description: d.description,
        })),
      });
    }
  }

  private lpInclude() {
    return {
      learningObjectives: { include: { learningObjective: true } },
      lessonPlanActivities: { include: { learningActivity: true } },
      lessonPlanResources: { include: { learningResource: true } },
      lessonPlanAssessments: true,
      lessonPlanDifferentiations: true,
      lessonPlanReflections: true,
      lessonPlanReviews: true,
      subject: true,
    };
  }

  async listLessonPlans(opts: { courseOfferingId?: string; teacherPartnerId?: string; workflowStatus?: string; termId?: string }) {
    return this.prisma.client.lessonPlan.findMany({
      where: {
        organizationId: this.org,
        ...(opts.courseOfferingId ? { courseOfferingId: opts.courseOfferingId } : {}),
        ...(opts.teacherPartnerId ? { teacherPartnerId: opts.teacherPartnerId } : {}),
        ...(opts.workflowStatus ? { workflowStatus: opts.workflowStatus } : {}),
        ...(opts.termId ? { termId: opts.termId } : {}),
      },
      include: this.lpInclude(),
      orderBy: { createdAt: 'desc' },
    });
  }

  async getLessonPlan(id: string) {
    const lp = await this.prisma.client.lessonPlan.findFirst({
      where: { id, organizationId: this.org },
      include: this.lpInclude(),
    });
    if (!lp) throw new NotFoundException('LessonPlan not found');
    return lp;
  }

  /** Optimistic-concurrency guarded update. Rejects stale writes (409). */
  async updateLessonPlan(id: string, dto: any) {
    const lp = await this.getLessonPlan(id);
    if (lp.version !== dto.version) {
      throw new BadRequestException(`Stale update: expected version ${lp.version}, got ${dto.version}`);
    }
    if (!['draft', 'needs_revision'].includes(lp.workflowStatus)) {
      throw new BadRequestException(`Cannot edit a plan in status '${lp.workflowStatus}' — return to revision first`);
    }
    const nextVersion = lp.version + 1;
    await this.prisma.client.lessonPlan.update({
      where: { id },
      data: {
        courseOfferingId: dto.courseOfferingId,
        curriculumVersionId: dto.curriculumVersionId,
        subjectId: dto.subjectId,
        classId: dto.classId,
        termId: dto.termId,
        title: dto.title,
        weekOf: dto.weekOf ? new Date(dto.weekOf) : undefined,
        objectives: dto.objectives,
        materials: dto.materials,
        unitId: dto.unitId,
        topicId: dto.topicId,
        subtopic: dto.subtopic,
        version: nextVersion,
      },
    });
    await this.snapshot(id, nextVersion, lp.teacherPartnerId ?? undefined);
    return this.getLessonPlan(id);
  }

  async submitLessonPlan(id: string, dto: { version: number }) {
    const lp = await this.getLessonPlan(id);
    if (lp.version !== dto.version) throw new BadRequestException(`Stale update: expected version ${lp.version}`);
    if (!['draft', 'needs_revision'].includes(lp.workflowStatus)) {
      throw new BadRequestException(`Cannot submit a plan in status '${lp.workflowStatus}'`);
    }
    const next = lp.version + 1;
    await this.prisma.client.lessonPlan.update({ where: { id }, data: { workflowStatus: 'submitted', version: next } });
    await this.recordReview(id, lp.workflowStatus, 'submitted');
    await this.snapshot(id, next, lp.teacherPartnerId ?? undefined);
    return this.getLessonPlan(id);
  }

  async reviewLessonPlan(id: string, dto: { toStatus: 'approved' | 'needs_revision'; comment?: string; requestedChanges?: string }) {
    const lp = await this.getLessonPlan(id);
    if (lp.workflowStatus !== 'submitted') {
      throw new BadRequestException(`Can only review a submitted plan (current: '${lp.workflowStatus}')`);
    }
    if (!LP_WORKFLOW[lp.workflowStatus]?.includes(dto.toStatus)) {
      throw new BadRequestException(`Invalid transition '${lp.workflowStatus}' → '${dto.toStatus}'`);
    }
    const next = lp.version + 1;
    await this.prisma.client.lessonPlan.update({ where: { id }, data: { workflowStatus: dto.toStatus, version: next } });
    await this.recordReview(id, lp.workflowStatus, dto.toStatus, dto.comment, dto.requestedChanges);
    await this.snapshot(id, next);
    return this.getLessonPlan(id);
  }

  private async recordReview(id: string, from: string, to: string, comment?: string, requestedChanges?: string) {
    await this.prisma.client.lessonPlanReview.create({
      data: { organizationId: this.org, lessonPlanId: id, reviewerId: this.tenant.userId ?? undefined, fromStatus: from, toStatus: to, comment, requestedChanges },
    });
  }

  // ───────────── Timetable integration ─────────────

  async createFromTimetable(dto: { timetableSlotId: string; plannedDate: string; lessonPlanId?: string }) {
    const slot = await this.prisma.client.timetableSlot.findFirst({
      where: { id: dto.timetableSlotId, organizationId: this.org },
    });
    if (!slot) throw new NotFoundException('TimetableSlot not found');
    // Find-or-create the CourseOffering for this subject/class/term (timetable is schedule authority).
    const term = await this.prisma.client.term.findFirst({ where: { organizationId: this.org }, orderBy: { isCurrent: 'desc' } });
    const offering = await this.upsertFromTeacherAssignmentOrSlot(slot, term?.id);
    // Create ScheduledLesson linked to the slot (does not duplicate the plan).
    const scheduled = await this.prisma.client.scheduledLesson.create({
      data: {
        organizationId: this.org,
        courseOfferingId: offering.id,
        timetableSlotId: slot.id,
        lessonPlanId: dto.lessonPlanId,
        plannedDate: new Date(dto.plannedDate),
        teacherPartnerId: slot.substituteTeacherId ?? slot.teacherPartnerId,
        teachingRoomId: slot.teachingRoomId,
        room: slot.room,
        status: 'scheduled',
      },
    });
    return scheduled;
  }

  private async upsertFromTeacherAssignmentOrSlot(slot: any, termId?: string) {
    const curriculum = await this.prisma.client.curriculum.findFirst({
      where: { classId: slot.classId, organizationId: this.org },
      orderBy: [{ status: 'desc' }, { version: 'desc' }],
    });
    if (!curriculum) throw new BadRequestException(`No curriculum for class ${slot.classId}`);
    return this.upsertCourseOffering({
      academicYearId: curriculum.academicYearId,
      termId: termId ?? '',
      subjectId: slot.subjectId,
      classId: slot.classId,
      sectionId: slot.sectionId,
      curriculumId: curriculum.id,
      teacherPartnerIds: slot.teacherPartnerId ? [slot.teacherPartnerId] : [],
    });
  }

  // ───────────── Templates ─────────────

  async saveTemplate(lessonPlanId: string, dto: { name: string; scope: string; subjectId?: string; isSchoolWide?: boolean }) {
    const lp = await this.getLessonPlan(lessonPlanId);
    const snapshot = await this.prisma.client.lessonPlanRevision.findFirst({
      where: { lessonPlanId, organizationId: this.org },
      orderBy: { version: 'desc' },
    });
    return this.prisma.client.lessonPlanTemplate.create({
      data: {
        organizationId: this.org,
        name: dto.name,
        scope: dto.scope,
        subjectId: dto.subjectId ?? lp.subjectId,
        body: (snapshot?.snapshot as any) ?? {},
        isSchoolWide: dto.isSchoolWide ?? false,
        createdById: this.tenant.userId ?? undefined,
      },
    });
  }

  async listTemplates(subjectId?: string) {
    return this.prisma.client.lessonPlanTemplate.findMany({
      where: { organizationId: this.org, ...(subjectId ? { subjectId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ───────────── Teacher dashboard + curriculum coverage ─────────────

  async teacherDashboard(teacherPartnerId: string) {
    const where = { organizationId: this.org, teacherPartnerId };
    const [draft, submitted, needsRevision, approved] = await Promise.all([
      this.prisma.client.lessonPlan.count({ where: { ...where, workflowStatus: 'draft' } }),
      this.prisma.client.lessonPlan.count({ where: { ...where, workflowStatus: 'submitted' } }),
      this.prisma.client.lessonPlan.count({ where: { ...where, workflowStatus: 'needs_revision' } }),
      this.prisma.client.lessonPlan.count({ where: { ...where, workflowStatus: 'approved' } }),
    ]);
    return { draft, submitted, needsRevision, approved };
  }

  /** Four-way coverage for a subject's curriculum in a term (Planned/Delivered/Assessed/Mastered). */
  async curriculumCoverage(subjectId: string, termId?: string) {
    const objectives = await this.prisma.client.learningObjective.findMany({
      where: { organizationId: this.org, topic: { curriculumSubject: { subjectId } } },
      select: { id: true },
    });
    const ids = objectives.map((o) => o.id);
    if (!ids.length) return { total: 0, planned: 0, delivered: 0, assessed: 0, mastered: 0 };
    const [planned, delivered, assessed, mastered] = await Promise.all([
      this.prisma.client.lessonPlanObjective.count({ where: { learningObjectiveId: { in: ids }, lessonPlan: { workflowStatus: 'approved' } } }),
      (async () => {
        const plans = await this.prisma.client.lessonPlan.findMany({
          where: { organizationId: this.org, learningObjectives: { some: { learningObjectiveId: { in: ids } } } },
          select: { id: true },
        });
        const planIds = plans.map((p) => p.id);
        if (!planIds.length) return 0;
        return this.prisma.client.lessonDelivery.count({ where: { lessonPlanId: { in: planIds }, completedAt: { not: null } } });
      })(),
      this.prisma.client.learningObjectiveEvidence.count({ where: { learningObjectiveId: { in: ids } } }),
      this.prisma.client.learningObjectiveProgress.count({ where: { learningObjectiveId: { in: ids }, masteryPct: { gte: 60 } } }),
    ]);
    const total = ids.length;
    return {
      total,
      planned: Math.round((planned / total) * 100),
      delivered: Math.round((delivered / total) * 100),
      assessed: Math.round((assessed / total) * 100),
      mastered: Math.round((mastered / total) * 100),
    };
  }
}
