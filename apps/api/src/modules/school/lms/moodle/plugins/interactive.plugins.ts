import { BadRequestException, Injectable } from '@nestjs/common';
import type { CourseModule } from '@prisma/client';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';
import { ActivityRegistry } from '../activity/activity-registry.service';
import { BaseActivityPlugin } from './plugin-base';
import type { CompletionState, GradeDefinition, PluginCtx } from '../plugin.types';
import { LmsGradeBridgeService } from '../grade/grade-bridge.service';

/** mod_choice — a single-question poll. */
@Injectable()
export class ModChoicePlugin extends BaseActivityPlugin {
  readonly type = 'choice';
  readonly features = { gradable: false, hasSubmissions: true, supportsGroups: true, supportsCompletionAuto: true, completionRuleKeys: ['view', 'submit'], label: 'Poll', icon: 'BarChart3' };
  protected readonly table = 'modChoice';
  constructor(prisma: PrismaService, tenant: TenantContextService, registry: ActivityRegistry) { super(prisma, tenant, registry); }

  async createInstance(_ctx: PluginCtx, dto: Record<string, unknown>) {
    const row = await this.model().create({ data: { organizationId: this.org, name: dto.name ?? 'Poll', intro: dto.intro ?? null, allowMultiple: (dto.allowMultiple as boolean) ?? false, allowUpdate: (dto.allowUpdate as boolean) ?? true, limitAnswers: (dto.limitAnswers as boolean) ?? false, showResults: dto.showResults ?? 'after_answer', publishAnon: (dto.publishAnon as boolean) ?? false, options: (dto.options as any) ?? [], closeAt: dto.closeAt ? new Date(dto.closeAt as string) : null } });
    return { instanceId: row.id };
  }
  async updateInstance(_ctx: PluginCtx, id: string, dto: Record<string, unknown>) {
    await this.model().update({ where: { id }, data: { name: dto.name, intro: dto.intro, allowMultiple: dto.allowMultiple, showResults: dto.showResults, options: dto.options as any } });
  }
  async viewForStudent(ctx: PluginCtx, cm: CourseModule) {
    const inst = await this.getInstance(ctx, cm.instanceId);
    const mine = ctx.studentProfileId ? await this.db.modChoiceAnswer.findMany({ where: { choiceId: cm.instanceId, studentProfileId: ctx.studentProfileId } }) : [];
    return { instance: inst, myAnswers: mine.map((a: any) => a.optionKey) };
  }
  async viewForTeacher(ctx: PluginCtx, cm: CourseModule) {
    const inst = await this.getInstance(ctx, cm.instanceId);
    const answers = await this.db.modChoiceAnswer.groupBy({ by: ['optionKey'], where: { choiceId: cm.instanceId }, _count: { _all: true } });
    return { instance: inst, tally: answers };
  }
  async action(ctx: PluginCtx, cm: CourseModule, action: string, dto: Record<string, unknown>) {
    if (action !== 'choose') throw new BadRequestException(`Unknown mod_choice action '${action}'`);
    if (!ctx.studentProfileId) throw new BadRequestException('choose requires a student');
    await this.db.modChoiceAnswer.deleteMany({ where: { choiceId: cm.instanceId, studentProfileId: ctx.studentProfileId } });
    const keys = (dto.optionKeys as string[]) ?? [dto.optionKey as string];
    for (const k of keys.filter(Boolean)) await this.db.modChoiceAnswer.create({ data: { organizationId: this.org, choiceId: cm.instanceId, optionKey: k, studentProfileId: ctx.studentProfileId } });
    return { ok: true };
  }
  async evaluateCompletion(ctx: PluginCtx, cm: CourseModule): Promise<CompletionState> {
    if (!ctx.studentProfileId) return 'incomplete';
    const a = await this.db.modChoiceAnswer.findFirst({ where: { choiceId: cm.instanceId, studentProfileId: ctx.studentProfileId } });
    return a ? 'complete' : 'incomplete';
  }
}

/** mod_feedback — anonymous survey. */
@Injectable()
export class ModFeedbackPlugin extends BaseActivityPlugin {
  readonly type = 'feedback';
  readonly features = { gradable: false, hasSubmissions: true, supportsGroups: false, supportsCompletionAuto: true, completionRuleKeys: ['view', 'submit'], label: 'Feedback', icon: 'MessageSquare' };
  protected readonly table = 'modFeedback';
  constructor(prisma: PrismaService, tenant: TenantContextService, registry: ActivityRegistry) { super(prisma, tenant, registry); }

  async createInstance(_ctx: PluginCtx, dto: Record<string, unknown>) {
    const row = await this.model().create({ data: { organizationId: this.org, name: dto.name ?? 'Feedback', intro: dto.intro ?? null, anonymous: (dto.anonymous as boolean) ?? true, multipleSubmit: (dto.multipleSubmit as boolean) ?? false } });
    const items = (dto.items as any[]) ?? [];
    for (let i = 0; i < items.length; i++) await this.db.modFeedbackItem.create({ data: { organizationId: this.org, feedbackId: row.id, label: items[i].label, itemType: items[i].itemType ?? 'text', required: items[i].required ?? false, options: items[i].options ?? [], sequence: i } });
    return { instanceId: row.id };
  }
  async updateInstance(_ctx: PluginCtx, id: string, dto: Record<string, unknown>) {
    await this.model().update({ where: { id }, data: { name: dto.name, intro: dto.intro, anonymous: dto.anonymous, multipleSubmit: dto.multipleSubmit } });
  }
  async viewForStudent(ctx: PluginCtx, cm: CourseModule) {
    const inst = await this.getInstance(ctx, cm.instanceId);
    const items = await this.db.modFeedbackItem.findMany({ where: { feedbackId: cm.instanceId }, orderBy: { sequence: 'asc' } });
    return { instance: inst, items };
  }
  async viewForTeacher(ctx: PluginCtx, cm: CourseModule) {
    const inst = await this.getInstance(ctx, cm.instanceId);
    const items = await this.db.modFeedbackItem.findMany({ where: { feedbackId: cm.instanceId }, orderBy: { sequence: 'asc' } });
    const responses = await this.db.modFeedbackResponse.findMany({ where: { feedbackId: cm.instanceId } });
    return { instance: inst, items, responseCount: responses.length, responses: inst && (inst as any).anonymous ? undefined : responses };
  }
  async action(ctx: PluginCtx, cm: CourseModule, action: string, dto: Record<string, unknown>) {
    if (action !== 'respond') throw new BadRequestException(`Unknown mod_feedback action '${action}'`);
    return this.db.modFeedbackResponse.create({ data: { organizationId: this.org, feedbackId: cm.instanceId, studentProfileId: ctx.studentProfileId ?? null, userId: ctx.userId ?? null, answers: (dto.answers as any) ?? {} } });
  }
}

/** mod_glossary — a shared glossary of entries. */
@Injectable()
export class ModGlossaryPlugin extends BaseActivityPlugin {
  readonly type = 'glossary';
  readonly features = { gradable: false, hasSubmissions: true, supportsGroups: false, supportsCompletionAuto: true, completionRuleKeys: ['view'], label: 'Glossary', icon: 'BookA' };
  protected readonly table = 'modGlossary';
  constructor(prisma: PrismaService, tenant: TenantContextService, registry: ActivityRegistry) { super(prisma, tenant, registry); }

  async createInstance(_ctx: PluginCtx, dto: Record<string, unknown>) {
    const row = await this.model().create({ data: { organizationId: this.org, name: dto.name ?? 'Glossary', intro: dto.intro ?? null, allowComments: (dto.allowComments as boolean) ?? false, allowDuplicate: (dto.allowDuplicate as boolean) ?? false } });
    return { instanceId: row.id };
  }
  async updateInstance(_ctx: PluginCtx, id: string, dto: Record<string, unknown>) {
    await this.model().update({ where: { id }, data: { name: dto.name, intro: dto.intro, allowComments: dto.allowComments } });
  }
  async viewForStudent(ctx: PluginCtx, cm: CourseModule) { return this.list(cm); }
  async viewForTeacher(ctx: PluginCtx, cm: CourseModule) { return this.list(cm); }
  private async list(cm: CourseModule) {
    const inst = await this.getInstance({} as PluginCtx, cm.instanceId);
    const entries = await this.db.modGlossaryEntry.findMany({ where: { glossaryId: cm.instanceId, approved: true }, orderBy: { concept: 'asc' } });
    return { instance: inst, entries };
  }
  async action(ctx: PluginCtx, cm: CourseModule, action: string, dto: Record<string, unknown>) {
    const inst: any = await this.getInstance(ctx, cm.instanceId);
    switch (action) {
      case 'addEntry': {
        const concept = String(dto.concept ?? '').trim();
        if (!concept) throw new BadRequestException('An entry needs a term');
        // A glossary that allows duplicates ends up with five near-identical
        // definitions of the same word; the setting exists to prevent that.
        if (!inst?.allowDuplicate) {
          const clash = await this.db.modGlossaryEntry.findFirst({
            where: { glossaryId: cm.instanceId, concept: { equals: concept, mode: 'insensitive' } },
          });
          if (clash) throw new BadRequestException(`"${concept}" is already defined in this glossary`);
        }
        return this.db.modGlossaryEntry.create({
          data: {
            organizationId: this.org, glossaryId: cm.instanceId, concept,
            definition: (dto.definition as string) ?? '',
            aliases: (dto.aliases as string[]) ?? [],
            authorId: ctx.userId ?? null,
            // A pupil's entry waits for a teacher; a teacher's is live at once.
            approved: !ctx.studentProfileId,
          },
        });
      }

      /** Teacher moderation for pupil-contributed entries. */
      case 'approveEntry': {
        return this.db.modGlossaryEntry.update({
          where: { id: dto.entryId as string },
          data: { approved: true },
        });
      }

      case 'deleteEntry': {
        const entry = await this.db.modGlossaryEntry.findFirst({
          where: { id: dto.entryId as string, glossaryId: cm.instanceId },
        });
        if (!entry) throw new BadRequestException('Entry not found in this glossary');
        // A pupil may withdraw their own entry; anything else is a teacher action,
        // which the capability guard on the route already gates.
        if (ctx.studentProfileId && entry.authorId !== ctx.userId) {
          throw new BadRequestException('You can only remove your own entry');
        }
        await this.db.modGlossaryEntry.delete({ where: { id: entry.id } });
        return { ok: true };
      }

      /** Term search, including aliases — a glossary is useless without it. */
      case 'search': {
        const q = String(dto.q ?? '').trim();
        if (!q) return { entries: [] };
        const entries = await this.db.modGlossaryEntry.findMany({
          where: {
            glossaryId: cm.instanceId,
            OR: [
              { concept: { contains: q, mode: 'insensitive' } },
              { definition: { contains: q, mode: 'insensitive' } },
              { aliases: { has: q } },
            ],
          },
          orderBy: { concept: 'asc' },
          take: 50,
        });
        return { entries };
      }

      default:
        throw new BadRequestException(`Unknown mod_glossary action '${action}'`);
    }
  }
}

/** mod_wiki — collaborative pages with version history. */
@Injectable()
export class ModWikiPlugin extends BaseActivityPlugin {
  readonly type = 'wiki';
  readonly features = { gradable: false, hasSubmissions: true, supportsGroups: true, supportsCompletionAuto: true, completionRuleKeys: ['view'], label: 'Wiki', icon: 'BookOpen' };
  protected readonly table = 'modWiki';
  constructor(prisma: PrismaService, tenant: TenantContextService, registry: ActivityRegistry) { super(prisma, tenant, registry); }

  async createInstance(_ctx: PluginCtx, dto: Record<string, unknown>) {
    const row = await this.model().create({ data: { organizationId: this.org, name: dto.name ?? 'Wiki', intro: dto.intro ?? null, wikiMode: dto.wikiMode ?? 'collaborative', firstPageTitle: dto.firstPageTitle ?? 'Home' } });
    await this.db.modWikiPage.create({ data: { organizationId: this.org, wikiId: row.id, title: (dto.firstPageTitle as string) ?? 'Home', content: '' } });
    return { instanceId: row.id };
  }
  async updateInstance(_ctx: PluginCtx, id: string, dto: Record<string, unknown>) {
    await this.model().update({ where: { id }, data: { name: dto.name, intro: dto.intro, wikiMode: dto.wikiMode } });
  }
  async viewForStudent(ctx: PluginCtx, cm: CourseModule) { return this.pages(cm); }
  async viewForTeacher(ctx: PluginCtx, cm: CourseModule) { return this.pages(cm); }
  private async pages(cm: CourseModule) {
    const inst = await this.getInstance({} as PluginCtx, cm.instanceId);
    const pages = await this.db.modWikiPage.findMany({ where: { wikiId: cm.instanceId }, orderBy: { title: 'asc' } });
    return { instance: inst, pages };
  }
  async action(ctx: PluginCtx, cm: CourseModule, action: string, dto: Record<string, unknown>) {
    switch (action) {
      case 'editPage': {
        const title = dto.title as string;
        if (!title?.trim()) throw new BadRequestException('A wiki page needs a title');
        const existing = await this.db.modWikiPage.findFirst({ where: { wikiId: cm.instanceId, title } });
        if (existing) {
          // Snapshot the OUTGOING content before overwriting: the history is what
          // makes a collaborative page safe to edit, since anyone can change it.
          const v = await this.db.modWikiVersion.aggregate({ where: { pageId: existing.id }, _max: { version: true } });
          await this.db.modWikiVersion.create({
            data: { pageId: existing.id, version: (v._max.version ?? 0) + 1, content: existing.content, authorId: ctx.userId ?? null },
          });
          return this.db.modWikiPage.update({ where: { id: existing.id }, data: { content: dto.content as string } });
        }
        return this.db.modWikiPage.create({ data: { organizationId: this.org, wikiId: cm.instanceId, title, content: (dto.content as string) ?? '' } });
      }

      /** Every prior revision of one page, newest first. */
      case 'history': {
        const page = await this.db.modWikiPage.findFirst({ where: { id: dto.pageId as string, wikiId: cm.instanceId } });
        if (!page) throw new BadRequestException('Page not found in this wiki');
        const versions = await this.db.modWikiVersion.findMany({
          where: { pageId: page.id },
          orderBy: { version: 'desc' },
        });
        return { page, versions };
      }

      /**
       * Restore an earlier revision.
       *
       * The revert is itself a new version, not a rewind: undoing an edit must
       * leave a trace, or a page can be quietly reverted with nothing to show
       * that it happened.
       */
      case 'revert': {
        const page = await this.db.modWikiPage.findFirst({ where: { id: dto.pageId as string, wikiId: cm.instanceId } });
        if (!page) throw new BadRequestException('Page not found in this wiki');
        const target = await this.db.modWikiVersion.findFirst({
          where: { id: dto.versionId as string, pageId: page.id },
        });
        if (!target) throw new BadRequestException('That revision does not belong to this page');
        const v = await this.db.modWikiVersion.aggregate({ where: { pageId: page.id }, _max: { version: true } });
        await this.db.modWikiVersion.create({
          data: { pageId: page.id, version: (v._max.version ?? 0) + 1, content: page.content, authorId: ctx.userId ?? null },
        });
        return this.db.modWikiPage.update({ where: { id: page.id }, data: { content: target.content } });
      }

      default:
        throw new BadRequestException(`Unknown mod_wiki action '${action}'`);
    }
  }
}

/** mod_lesson — branching content pages. Lightweight: navigation + manual completion. */
@Injectable()
export class ModLessonPlugin extends BaseActivityPlugin {
  readonly type = 'lesson';
  readonly features = { gradable: true, hasSubmissions: true, supportsGroups: false, supportsCompletionAuto: true, completionRuleKeys: ['view', 'submit', 'minGrade'], label: 'Lesson', icon: 'GraduationCap' };
  protected readonly table = 'modLesson';
  constructor(prisma: PrismaService, tenant: TenantContextService, registry: ActivityRegistry, private readonly grades: LmsGradeBridgeService) { super(prisma, tenant, registry); }

  async gradeDefinition(_ctx: PluginCtx, instanceId: string): Promise<GradeDefinition> {
    const inst: any = await this.model().findFirst({ where: { id: instanceId } });
    return { maxScore: Number(inst?.maxScore ?? 100), gradingMode: 'points' };
  }

  async createInstance(_ctx: PluginCtx, dto: Record<string, unknown>) {
    const row = await this.model().create({ data: { organizationId: this.org, name: dto.name ?? 'Lesson', intro: dto.intro ?? null, gradable: (dto.gradable as boolean) ?? false, maxScore: (dto.maxScore as number) ?? 100 } });
    const pages = (dto.pages as any[]) ?? [];
    for (let i = 0; i < pages.length; i++) await this.db.modLessonPage.create({ data: { organizationId: this.org, lessonId: row.id, title: pages[i].title, content: pages[i].content ?? '', pageType: pages[i].pageType ?? 'content', qtype: pages[i].qtype ?? null, sequence: i, branches: pages[i].branches ?? [] } });
    return { instanceId: row.id };
  }
  async updateInstance(_ctx: PluginCtx, id: string, dto: Record<string, unknown>) {
    await this.model().update({ where: { id }, data: { name: dto.name, intro: dto.intro } });
  }
  /**
   * The pupil sees ONE page — the one their path has reached — not the whole
   * deck. Handing over every page would give away the answers and defeat the
   * branching entirely.
   */
  async viewForStudent(ctx: PluginCtx, cm: CourseModule) {
    const inst = await this.getInstance(ctx, cm.instanceId);
    const pages = await this.db.modLessonPage.findMany({
      where: { lessonId: cm.instanceId }, orderBy: { sequence: 'asc' },
    });
    if (!ctx.studentProfileId) return { instance: inst, pages, attempt: null, page: null };

    const attempt = await this.attemptFor(cm, ctx.studentProfileId, pages);
    const page = attempt.finishedAt
      ? null
      : pages.find((p: any) => p.id === attempt.currentPageId) ?? pages[0] ?? null;

    return {
      instance: inst,
      // Only the current page, and its answer options WITHOUT which branch each
      // one leads to — the destination is the answer key.
      page: page ? { ...page, branches: this.publicBranches(page) } : null,
      attempt: {
        seen: attempt.seen, answeredCount: attempt.answeredCount,
        correctCount: attempt.correctCount, finishedAt: attempt.finishedAt,
      },
      totalPages: pages.length,
    };
  }

  /** A teacher sees the whole structure, branches included — they author it. */
  async viewForTeacher(ctx: PluginCtx, cm: CourseModule) {
    const inst = await this.getInstance(ctx, cm.instanceId);
    const pages = await this.db.modLessonPage.findMany({
      where: { lessonId: cm.instanceId }, orderBy: { sequence: 'asc' },
    });
    const attempts = await this.db.modLessonAttempt.findMany({ where: { lessonId: cm.instanceId } });
    return { instance: inst, pages, attempts, attemptCount: attempts.length };
  }

  async action(ctx: PluginCtx, cm: CourseModule, action: string, dto: Record<string, unknown>) {
    if (!ctx.studentProfileId) throw new BadRequestException('A lesson is taken by a student');
    const pages = await this.db.modLessonPage.findMany({
      where: { lessonId: cm.instanceId }, orderBy: { sequence: 'asc' },
    });
    if (pages.length === 0) throw new BadRequestException('This lesson has no pages yet');
    const attempt = await this.attemptFor(cm, ctx.studentProfileId, pages);

    switch (action) {
      /**
       * Answer the current page and move on.
       *
       * The branch destination is resolved SERVER-side from the chosen answer;
       * the client never says which page comes next, or a pupil could skip
       * straight to the end.
       */
      case 'answer': {
        if (attempt.finishedAt) throw new BadRequestException('You have already finished this lesson');
        const page = pages.find((p: any) => p.id === (attempt.currentPageId ?? pages[0].id));
        if (!page) throw new BadRequestException('Lesson page not found');

        const branches: any[] = Array.isArray(page.branches) ? page.branches : [];
        const chosen = branches[Number(dto.answerIndex)];
        const isContent = page.pageType === 'content' || branches.length === 0;
        if (!isContent && !chosen) throw new BadRequestException('Choose one of the answers');

        const correct = Boolean(chosen?.correct);
        const nextId: string | null = isContent
          ? (pages[pages.indexOf(page) + 1]?.id ?? null)
          : (chosen?.nextPageId ?? pages[pages.indexOf(page) + 1]?.id ?? null);

        const answers = { ...((attempt.answers ?? {}) as Record<string, unknown>) };
        answers[page.id] = { answerIndex: dto.answerIndex ?? null, correct, at: new Date().toISOString() };

        const updated = await this.db.modLessonAttempt.update({
          where: { id: attempt.id },
          data: {
            currentPageId: nextId,
            seen: attempt.seen.includes(page.id) ? attempt.seen : [...attempt.seen, page.id],
            answers: answers as any,
            answeredCount: isContent ? attempt.answeredCount : attempt.answeredCount + 1,
            correctCount: correct ? attempt.correctCount + 1 : attempt.correctCount,
            finishedAt: nextId ? null : new Date(),
          },
        });
        if (!nextId) await this.gradeAttempt(cm, updated);
        return {
          correct: isContent ? null : correct,
          feedback: chosen?.feedback ?? null,
          finished: !nextId,
        };
      }

      /** Start again from the top. */
      case 'restart': {
        return this.db.modLessonAttempt.update({
          where: { id: attempt.id },
          data: {
            currentPageId: pages[0].id, seen: [], answers: {},
            answeredCount: 0, correctCount: 0, finishedAt: null,
          },
        });
      }

      default:
        throw new BadRequestException(`Unknown mod_lesson action '${action}'`);
    }
  }

  async evaluateCompletion(ctx: PluginCtx, cm: CourseModule): Promise<CompletionState> {
    if (!ctx.studentProfileId) return 'incomplete';
    const attempt = await this.db.modLessonAttempt.findFirst({
      where: { lessonId: cm.instanceId, studentProfileId: ctx.studentProfileId },
    });
    return attempt?.finishedAt ? 'complete' : 'incomplete';
  }

  // ── internals ──

  /** The pupil's attempt, created on first view so state exists from page one. */
  private async attemptFor(cm: CourseModule, studentProfileId: string, pages: any[]) {
    const existing = await this.db.modLessonAttempt.findFirst({
      where: { lessonId: cm.instanceId, studentProfileId },
    });
    if (existing) return existing;
    return this.db.modLessonAttempt.create({
      data: {
        organizationId: this.org, lessonId: cm.instanceId, courseModuleId: cm.id,
        studentProfileId, currentPageId: pages[0]?.id ?? null, seen: [], answers: {},
      },
    });
  }

  /**
   * Answer options with the branch destinations stripped.
   *
   * `nextPageId` and `correct` together ARE the answer key: a pupil reading the
   * payload could see which option leads to the "well done" page.
   */
  private publicBranches(page: any) {
    const branches: any[] = Array.isArray(page.branches) ? page.branches : [];
    return branches.map((b, i) => ({ index: i, label: b.label ?? b.text ?? `Option ${i + 1}` }));
  }

  /** Post a score once the pupil reaches the end, if the lesson is graded. */
  private async gradeAttempt(cm: CourseModule, attempt: any): Promise<void> {
    if (!cm.assessmentId) return;
    const inst: any = await this.getInstance({} as PluginCtx, cm.instanceId);
    if (!inst?.gradable || attempt.answeredCount === 0) return;
    const pct = attempt.correctCount / attempt.answeredCount;
    const score = Math.round(pct * Number(inst.maxScore ?? 100) * 100) / 100;
    const assessment = await this.db.assessment.findFirst({ where: { id: cm.assessmentId } });
    const sa = await this.db.studentAssessment.upsert({
      where: { assessmentId_studentProfileId: { assessmentId: cm.assessmentId, studentProfileId: attempt.studentProfileId } },
      create: {
        organizationId: this.org, assessmentId: cm.assessmentId, studentProfileId: attempt.studentProfileId,
        classId: assessment?.classId ?? null, termId: assessment?.termId ?? null, maxScore: assessment?.maxScore ?? 100,
      },
      update: {},
    });
    await this.prisma.client.$transaction(async (tx: any) =>
      this.grades.setScore({ studentAssessmentId: sa.id, score, source: 'plugin' }, tx));
  }
}

export const INTERACTIVE_PLUGINS = [ModChoicePlugin, ModFeedbackPlugin, ModGlossaryPlugin, ModWikiPlugin, ModLessonPlugin];
