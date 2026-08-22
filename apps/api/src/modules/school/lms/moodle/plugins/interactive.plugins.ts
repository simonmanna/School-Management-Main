import { BadRequestException, Injectable } from '@nestjs/common';
import type { CourseModule } from '@prisma/client';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';
import { ActivityRegistry } from '../activity/activity-registry.service';
import { BaseActivityPlugin } from './plugin-base';
import type { CompletionState, PluginCtx } from '../plugin.types';

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
    if (action !== 'addEntry') throw new BadRequestException(`Unknown mod_glossary action '${action}'`);
    return this.db.modGlossaryEntry.create({ data: { organizationId: this.org, glossaryId: cm.instanceId, concept: dto.concept as string, definition: dto.definition as string, aliases: (dto.aliases as string[]) ?? [], authorId: ctx.userId ?? null } });
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
    if (action !== 'editPage') throw new BadRequestException(`Unknown mod_wiki action '${action}'`);
    const title = dto.title as string;
    const existing = await this.db.modWikiPage.findFirst({ where: { wikiId: cm.instanceId, title } });
    if (existing) {
      const v = await this.db.modWikiVersion.aggregate({ where: { pageId: existing.id }, _max: { version: true } });
      await this.db.modWikiVersion.create({ data: { pageId: existing.id, version: (v._max.version ?? 0) + 1, content: existing.content, authorId: ctx.userId ?? null } });
      return this.db.modWikiPage.update({ where: { id: existing.id }, data: { content: dto.content as string } });
    }
    return this.db.modWikiPage.create({ data: { organizationId: this.org, wikiId: cm.instanceId, title, content: (dto.content as string) ?? '' } });
  }
}

/** mod_lesson — branching content pages. Lightweight: navigation + manual completion. */
@Injectable()
export class ModLessonPlugin extends BaseActivityPlugin {
  readonly type = 'lesson';
  readonly features = { gradable: false, hasSubmissions: false, supportsGroups: false, supportsCompletionAuto: true, completionRuleKeys: ['view'], label: 'Lesson', icon: 'GraduationCap' };
  protected readonly table = 'modLesson';
  constructor(prisma: PrismaService, tenant: TenantContextService, registry: ActivityRegistry) { super(prisma, tenant, registry); }

  async createInstance(_ctx: PluginCtx, dto: Record<string, unknown>) {
    const row = await this.model().create({ data: { organizationId: this.org, name: dto.name ?? 'Lesson', intro: dto.intro ?? null, gradable: (dto.gradable as boolean) ?? false, maxScore: (dto.maxScore as number) ?? 100 } });
    const pages = (dto.pages as any[]) ?? [];
    for (let i = 0; i < pages.length; i++) await this.db.modLessonPage.create({ data: { organizationId: this.org, lessonId: row.id, title: pages[i].title, content: pages[i].content ?? '', pageType: pages[i].pageType ?? 'content', qtype: pages[i].qtype ?? null, sequence: i, branches: pages[i].branches ?? [] } });
    return { instanceId: row.id };
  }
  async updateInstance(_ctx: PluginCtx, id: string, dto: Record<string, unknown>) {
    await this.model().update({ where: { id }, data: { name: dto.name, intro: dto.intro } });
  }
  async viewForStudent(ctx: PluginCtx, cm: CourseModule) { return this.pages(cm); }
  async viewForTeacher(ctx: PluginCtx, cm: CourseModule) { return this.pages(cm); }
  private async pages(cm: CourseModule) {
    const inst = await this.getInstance({} as PluginCtx, cm.instanceId);
    const pages = await this.db.modLessonPage.findMany({ where: { lessonId: cm.instanceId }, orderBy: { sequence: 'asc' } });
    return { instance: inst, pages };
  }
}

export const INTERACTIVE_PLUGINS = [ModChoicePlugin, ModFeedbackPlugin, ModGlossaryPlugin, ModWikiPlugin, ModLessonPlugin];
