import { BadRequestException, Injectable } from '@nestjs/common';
import type { CourseModule } from '@prisma/client';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';
import { ActivityRegistry } from '../activity/activity-registry.service';
import { LmsGradeBridgeService } from '../grade/grade-bridge.service';
import { BaseActivityPlugin } from './plugin-base';
import type { CompletionState, GradeDefinition, PluginCtx } from '../plugin.types';

/**
 * mod_scorm — SCORM 1.2 / 2004 package. Backend stores the CMI datamodel per SCO
 * attempt (ScormTrack) and bridges cmi.core.score.raw into the module Assessment.
 * NOTE: the SCO player + manifest sequencing run in the browser; full IMS sequencing
 * is not implemented here — this is the tracking + grade surface it posts to.
 */
@Injectable()
export class ModScormPlugin extends BaseActivityPlugin {
  readonly type = 'scorm';
  readonly features = { gradable: true, hasSubmissions: true, supportsGroups: false, supportsCompletionAuto: true, completionRuleKeys: ['view', 'requireGrade', 'minGrade'], label: 'SCORM package', icon: 'Package' };
  protected readonly table = 'modScorm';
  constructor(prisma: PrismaService, tenant: TenantContextService, registry: ActivityRegistry, private readonly grades: LmsGradeBridgeService) { super(prisma, tenant, registry); }

  async createInstance(_ctx: PluginCtx, dto: Record<string, unknown>) {
    const row = await this.model().create({ data: { organizationId: this.org, name: dto.name ?? 'SCORM package', intro: dto.intro ?? null, packageFileId: (dto.packageFileId as string) ?? null, scormVersion: dto.scormVersion ?? '1.2', manifest: (dto.manifest as any) ?? {}, maxAttempts: (dto.maxAttempts as number) ?? 0, gradingMethod: dto.gradingMethod ?? 'highest', maxScore: (dto.maxScore as number) ?? 100 } });
    return { instanceId: row.id };
  }
  async updateInstance(_ctx: PluginCtx, id: string, dto: Record<string, unknown>) {
    await this.model().update({ where: { id }, data: { name: dto.name, intro: dto.intro, manifest: dto.manifest as any, maxAttempts: dto.maxAttempts, gradingMethod: dto.gradingMethod, maxScore: dto.maxScore } });
  }
  async gradeDefinition(_ctx: PluginCtx, instanceId: string): Promise<GradeDefinition> {
    const inst = await this.model().findFirst({ where: { id: instanceId } });
    return { maxScore: Number(inst?.maxScore ?? 100), gradingMode: 'points' };
  }
  async viewForStudent(ctx: PluginCtx, cm: CourseModule) {
    const inst = await this.getInstance(ctx, cm.instanceId);
    const tracks = ctx.studentProfileId ? await this.db.scormTrack.findMany({ where: { scormId: cm.instanceId, studentProfileId: ctx.studentProfileId } }) : [];
    return { instance: inst, tracks };
  }
  async viewForTeacher(ctx: PluginCtx, cm: CourseModule) {
    const inst = await this.getInstance(ctx, cm.instanceId);
    const trackCount = await this.db.scormTrack.count({ where: { scormId: cm.instanceId } });
    return { instance: inst, trackCount };
  }
  async action(ctx: PluginCtx, cm: CourseModule, action: string, dto: Record<string, unknown>) {
    if (action !== 'commit') throw new BadRequestException(`Unknown mod_scorm action '${action}'`);
    if (!ctx.studentProfileId) throw new BadRequestException('commit requires a student');
    const sco = (dto.scoIdentifier as string) ?? 'default';
    const attempt = (dto.attempt as number) ?? 1;
    const cmi = (dto.cmi as Record<string, unknown>) ?? {};
    const scoreRaw = cmi['cmi.core.score.raw'] ?? cmi['cmi.score.raw'];
    const lessonStatus = String(cmi['cmi.core.lesson_status'] ?? cmi['cmi.completion_status'] ?? 'incomplete');
    await this.db.scormTrack.upsert({
      where: { scormId_studentProfileId_scoIdentifier_attempt: { scormId: cm.instanceId, studentProfileId: ctx.studentProfileId, scoIdentifier: sco, attempt } },
      create: { organizationId: this.org, scormId: cm.instanceId, studentProfileId: ctx.studentProfileId, scoIdentifier: sco, attempt, cmi: cmi as any, lessonStatus, scoreRaw: scoreRaw != null ? Number(scoreRaw) : null },
      update: { cmi: cmi as any, lessonStatus, scoreRaw: scoreRaw != null ? Number(scoreRaw) : null },
    });
    if (scoreRaw != null && cm.assessmentId) {
      const sa = await this.ensureSa(cm.assessmentId, ctx.studentProfileId);
      await this.prisma.client.$transaction(async (tx: any) =>
        this.grades.setScore({ studentAssessmentId: sa.id, score: Number(scoreRaw), source: 'plugin' }, tx));
    }
    return { ok: true };
  }
  async evaluateCompletion(ctx: PluginCtx, cm: CourseModule): Promise<CompletionState> {
    if (!ctx.studentProfileId) return 'incomplete';
    const t = await this.db.scormTrack.findFirst({ where: { scormId: cm.instanceId, studentProfileId: ctx.studentProfileId, lessonStatus: { in: ['completed', 'passed'] } } });
    return t ? (t.lessonStatus === 'passed' ? 'complete_pass' : 'complete') : 'incomplete';
  }
  private async ensureSa(assessmentId: string, studentProfileId: string) {
    const a = await this.db.assessment.findFirst({ where: { id: assessmentId } });
    return this.db.studentAssessment.upsert({ where: { assessmentId_studentProfileId: { assessmentId, studentProfileId } }, create: { organizationId: this.org, assessmentId, studentProfileId, classId: a?.classId ?? null, termId: a?.termId ?? null, maxScore: a?.maxScore ?? 100 }, update: {} });
  }
}

/**
 * mod_lti — LTI 1.3 tool link. NOTE: OIDC login + signed launch (JWT/JWKS) and the
 * AGS grade callback are the runtime; this stores the tool registration and exposes a
 * launch descriptor the frontend/edge signs. Grade sync accepts an AGS score post.
 */
@Injectable()
export class ModLtiPlugin extends BaseActivityPlugin {
  readonly type = 'lti';
  readonly features = { gradable: true, hasSubmissions: false, supportsGroups: false, supportsCompletionAuto: false, completionRuleKeys: ['view'], label: 'External tool', icon: 'ExternalLink' };
  protected readonly table = 'modLti';
  constructor(prisma: PrismaService, tenant: TenantContextService, registry: ActivityRegistry, private readonly grades: LmsGradeBridgeService) { super(prisma, tenant, registry); }

  async createInstance(_ctx: PluginCtx, dto: Record<string, unknown>) {
    const row = await this.model().create({ data: { organizationId: this.org, name: dto.name ?? 'External tool', intro: dto.intro ?? null, toolUrl: dto.toolUrl as string, clientId: (dto.clientId as string) ?? null, deploymentId: (dto.deploymentId as string) ?? null, loginUrl: (dto.loginUrl as string) ?? null, customParams: (dto.customParams as any) ?? {}, launchContainer: dto.launchContainer ?? 'new_window', gradable: (dto.gradable as boolean) ?? false, maxScore: (dto.maxScore as number) ?? 100 } });
    return { instanceId: row.id };
  }
  async updateInstance(_ctx: PluginCtx, id: string, dto: Record<string, unknown>) {
    await this.model().update({ where: { id }, data: { name: dto.name, intro: dto.intro, toolUrl: dto.toolUrl, clientId: dto.clientId, deploymentId: dto.deploymentId, customParams: dto.customParams as any, gradable: dto.gradable, maxScore: dto.maxScore } });
  }
  async gradeDefinition(_ctx: PluginCtx, instanceId: string): Promise<GradeDefinition> {
    const inst = await this.model().findFirst({ where: { id: instanceId } });
    return { maxScore: Number(inst?.maxScore ?? 100), gradingMode: 'points' };
  }
  async viewForStudent(ctx: PluginCtx, cm: CourseModule) {
    const inst: any = await this.getInstance(ctx, cm.instanceId);
    // Launch descriptor — the actual signed OIDC launch is performed at the edge.
    return { instance: inst, launch: { toolUrl: inst?.toolUrl, container: inst?.launchContainer, custom: inst?.customParams } };
  }
  async viewForTeacher(ctx: PluginCtx, cm: CourseModule) { return this.getInstance(ctx, cm.instanceId); }
  async action(ctx: PluginCtx, cm: CourseModule, action: string, dto: Record<string, unknown>) {
    if (action !== 'agsScore') throw new BadRequestException(`Unknown mod_lti action '${action}'`);
    const studentProfileId = (dto.studentProfileId as string) ?? ctx.studentProfileId;
    if (!studentProfileId || !cm.assessmentId) throw new BadRequestException('agsScore requires a gradable module and student');
    const a = await this.db.assessment.findFirst({ where: { id: cm.assessmentId } });
    const sa = await this.db.studentAssessment.upsert({ where: { assessmentId_studentProfileId: { assessmentId: cm.assessmentId, studentProfileId } }, create: { organizationId: this.org, assessmentId: cm.assessmentId, studentProfileId, classId: a?.classId ?? null, termId: a?.termId ?? null, maxScore: a?.maxScore ?? 100 }, update: {} });
    await this.prisma.client.$transaction(async (tx: any) =>
      this.grades.setScore({ studentAssessmentId: sa.id, score: Number(dto.score), source: 'plugin' }, tx));
    return { ok: true };
  }
}

/**
 * mod_h5p — H5P interactive content. Backend stores content metadata and captures
 * xAPI statements; when a statement carries a score and the module is gradable, it
 * bridges into the Assessment. NOTE: the H5P player runs in the browser.
 */
@Injectable()
export class ModH5pPlugin extends BaseActivityPlugin {
  readonly type = 'h5p';
  readonly features = { gradable: true, hasSubmissions: true, supportsGroups: false, supportsCompletionAuto: true, completionRuleKeys: ['view', 'requireGrade'], label: 'H5P', icon: 'Puzzle' };
  protected readonly table = 'modH5p';
  constructor(prisma: PrismaService, tenant: TenantContextService, registry: ActivityRegistry, private readonly grades: LmsGradeBridgeService) { super(prisma, tenant, registry); }

  async createInstance(_ctx: PluginCtx, dto: Record<string, unknown>) {
    const row = await this.model().create({ data: { organizationId: this.org, name: dto.name ?? 'Interactive content', intro: dto.intro ?? null, packageFileId: (dto.packageFileId as string) ?? null, contentJson: (dto.contentJson as any) ?? {}, library: (dto.library as string) ?? null, gradable: (dto.gradable as boolean) ?? false, maxScore: (dto.maxScore as number) ?? 100 } });
    return { instanceId: row.id };
  }
  async updateInstance(_ctx: PluginCtx, id: string, dto: Record<string, unknown>) {
    await this.model().update({ where: { id }, data: { name: dto.name, intro: dto.intro, contentJson: dto.contentJson as any, library: dto.library, gradable: dto.gradable, maxScore: dto.maxScore } });
  }
  async gradeDefinition(_ctx: PluginCtx, instanceId: string): Promise<GradeDefinition> {
    const inst = await this.model().findFirst({ where: { id: instanceId } });
    return { maxScore: Number(inst?.maxScore ?? 100), gradingMode: 'points' };
  }
  async viewForStudent(ctx: PluginCtx, cm: CourseModule) { return this.getInstance(ctx, cm.instanceId); }
  async viewForTeacher(ctx: PluginCtx, cm: CourseModule) {
    const inst = await this.getInstance(ctx, cm.instanceId);
    const statements = await this.db.xapiStatement.count({ where: { h5pId: cm.instanceId } });
    return { instance: inst, statementCount: statements };
  }
  async action(ctx: PluginCtx, cm: CourseModule, action: string, dto: Record<string, unknown>) {
    if (action !== 'xapi') throw new BadRequestException(`Unknown mod_h5p action '${action}'`);
    const result = (dto.result as Record<string, unknown>) ?? {};
    await this.db.xapiStatement.create({ data: { organizationId: this.org, h5pId: cm.instanceId, courseModuleId: cm.id, studentProfileId: ctx.studentProfileId ?? null, userId: ctx.userId ?? null, verb: (dto.verb as string) ?? 'experienced', object: (dto.object as string) ?? cm.instanceId, result: result as any, raw: (dto.raw as any) ?? {} } });
    const scaled = result['score.scaled'] ?? (result as any).scaled;
    if (scaled != null && cm.assessmentId && ctx.studentProfileId) {
      const inst: any = await this.getInstance(ctx, cm.instanceId);
      const a = await this.db.assessment.findFirst({ where: { id: cm.assessmentId } });
      const sa = await this.db.studentAssessment.upsert({ where: { assessmentId_studentProfileId: { assessmentId: cm.assessmentId, studentProfileId: ctx.studentProfileId } }, create: { organizationId: this.org, assessmentId: cm.assessmentId, studentProfileId: ctx.studentProfileId, classId: a?.classId ?? null, termId: a?.termId ?? null, maxScore: a?.maxScore ?? 100 }, update: {} });
      await this.prisma.client.$transaction(async (tx: any) =>
        this.grades.setScore({ studentAssessmentId: sa.id, score: Number(scaled) * Number(inst?.maxScore ?? 100), source: 'plugin' }, tx));
    }
    return { ok: true };
  }
}

/**
 * mod_workshop — peer assessment (ADR-014 §4). Phases: setup → submission →
 * assessment → grading → closed. Simplified allocation + grading in this pass.
 */
@Injectable()
export class ModWorkshopPlugin extends BaseActivityPlugin {
  readonly type = 'workshop';
  readonly features = { gradable: true, hasSubmissions: true, supportsGroups: false, supportsCompletionAuto: false, completionRuleKeys: ['view', 'submit'], label: 'Workshop', icon: 'Users' };
  protected readonly table = 'modWorkshop';
  constructor(prisma: PrismaService, tenant: TenantContextService, registry: ActivityRegistry, private readonly grades: LmsGradeBridgeService) { super(prisma, tenant, registry); }

  async createInstance(_ctx: PluginCtx, dto: Record<string, unknown>) {
    const row = await this.model().create({ data: { organizationId: this.org, name: dto.name ?? 'Workshop', intro: dto.intro ?? null, numReviewers: (dto.numReviewers as number) ?? 3, rubric: (dto.rubric as any) ?? {}, gradeSubmission: (dto.gradeSubmission as number) ?? 80, gradeAssessment: (dto.gradeAssessment as number) ?? 20 } });
    return { instanceId: row.id };
  }
  async updateInstance(_ctx: PluginCtx, id: string, dto: Record<string, unknown>) {
    await this.model().update({ where: { id }, data: { name: dto.name, intro: dto.intro, phase: dto.phase, numReviewers: dto.numReviewers, rubric: dto.rubric as any } });
  }
  async viewForStudent(ctx: PluginCtx, cm: CourseModule) {
    const inst = await this.getInstance(ctx, cm.instanceId);
    const mine = ctx.studentProfileId ? await this.db.modWorkshopSubmission.findFirst({ where: { workshopId: cm.instanceId, studentProfileId: ctx.studentProfileId } }) : null;
    const toReview = ctx.studentProfileId ? await this.db.modWorkshopAllocation.findMany({ where: { workshopId: cm.instanceId, reviewerProfileId: ctx.studentProfileId } }) : [];
    return { instance: inst, mySubmission: mine, toReview };
  }
  async viewForTeacher(ctx: PluginCtx, cm: CourseModule) {
    const inst = await this.getInstance(ctx, cm.instanceId);
    const submissions = await this.db.modWorkshopSubmission.findMany({ where: { workshopId: cm.instanceId } });
    return { instance: inst, submissions };
  }
  async action(ctx: PluginCtx, cm: CourseModule, action: string, dto: Record<string, unknown>) {
    switch (action) {
      case 'submit': {
        if (!ctx.studentProfileId) throw new BadRequestException('submit requires a student');
        return this.db.modWorkshopSubmission.create({ data: { organizationId: this.org, workshopId: cm.instanceId, studentProfileId: ctx.studentProfileId, title: (dto.title as string) ?? 'Submission', content: (dto.content as string) ?? null, attachments: (dto.attachments as any) ?? [] } });
      }
      case 'allocate': {
        return this.db.modWorkshopAllocation.create({ data: { organizationId: this.org, workshopId: cm.instanceId, submissionId: dto.submissionId as string, reviewerProfileId: dto.reviewerProfileId as string } });
      }
      case 'assess': {
        return this.db.modWorkshopAllocation.update({ where: { id: dto.allocationId as string }, data: { grade: Number(dto.grade), feedback: (dto.feedback as string) ?? null, filledRubric: (dto.filledRubric as any) ?? {}, submittedAt: new Date() } });
      }
      default:
        throw new BadRequestException(`Unknown mod_workshop action '${action}'`);
    }
  }
}

/**
 * mod_attendance — a thin wrapper that surfaces the EXISTING attendance module inside
 * a course. Not gradable; the canonical attendance truth stays in that module.
 */
@Injectable()
export class ModAttendancePlugin extends BaseActivityPlugin {
  readonly type = 'attendance';
  readonly features = { gradable: false, hasSubmissions: false, supportsGroups: false, supportsCompletionAuto: false, completionRuleKeys: ['view'], label: 'Attendance', icon: 'CalendarCheck' };
  protected readonly table = 'modLabel'; // no own state; reuse a trivial instance row
  constructor(prisma: PrismaService, tenant: TenantContextService, registry: ActivityRegistry) { super(prisma, tenant, registry); }

  async createInstance(_ctx: PluginCtx, _dto: Record<string, unknown>) {
    const row = await this.db.modLabel.create({ data: { organizationId: this.org, content: 'attendance' } });
    return { instanceId: row.id };
  }
  async updateInstance(): Promise<void> { /* nothing to edit */ }
  async viewForStudent(_ctx: PluginCtx, cm: CourseModule) { return { link: { module: 'attendance', courseOfferingId: cm.courseOfferingId } }; }
  async viewForTeacher(_ctx: PluginCtx, cm: CourseModule) { return { link: { module: 'attendance', courseOfferingId: cm.courseOfferingId } }; }
}

export const STANDARDS_PLUGINS = [ModScormPlugin, ModLtiPlugin, ModH5pPlugin, ModWorkshopPlugin, ModAttendancePlugin];
