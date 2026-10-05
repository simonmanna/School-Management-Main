import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';
import { ActivityRegistry } from '../activity/activity-registry.service';
import { LmsContextService } from '../context/context.service';
import { LmsGradeBridgeService } from '../grade/grade-bridge.service';
import { LmsEventService } from '../lms-event.service';

export interface CourseBundle {
  formatVersion: 1;
  exportedAt: string;
  course: Record<string, unknown>;
  sections: Array<Record<string, unknown>>;
  modules: Array<{
    spine: Record<string, unknown>;
    activityType: string;
    instance: unknown;
    /** Original id, so availability rules that name a module can be rewritten. */
    sourceId: string;
  }>;
  /** Present only when includeUserData was set. Never used by rollover. */
  userData?: { completions: unknown[]; submissions: unknown[] };
}

/** A stable, readable identity for a template whose author gave none. */
function slugCode(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'template';
}

/**
 * Course backup, restore and year rollover (L8 / ADR-014 §5).
 *
 * The school-critical case is rollover: at the start of a year a teacher wants
 * last year's course structure again, WITHOUT last year's pupils, submissions or
 * marks. So `includeUserData` defaults to false and rollover never passes it —
 * carrying a previous cohort's work into a new term would corrupt the new year's
 * gradebook and leak one pupil's work to another.
 *
 * The bundle is plain JSON, not Moodle's `.mbz`; ADR-014 lists format compatibility
 * as an explicit non-goal.
 */
@Injectable()
export class CourseBackupService {
  private readonly logger = new Logger('CourseBackup');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly registry: ActivityRegistry,
    private readonly contexts: LmsContextService,
    private readonly grades: LmsGradeBridgeService,
    private readonly events: LmsEventService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  /** Serialise a course to a portable bundle. */
  async export(courseOfferingId: string, opts: { includeUserData?: boolean } = {}): Promise<CourseBundle> {
    const offering = await this.prisma.client.courseOffering.findFirst({
      where: { id: courseOfferingId, organizationId: this.org },
    });
    if (!offering) throw new NotFoundException('Course not found');

    const [sections, modules] = await Promise.all([
      this.prisma.client.courseSection.findMany({
        where: { organizationId: this.org, courseOfferingId, deletedAt: null },
        orderBy: { sectionNo: 'asc' },
      }),
      this.prisma.client.courseModule.findMany({
        where: { organizationId: this.org, courseOfferingId, deletedAt: null },
        orderBy: { sequence: 'asc' },
      }),
    ]);

    const exported = [];
    for (const m of modules) {
      if (!this.registry.has(m.activityType)) {
        this.logger.warn(`Skipping ${m.id}: no plugin for '${m.activityType}'`);
        continue;
      }
      const plugin = this.registry.get(m.activityType);
      const instance = await plugin
        .exportInstance({ organizationId: this.org }, m.instanceId, { includeUserData: Boolean(opts.includeUserData) })
        .catch(() => ({}));
      exported.push({
        sourceId: m.id,
        activityType: m.activityType,
        instance,
        spine: {
          sectionNo: sections.find((s) => s.id === m.sectionId)?.sectionNo ?? 0,
          sequence: m.sequence,
          visible: m.visible,
          visibleOnPage: m.visibleOnPage,
          availability: m.availability,
          groupMode: m.groupMode,
          completionMode: m.completionMode,
          completionRules: m.completionRules,
          idnumber: m.idnumber,
          // Dates are deliberately dropped on restore — see `import`.
          openAt: m.openAt, dueAt: m.dueAt, cutoffAt: m.cutoffAt,
        },
      });
    }

    const bundle: CourseBundle = {
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      course: {
        format: offering.format, numSections: offering.numSections, summary: offering.summary,
        groupMode: offering.groupMode, completionEnabled: offering.completionEnabled,
        showGradesToStudents: offering.showGradesToStudents,
      },
      sections: sections.map((s) => ({
        sectionNo: s.sectionNo, name: s.name, summary: s.summary, visible: s.visible, availability: s.availability,
      })),
      modules: exported,
    };

    if (opts.includeUserData) {
      const [completions, submissions] = await Promise.all([
        this.prisma.client.courseModuleCompletion.findMany({
          where: { organizationId: this.org, courseModuleId: { in: modules.map((m) => m.id) } },
        }),
        this.prisma.client.modAssignSubmission.findMany({
          where: { organizationId: this.org, courseModuleId: { in: modules.map((m) => m.id) } },
        }),
      ]);
      bundle.userData = { completions, submissions };
    }

    await this.events.log({
      eventName: 'core_backup.exported', component: 'core_backup', action: 'created', target: 'course',
      courseOfferingId, other: { modules: exported.length, includeUserData: Boolean(opts.includeUserData) },
    });
    return bundle;
  }

  /**
   * Restore a bundle into an EXISTING course offering.
   *
   * The target must already exist: a `CourseOffering` is keyed by
   * (year, term, subject, class, section), so inventing one here would mean
   * guessing which class and term a bundle belongs to. Rollover creates the
   * target first, then calls this.
   */
  async import(
    targetOfferingId: string,
    bundle: CourseBundle,
    opts: { includeUserData?: boolean } = {},
  ): Promise<{ sections: number; modules: number; skipped: number }> {
    if (bundle?.formatVersion !== 1) throw new BadRequestException('Unsupported bundle format');
    const target = await this.prisma.client.courseOffering.findFirst({
      where: { id: targetOfferingId, organizationId: this.org },
    });
    if (!target) throw new NotFoundException('Target course not found');

    await this.prisma.client.courseOffering.update({
      where: { id: targetOfferingId },
      data: {
        format: bundle.course.format as any,
        numSections: Number(bundle.course.numSections ?? 14),
        summary: (bundle.course.summary as string) ?? null,
        completionEnabled: Boolean(bundle.course.completionEnabled),
        showGradesToStudents: bundle.course.showGradesToStudents !== false,
      },
    });

    // Sections first, so modules have somewhere to land.
    const sectionByNo = new Map<number, string>();
    for (const sec of bundle.sections) {
      const no = Number(sec.sectionNo ?? 0);
      const existing = await this.prisma.client.courseSection.findFirst({
        where: { organizationId: this.org, courseOfferingId: targetOfferingId, sectionNo: no },
      });
      const row = existing
        ? await this.prisma.client.courseSection.update({
            where: { id: existing.id },
            data: { name: (sec.name as string) ?? null, summary: (sec.summary as string) ?? null, visible: sec.visible !== false },
          })
        : await this.prisma.client.courseSection.create({
            data: {
              organizationId: this.org, courseOfferingId: targetOfferingId, sectionNo: no,
              name: (sec.name as string) ?? null, summary: (sec.summary as string) ?? null,
              visible: sec.visible !== false,
            },
          });
      sectionByNo.set(no, row.id);
    }

    // Old module id → new, so availability rules referencing a module still work.
    const idMap = new Map<string, string>();
    let created = 0;
    let skipped = 0;

    for (const m of bundle.modules) {
      if (!this.registry.has(m.activityType)) { skipped += 1; continue; }
      const plugin = this.registry.get(m.activityType);
      const sectionId = sectionByNo.get(Number(m.spine.sectionNo ?? 0));
      if (!sectionId) { skipped += 1; continue; }

      const { instanceId } = await plugin.importInstance({ organizationId: this.org }, m.instance);
      const cm = await this.prisma.client.courseModule.create({
        data: {
          organizationId: this.org,
          courseOfferingId: targetOfferingId,
          sectionId,
          activityType: m.activityType,
          instanceId,
          sequence: Number(m.spine.sequence ?? 0),
          visible: m.spine.visible !== false,
          visibleOnPage: m.spine.visibleOnPage !== false,
          groupMode: (m.spine.groupMode as any) ?? 'none',
          completionMode: (m.spine.completionMode as any) ?? 'manual',
          completionRules: (m.spine.completionRules as any) ?? {},
          idnumber: (m.spine.idnumber as string) ?? null,
          // Dates are NOT carried over. A deadline from last March is worse than
          // no deadline: it shows every activity as overdue on day one. The
          // teacher sets new ones.
          openAt: opts.includeUserData ? (m.spine.openAt as any) ?? null : null,
          dueAt: opts.includeUserData ? (m.spine.dueAt as any) ?? null : null,
          cutoffAt: opts.includeUserData ? (m.spine.cutoffAt as any) ?? null : null,
        },
      });
      idMap.set(m.sourceId, cm.id);
      await this.contexts.ensureActivityContext(cm.id, targetOfferingId);

      if (plugin.features.gradable && plugin.gradeDefinition) {
        const def = await plugin.gradeDefinition({ organizationId: this.org, courseModule: cm }, instanceId);
        await this.prisma.client.$transaction(async (tx: any) => {
          const assessmentId = await this.grades.ensureAssessment(cm, target, def, tx);
          await this.grades.fanout(assessmentId, cm, tx);
        });
      }
      created += 1;
    }

    // Second pass: rewrite availability rules that point at a module id, now that
    // every new id is known. A rule left pointing at last year's module would
    // never be satisfiable, silently locking the activity forever.
    for (const m of bundle.modules) {
      const newId = idMap.get(m.sourceId);
      if (!newId || !m.spine.availability) continue;
      const rewritten = this.remapAvailability(m.spine.availability, idMap);
      await this.prisma.client.courseModule.update({
        where: { id: newId },
        data: { availability: rewritten as any },
      });
    }

    // Rebuild each section's denormalised order.
    for (const [no, sectionId] of sectionByNo) {
      const inSection = bundle.modules
        .filter((m) => Number(m.spine.sectionNo ?? 0) === no)
        .sort((a, b) => Number(a.spine.sequence ?? 0) - Number(b.spine.sequence ?? 0))
        .map((m) => idMap.get(m.sourceId))
        .filter((x): x is string => Boolean(x));
      await this.prisma.client.courseSection.update({ where: { id: sectionId }, data: { sequence: inSection } });
    }

    await this.events.log({
      eventName: 'core_backup.imported', component: 'core_backup', action: 'created', target: 'course',
      courseOfferingId: targetOfferingId, other: { modules: created, skipped },
    });
    return { sections: sectionByNo.size, modules: created, skipped };
  }

  /**
   * Clone a term's courses into another term.
   *
   * Structure only — never pupils, submissions or marks. The target offering for
   * each source must already exist (created by the academics module when the term
   * was set up); a source with no counterpart is reported rather than invented,
   * because guessing which class a course belongs to is how a year's data ends up
   * on the wrong register.
   */
  async rollover(dto: { fromTermId: string; toTermId: string; offeringIds?: string[] }) {
    const sources = await this.prisma.client.courseOffering.findMany({
      where: {
        organizationId: this.org, termId: dto.fromTermId, deletedAt: null,
        ...(dto.offeringIds?.length ? { id: { in: dto.offeringIds } } : {}),
      },
    });
    if (sources.length === 0) return { rolled: [], unmatched: [] };

    const rolled: Array<{ from: string; to: string; modules: number }> = [];
    const unmatched: Array<{ from: string; reason: string }> = [];

    for (const src of sources) {
      const target = await this.prisma.client.courseOffering.findFirst({
        where: {
          organizationId: this.org, termId: dto.toTermId, deletedAt: null,
          subjectId: src.subjectId, classId: src.classId,
          ...(src.sectionId ? { sectionId: src.sectionId } : {}),
        },
      });
      if (!target) {
        unmatched.push({ from: src.id, reason: 'No matching course exists in the target term' });
        continue;
      }
      const existing = await this.prisma.client.courseModule.count({
        where: { organizationId: this.org, courseOfferingId: target.id, deletedAt: null },
      });
      if (existing > 0) {
        // Refuse rather than duplicate: running rollover twice must not give a
        // teacher two of every activity.
        unmatched.push({ from: src.id, reason: 'Target course already has activities' });
        continue;
      }
      const bundle = await this.export(src.id, { includeUserData: false });
      const result = await this.import(target.id, bundle, { includeUserData: false });
      rolled.push({ from: src.id, to: target.id, modules: result.modules });
    }
    this.logger.log(`Rollover ${dto.fromTermId} → ${dto.toTermId}: ${rolled.length} course(s), ${unmatched.length} skipped`);
    return { rolled, unmatched };
  }

  // ── Templates (ADR-034) ─────────────────────────────────────────────────
  //
  // A template is a NAMED export, not a new kind of thing: the bundle is the
  // same structure-only JSON rollover already uses. That is the whole point —
  // reuse without a second source of course naming, and without any way for
  // pupils, submissions or marks to travel, because `export` omits user data
  // unless asked and these never ask.

  /** Save a course's structure for reuse next term. */
  async saveAsTemplate(
    courseOfferingId: string,
    dto: { name: string; code?: string; description?: string; coverImageFileId?: string },
  ) {
    const offering = await this.prisma.client.courseOffering.findFirst({
      where: { id: courseOfferingId, organizationId: this.org, deletedAt: null },
    });
    if (!offering) throw new NotFoundException('Course not found');

    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('A template needs a name');

    const bundle = await this.export(courseOfferingId, { includeUserData: false });
    if (bundle.modules.length === 0 && bundle.sections.length === 0) {
      throw new BadRequestException('This course has nothing in it to save');
    }

    // `code` is the operator-facing identity: a re-save under the same code
    // replaces that template rather than making a second copy of it.
    const code = (dto.code?.trim() || slugCode(name)).slice(0, 60);
    const data = {
      organizationId: this.org,
      code,
      name,
      description: dto.description ?? null,
      // What the template is FOR, taken from the course it came from.
      subjectId: offering.subjectId ?? null,
      coverImageFileId: dto.coverImageFileId ?? offering.coverImageFileId ?? null,
      bundle: bundle as unknown as object,
      sectionCount: bundle.sections.length,
      moduleCount: bundle.modules.length,
      createdById: this.tenant.userId ?? null,
      deletedAt: null,
    };

    const existing = await this.prisma.client.lmsCourseTemplate.findFirst({
      where: { organizationId: this.org, code },
    });
    const row = existing
      ? await this.prisma.client.lmsCourseTemplate.update({ where: { id: existing.id }, data })
      : await this.prisma.client.lmsCourseTemplate.create({ data });

    await this.events.log({
      eventName: 'core_backup.template_saved',
      component: 'core_backup',
      action: existing ? 'updated' : 'created',
      target: 'course',
      courseOfferingId,
      other: { templateId: row.id, code, modules: data.moduleCount },
    });
    return this.summarise(row);
  }

  /** Templates available to this school, newest first. */
  async listTemplates(opts: { subjectId?: string; gradeLevelId?: string } = {}) {
    const rows = await this.prisma.client.lmsCourseTemplate.findMany({
      where: {
        organizationId: this.org,
        deletedAt: null,
        ...(opts.subjectId ? { subjectId: opts.subjectId } : {}),
        ...(opts.gradeLevelId ? { gradeLevelId: opts.gradeLevelId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });
    // The bundle can be hundreds of kilobytes; a listing must not carry it.
    return rows.map((r: any) => this.summarise(r));
  }

  async getTemplate(id: string) {
    const row = await this.prisma.client.lmsCourseTemplate.findFirst({
      where: { id, organizationId: this.org, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Template not found');
    return row;
  }

  /** Retire a template. Soft, like the course recycle bin. */
  async deleteTemplate(id: string) {
    const row = await this.getTemplate(id);
    await this.prisma.client.lmsCourseTemplate.update({
      where: { id: row.id },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  /**
   * Build a course from a template.
   *
   * Delegates to `import`, which refuses a target that already has activities —
   * so applying a template twice cannot silently double a course, and the
   * failure names the reason.
   */
  async applyTemplate(targetOfferingId: string, templateId: string) {
    const template = await this.getTemplate(templateId);
    const bundle = template.bundle as unknown as CourseBundle;
    if (bundle?.formatVersion !== 1) {
      throw new BadRequestException('This template was saved in an unsupported format');
    }
    const existing = await this.prisma.client.courseModule.count({
      where: { organizationId: this.org, courseOfferingId: targetOfferingId, deletedAt: null },
    });
    if (existing > 0) {
      throw new BadRequestException(
        'That course already has activities. Apply a template to an empty course.',
      );
    }
    const result = await this.import(targetOfferingId, bundle, { includeUserData: false });

    // The course keeps its own name — a template supplies structure, not
    // identity — but a template's picture is part of the structure a teacher
    // chose, so it travels when the course has none.
    if (template.coverImageFileId) {
      await this.prisma.client.courseOffering.updateMany({
        where: { id: targetOfferingId, organizationId: this.org, coverImageFileId: null },
        data: { coverImageFileId: template.coverImageFileId },
      });
    }

    await this.events.log({
      eventName: 'core_backup.template_applied',
      component: 'core_backup',
      action: 'created',
      target: 'course',
      courseOfferingId: targetOfferingId,
      other: { templateId, ...result },
    });
    return result;
  }

  /** A template without its bundle. */
  private summarise(row: any) {
    const { bundle: _bundle, ...rest } = row;
    return rest;
  }

  /** Rewrite module ids inside an availability tree. */
  private remapAvailability(tree: unknown, idMap: Map<string, string>): unknown {
    if (Array.isArray(tree)) return tree.map((x) => this.remapAvailability(x, idMap));
    if (tree && typeof tree === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(tree as Record<string, unknown>)) {
        // `cm` is the completion condition's module pointer.
        out[k] = k === 'cm' && typeof v === 'string' ? idMap.get(v) ?? v : this.remapAvailability(v, idMap);
      }
      return out;
    }
    return tree;
  }
}
