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
    const inst: any = await this.getInstance(ctx, cm.instanceId);
    const sco = (dto.scoIdentifier as string) ?? 'default';
    const attempt = (dto.attempt as number) ?? 1;

    // Attempt ceiling. `maxAttempts` was stored and ignored, so a package could
    // be re-run indefinitely and each run overwrote the grade.
    const maxAttempts = Number(inst?.maxAttempts ?? 0); // 0 = unlimited
    if (maxAttempts > 0 && attempt > maxAttempts) {
      throw new BadRequestException(`You have used all ${maxAttempts} attempt(s) at this package`);
    }

    const cmi = (dto.cmi as Record<string, unknown>) ?? {};
    const scoreRaw = cmi['cmi.core.score.raw'] ?? cmi['cmi.score.raw'];
    const lessonStatus = String(cmi['cmi.core.lesson_status'] ?? cmi['cmi.completion_status'] ?? 'incomplete');
    await this.db.scormTrack.upsert({
      where: { scormId_studentProfileId_scoIdentifier_attempt: { scormId: cm.instanceId, studentProfileId: ctx.studentProfileId, scoIdentifier: sco, attempt } },
      create: { organizationId: this.org, scormId: cm.instanceId, studentProfileId: ctx.studentProfileId, scoIdentifier: sco, attempt, cmi: cmi as any, lessonStatus, scoreRaw: scoreRaw != null ? Number(scoreRaw) : null },
      update: { cmi: cmi as any, lessonStatus, scoreRaw: scoreRaw != null ? Number(scoreRaw) : null },
    });

    if (cm.assessmentId) {
      // The grade is the one the package's OWN grading method selects across
      // attempts — writing the latest raw score meant a pupil could lower their
      // mark by re-opening a completed package.
      const graded = await this.gradeFromTracks(cm.instanceId, ctx.studentProfileId, String(inst?.gradingMethod ?? 'highest'));
      if (graded != null) {
        const sa = await this.ensureSa(cm.assessmentId, ctx.studentProfileId);
        await this.prisma.client.$transaction(async (tx: any) =>
          this.grades.setScore({ studentAssessmentId: sa.id, score: graded, source: 'plugin' }, tx));
      }
    }
    return { ok: true, attempt };
  }

  /** Reduce a pupil's tracked attempts to one mark, per the package's setting. */
  private async gradeFromTracks(scormId: string, studentProfileId: string, method: string): Promise<number | null> {
    const tracks: Array<{ attempt: number; scoreRaw: unknown }> = await this.db.scormTrack.findMany({
      where: { organizationId: this.org, scormId, studentProfileId, scoreRaw: { not: null } },
      orderBy: { attempt: 'asc' },
      select: { attempt: true, scoreRaw: true },
    });
    const scores = tracks.map((t) => Number(t.scoreRaw)).filter((n) => Number.isFinite(n));
    if (scores.length === 0) return null;
    switch (method) {
      case 'first': return scores[0];
      case 'last': return scores[scores.length - 1];
      case 'average': return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100;
      case 'highest':
      default: return Math.max(...scores);
    }
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
    // xAPI nests the score: `result.score.{raw,max,scaled}`. The flat
    // `result['score.scaled']` lookup this replaced never matched a real
    // statement, so H5P activities silently never graded.
    const score = (result.score ?? {}) as Record<string, unknown>;
    const scaled =
      score.scaled != null
        ? Number(score.scaled)
        : score.raw != null && score.max != null && Number(score.max) > 0
          ? Number(score.raw) / Number(score.max)
          : (result as any)['score.scaled'] ?? null;
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
    const inst: any = await this.getInstance(ctx, cm.instanceId);
    const phase = String(inst?.phase ?? 'setup');

    switch (action) {
      case 'submit': {
        if (!ctx.studentProfileId) throw new BadRequestException('submit requires a student');
        // Phases are the whole point of a workshop: work must be in before peers
        // review it, or a reviewer sees a half-finished draft and marks it.
        if (phase !== 'submission') {
          throw new BadRequestException(`This workshop is in the ${phase} phase and is not accepting submissions`);
        }
        const already = await this.db.modWorkshopSubmission.findFirst({
          where: { workshopId: cm.instanceId, studentProfileId: ctx.studentProfileId },
        });
        if (already) {
          return this.db.modWorkshopSubmission.update({
            where: { id: already.id },
            data: { title: (dto.title as string) ?? already.title, content: (dto.content as string) ?? already.content, attachments: (dto.attachments as any) ?? already.attachments },
          });
        }
        return this.db.modWorkshopSubmission.create({ data: { organizationId: this.org, workshopId: cm.instanceId, studentProfileId: ctx.studentProfileId, title: (dto.title as string) ?? 'Submission', content: (dto.content as string) ?? null, attachments: (dto.attachments as any) ?? [] } });
      }

      case 'allocate': {
        return this.db.modWorkshopAllocation.create({ data: { organizationId: this.org, workshopId: cm.instanceId, submissionId: dto.submissionId as string, reviewerProfileId: dto.reviewerProfileId as string } });
      }

      /**
       * Spread reviewers round-robin so every submission gets `numReviewers`, and
       * nobody reviews their own work. Doing this by hand for a class of 30 is
       * why teachers avoid peer assessment.
       */
      case 'autoAllocate': {
        const submissions = await this.db.modWorkshopSubmission.findMany({ where: { workshopId: cm.instanceId } });
        if (submissions.length < 2) throw new BadRequestException('Need at least two submissions to allocate reviewers');
        const perSubmission = Math.min(Number(inst?.numReviewers ?? 2), submissions.length - 1);
        await this.db.modWorkshopAllocation.deleteMany({ where: { workshopId: cm.instanceId, submittedAt: null } });
        const created = [];
        for (let i = 0; i < submissions.length; i++) {
          for (let n = 1; n <= perSubmission; n++) {
            const reviewer = submissions[(i + n) % submissions.length];
            if (reviewer.studentProfileId === submissions[i].studentProfileId) continue;
            created.push(await this.db.modWorkshopAllocation.create({
              data: {
                organizationId: this.org, workshopId: cm.instanceId,
                submissionId: submissions[i].id, reviewerProfileId: reviewer.studentProfileId,
              },
            }));
          }
        }
        return { allocated: created.length, perSubmission };
      }

      case 'assess': {
        if (phase !== 'assessment') {
          throw new BadRequestException(`This workshop is in the ${phase} phase and is not accepting assessments`);
        }
        const allocation = await this.db.modWorkshopAllocation.findFirst({
          where: { id: dto.allocationId as string, workshopId: cm.instanceId },
        });
        if (!allocation) throw new BadRequestException('Allocation not found');
        // A reviewer may only fill in the review assigned to them.
        if (ctx.studentProfileId && allocation.reviewerProfileId !== ctx.studentProfileId) {
          throw new BadRequestException('This review is allocated to someone else');
        }
        return this.db.modWorkshopAllocation.update({ where: { id: allocation.id }, data: { grade: Number(dto.grade), feedback: (dto.feedback as string) ?? null, filledRubric: (dto.filledRubric as any) ?? {}, submittedAt: new Date() } });
      }

      /**
       * Move to the next phase. Closing assessment computes each author's mark
       * from the peer reviews and posts it to the spine — the point at which a
       * workshop becomes a graded activity rather than a discussion.
       */
      case 'setPhase': {
        const next = String(dto.phase ?? '');
        const allowed = ['setup', 'submission', 'assessment', 'grading', 'closed'];
        if (!allowed.includes(next)) throw new BadRequestException(`Unknown workshop phase '${next}'`);
        await this.model().update({ where: { id: cm.instanceId }, data: { phase: next } });
        if (next === 'grading' || next === 'closed') await this.computePeerGrades(cm);
        return { ok: true, phase: next };
      }

      default:
        throw new BadRequestException(`Unknown mod_workshop action '${action}'`);
    }
  }

  /** Average the submitted peer reviews per author and post to the assessment spine. */
  private async computePeerGrades(cm: CourseModule): Promise<{ graded: number }> {
    if (!cm.assessmentId) return { graded: 0 };
    const submissions = await this.db.modWorkshopSubmission.findMany({ where: { workshopId: cm.instanceId } });
    let graded = 0;
    for (const sub of submissions) {
      const reviews = await this.db.modWorkshopAllocation.findMany({
        where: { workshopId: cm.instanceId, submissionId: sub.id, submittedAt: { not: null }, grade: { not: null } },
        select: { grade: true },
      });
      if (reviews.length === 0) continue; // nobody reviewed it; leave unmarked rather than score zero
      const mean = reviews.reduce((a: number, r: any) => a + Number(r.grade), 0) / reviews.length;
      const sa = await this.ensureSa(cm.assessmentId, sub.studentProfileId);
      await this.prisma.client.$transaction(async (tx: any) =>
        this.grades.setScore({ studentAssessmentId: sa.id, score: Math.round(mean * 100) / 100, source: 'plugin' }, tx));
      graded += 1;
    }
    return { graded };
  }

  private async ensureSa(assessmentId: string, studentProfileId: string) {
    const a = await this.db.assessment.findFirst({ where: { id: assessmentId } });
    return this.db.studentAssessment.upsert({
      where: { assessmentId_studentProfileId: { assessmentId, studentProfileId } },
      create: { organizationId: this.org, assessmentId, studentProfileId, classId: a?.classId ?? null, termId: a?.termId ?? null, maxScore: a?.maxScore ?? 100 },
      update: {},
    });
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
