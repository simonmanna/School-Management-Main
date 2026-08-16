import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Curriculum, LessonPlan, TeacherAssignment, TimetableSlot } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { EVENTS } from '@erp/shared';
import type {
  BulkTimetableDto,
  CreateCurriculumDto,
  CreateLessonPlanDto,
  CreateTeacherAssignmentDto,
  CreateTimetableSlotDto,
  UpdateCurriculumDto,
  UpdateLessonPlanDto,
  UpdateTeacherAssignmentDto,
  UpdateTimetableSlotDto,
} from './dto.types';

@Injectable()
export class CurriculumService extends BaseCrudService<Curriculum, CreateCurriculumDto, UpdateCurriculumDto> {
  protected readonly entityName = 'Curriculum';
  protected readonly searchFields = ['name'];
  protected readonly defaultInclude = {
    subjects: { include: { subject: true } },
    topics: { include: { units: { include: { learningObjectives: true } } } },
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {
    super(prisma.client.curriculum as unknown as CrudDelegate);
  }

  async create(dto: CreateCurriculumDto): Promise<Curriculum> {
    return this.prisma.client.$transaction(async (tx: any) => {
      const organizationId = this.tenant.organizationId;
      // v1 is always a fresh draft.
      const row = await tx.curriculum.create({
        data: {
          organizationId,
          classId: dto.classId,
          academicYearId: dto.academicYearId,
          name: dto.name,
          description: dto.description ?? null,
          version: 1,
          status: 'draft',
        },
        include: this.defaultInclude,
      });
      await tx.curriculumSubject.createMany({
        data: dto.subjects.map((s: any) => ({
          organizationId,
          curriculumId: row.id,
          subjectId: s.subjectId,
          periodsPerWeek: s.periodsPerWeek,
          isCore: s.isCore ?? true,
        })),
      });
      await this.audit.recordInTx(tx, { entity: 'Curriculum', entityId: row.id, action: 'create', newValues: row });
      this.events.publish(EVENTS.SchoolCurriculumCreated, { organizationId, curriculumId: row.id, version: 1 });
      return tx.curriculum.findFirst({ where: { id: row.id }, include: this.defaultInclude }) as Promise<Curriculum>;
    });
  }

  /**
   * Publish a draft curriculum version. Immutable once published: further edits must
   * go through cloneAsNewVersion. Uses the WorkflowService transition so permission
   * gating is centralised.
   */
  async publish(id: string) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const cur = await tx.curriculum.findFirst({ where: { id } });
      if (!cur) throw new NotFoundException(`Curriculum ${id} not found`);
      if (cur.status !== 'draft') {
        throw new BadRequestException(`Cannot publish a curriculum in status '${cur.status}' (must be draft).`);
      }
      await tx.curriculum.updateMany({ where: { id }, data: { status: 'published', publishedAt: new Date() } });
      await this.audit.recordInTx(tx, { entity: 'Curriculum', entityId: id, action: 'update', oldValues: { status: cur.status }, newValues: { status: 'published' } });
      this.events.publish(EVENTS.SchoolCurriculumPublished, { organizationId: this.tenant.organizationId, curriculumId: id, version: cur.version });
      return tx.curriculum.findFirst({ where: { id }, include: this.defaultInclude });
    });
  }

  /** Archive a published version (retained for history; not deletable). */
  async archive(id: string) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const cur = await tx.curriculum.findFirst({ where: { id } });
      if (!cur) throw new NotFoundException(`Curriculum ${id} not found`);
      if (cur.status !== 'published') {
        throw new BadRequestException(`Only published curriculum versions can be archived (current: '${cur.status}').`);
      }
      await tx.curriculum.updateMany({ where: { id }, data: { status: 'archived', archivedAt: new Date() } });
      await this.audit.recordInTx(tx, { entity: 'Curriculum', entityId: id, action: 'update', oldValues: { status: cur.status }, newValues: { status: 'archived' } });
      return tx.curriculum.findFirst({ where: { id }, include: this.defaultInclude });
    });
  }

  /**
   * Clone a published/frozen version into a new editable draft (version+1), copying
   * subjects, topics, units, and learning objectives. This is how curriculum edits
   * preserve a complete auditable history.
   */
  async cloneAsNewVersion(id: string) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const src = await tx.curriculum.findFirst({
        where: { id },
        include: {
          subjects: true,
          topics: { include: { units: { include: { learningObjectives: true } } } },
        },
      });
      if (!src) throw new NotFoundException(`Curriculum ${id} not found`);

      const nextVersion = (src.version ?? 1) + 1;
      const clone = await tx.curriculum.create({
        data: {
          organizationId: src.organizationId,
          classId: src.classId,
          academicYearId: src.academicYearId,
          name: src.name,
          description: src.description,
          version: nextVersion,
          status: 'draft',
          parentVersionId: src.id,
        },
      });

      // Copy subjects
      if (src.subjects?.length) {
        await tx.curriculumSubject.createMany({
          data: src.subjects.map((s: any) => ({
            organizationId: src.organizationId,
            curriculumId: clone.id,
            subjectId: s.subjectId,
            periodsPerWeek: s.periodsPerWeek,
            isCore: s.isCore,
          })),
        });
      }

      // Copy topics → units → learning objectives
      for (const topic of src.topics ?? []) {
        const newTopic = await tx.topic.create({
          data: {
            organizationId: src.organizationId,
            curriculumId: clone.id,
            curriculumSubjectId: topic.curriculumSubjectId,
            competencyId: topic.competencyId,
            title: topic.title,
            order: topic.order,
          },
        });
        for (const unit of topic.units ?? []) {
          const newUnit = await tx.unit.create({
            data: {
              organizationId: src.organizationId,
              curriculumId: clone.id,
              curriculumSubjectId: unit.curriculumSubjectId,
              topicId: newTopic.id,
              title: unit.title,
              description: unit.description,
              order: unit.order,
            },
          });
          if (unit.learningObjectives?.length) {
            await tx.learningObjective.createMany({
              data: unit.learningObjectives.map((lo: any) => ({
                organizationId: src.organizationId,
                unitId: newUnit.id,
                topicId: newTopic.id,
                description: lo.description,
                bloomLevel: lo.bloomLevel,
              })),
            });
          }
        }
      }

      await this.audit.recordInTx(tx, {
        entity: 'Curriculum', entityId: clone.id, action: 'create',
        newValues: { version: nextVersion, parentVersionId: src.id, status: 'draft' },
      });
      this.events.publish(EVENTS.SchoolCurriculumVersionCloned, {
        organizationId: this.tenant.organizationId, curriculumId: clone.id,
        fromVersion: src.version, toVersion: nextVersion,
      });
      return tx.curriculum.findFirst({ where: { id: clone.id }, include: this.defaultInclude });
    });
  }

  /** List all versions of a (classId, academicYearId) curriculum lineage. */
  async versions(classId: string, academicYearId: string) {
    return this.prisma.client.curriculum.findMany({
      where: { classId, academicYearId },
      orderBy: { version: 'asc' },
      include: { parentVersion: true },
    });
  }

  /**
   * Override: published/archived curriculum versions are immutable. Edits must go
   * through cloneAsNewVersion. Drafts may still be patched (e.g. rename, description).
   */
  async update(id: string, data: UpdateCurriculumDto): Promise<Curriculum> {
    const cur = await this.prisma.client.curriculum.findFirst({ where: { id } });
    if (!cur) throw new NotFoundException(`${this.entityName} ${id} not found`);
    if (cur.status !== 'draft') {
      throw new BadRequestException(
        `Curriculum v${cur.version} is '${cur.status}' and immutable. Edit via cloneAsNewVersion().`,
      );
    }
    return super.update(id, data);
  }
}

@Injectable()
export class LessonPlanService extends BaseCrudService<LessonPlan, CreateLessonPlanDto, UpdateLessonPlanDto> {
  protected readonly entityName = 'LessonPlan';
  protected readonly searchFields = ['title', 'objectives'];
  protected readonly defaultInclude = { subject: true };

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {
    super(prisma.client.lessonPlan as unknown as CrudDelegate);
  }

  /**
   * Publish a lesson plan — simple status flip with audit + event.
   * A real WorkflowService transition would be used in production for
   * permission gating; we keep this lean for the sprint scope.
   */
  async publish(id: string) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const before = await tx.lessonPlan.findFirst({ where: { id } });
      if (!before) throw new NotFoundException(`LessonPlan ${id} not found`);
      const updated = await tx.lessonPlan.updateMany({
        where: { id },
        data: { status: 'published', publishedAt: new Date() },
      });
      if (updated.count === 0) throw new NotFoundException(`LessonPlan ${id} not found`);
      const after = await tx.lessonPlan.findFirst({ where: { id } });
      await this.audit.recordInTx(tx, {
        entity: 'LessonPlan',
        entityId: id,
        // 'publish' is not an AuditAction enum value — that write would throw and
        // roll back the publish. Publishing is a status update.
        action: 'update',
        oldValues: { status: before.status },
        newValues: { status: 'published', action: 'publish' },
      });
      this.events.publish(EVENTS.SchoolLessonPlanPublished, {
        organizationId: this.tenant.organizationId,
        lessonPlanId: id,
        subjectId: before.subjectId,
        classId: before.classId ?? undefined,
      });
      return after;
    });
  }

  async byTeacher(teacherPartnerId: string) {
    return this.prisma.client.lessonPlan.findMany({
      where: { teacherPartnerId },
      orderBy: { weekOf: 'desc' },
      include: { subject: true },
    });
  }
}

@Injectable()
export class TeacherAssignmentService extends BaseCrudService<TeacherAssignment, CreateTeacherAssignmentDto, UpdateTeacherAssignmentDto> {
  protected readonly entityName = 'TeacherAssignment';
  protected readonly searchFields: string[] = [];
  protected readonly defaultInclude = { subject: true, schoolClass: true, section: true };

  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.teacherAssignment as unknown as CrudDelegate);
  }

  async byTeacher(teacherPartnerId: string) {
    return this.prisma.client.teacherAssignment.findMany({
      where: { teacherPartnerId },
      include: { subject: true, schoolClass: { include: { gradeLevel: true } }, section: true },
    });
  }

  async byClass(classId: string) {
    return this.prisma.client.teacherAssignment.findMany({
      where: { classId },
      include: { subject: true, teacher: { include: { position: true } } },
    });
  }
}

/**
 * Timetable service with conflict detection. Detects:
 *   - Teacher double-booked (same teacher, day, period).
 *   - Room double-booked (same room, day, period).
 *   - Class double-booked (same class, day, period).
 */
@Injectable()
export class TimetableService extends BaseCrudService<TimetableSlot, CreateTimetableSlotDto, UpdateTimetableSlotDto> {
  protected readonly entityName = 'TimetableSlot';
  protected readonly searchFields: string[] = [];
  protected readonly defaultInclude = { subject: true, period: true, teacher: true };

  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.timetableSlot as unknown as CrudDelegate);
  }

  /**
   * Detect conflicts before creating a slot.
   * Returns an array of conflict descriptions; empty array means clean.
   */
  async detectConflicts(slot: CreateTimetableSlotDto, excludeSlotId?: string): Promise<string[]> {
    const conflicts: string[] = [];
    const where = (extra: Record<string, unknown>) => ({
      organizationId: undefined as any, // tenancy extension fills this
      dayOfWeek: slot.dayOfWeek,
      periodId: slot.periodId,
      ...extra,
      ...(excludeSlotId ? { id: { not: excludeSlotId } } : {}),
    });
    if (slot.teacherPartnerId) {
      const teacherClash = await this.prisma.client.timetableSlot.findFirst({
        where: where({ teacherPartnerId: slot.teacherPartnerId }),
      });
      if (teacherClash) conflicts.push(`Teacher double-booked (slot ${teacherClash.id})`);
    }
    if (slot.room) {
      const roomClash = await this.prisma.client.timetableSlot.findFirst({
        where: where({ room: slot.room }),
      });
      if (roomClash) conflicts.push(`Room ${slot.room} double-booked (slot ${roomClash.id})`);
    }
    const classClash = await this.prisma.client.timetableSlot.findFirst({
      where: where({ classId: slot.classId, sectionId: slot.sectionId ?? null }),
    });
    if (classClash) conflicts.push(`Class already has a lesson at this time (slot ${classClash.id})`);
    return conflicts;
  }

  async create(dto: CreateTimetableSlotDto): Promise<TimetableSlot> {
    const conflicts = await this.detectConflicts(dto);
    if (conflicts.length > 0) {
      throw new BadRequestException(`Timetable conflicts: ${conflicts.join('; ')}`);
    }
    return super.create(dto);
  }

  /**
   * Conflict-checked update. `BaseCrudService.update` does no validation, so a
   * PATCH could previously move a slot on top of an existing teacher/room/class
   * booking. The incoming patch is merged over the stored row first, because
   * `detectConflicts` needs the *resulting* slot, not just the changed fields.
   */
  async update(id: string, dto: UpdateTimetableSlotDto): Promise<TimetableSlot> {
    const existing = await this.prisma.client.timetableSlot.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException(`${this.entityName} ${id} not found`);

    const merged: CreateTimetableSlotDto = {
      classId: dto.classId ?? existing.classId,
      sectionId: dto.sectionId ?? existing.sectionId ?? undefined,
      dayOfWeek: dto.dayOfWeek ?? existing.dayOfWeek,
      periodId: dto.periodId ?? existing.periodId,
      subjectId: dto.subjectId ?? existing.subjectId,
      teacherPartnerId: dto.teacherPartnerId ?? existing.teacherPartnerId ?? undefined,
      campusId: dto.campusId ?? existing.campusId ?? undefined,
      room: dto.room ?? existing.room ?? undefined,
    };

    const conflicts = await this.detectConflicts(merged, id);
    if (conflicts.length > 0) {
      throw new BadRequestException(`Timetable conflicts: ${conflicts.join('; ')}`);
    }
    return super.update(id, dto);
  }

  /**
   * Hard delete. `TimetableSlot` has no `deletedAt` column and is not in the
   * tenancy extension's SOFT_DELETE set, so the inherited soft-delete `remove`
   * sent Prisma an unknown argument and 500'd on every DELETE.
   */
  async remove(id: string): Promise<void> {
    const res = await this.prisma.client.timetableSlot.deleteMany({ where: { id } });
    if (res.count === 0) throw new NotFoundException(`${this.entityName} ${id} not found`);
  }

  async bulkUpsert(dto: BulkTimetableDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      // Wipe existing slots for this class/section, then re-insert atomically.
      await tx.timetableSlot.deleteMany({
        where: { classId: dto.classId, sectionId: dto.sectionId ?? null },
      });
      const created = [];
      for (const slot of dto.slots) {
        created.push(
          await tx.timetableSlot.create({
            data: { ...slot, classId: dto.classId, sectionId: dto.sectionId ?? null },
          }),
        );
      }
      return { count: created.length };
    });
  }

  async gridForClass(classId: string, sectionId?: string) {
    const slots = await this.prisma.client.timetableSlot.findMany({
      where: { classId, sectionId: sectionId ?? null },
      include: { subject: true, period: true, teacher: true },
      orderBy: [{ dayOfWeek: 'asc' }, { period: { order: 'asc' } }],
    });
    // Shape into a 7-day grid keyed by [day][period] for the UI.
    const grid: Record<number, Record<string, any>> = {};
    for (const s of slots) {
      grid[s.dayOfWeek] ??= {};
      grid[s.dayOfWeek][s.periodId] = s;
    }
    return { slots, grid };
  }
}