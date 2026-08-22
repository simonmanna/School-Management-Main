import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';
import { CourseService } from '../course/course.service';
import { CourseModuleService } from '../course/module.service';

/**
 * Lesson-planning bridge (ADR-014 §7). Publishing an approved LessonPlan materialises
 * its activities and resources as CourseModules in the matching week's section — the
 * layer where Moodle has nothing and we go beyond it.
 */
@Injectable()
export class PlanPublishService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly courses: CourseService,
    private readonly modules: CourseModuleService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  /** Materialise a lesson plan into a course section. Idempotency is the caller's concern (re-publish adds again). */
  async publishToCourse(lessonPlanId: string, dto: { courseOfferingId: string; sectionNo?: number }) {
    const plan = await this.prisma.client.lessonPlan.findFirst({
      where: { id: lessonPlanId, organizationId: this.org },
      include: { lessonPlanActivities: { include: { learningActivity: true }, orderBy: { sequence: 'asc' } }, lessonPlanResources: true },
    });
    if (!plan) throw new NotFoundException(`LessonPlan ${lessonPlanId} not found`);

    const sections = await this.courses.ensureSections(dto.courseOfferingId);
    const sectionNo = dto.sectionNo ?? this.weekSection(plan.weekOf, sections.length);
    const section = sections.find((s) => s.sectionNo === sectionNo) ?? sections[Math.min(sectionNo, sections.length - 1)];

    const created: string[] = [];
    // A heading label for the plan.
    const label = await this.modules.add(dto.courseOfferingId, { activityType: 'label', sectionId: section.id, content: `<h3>${plan.title}</h3>${plan.objectives ? `<p>${plan.objectives}</p>` : ''}` });
    created.push(label.id);

    for (const a of plan.lessonPlanActivities) {
      const title = a.learningActivity?.title ?? 'Activity';
      const instructions = a.studentInstructions ?? a.teacherInstructions ?? '';
      const page = await this.modules.add(dto.courseOfferingId, { activityType: 'page', sectionId: section.id, name: title, content: instructions });
      created.push(page.id);
    }
    for (const r of plan.lessonPlanResources) {
      const res = await this.modules.add(dto.courseOfferingId, { activityType: 'resource', sectionId: section.id, name: 'Resource', resourceId: r.learningResourceId });
      created.push(res.id);
    }
    return { sectionId: section.id, sectionNo: section.sectionNo, createdModuleIds: created };
  }

  /** Coverage report: plan objectives vs delivered gradable modules for a course. */
  async coverage(courseOfferingId: string) {
    const offering = await this.prisma.client.courseOffering.findFirst({ where: { id: courseOfferingId, organizationId: this.org } });
    if (!offering) throw new NotFoundException('Course not found');
    const plans = await this.prisma.client.lessonPlan.findMany({
      where: { organizationId: this.org, subjectId: offering.subjectId, classId: offering.classId },
      include: { learningObjectives: true },
    });
    const modules = await this.prisma.client.courseModule.findMany({
      where: { organizationId: this.org, courseOfferingId, deletedAt: null },
      select: { id: true, activityType: true, assessmentId: true },
    });
    const plannedObjectives = new Set(plans.flatMap((p) => p.learningObjectives.map((o) => o.learningObjectiveId)));
    return {
      plannedObjectiveCount: plannedObjectives.size,
      deliveredModuleCount: modules.length,
      gradableModuleCount: modules.filter((m) => m.assessmentId).length,
      plans: plans.map((p) => ({ id: p.id, title: p.title, weekOf: p.weekOf, objectiveCount: p.learningObjectives.length })),
    };
  }

  private weekSection(weekOf: Date | null, sectionCount: number): number {
    if (!weekOf) return 1;
    // Best-effort: map the plan's ISO week to a 1-based section, clamped.
    const week = Math.ceil(((weekOf.getTime() - new Date(weekOf.getFullYear(), 0, 1).getTime()) / 86400000 + 1) / 7);
    return Math.max(1, Math.min(week % Math.max(1, sectionCount - 1) || 1, sectionCount - 1));
  }
}
