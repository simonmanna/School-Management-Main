import { Injectable } from '@nestjs/common';
import type { CourseModule } from '@prisma/client';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';
import { ActivityRegistry } from '../activity/activity-registry.service';
import { LmsEventService } from '../lms-event.service';
import type { CompletionState } from '../plugin.types';
import { ViewEnvelopeService } from '../course/view-envelope.service';

/**
 * Completion tracking (ADR-014 §3.4) and the rollup that finally gives
 * StudentCourseProgress.progressPct a real value: complete ÷ completion-tracked.
 */
@Injectable()
export class CompletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly registry: ActivityRegistry,
    private readonly events: LmsEventService,
    private readonly envelope: ViewEnvelopeService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  /** Manual tick / override by a teacher or by the student (self-completion). */
  async setManual(courseModuleId: string, studentProfileId: string, state: CompletionState): Promise<void> {
    await this.upsert(courseModuleId, studentProfileId, state, { overridden: true });
    await this.rollupFor(courseModuleId, studentProfileId);
    await this.events.log({
      eventName: 'core_completion.updated', component: 'core_completion', action: 'updated', target: 'course_module',
      courseModuleId, studentProfileId, objectId: courseModuleId, other: { state, manual: true },
    });
  }

  /** Record that the student viewed the activity — may itself satisfy a `view` completion rule. */
  async markViewed(cm: CourseModule, studentProfileId: string): Promise<void> {
    const existing = await this.prisma.client.courseModuleCompletion.findFirst({
      where: { courseModuleId: cm.id, studentProfileId },
    });
    const rules = (cm.completionRules ?? {}) as Record<string, unknown>;
    const viewSatisfies = cm.completionMode === 'automatic' && rules.view === true;
    const nextState: CompletionState = viewSatisfies ? 'complete' : (existing?.state as CompletionState) ?? 'incomplete';
    await this.prisma.client.courseModuleCompletion.upsert({
      where: { courseModuleId_studentProfileId: { courseModuleId: cm.id, studentProfileId } },
      create: { organizationId: this.org, courseModuleId: cm.id, studentProfileId, viewed: true, state: nextState, completedAt: nextState !== 'incomplete' ? new Date() : null },
      update: { viewed: true, state: nextState, ...(nextState !== 'incomplete' ? { completedAt: new Date() } : {}) },
    });
    if (viewSatisfies) await this.rollupFor(cm.id, studentProfileId);
  }

  /** Ask the plugin for a fresh automatic-completion verdict and persist it. */
  async recomputeAuto(cm: CourseModule, studentProfileId: string): Promise<CompletionState> {
    if (cm.completionMode !== 'automatic') return 'incomplete';
    const plugin = this.registry.get(cm.activityType);
    let state: CompletionState = 'incomplete';
    if (plugin.evaluateCompletion) {
      state = await plugin.evaluateCompletion({ organizationId: this.org, studentProfileId, courseModule: cm }, cm);
    }
    await this.upsert(cm.id, studentProfileId, state, { overridden: false });
    await this.rollupFor(cm.id, studentProfileId);
    return state;
  }

  private async upsert(courseModuleId: string, studentProfileId: string, state: CompletionState, opts: { overridden: boolean }) {
    await this.prisma.client.courseModuleCompletion.upsert({
      where: { courseModuleId_studentProfileId: { courseModuleId, studentProfileId } },
      create: {
        organizationId: this.org, courseModuleId, studentProfileId, state,
        completedAt: state !== 'incomplete' ? new Date() : null,
        overriddenById: opts.overridden ? this.tenant.userId ?? null : null,
      },
      update: {
        state, completedAt: state !== 'incomplete' ? new Date() : null,
        overriddenById: opts.overridden ? this.tenant.userId ?? null : undefined,
      },
    });
  }

  /** Recompute StudentCourseProgress for one student in the module's course. */
  async rollupFor(courseModuleId: string, studentProfileId: string): Promise<void> {
    const cm = await this.prisma.client.courseModule.findFirst({ where: { id: courseModuleId }, select: { courseOfferingId: true } });
    if (!cm) return;
    await this.rollupCourse(cm.courseOfferingId, studentProfileId);
  }

  async rollupCourse(courseOfferingId: string, studentProfileId: string): Promise<number> {
    const tracked = await this.prisma.client.courseModule.findMany({
      where: { organizationId: this.org, courseOfferingId, deletedAt: null, completionMode: { not: 'none' } },
      select: { id: true },
    });
    if (tracked.length === 0) return 0;
    const ids = tracked.map((m) => m.id);
    const complete = await this.prisma.client.courseModuleCompletion.count({
      where: { organizationId: this.org, studentProfileId, courseModuleId: { in: ids }, state: { not: 'incomplete' } },
    });
    const pct = Math.round((complete / tracked.length) * 10000) / 100;
    await this.prisma.client.studentCourseProgress.upsert({
      where: { studentProfileId_courseOfferingId: { studentProfileId, courseOfferingId } },
      create: { organizationId: this.org, studentProfileId, courseOfferingId, progressPct: pct, lastComputedAt: new Date() },
      update: { progressPct: pct, lastComputedAt: new Date() },
    });
    return pct;
  }

  /** Completion matrix for the teacher report: students × modules. */
  async matrix(courseOfferingId: string) {
    const modules = await this.prisma.client.courseModule.findMany({
      where: { organizationId: this.org, courseOfferingId, deletedAt: null, completionMode: { not: 'none' } },
    });
    const rows = await this.prisma.client.courseModuleCompletion.findMany({
      where: { organizationId: this.org, courseModuleId: { in: modules.map((m) => m.id) } },
    });
    // Names, so the report reads as a list of activities rather than uuid stubs.
    const views = await this.envelope.moduleViews(modules, { showGrades: false });
    const studentIds = [...new Set(rows.map((r) => r.studentProfileId))];
    const names = await this.envelope.studentNames(studentIds);
    return {
      modules: views.map((v) => ({ id: v.id, activityType: v.activityType, name: v.name, icon: v.icon })),
      students: studentIds.map((sid) => ({ studentProfileId: sid, studentName: names.get(sid)?.name ?? null })),
      completions: rows,
    };
  }
}
