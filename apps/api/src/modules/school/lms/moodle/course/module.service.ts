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
import { sanitizeDto } from '../util/sanitize';
import { PortalIdentityService } from '../../../../../kernel/auth/portal-identity.service';
import { CapabilityService } from '../context/capability.service';
import { CAP } from '../capabilities';
import { ViewEnvelopeService } from './view-envelope.service';
import type { ModuleViewEnvelope, ModuleAvailability } from './view-envelope.types';

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
    private readonly portalIdentity: PortalIdentityService,
    private readonly caps: CapabilityService,
    private readonly envelope: ViewEnvelopeService,
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

    // Teacher-authored HTML is cleaned here, at the single point where a DTO
    // reaches a plugin, so no plugin can forget and no stored row is ever dirty.
    const { instanceId } = await plugin.createInstance(this.ctx(), sanitizeDto(dto));
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
    // Re-read: the grade bridge writes `assessmentId` onto the row after it was
    // created, so the in-memory copy still says null. Returning that told the
    // caller a gradable activity had no assessment.
    return (await this.prisma.client.courseModule.findFirst({ where: { id: cm.id } })) ?? cm;
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
    await this.registry.get(cm.activityType).updateInstance(this.ctx(cm), cm.instanceId, sanitizeDto(dto));
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

  /**
   * Resolve WHICH student a request acts for.
   *
   * The subject comes from the verified token, never from the caller. Staff may
   * name a student explicitly (`asStudent`) — a teacher previewing what a pupil
   * sees — but only with the capability to view on others' behalf. A student may
   * only ever be themselves: passing someone else's id is refused rather than
   * silently ignored, so a probe shows up as a 403 in the logs.
   */
  private async resolveSubject(asStudent?: string): Promise<string | undefined> {
    const p = this.portalIdentity.principal();
    if (p.kind === 'student') {
      if (asStudent && asStudent !== p.studentProfileId) {
        throw new ForbiddenException('You may only act as yourself');
      }
      return p.studentProfileId;
    }
    if (p.kind === 'guardian') {
      // A guardian reads on behalf of a child and must name which one.
      if (!asStudent) return undefined;
      if (!(await this.portalIdentity.canAccessStudent(asStudent))) {
        throw new ForbiddenException('Not a guardian of this student');
      }
      return asStudent;
    }
    return asStudent;
  }

  /**
   * Open an activity.
   *
   * Returns a ModuleViewEnvelope: common chrome (name, due date, grade,
   * completion, capabilities) assembled by the spine, with the plugin's own
   * payload under `body`. Before the envelope existed the raw plugin payload was
   * returned untagged, so the client duck-typed the response to guess the
   * activity type and fell back to printing raw JSON on screen.
   */
  async view(id: string, opts: { asStudent?: string } = {}): Promise<ModuleViewEnvelope> {
    const cm = await this.get(id);
    const principal = this.portalIdentity.principal();
    const studentProfileId = await this.resolveSubject(opts.asStudent);
    const pctx: PluginCtx = { organizationId: this.org, userId: this.tenant.userId, studentProfileId, courseModule: cm };
    const plugin = this.registry.get(cm.activityType);

    // Staff naming a student get the STUDENT view, and only with the capability
    // to do so. Previously the teacher view was reachable simply by omitting the
    // parameter, which handed submission lists and answer keys to any caller.
    if (principal.kind === 'staff' && !opts.asStudent) {
      const canTeach = await this.caps.canAtCourse(
        { userId: principal.userId }, CAP.courseManageActivities, cm.courseOfferingId,
      );
      if (!canTeach) throw new ForbiddenException('Missing LMS capability to view this activity as a teacher');
      await this.events.log({ eventName: `mod_${cm.activityType}.viewed`, component: `mod_${cm.activityType}`, action: 'viewed', target: 'course_module', courseModuleId: id });
      const body = await plugin.viewForTeacher(pctx, cm);
      return this.wrap(cm, body, 'teacher', undefined, null);
    }

    if (!studentProfileId) throw new ForbiddenException('No student subject for this request');
    if (principal.kind === 'staff') {
      const canPreview = await this.caps.canAtCourse(
        { userId: principal.userId }, CAP.courseViewHidden, cm.courseOfferingId,
      );
      if (!canPreview) throw new ForbiddenException('Missing LMS capability to view on behalf of a student');
    }

    const avail = await this.availability.evaluate(cm.availability, { studentProfileId, courseOfferingId: cm.courseOfferingId });
    if (!avail.available) throw new ForbiddenException(`Not available: ${avail.reasons.join('; ') || 'restricted'}`);
    // Only a real student visit counts towards completion — a teacher preview
    // or a guardian looking in must not tick the box on the pupil's behalf.
    if (principal.kind === 'student') await this.completion.markViewed(cm, studentProfileId);
    await this.events.log({ eventName: `mod_${cm.activityType}.viewed`, component: `mod_${cm.activityType}`, action: 'viewed', target: 'course_module', courseModuleId: id, studentProfileId });
    const body = await plugin.viewForStudent(pctx, cm);
    return this.wrap(cm, body, 'student', studentProfileId, {
      available: avail.available,
      reasons: avail.reasons,
      greyed: avail.showGreyed,
    });
  }

  /** Assemble the envelope around whichever plugin view just ran. */
  private async wrap(
    cm: CourseModule,
    body: unknown,
    audience: 'student' | 'teacher',
    studentProfileId: string | undefined,
    availability: ModuleAvailability | null,
  ): Promise<ModuleViewEnvelope> {
    const offering = await this.prisma.client.courseOffering.findFirst({
      where: { id: cm.courseOfferingId, organizationId: this.org },
    });
    const [header, capabilities, views] = await Promise.all([
      offering ? this.envelope.courseHeader(offering) : Promise.resolve(null),
      this.envelope.capabilitiesFor(cm.courseOfferingId),
      this.envelope.moduleViews([cm], {
        studentProfileId,
        availabilityByModule: availability ? new Map([[cm.id, availability]]) : undefined,
        showGrades: offering?.showGradesToStudents !== false || audience === 'teacher',
      }),
    ]);
    const principal = this.portalIdentity.principal();
    return {
      module: views[0],
      course: {
        id: cm.courseOfferingId,
        name: header?.name ?? 'Course',
        subject: header?.subject ?? null,
        className: header?.className ?? null,
        term: header?.term ?? null,
      },
      capabilities,
      viewingAs: { kind: principal.kind, studentProfileId: studentProfileId ?? null },
      audience,
      body,
    };
  }

  /** A plugin-defined verb (submit, start-attempt, post…). Recomputes completion + evidence after. */
  async action(id: string, action: string, dto: Record<string, unknown>, opts: { asStudent?: string } = {}): Promise<unknown> {
    const cm = await this.get(id);
    const plugin = this.registry.get(cm.activityType);
    if (!plugin.action) throw new BadRequestException(`Activity '${cm.activityType}' supports no actions`);
    const principal = this.portalIdentity.principal();
    // A guardian may read a child's course but never act in it — submitting work
    // or posting as the pupil would corrupt the academic record.
    if (principal.kind === 'guardian') throw new ForbiddenException('Guardians cannot submit or post on behalf of a student');
    const studentProfileId = await this.resolveSubject(opts.asStudent);
    const pctx: PluginCtx = { organizationId: this.org, userId: this.tenant.userId, studentProfileId, courseModule: cm };
    // Student-authored bodies (forum posts, wiki edits, glossary definitions) run
    // through the same cleaner as teacher content — a peer reading a post is just
    // as exposed as a student reading a page.
    const result = await plugin.action(pctx, cm, action, sanitizeDto(dto));

    if (studentProfileId) {
      if (cm.completionMode === 'automatic') await this.completion.recomputeAuto(cm, studentProfileId);
      if (plugin.emitEvidence) {
        const rows = await plugin.emitEvidence(pctx, cm);
        for (const r of rows) {
          await this.prisma.client.learningObjectiveEvidence.create({
            data: {
              organizationId: this.org, studentProfileId, learningObjectiveId: r.learningObjectiveId,
              sourceType: r.sourceType, sourceId: r.sourceId,
              normalizedScore: r.normalizedScore ?? null, proficiency: r.proficiency ?? null,
            },
          });
        }
      }
    }
    await this.events.log({ eventName: `mod_${cm.activityType}.${action}`, component: `mod_${cm.activityType}`, action, target: 'course_module', courseModuleId: id, studentProfileId });
    return result;
  }
}
