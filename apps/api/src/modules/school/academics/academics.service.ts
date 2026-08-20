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

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {
    super(prisma.client.timetableSlot as unknown as CrudDelegate);
  }

  /**
   * Resolve the canonical CourseOffering for a slot (class+section+subject+term),
   * so timetable rows hang off the teaching-instance spine. Best-effort: returns
   * null when no matching offering exists yet (caller may create one via LMS).
   */
  private async resolveCourseOffering(
    tx: any,
    slot: { classId: string; sectionId?: string | null; subjectId: string },
  ): Promise<string | null> {
    const where: Record<string, unknown> = {
      organizationId: this.tenant.organizationId,
      classId: slot.classId,
      sectionId: slot.sectionId ?? null,
      subjectId: slot.subjectId,
    };
    const offering = await tx.courseOffering.findFirst({ where });
    return offering?.id ?? null;
  }

  /**
   * Detect conflicts before creating a slot.
   * Returns an array of conflict descriptions; empty array means clean.
   */
  async detectConflicts(slot: CreateTimetableSlotDto, excludeSlotId?: string): Promise<string[]> {
    // Breaks and free periods are intentionally not bookable resources — skip.
    if (slot.type === 'break' || slot.type === 'free') return [];
    const organizationId = this.tenant.organizationId;
    const conflicts: string[] = [];
    const excl = excludeSlotId ? { id: { not: excludeSlotId } } : {};
    const base = (extra: Record<string, unknown>) => ({
      organizationId,
      dayOfWeek: slot.dayOfWeek,
      ...extra,
      ...excl,
    });

    // Resolve the ordered period list to validate multi-period (double) spans.
    const span = slot.spanPeriods ?? 1;
    let periodIds: string[] = [slot.periodId];
    if (span > 1) {
      const ordered = (await this.prisma.client.period.findMany({ orderBy: { order: 'asc' } }))
        .map((p: any) => p.id);
      const idx = ordered.indexOf(slot.periodId);
      if (idx < 0 || idx + span > ordered.length) {
        conflicts.push(`Double period spans past the end of the day`);
      } else {
        periodIds = ordered.slice(idx, idx + span);
      }
    }

    // Teacher availability: cannot place where the teacher is unavailable.
    if (slot.teacherPartnerId) {
      const avail = await this.prisma.client.teacherAvailability.findFirst({
        where: { teacherPartnerId: slot.teacherPartnerId, dayOfWeek: slot.dayOfWeek,
          periodId: { in: periodIds }, status: 'unavailable' } as any,
      });
      if (avail) conflicts.push(`Teacher unavailable at this period (${avail.reason ?? ''})`);

      const teacherClash = await this.prisma.client.timetableSlot.findFirst({
        where: base({ teacherPartnerId: slot.teacherPartnerId, periodId: { in: periodIds } }),
      });
      if (teacherClash) conflicts.push(`Teacher double-booked (slot ${teacherClash.id})`);
    }

    // Room: prefer managed teachingRoomId, fall back to free-text room label.
    const roomKey = slot.teachingRoomId ? { teachingRoomId: slot.teachingRoomId } : (slot.room ? { room: slot.room } : null);
    if (roomKey) {
      const roomClash = await this.prisma.client.timetableSlot.findFirst({
        where: base({ ...roomKey, periodId: { in: periodIds } }),
      });
      if (roomClash) conflicts.push(`Room double-booked (slot ${roomClash.id})`);
    }

    const classClash = await this.prisma.client.timetableSlot.findFirst({
      where: base({ classId: slot.classId, sectionId: slot.sectionId ?? null, periodId: { in: periodIds } }),
    });
    if (classClash) conflicts.push(`Class already has a lesson at this time (slot ${classClash.id})`);
    return conflicts;
  }

  async create(dto: CreateTimetableSlotDto): Promise<TimetableSlot> {
    const conflicts = await this.detectConflicts(dto);
    if (conflicts.length > 0) {
      throw new BadRequestException(`Timetable conflicts: ${conflicts.join('; ')}`);
    }
    // Hang the slot off the canonical CourseOffering spine (best-effort).
    const courseOfferingId = await this.resolveCourseOffering(this.prisma.client, {
      classId: dto.classId,
      sectionId: dto.sectionId ?? null,
      subjectId: dto.subjectId,
    });
    return super.create({ ...dto, courseOfferingId: courseOfferingId ?? undefined });
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
      courseOfferingId: existing.courseOfferingId ?? undefined,
    };

    const conflicts = await this.detectConflicts(merged, id);
    if (conflicts.length > 0) {
      throw new BadRequestException(`Timetable conflicts: ${conflicts.join('; ')}`);
    }

    // Re-resolve the spine if the class/section/subject changed.
    const courseOfferingId = await this.resolveCourseOffering(this.prisma.client, merged);
    const updateData: UpdateTimetableSlotDto = { ...dto };
    if (courseOfferingId) (updateData as any).courseOfferingId = courseOfferingId;
    return super.update(id, updateData);
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
        const courseOfferingId = await this.resolveCourseOffering(tx, {
          classId: dto.classId,
          sectionId: dto.sectionId ?? null,
          subjectId: slot.subjectId,
        });
        created.push(
          await tx.timetableSlot.create({
            data: {
              ...slot,
              classId: dto.classId,
              sectionId: dto.sectionId ?? null,
              ...(courseOfferingId ? { courseOfferingId } : {}),
            },
          }),
        );
      }
      return { count: created.length };
    });
  }

  async gridForClass(classId: string, sectionId?: string, cycle?: string) {
    const slots = await this.prisma.client.timetableSlot.findMany({
      where: {
        classId, sectionId: sectionId ?? null,
        ...(cycle ? { cycle: { in: ['all', cycle] } } : {}),
      },
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

  /** Teacher timetable: every slot assigned to a given teacher (across classes). */
  async gridForTeacher(teacherPartnerId: string, cycle?: string) {
    const slots = await this.prisma.client.timetableSlot.findMany({
      where: { teacherPartnerId, ...(cycle ? { cycle: { in: ['all', cycle] } } : {}) },
      include: { subject: true, period: true, schoolClass: true, teacher: true },
      orderBy: [{ dayOfWeek: 'asc' }, { period: { order: 'asc' } }],
    });
    return this.toGrid(slots);
  }

  /** Room timetable: every slot booked into a given room (free-text room label). */
  async gridForRoom(room: string, cycle?: string) {
    const slots = await this.prisma.client.timetableSlot.findMany({
      where: { room, ...(cycle ? { cycle: { in: ['all', cycle] } } : {}) },
      include: { subject: true, period: true, schoolClass: true, teacher: true },
      orderBy: [{ dayOfWeek: 'asc' }, { period: { order: 'asc' } }],
    });
    return this.toGrid(slots);
  }

  /** Subject timetable: every slot for a given subject (across classes/teachers). */
  async gridForSubject(subjectId: string, cycle?: string) {
    const slots = await this.prisma.client.timetableSlot.findMany({
      where: { subjectId, ...(cycle ? { cycle: { in: ['all', cycle] } } : {}) },
      include: { subject: true, period: true, schoolClass: true, teacher: true },
      orderBy: [{ dayOfWeek: 'asc' }, { period: { order: 'asc' } }],
    });
    return this.toGrid(slots);
  }

  private toGrid(slots: any[]) {
    const grid: Record<number, Record<string, any>> = {};
    for (const s of slots) {
      grid[s.dayOfWeek] ??= {};
      grid[s.dayOfWeek][s.periodId] = s;
    }
    return { slots, grid };
  }

  /** Publish (or unpublish) a class's entire timetable grid at once. */
  async publishClass(classId: string, sectionId: string | undefined, published: boolean) {
    await this.prisma.client.timetableSlot.updateMany({
      where: { classId, sectionId: sectionId ?? null },
      data: { published },
    });
    return { published };
  }
}