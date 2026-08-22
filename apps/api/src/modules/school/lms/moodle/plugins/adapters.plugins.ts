import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CourseModule } from '@prisma/client';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';
import { ActivityRegistry } from '../activity/activity-registry.service';
import { LmsGradeBridgeService } from '../grade/grade-bridge.service';
import { BaseActivityPlugin } from './plugin-base';
import type { CompletionState, GradeDefinition, PluginCtx } from '../plugin.types';

/**
 * mod_assign (ADR-014 §4) — gradable. Stores only the submission artefact; the mark
 * is written to the assessment spine through the grade bridge. The module owns one
 * Assessment (created by the spine on add); grading fills that student's StudentAssessment.
 */
@Injectable()
export class ModAssignPlugin extends BaseActivityPlugin {
  readonly type = 'assign';
  readonly features = {
    gradable: true, hasSubmissions: true, supportsGroups: true, supportsCompletionAuto: true,
    completionRuleKeys: ['view', 'submit', 'requireGrade', 'minGrade'], label: 'Assignment', icon: 'ClipboardList',
  };
  protected readonly table = 'modAssign';

  constructor(
    prisma: PrismaService,
    tenant: TenantContextService,
    registry: ActivityRegistry,
    private readonly grades: LmsGradeBridgeService,
  ) {
    super(prisma, tenant, registry);
  }

  async createInstance(_ctx: PluginCtx, dto: Record<string, unknown>) {
    const row = await this.model().create({
      data: {
        organizationId: this.org, name: dto.name ?? 'Assignment', intro: dto.intro ?? null,
        dueDate: dto.dueDate ? new Date(dto.dueDate as string) : null,
        cutoffDate: dto.cutoffDate ? new Date(dto.cutoffDate as string) : null,
        maxScore: (dto.maxScore as number) ?? 100,
        submissionTypes: (dto.submissionTypes as string[]) ?? ['online_text', 'file'],
        maxAttempts: (dto.maxAttempts as number) ?? 1,
        teamSubmission: (dto.teamSubmission as boolean) ?? false,
        blindMarking: (dto.blindMarking as boolean) ?? false,
      },
    });
    return { instanceId: row.id };
  }

  async updateInstance(_ctx: PluginCtx, id: string, dto: Record<string, unknown>) {
    await this.model().update({
      where: { id },
      data: {
        name: dto.name, intro: dto.intro, maxScore: dto.maxScore, maxAttempts: dto.maxAttempts,
        submissionTypes: dto.submissionTypes, teamSubmission: dto.teamSubmission, blindMarking: dto.blindMarking,
        dueDate: dto.dueDate !== undefined ? (dto.dueDate ? new Date(dto.dueDate as string) : null) : undefined,
        cutoffDate: dto.cutoffDate !== undefined ? (dto.cutoffDate ? new Date(dto.cutoffDate as string) : null) : undefined,
      },
    });
  }

  async gradeDefinition(_ctx: PluginCtx, instanceId: string): Promise<GradeDefinition> {
    const inst = await this.model().findFirst({ where: { id: instanceId } });
    return { maxScore: Number(inst?.maxScore ?? 100), gradingMode: 'points' };
  }

  async viewForStudent(ctx: PluginCtx, cm: CourseModule) {
    const inst = await this.getInstance(ctx, cm.instanceId);
    const submission = ctx.studentProfileId
      ? await this.db.modAssignSubmission.findFirst({ where: { assignId: cm.instanceId, studentProfileId: ctx.studentProfileId }, orderBy: { attemptNo: 'desc' } })
      : null;
    return { instance: inst, submission };
  }

  async viewForTeacher(ctx: PluginCtx, cm: CourseModule) {
    const inst = await this.getInstance(ctx, cm.instanceId);
    const submissions = await this.db.modAssignSubmission.findMany({ where: { assignId: cm.instanceId }, orderBy: { submittedAt: 'desc' } });
    return { instance: inst, submissions, submissionCount: submissions.length };
  }

  async action(ctx: PluginCtx, cm: CourseModule, action: string, dto: Record<string, unknown>) {
    switch (action) {
      case 'submit': {
        if (!ctx.studentProfileId) throw new BadRequestException('submit requires a student');
        return this.db.modAssignSubmission.upsert({
          where: { assignId_studentProfileId_attemptNo: { assignId: cm.instanceId, studentProfileId: ctx.studentProfileId, attemptNo: 1 } },
          create: { organizationId: this.org, assignId: cm.instanceId, courseModuleId: cm.id, studentProfileId: ctx.studentProfileId, content: (dto.content as string) ?? null, attachments: (dto.attachments as any) ?? [], status: 'submitted' },
          update: { content: (dto.content as string) ?? undefined, attachments: (dto.attachments as any) ?? undefined, status: 'submitted', submittedAt: new Date() },
        });
      }
      case 'grade': {
        const studentProfileId = dto.studentProfileId as string;
        if (!studentProfileId || !cm.assessmentId) throw new BadRequestException('grade requires studentProfileId and a gradable module');
        const sa = await this.ensureStudentAssessment(cm.assessmentId, studentProfileId, cm.instanceId);
        // The mark and the submission's graded flag move together, or a crash
        // leaves a submission marked graded with no score behind it.
        await this.prisma.client.$transaction(async (tx: any) => {
          await this.grades.setScore({ studentAssessmentId: sa.id, score: Number(dto.score), source: 'plugin' }, tx);
          await tx.modAssignSubmission.updateMany({ where: { assignId: cm.instanceId, studentProfileId }, data: { status: 'graded', gradedAt: new Date(), feedback: (dto.feedback as string) ?? null } });
        });
        return { ok: true };
      }
      default:
        throw new BadRequestException(`Unknown mod_assign action '${action}'`);
    }
  }

  async evaluateCompletion(ctx: PluginCtx, cm: CourseModule): Promise<CompletionState> {
    if (!ctx.studentProfileId) return 'incomplete';
    const rules = (cm.completionRules ?? {}) as Record<string, unknown>;
    if (rules.requireGrade || rules.minGrade) {
      const sa = cm.assessmentId ? await this.db.studentAssessment.findFirst({ where: { assessmentId: cm.assessmentId, studentProfileId: ctx.studentProfileId } }) : null;
      const pct = sa?.percentage != null ? Number(sa.percentage) : null;
      if (pct == null) return 'incomplete';
      if (rules.minGrade) return pct >= Number(rules.minGrade) ? 'complete_pass' : 'complete_fail';
      return 'complete';
    }
    if (rules.submit) {
      const sub = await this.db.modAssignSubmission.findFirst({ where: { assignId: cm.instanceId, studentProfileId: ctx.studentProfileId, status: { in: ['submitted', 'graded'] } } });
      return sub ? 'complete' : 'incomplete';
    }
    return 'incomplete';
  }

  private async ensureStudentAssessment(assessmentId: string, studentProfileId: string, _assignId: string) {
    const assessment = await this.db.assessment.findFirst({ where: { id: assessmentId } });
    return this.db.studentAssessment.upsert({
      where: { assessmentId_studentProfileId: { assessmentId, studentProfileId } },
      create: { organizationId: this.org, assessmentId, studentProfileId, classId: assessment?.classId ?? null, termId: assessment?.termId ?? null, maxScore: assessment?.maxScore ?? 100 },
      update: {},
    });
  }
}

/**
 * mod_forum (ADR-014 §4) — reuses the existing Discussion / DiscussionPost tables,
 * scoped to a course module. Not gradable in this pass.
 */
@Injectable()
export class ModForumPlugin extends BaseActivityPlugin {
  readonly type = 'forum';
  readonly features = {
    gradable: false, hasSubmissions: false, supportsGroups: true, supportsCompletionAuto: true,
    completionRuleKeys: ['view', 'forumPosts', 'forumReplies'], label: 'Forum', icon: 'MessagesSquare',
  };
  protected readonly table = 'modForum';

  constructor(prisma: PrismaService, tenant: TenantContextService, registry: ActivityRegistry) { super(prisma, tenant, registry); }

  async createInstance(_ctx: PluginCtx, dto: Record<string, unknown>) {
    const row = await this.model().create({
      data: { organizationId: this.org, name: dto.name ?? 'Forum', intro: dto.intro ?? null, forumType: dto.forumType ?? 'general', subscription: dto.subscription ?? 'optional', maxAttachments: (dto.maxAttachments as number) ?? 2, ratingScale: (dto.ratingScale as number) ?? null },
    });
    return { instanceId: row.id };
  }
  async updateInstance(_ctx: PluginCtx, id: string, dto: Record<string, unknown>) {
    await this.model().update({ where: { id }, data: { name: dto.name, intro: dto.intro, forumType: dto.forumType, subscription: dto.subscription, maxAttachments: dto.maxAttachments, ratingScale: dto.ratingScale } });
  }

  async viewForStudent(_ctx: PluginCtx, cm: CourseModule) { return this.forumView(cm); }
  async viewForTeacher(_ctx: PluginCtx, cm: CourseModule) { return this.forumView(cm); }

  private async forumView(cm: CourseModule) {
    const instance = await this.model().findFirst({ where: { id: cm.instanceId } });
    const discussions = await this.db.discussion.findMany({
      where: { organizationId: this.org, courseModuleId: cm.id, deletedAt: null },
      include: { posts: { orderBy: { createdAt: 'asc' } } },
      orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
    });
    return { instance, discussions };
  }

  async action(ctx: PluginCtx, cm: CourseModule, action: string, dto: Record<string, unknown>) {
    switch (action) {
      case 'startDiscussion': {
        return this.db.discussion.create({
          data: { organizationId: this.org, courseOfferingId: cm.courseOfferingId, courseModuleId: cm.id, forumGroupId: (dto.groupId as string) ?? null, title: (dto.title as string) ?? 'Discussion', body: (dto.body as string) ?? null, createdById: ctx.userId ?? null },
        });
      }
      case 'reply': {
        const discussionId = dto.discussionId as string;
        if (!discussionId) throw new BadRequestException('reply requires discussionId');
        const disc = await this.db.discussion.findFirst({ where: { id: discussionId, organizationId: this.org } });
        if (!disc) throw new NotFoundException('Discussion not found');
        if (disc.locked) throw new BadRequestException('Discussion is locked');
        await this.db.discussion.update({ where: { id: discussionId }, data: { updatedAt: new Date() } });
        return this.db.discussionPost.create({
          data: { organizationId: this.org, discussionId, authorId: ctx.userId ?? null, parentPostId: (dto.parentPostId as string) ?? null, body: (dto.body as string) ?? '' },
        });
      }
      default:
        throw new BadRequestException(`Unknown mod_forum action '${action}'`);
    }
  }

  async evaluateCompletion(ctx: PluginCtx, cm: CourseModule): Promise<CompletionState> {
    if (!ctx.userId) return 'incomplete';
    const rules = (cm.completionRules ?? {}) as Record<string, unknown>;
    const need = Number(rules.forumPosts ?? 0);
    if (need <= 0) return 'incomplete';
    const posts = await this.db.discussionPost.count({ where: { organizationId: this.org, authorId: ctx.userId, discussion: { courseModuleId: cm.id } } });
    return posts >= need ? 'complete' : 'incomplete';
  }
}

export const ADAPTER_PLUGINS = [ModAssignPlugin, ModForumPlugin];
