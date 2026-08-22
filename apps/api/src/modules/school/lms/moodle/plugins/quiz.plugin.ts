import { BadRequestException, Injectable } from '@nestjs/common';
import type { CourseModule } from '@prisma/client';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';
import { ActivityRegistry } from '../activity/activity-registry.service';
import { LmsGradeBridgeService } from '../grade/grade-bridge.service';
import { BaseActivityPlugin } from './plugin-base';
import { pickAttemptScore, type QuizGradingMethod } from '../../../cbt/cbt-marking';
import type { CompletionState, GradeDefinition, PluginCtx } from '../plugin.types';

/**
 * mod_quiz (ADR-014 §3.6, §4) — gradable. Owns the quiz STRUCTURE (settings, slots,
 * overrides) and creates a Paper so the proven CBT attempt engine (QuizAttempt /
 * QuizResponse + marking) runs the runtime; it is not reinvented here. `syncGrade`
 * bridges the best attempt's auto-score into the module's Assessment.
 */
@Injectable()
export class ModQuizPlugin extends BaseActivityPlugin {
  readonly type = 'quiz';
  readonly features = {
    gradable: true, hasSubmissions: true, supportsGroups: true, supportsCompletionAuto: true,
    completionRuleKeys: ['view', 'requireGrade', 'minGrade'], label: 'Quiz', icon: 'ListChecks',
  };
  protected readonly table = 'modQuiz';

  constructor(
    prisma: PrismaService,
    tenant: TenantContextService,
    registry: ActivityRegistry,
    private readonly grades: LmsGradeBridgeService,
  ) {
    super(prisma, tenant, registry);
  }

  async createInstance(_ctx: PluginCtx, dto: Record<string, unknown>) {
    // A Paper backs the CBT runtime; slots are synced into PaperQuestion rows.
    const paper = await this.db.paper.create({
      data: { organizationId: this.org, name: (dto.name as string) ?? 'Quiz', durationMinutes: dto.timeLimitSec ? Math.ceil(Number(dto.timeLimitSec) / 60) : 60 },
    });
    const row = await this.model().create({
      data: {
        organizationId: this.org, name: dto.name ?? 'Quiz', intro: dto.intro ?? null, questionPaperId: paper.id,
        timeLimitSec: (dto.timeLimitSec as number) ?? null, attemptsAllowed: (dto.attemptsAllowed as number) ?? 0,
        gradingMethod: dto.gradingMethod ?? 'highest', navMethod: dto.navMethod ?? 'free',
        shuffleQuestions: (dto.shuffleQuestions as boolean) ?? false, shuffleAnswers: (dto.shuffleAnswers as boolean) ?? true,
        behaviour: dto.behaviour ?? 'deferredfeedback', reviewOptions: (dto.reviewOptions as any) ?? {},
        overallFeedback: (dto.overallFeedback as any) ?? [], maxScore: (dto.maxScore as number) ?? 100,
        openAt: dto.openAt ? new Date(dto.openAt as string) : null, closeAt: dto.closeAt ? new Date(dto.closeAt as string) : null,
      },
    });
    return { instanceId: row.id };
  }

  async updateInstance(_ctx: PluginCtx, id: string, dto: Record<string, unknown>) {
    await this.model().update({
      where: { id },
      data: {
        name: dto.name, intro: dto.intro, timeLimitSec: dto.timeLimitSec, attemptsAllowed: dto.attemptsAllowed,
        gradingMethod: dto.gradingMethod, navMethod: dto.navMethod, shuffleQuestions: dto.shuffleQuestions, shuffleAnswers: dto.shuffleAnswers,
        behaviour: dto.behaviour, reviewOptions: dto.reviewOptions as any, overallFeedback: dto.overallFeedback as any, maxScore: dto.maxScore,
        openAt: dto.openAt !== undefined ? (dto.openAt ? new Date(dto.openAt as string) : null) : undefined,
        closeAt: dto.closeAt !== undefined ? (dto.closeAt ? new Date(dto.closeAt as string) : null) : undefined,
      },
    });
  }

  async gradeDefinition(_ctx: PluginCtx, instanceId: string): Promise<GradeDefinition> {
    const inst = await this.model().findFirst({ where: { id: instanceId } });
    return { maxScore: Number(inst?.maxScore ?? 100), gradingMode: 'points' };
  }

  async viewForStudent(ctx: PluginCtx, cm: CourseModule) {
    const inst: any = await this.getInstance(ctx, cm.instanceId);
    const slots = await this.db.quizSlot.findMany({ where: { quizId: cm.instanceId }, orderBy: { slotNo: 'asc' } });
    const attempts = ctx.studentProfileId && inst?.questionPaperId
      ? await this.db.quizAttempt.findMany({ where: { organizationId: this.org, paperId: inst.questionPaperId, studentProfileId: ctx.studentProfileId }, orderBy: { attemptNumber: 'desc' } })
      : [];
    return { instance: inst, slotCount: slots.length, attempts, paperId: inst?.questionPaperId };
  }

  async viewForTeacher(ctx: PluginCtx, cm: CourseModule) {
    const inst: any = await this.getInstance(ctx, cm.instanceId);
    const slots = await this.db.quizSlot.findMany({ where: { quizId: cm.instanceId }, orderBy: { slotNo: 'asc' } });
    const overrides = await this.db.quizOverride.findMany({ where: { quizId: cm.instanceId } });
    const attemptCount = inst?.questionPaperId ? await this.db.quizAttempt.count({ where: { organizationId: this.org, paperId: inst.questionPaperId } }) : 0;
    return { instance: inst, slots, overrides, attemptCount, paperId: inst?.questionPaperId };
  }

  async action(ctx: PluginCtx, cm: CourseModule, action: string, dto: Record<string, unknown>) {
    const inst: any = await this.getInstance(ctx, cm.instanceId);
    switch (action) {
      case 'addSlot': {
        const max = await this.db.quizSlot.aggregate({ where: { quizId: cm.instanceId }, _max: { slotNo: true } });
        const slotNo = (max._max.slotNo ?? 0) + 1;
        const slot = await this.db.quizSlot.create({
          data: {
            organizationId: this.org, quizId: cm.instanceId, slotNo, page: (dto.page as number) ?? 1,
            questionId: (dto.questionId as string) ?? null, questionVersionId: (dto.questionVersionId as string) ?? null,
            randomCategoryId: (dto.randomCategoryId as string) ?? null, randomIncludeSub: (dto.randomIncludeSub as boolean) ?? false,
            randomTags: (dto.randomTags as string[]) ?? [], maxMark: (dto.maxMark as number) ?? 1, requirePrevious: (dto.requirePrevious as boolean) ?? false,
          },
        });
        // Fixed-question slots become PaperQuestion rows so the CBT engine can present them.
        if (dto.questionId && inst?.questionPaperId) {
          await this.db.paperQuestion.upsert({
            where: { paperId_questionId: { paperId: inst.questionPaperId, questionId: dto.questionId as string } },
            create: { paperId: inst.questionPaperId, questionId: dto.questionId as string, order: slotNo, marks: (dto.maxMark as number) ?? 1 },
            update: { order: slotNo, marks: (dto.maxMark as number) ?? 1 },
          });
        }
        return slot;
      }
      case 'removeSlot': {
        const slot = await this.db.quizSlot.findFirst({ where: { id: dto.slotId as string, quizId: cm.instanceId } });
        if (slot) {
          await this.db.quizSlot.delete({ where: { id: slot.id } });
          if (slot.questionId && inst?.questionPaperId) await this.db.paperQuestion.deleteMany({ where: { paperId: inst.questionPaperId, questionId: slot.questionId } });
        }
        return { ok: true };
      }
      case 'addOverride': {
        return this.db.quizOverride.create({
          data: {
            organizationId: this.org, quizId: cm.instanceId, studentProfileId: (dto.studentProfileId as string) ?? null, groupId: (dto.groupId as string) ?? null,
            openAt: dto.openAt ? new Date(dto.openAt as string) : null, closeAt: dto.closeAt ? new Date(dto.closeAt as string) : null,
            timeLimitSec: (dto.timeLimitSec as number) ?? null, attemptsAllowed: (dto.attemptsAllowed as number) ?? null,
          },
        });
      }
      case 'syncGrade': {
        // Pull the student's best submitted attempt auto-score into the module's Assessment.
        const studentProfileId = (dto.studentProfileId as string) ?? ctx.studentProfileId;
        if (!studentProfileId || !cm.assessmentId || !inst?.questionPaperId) throw new BadRequestException('syncGrade requires a graded quiz, paper, and student');
        const attempts = await this.db.quizAttempt.findMany({
          where: { organizationId: this.org, paperId: inst.questionPaperId, studentProfileId, status: 'submitted' },
          orderBy: { attemptNumber: 'asc' },
        });
        // An attempt still awaiting human marking is not a final score — syncing
        // it would publish a partial grade as if it were complete.
        const gradable = attempts.filter((a: any) => (a.manualPending ?? 0) === 0);
        if (gradable.length === 0) {
          return { ok: false, reason: attempts.length === 0 ? 'no submitted attempt' : 'attempts await manual marking' };
        }
        const best = pickAttemptScore(
          gradable.map((a: any) => ({ attemptNumber: a.attemptNumber, score: Number(a.autoScore ?? 0) })),
          (inst.gradingMethod as QuizGradingMethod) ?? 'highest',
        );
        if (best === null) return { ok: false, reason: 'no submitted attempt' };
        const sa = await this.ensureStudentAssessment(cm.assessmentId, studentProfileId);
        await this.prisma.client.$transaction(async (tx: any) =>
          this.grades.setScore({ studentAssessmentId: sa.id, score: best, source: 'plugin' }, tx));
        return { ok: true, score: best };
      }
      default:
        throw new BadRequestException(`Unknown mod_quiz action '${action}'`);
    }
  }

  async evaluateCompletion(ctx: PluginCtx, cm: CourseModule): Promise<CompletionState> {
    if (!ctx.studentProfileId || !cm.assessmentId) return 'incomplete';
    const rules = (cm.completionRules ?? {}) as Record<string, unknown>;
    const sa = await this.db.studentAssessment.findFirst({ where: { assessmentId: cm.assessmentId, studentProfileId: ctx.studentProfileId } });
    const pct = sa?.percentage != null ? Number(sa.percentage) : null;
    if (pct == null) return 'incomplete';
    if (rules.minGrade) return pct >= Number(rules.minGrade) ? 'complete_pass' : 'complete_fail';
    return 'complete';
  }

  private async ensureStudentAssessment(assessmentId: string, studentProfileId: string) {
    const assessment = await this.db.assessment.findFirst({ where: { id: assessmentId } });
    return this.db.studentAssessment.upsert({
      where: { assessmentId_studentProfileId: { assessmentId, studentProfileId } },
      create: { organizationId: this.org, assessmentId, studentProfileId, classId: assessment?.classId ?? null, termId: assessment?.termId ?? null, maxScore: assessment?.maxScore ?? 100 },
      update: {},
    });
  }
}

export const QUIZ_PLUGINS = [ModQuizPlugin];
