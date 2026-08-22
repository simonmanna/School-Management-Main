import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { CourseModule, Prisma } from '@prisma/client';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';
import { ActivityRegistry } from '../activity/activity-registry.service';
import { LmsContextService } from '../context/context.service';
import { LmsGradeBridgeService } from '../grade/grade-bridge.service';
import { CompletionService } from '../completion/completion.service';
import { AvailabilityService } from '../availability/availability.service';
import { LmsEventService } from '../lms-event.service';
import type { PluginCtx } from '../plugin.types';

/**
 * Placement + delivery of activities (ADR-014 §5). Owns the spine responsibilities the
 * plugins must never touch: context creation, grade fan-out, completion, availability,
 * event logging. Delegates only the per-type body to the plugin.
 */
@Injectable()
export class CourseModuleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly registry: ActivityRegistry,
    private readonly contexts: LmsContextService,
    private readonly grades: LmsGradeBridgeService,
    private readonly completion: CompletionService,
    private readonly availability: AvailabilityService,
    private readonly events: LmsEventService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  private ctx(courseModule?: CourseModule): PluginCtx {
    return { organizationId: this.org, userId: this.tenant.userId, courseModule };
  }

  async get(id: string): Promise<CourseModule> {
    const cm = await this.prisma.client.courseModule.findFirst({ where: { id, organizationId: this.org, deletedAt: null } });
    if (!cm) throw new NotFoundException(`CourseModule ${id} not found`);
    return cm;
  }

  /** Add an activity to a section. Creates the plugin instance, the spine row, its context, and (if gradable) its Assessment. */
  async add(courseOfferingId: string, dto: Record<string, unknown> & { activityType: string; sectionId: string }): Promise<CourseModule> {
    const offering = await this.prisma.client.courseOffering.findFirst({ where: { id: courseOfferingId, organizationId: this.org } });
    if (!offering) throw new NotFoundException(`Course ${courseOfferingId} not found`);
    const section = await this.prisma.client.courseSection.findFirst({ where: { id: dto.sectionId, organizationId: this.org, courseOfferingId } });
    if (!section) throw new NotFoundException('Section not found in this course');
    const plugin = this.registry.get(dto.activityType);

    const { instanceId } = await plugin.createInstance(this.ctx(), dto);
    const max = await this.prisma.client.courseModule.aggregate({ where: { organizationId: this.org, sectionId: section.id }, _max: { sequence: true } });

    const cm = await this.prisma.client.courseModule.create({
      data: {
        organizationId: this.org,
        courseOfferingId,
        sectionId: section.id,
        activityType: dto.activityType,
        instanceId,
        sequence: (max._max.sequence ?? -1) + 1,
        visible: (dto.visible as boolean) ?? true,
        completionMode: (dto.completionMode as 'none' | 'manual' | 'automatic') ?? (plugin.features.supportsCompletionAuto ? 'manual' : 'manual'),
        completionRules: (dto.completionRules as Prisma.InputJsonValue) ?? {},
        availability: (dto.availability as Prisma.InputJsonValue) ?? undefined,
        groupMode: (dto.groupMode as 'none' | 'separate' | 'visible') ?? 'none',
        openAt: dto.openAt ? new Date(dto.openAt as string) : null,
        dueAt: dto.dueAt ? new Date(dto.dueAt as string) : null,
        cutoffAt: dto.cutoffAt ? new Date(dto.cutoffAt as string) : null,
      },
    });

    // Denormalised section sequence (Moodle) — append.
    await this.prisma.client.courseSection.update({ where: { id: section.id }, data: { sequence: { push: cm.id } } });
    // Activity context for capability + file ACL.
    await this.contexts.ensureActivityContext(cm.id, courseOfferingId);

    // Grade bridge: gradable activities own exactly one Assessment. Both calls
    // share a transaction — a module whose assessment exists but whose roster
    // was never fanned out is a grade item nobody can be marked in.
    if (plugin.features.gradable && plugin.gradeDefinition) {
      const gradeDef = await plugin.gradeDefinition(this.ctx(cm), instanceId);
      await this.prisma.client.$transaction(async (tx: Prisma.TransactionClient) => {
        const assessmentId = await this.grades.ensureAssessment(cm, offering, gradeDef, tx);
        await this.grades.fanout(assessmentId, cm, tx);
      });
    }

    await this.events.log({ eventName: `mod_${dto.activityType}.created`, component: `mod_${dto.activityType}`, action: 'created', target: 'course_module', courseOfferingId, courseModuleId: cm.id, objectId: cm.id });
    return cm;
  }

  /** Update spine-level fields (visibility, dates, availability, completion rules). */
  async updateSpine(id: string, dto: Record<string, unknown>): Promise<CourseModule> {
    await this.get(id);
    const data: Prisma.CourseModuleUpdateInput = {};
    for (const k of ['visible', 'visibleOnPage', 'idnumber', 'groupMode', 'groupingId', 'completionMode'] as const) {
      if (dto[k] !== undefined) (data as Record<string, unknown>)[k] = dto[k];
    }
    if (dto.completionRules !== undefined) data.completionRules = dto.completionRules as Prisma.InputJsonValue;
    if (dto.availability !== undefined) data.availability = dto.availability as Prisma.InputJsonValue;
    for (const k of ['openAt', 'dueAt', 'cutoffAt'] as const) {
      if (dto[k] !== undefined) (data as Record<string, unknown>)[k] = dto[k] ? new Date(dto[k] as string) : null;
    }
    const cm = await this.prisma.client.courseModule.update({ where: { id }, data });
    await this.events.log({ eventName: `mod_${cm.activityType}.updated`, component: `mod_${cm.activityType}`, action: 'updated', target: 'course_module', courseModuleId: id });
    return cm;
  }

  /** Delegate a per-type edit to the plugin. */
  async updateInstance(id: string, dto: Record<string, unknown>): Promise<{ ok: true }> {
    const cm = await this.get(id);
    await this.registry.get(cm.activityType).updateInstance(this.ctx(cm), cm.instanceId, dto);
    return { ok: true };
  }

  /** Move a module to another section / position; rewrite the sequence arrays. */
  async move(id: string, dto: { sectionId: string; sequence?: string[] }): Promise<{ ok: true }> {
    const cm = await this.get(id);
    const target = await this.prisma.client.courseSection.findFirst({ where: { id: dto.sectionId, organizationId: this.org, courseOfferingId: cm.courseOfferingId } });
    if (!target) throw new NotFoundException('Target section not found in this course');
    await this.prisma.client.$transaction(async (tx: Prisma.TransactionClient) => {
      if (cm.sectionId !== target.id) {
        const old = await tx.courseSection.findFirst({ where: { id: cm.sectionId } });
        if (old) await tx.courseSection.update({ where: { id: old.id }, data: { sequence: old.sequence.filter((x) => x !== id) } });
        await tx.courseModule.update({ where: { id }, data: { sectionId: target.id } });
      }
      const seq = dto.sequence ?? [...target.sequence.filter((x) => x !== id), id];
      await tx.courseSection.update({ where: { id: target.id }, data: { sequence: seq } });
    });
    return { ok: true };
  }

  async setVisibility(id: string, dto: { visible?: boolean; visibleOnPage?: boolean }): Promise<CourseModule> {
    await this.get(id);
    return this.prisma.client.courseModule.update({ where: { id }, data: { visible: dto.visible, visibleOnPage: dto.visibleOnPage } });
  }

  /** Duplicate a module via the plugin's export→import (no user data). */
  async duplicate(id: string): Promise<CourseModule> {
    const cm = await this.get(id);
    const plugin = this.registry.get(cm.activityType);
    const payload = await plugin.exportInstance(this.ctx(cm), cm.instanceId, { includeUserData: false });
    const { instanceId } = await plugin.importInstance(this.ctx(cm), payload);
    const max = await this.prisma.client.courseModule.aggregate({ where: { organizationId: this.org, sectionId: cm.sectionId }, _max: { sequence: true } });
    const copy = await this.prisma.client.courseModule.create({
      data: {
        organizationId: this.org, courseOfferingId: cm.courseOfferingId, sectionId: cm.sectionId,
        activityType: cm.activityType, instanceId, sequence: (max._max.sequence ?? -1) + 1,
        completionMode: cm.completionMode, completionRules: cm.completionRules as Prisma.InputJsonValue,
        visible: false,
      },
    });
    await this.prisma.client.courseSection.update({ where: { id: cm.sectionId }, data: { sequence: { push: copy.id } } });
    await this.contexts.ensureActivityContext(copy.id, cm.courseOfferingId);
    return copy;
  }

  async remove(id: string): Promise<{ ok: true }> {
    const cm = await this.get(id);
    await this.prisma.client.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.courseModule.update({ where: { id }, data: { deletedAt: new Date() } });
      const sec = await tx.courseSection.findFirst({ where: { id: cm.sectionId } });
      if (sec) await tx.courseSection.update({ where: { id: sec.id }, data: { sequence: sec.sequence.filter((x) => x !== id) } });
    });
    await this.events.log({ eventName: `mod_${cm.activityType}.deleted`, component: `mod_${cm.activityType}`, action: 'deleted', target: 'course_module', courseModuleId: id });
    return { ok: true };
  }

  /** Open an activity. Enforces availability for students, records a view, delegates the body to the plugin. */
  async view(id: string, opts: { studentProfileId?: string }): Promise<unknown> {
    const cm = await this.get(id);
    const pctx: PluginCtx = { organizationId: this.org, userId: this.tenant.userId, studentProfileId: opts.studentProfileId, courseModule: cm };
    const plugin = this.registry.get(cm.activityType);

    if (opts.studentProfileId) {
      const avail = await this.availability.evaluate(cm.availability, { studentProfileId: opts.studentProfileId, courseOfferingId: cm.courseOfferingId });
      if (!avail.available) throw new ForbiddenException(`Not available: ${avail.reasons.join('; ') || 'restricted'}`);
      await this.completion.markViewed(cm, opts.studentProfileId);
      await this.events.log({ eventName: `mod_${cm.activityType}.viewed`, component: `mod_${cm.activityType}`, action: 'viewed', target: 'course_module', courseModuleId: id, studentProfileId: opts.studentProfileId });
      return plugin.viewForStudent(pctx, cm);
    }
    await this.events.log({ eventName: `mod_${cm.activityType}.viewed`, component: `mod_${cm.activityType}`, action: 'viewed', target: 'course_module', courseModuleId: id });
    return plugin.viewForTeacher(pctx, cm);
  }

  /** A plugin-defined verb (submit, start-attempt, post…). Recomputes completion + evidence after. */
  async action(id: string, action: string, dto: Record<string, unknown>, opts: { studentProfileId?: string }): Promise<unknown> {
    const cm = await this.get(id);
    const plugin = this.registry.get(cm.activityType);
    if (!plugin.action) throw new BadRequestException(`Activity '${cm.activityType}' supports no actions`);
    const pctx: PluginCtx = { organizationId: this.org, userId: this.tenant.userId, studentProfileId: opts.studentProfileId, courseModule: cm };
    const result = await plugin.action(pctx, cm, action, dto);

    if (opts.studentProfileId) {
      if (cm.completionMode === 'automatic') await this.completion.recomputeAuto(cm, opts.studentProfileId);
      if (plugin.emitEvidence) {
        const rows = await plugin.emitEvidence(pctx, cm);
        for (const r of rows) {
          await this.prisma.client.learningObjectiveEvidence.create({
            data: {
              organizationId: this.org, studentProfileId: opts.studentProfileId, learningObjectiveId: r.learningObjectiveId,
              sourceType: r.sourceType, sourceId: r.sourceId,
              normalizedScore: r.normalizedScore ?? null, proficiency: r.proficiency ?? null,
            },
          });
        }
      }
    }
    await this.events.log({ eventName: `mod_${cm.activityType}.${action}`, component: `mod_${cm.activityType}`, action, target: 'course_module', courseModuleId: id, studentProfileId: opts.studentProfileId });
    return result;
  }
}
