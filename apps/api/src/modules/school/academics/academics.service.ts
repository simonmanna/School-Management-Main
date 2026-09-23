import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Curriculum, LessonPlan, TeacherAssignment, TimetableSlot } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { EVENTS } from '@erp/shared';
import { recordTimetableVersion } from './timetable-version';
import { assertYearWritable } from '../foundation/academic-year-guard';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {
    super(prisma.client.teacherAssignment as unknown as CrudDelegate);
  }

  /**
   * An assignment is only valid when every part of it is: an employed teacher,
   * an active subject, a section that belongs to the class, and a term whose
   * year is still open. Ids are resolved through the tenant-scoped client, so a
   * foreign id is simply "not found".
   */
  private async validate(dto: Partial<CreateTeacherAssignmentDto>, current?: TeacherAssignment) {
    const teacherId = dto.teacherPartnerId ?? current?.teacherPartnerId;
    const subjectId = dto.subjectId ?? current?.subjectId;
    const classId = dto.classId ?? current?.classId;
    const sectionId = dto.sectionId !== undefined ? dto.sectionId : current?.sectionId;
    const termId = dto.termId !== undefined ? dto.termId : current?.termId;
    const db = this.prisma.client;
    const [teacher, subject, cls] = await Promise.all([
      db.staffProfile.findFirst({ where: { id: teacherId }, select: { status: true } }),
      db.subject.findFirst({ where: { id: subjectId }, select: { isActive: true, name: true } }),
      db.schoolClass.findFirst({ where: { id: classId }, select: { isActive: true, name: true } }),
    ]);
    if (!teacher) throw new BadRequestException('Teacher not found in this school.');
    if (teacher.status !== 'active' && teacher.status !== 'on_leave') {
      throw new BadRequestException(`This staff member is ${teacher.status} and cannot be given teaching.`);
    }
    if (!subject) throw new BadRequestException('Subject not found in this school.');
    if (!subject.isActive) throw new BadRequestException(`"${subject.name}" has been retired.`);
    if (!cls) throw new BadRequestException('Class not found in this school.');
    if (!cls.isActive) throw new BadRequestException(`"${cls.name}" has been deactivated.`);
    if (sectionId) {
      const section = await db.section.findFirst({ where: { id: sectionId }, select: { classId: true } });
      if (!section || section.classId !== classId) throw new BadRequestException('That section does not belong to the class.');
    }
    if (termId) {
      const term = await db.term.findFirst({ where: { id: termId }, select: { academicYearId: true } });
      if (!term) throw new BadRequestException('Term not found in this school.');
      await assertYearWritable(db, this.tenant.organizationId, term.academicYearId, 'create');
    }
  }

  async create(dto: CreateTeacherAssignmentDto): Promise<TeacherAssignment> {
    await this.validate(dto);
    return super.create(dto);
  }

  async update(id: string, dto: UpdateTeacherAssignmentDto): Promise<TeacherAssignment> {
    const current = await this.findOne(id);
    await this.validate(dto as Partial<CreateTeacherAssignmentDto>, current);
    return super.update(id, dto);
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
   * so every lesson row hangs off the teaching-instance spine. Explicit ids are
   * validated; implicit resolution succeeds only when the context is unambiguous.
   */
  private async resolveCourseOffering(
    tx: any,
    slot: { classId: string; sectionId?: string | null; subjectId: string; courseOfferingId?: string | null },
  ): Promise<string | null> {
    if (slot.courseOfferingId) {
      const explicit = await tx.courseOffering.findFirst({ where: { id: slot.courseOfferingId, organizationId: this.tenant.organizationId } });
      if (!explicit || ['CLOSED', 'ARCHIVED'].includes(explicit.status) || explicit.classId !== slot.classId || explicit.subjectId !== slot.subjectId || (explicit.sectionId ?? null) !== (slot.sectionId ?? null)) {
        throw new BadRequestException('Course offering does not match the timetable class, grouping and subject.');
      }
      return explicit.id;
    }
    const where: Record<string, unknown> = {
      organizationId: this.tenant.organizationId,
      classId: slot.classId,
      sectionId: slot.sectionId ?? null,
      subjectId: slot.subjectId,
      status: { notIn: ['CLOSED', 'ARCHIVED'] },
    };
    const offerings = await tx.courseOffering.findMany({ where, take: 2, orderBy: { createdAt: 'desc' } });
    if (offerings.length > 1) throw new BadRequestException('More than one course offering matches this lesson. Select the offering explicitly.');
    return offerings[0]?.id ?? null;
  }

  /* ─────────────────────────── Conflict detection ─────────────────────────── */

  /**
   * The ordered period list a slot is laid out against: the slot's campus
   * periods plus campus-less (school-wide) ones. Mixing campuses would make a
   * double period at campus A "span" into campus B's timetable.
   */
  private async orderedPeriods(client: any, campusId?: string | null): Promise<string[]> {
    const periods = await client.period.findMany({
      where: campusId ? { OR: [{ campusId }, { campusId: null }] } : {},
      orderBy: { order: 'asc' },
      select: { id: true },
    });
    return periods.map((p: any) => p.id);
  }

  /** The period ids a slot occupies, given its start period and span. */
  private occupied(order: string[], periodId: string, span: number): string[] | null {
    const idx = order.indexOf(periodId);
    if (idx < 0) return [periodId];
    if (idx + span > order.length) return null;
    return order.slice(idx, idx + span);
  }

  /** Rotation cycles overlap unless they are two different named weeks (A vs B). */
  private cyclesOverlap(a?: string | null, b?: string | null): boolean {
    const x = a ?? 'all';
    const y = b ?? 'all';
    return x === 'all' || y === 'all' || x === y;
  }

  /**
   * Detect every clash a slot would create. Returns human-readable conflicts;
   * empty means clean. Considers:
   *   - teacher double-booked (teaching OR covering), substitute likewise;
   *   - teacher/substitute marked unavailable;
   *   - room double-booked (managed room, else free-text label);
   *   - class double-booked — a whole-class lesson clashes with every section's
   *     lesson at that time, and a section lesson clashes with whole-class ones;
   *   - multi-period spans on BOTH sides (an existing double period blocks the
   *     second period too), and rotation cycles (week A never clashes with B);
   *   - the teacher actually being allocated to this subject and class, and
   *     still employed.
   *
   * `pending` are slots being written in the same batch, checked against each
   * other as well as against the stored grid. `client` lets a caller run the
   * check inside its own transaction so it sees its own uncommitted changes.
   */
  async detectConflicts(
    slot: CreateTimetableSlotDto,
    excludeSlotId?: string,
    opts: { client?: any; pending?: CreateTimetableSlotDto[]; excludeScope?: { classId: string; sectionId: string | null } } = {},
  ): Promise<string[]> {
    if (slot.type === 'break' || slot.type === 'free') return [];
    const db = opts.client ?? this.prisma.client;
    const conflicts: string[] = [];
    const campusId = slot.campusId ?? (await db.schoolClass.findFirst({ where: { id: slot.classId }, select: { campusId: true } }))?.campusId ?? null;
    const order = await this.orderedPeriods(db, campusId);
    const mine = this.occupied(order, slot.periodId, slot.spanPeriods ?? 1);
    if (!mine) return ['Double period spans past the end of the day'];

    const people = [slot.teacherPartnerId, slot.substituteTeacherId].filter(Boolean) as string[];
    const roomFilter = slot.teachingRoomId ? { teachingRoomId: slot.teachingRoomId } : slot.room ? { room: slot.room } : null;

    // Every stored slot on that day that shares a teacher, a room or the class.
    const stored = await db.timetableSlot.findMany({
      where: {
        dayOfWeek: slot.dayOfWeek,
        type: { notIn: ['break', 'free'] },
        ...(excludeSlotId ? { id: { not: excludeSlotId } } : {}),
        // A bulk replace deletes this class's grid first; skip it here so the
        // batch is checked against what the grid WILL be, not what it was.
        ...(opts.excludeScope
          ? { NOT: { classId: opts.excludeScope.classId, sectionId: opts.excludeScope.sectionId } }
          : {}),
        OR: [
          ...(people.length ? [{ teacherPartnerId: { in: people } }, { substituteTeacherId: { in: people } }] : []),
          ...(roomFilter ? [roomFilter] : []),
          { classId: slot.classId },
        ],
      },
      select: {
        id: true, classId: true, sectionId: true, periodId: true, spanPeriods: true, cycle: true,
        teacherPartnerId: true, substituteTeacherId: true, teachingRoomId: true, room: true, campusId: true,
      },
    });
    const others: any[] = [
      ...stored,
      ...(opts.pending ?? []).filter((p) => p !== slot && p.dayOfWeek === slot.dayOfWeek && p.type !== 'break' && p.type !== 'free')
        .map((p, i) => ({ ...p, id: `batch#${i + 1}` })),
    ];

    for (const o of others) {
      if (!this.cyclesOverlap(slot.cycle, o.cycle)) continue;
      const theirs = this.occupied(order, o.periodId, o.spanPeriods ?? 1) ?? [o.periodId];
      if (!theirs.some((p) => mine.includes(p))) continue;

      if (slot.teacherPartnerId && o.teacherPartnerId === slot.teacherPartnerId) {
        conflicts.push(`Teacher double-booked (slot ${o.id})`);
      }
      if (slot.teacherPartnerId && o.substituteTeacherId === slot.teacherPartnerId) {
        conflicts.push(`Teacher is already covering another class (slot ${o.id})`);
      }
      if (slot.substituteTeacherId && o.teacherPartnerId === slot.substituteTeacherId) {
        conflicts.push(`Substitute teaches their own class at this time (slot ${o.id})`);
      }
      if (slot.substituteTeacherId && o.substituteTeacherId === slot.substituteTeacherId) {
        conflicts.push(`Substitute is already covering another class (slot ${o.id})`);
      }
      if (roomFilter) {
        const sameRoom = slot.teachingRoomId ? o.teachingRoomId === slot.teachingRoomId : o.room === slot.room;
        if (sameRoom) conflicts.push(`Room double-booked (slot ${o.id})`);
      }
      if (o.classId === slot.classId) {
        const a = slot.sectionId ?? null;
        const b = o.sectionId ?? null;
        // Whole class (null) overlaps every section; two different sections do not.
        if (a === null || b === null || a === b) {
          conflicts.push(`Class already has a lesson at this time (slot ${o.id})`);
        }
      }
    }

    for (const who of people) {
      const unavailable = await db.teacherAvailability.findFirst({
        where: { teacherPartnerId: who, dayOfWeek: slot.dayOfWeek, periodId: { in: mine }, status: 'unavailable' } as any,
      });
      if (unavailable) {
        conflicts.push(
          who === slot.teacherPartnerId
            ? `Teacher unavailable at this period (${unavailable.reason ?? ''})`
            : 'Substitute is unavailable at this period',
        );
      }
    }

    if (slot.teacherPartnerId && (slot.type ?? 'lesson') === 'lesson') {
      const issue = await this.teacherQualificationIssue(db, slot);
      if (issue) conflicts.push(issue);
    }
    return [...new Set(conflicts)];
  }

  /**
   * A lesson's teacher must be employed and allocated to teach it: either on the
   * course offering, or through a teacher assignment for the subject and class.
   */
  private async teacherQualificationIssue(db: any, slot: CreateTimetableSlotDto): Promise<string | null> {
    const staff = await db.staffProfile.findFirst({
      where: { id: slot.teacherPartnerId },
      select: { status: true },
    });
    if (!staff) return 'Teacher not found in this school';
    if (staff.status !== 'active' && staff.status !== 'on_leave') {
      return `Teacher is ${staff.status} and cannot be timetabled`;
    }
    const now = new Date();
    const allocated = slot.courseOfferingId
      ? await db.courseOfferingTeacher.findFirst({
          where: {
            courseOfferingId: slot.courseOfferingId,
            teacherPartnerId: slot.teacherPartnerId,
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
          },
          select: { id: true },
        })
      : null;
    if (allocated) return null;
    const assigned = await db.teacherAssignment.findFirst({
      where: {
        teacherPartnerId: slot.teacherPartnerId,
        subjectId: slot.subjectId,
        classId: slot.classId,
        OR: [{ sectionId: null }, { sectionId: slot.sectionId ?? null }],
      },
      select: { id: true },
    });
    return assigned ? null : 'Teacher is not assigned to teach this subject for this class';
  }

  /* ─────────────────────────────── Writes ─────────────────────────────── */

  /**
   * Every timetable write in an organization is serialized on one advisory
   * lock. Conflict detection is check-then-insert; without the lock two
   * concurrent writes each see a free teacher and both commit.
   */
  private async lockTimetable(tx: any) {
    await tx.$queryRawUnsafe(
      'SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext($1))) l',
      `timetable:${this.tenant.organizationId}`,
    );
  }

  /** Streams are sections (ADR-029); the legacy field is accepted and ignored. */
  private strip<T extends Record<string, any>>(dto: T): Omit<T, 'streamId'> {
    const { streamId: _stream, ...rest } = dto;
    return rest;
  }

  /**
   * Append the class/section's resulting grid to TimetableVersion, stamped with
   * the current term — the timetable's history.
   */
  private async snapshot(tx: any, classId: string, sectionId: string | null, reason: string) {
    await recordTimetableVersion(
      tx,
      { organizationId: this.tenant.organizationId, userId: this.tenant.userId },
      classId,
      sectionId,
      reason,
    );
  }

  async create(dto: CreateTimetableSlotDto): Promise<TimetableSlot> {
    const clean = this.strip(dto) as CreateTimetableSlotDto;
    return this.prisma.client.$transaction(async (tx: any) => {
      await this.lockTimetable(tx);
      let courseOfferingId: string | null = null;
      if (clean.type !== 'break' && clean.type !== 'free') {
        courseOfferingId = await this.resolveCourseOffering(tx, {
          classId: clean.classId,
          sectionId: clean.sectionId ?? null,
          subjectId: clean.subjectId,
          courseOfferingId: clean.courseOfferingId,
        });
        if (!courseOfferingId) {
          throw new BadRequestException('A lesson timetable slot requires a valid course offering. Create the offering first.');
        }
      }
      const conflicts = await this.detectConflicts({ ...clean, courseOfferingId: courseOfferingId ?? undefined }, undefined, { client: tx });
      if (conflicts.length > 0) {
        throw new BadRequestException(`Timetable conflicts: ${conflicts.join('; ')}`);
      }
      const row = await tx.timetableSlot.create({
        data: { ...clean, ...(courseOfferingId ? { courseOfferingId } : {}) },
      });
      await this.snapshot(tx, row.classId, row.sectionId ?? null, 'Slot added');
      return row;
    });
  }

  /**
   * Conflict-checked update. The patch is merged over the stored row first —
   * including span, cycle, room and substitute — because conflict detection
   * needs the RESULTING slot, not just the changed fields.
   */
  async update(id: string, dto: UpdateTimetableSlotDto): Promise<TimetableSlot> {
    const clean = this.strip(dto) as UpdateTimetableSlotDto;
    return this.prisma.client.$transaction(async (tx: any) => {
      await this.lockTimetable(tx);
      const existing = await tx.timetableSlot.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException(`${this.entityName} ${id} not found`);

      const pick = <K extends keyof UpdateTimetableSlotDto>(k: K, fallback: any) =>
        (clean as any)[k] !== undefined ? (clean as any)[k] : fallback;
      const merged: CreateTimetableSlotDto = {
        classId: pick('classId', existing.classId),
        sectionId: pick('sectionId', existing.sectionId ?? undefined),
        dayOfWeek: pick('dayOfWeek', existing.dayOfWeek),
        periodId: pick('periodId', existing.periodId),
        subjectId: pick('subjectId', existing.subjectId),
        teacherPartnerId: pick('teacherPartnerId', existing.teacherPartnerId ?? undefined),
        substituteTeacherId: pick('substituteTeacherId' as any, existing.substituteTeacherId ?? undefined),
        campusId: pick('campusId', existing.campusId ?? undefined),
        room: pick('room', existing.room ?? undefined),
        teachingRoomId: pick('teachingRoomId' as any, existing.teachingRoomId ?? undefined),
        spanPeriods: pick('spanPeriods' as any, existing.spanPeriods),
        cycle: pick('cycle' as any, existing.cycle),
        type: pick('type', existing.type),
        courseOfferingId: undefined,
      };

      let courseOfferingId: string | null = null;
      if (merged.type !== 'break' && merged.type !== 'free') {
        courseOfferingId = await this.resolveCourseOffering(tx, {
          classId: merged.classId,
          sectionId: merged.sectionId ?? null,
          subjectId: merged.subjectId,
          courseOfferingId:
            merged.classId === existing.classId && merged.subjectId === existing.subjectId &&
            (merged.sectionId ?? null) === (existing.sectionId ?? null)
              ? existing.courseOfferingId
              : undefined,
        });
        if (!courseOfferingId) throw new BadRequestException('A lesson timetable slot requires a valid course offering.');
      }
      const conflicts = await this.detectConflicts({ ...merged, courseOfferingId: courseOfferingId ?? undefined }, id, { client: tx });
      if (conflicts.length > 0) {
        throw new BadRequestException(`Timetable conflicts: ${conflicts.join('; ')}`);
      }
      await tx.timetableSlot.updateMany({
        where: { id },
        data: { ...clean, ...(courseOfferingId ? { courseOfferingId } : {}) },
      });
      const row = await tx.timetableSlot.findFirst({ where: { id }, include: this.defaultInclude });
      await this.snapshot(tx, row.classId, row.sectionId ?? null, 'Slot changed');
      if (row.classId !== existing.classId || (row.sectionId ?? null) !== (existing.sectionId ?? null)) {
        await this.snapshot(tx, existing.classId, existing.sectionId ?? null, 'Slot moved to another class');
      }
      return row;
    });
  }

  /**
   * Hard delete of the live slot. `TimetableSlot` has no `deletedAt`; the grid
   * as it stood is preserved in TimetableVersion.
   */
  async remove(id: string): Promise<void> {
    await this.prisma.client.$transaction(async (tx: any) => {
      await this.lockTimetable(tx);
      const existing = await tx.timetableSlot.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException(`${this.entityName} ${id} not found`);
      await tx.timetableSlot.deleteMany({ where: { id } });
      await this.snapshot(tx, existing.classId, existing.sectionId ?? null, 'Slot removed');
    });
  }

  /**
   * Replace a class (or section) grid atomically. The batch is validated as a
   * whole — against the rest of the school AND against itself — before
   * anything is written, and the previous grid survives in TimetableVersion.
   */
  async bulkUpsert(dto: BulkTimetableDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      await this.lockTimetable(tx);
      const sectionId = dto.sectionId ?? null;
      const batch: CreateTimetableSlotDto[] = [];
      for (const raw of dto.slots) {
        const slot = this.strip(raw as any) as any;
        const type = slot.type ?? 'lesson';
        let courseOfferingId: string | null = null;
        if (type === 'lesson') {
          courseOfferingId = await this.resolveCourseOffering(tx, {
            classId: dto.classId,
            sectionId,
            subjectId: slot.subjectId,
            courseOfferingId: slot.courseOfferingId,
          });
          if (!courseOfferingId) throw new BadRequestException(`No course offering for timetable subject ${slot.subjectId}.`);
        }
        batch.push({ ...slot, type, classId: dto.classId, sectionId: sectionId ?? undefined, courseOfferingId: courseOfferingId ?? undefined });
      }

      const blocking: string[] = [];
      for (const slot of batch) {
        const conflicts = await this.detectConflicts(slot, undefined, {
          client: tx,
          pending: batch,
          excludeScope: { classId: dto.classId, sectionId },
        });
        if (conflicts.length > 0) blocking.push(`${slot.dayOfWeek}/${slot.periodId}: ${conflicts.join('; ')}`);
      }
      if (blocking.length > 0) {
        throw new BadRequestException(`Timetable conflicts: ${blocking.join(' | ')}`);
      }

      await tx.timetableSlot.deleteMany({ where: { classId: dto.classId, sectionId } });
      for (const slot of batch) {
        await tx.timetableSlot.create({ data: { ...slot, sectionId } });
      }
      await this.snapshot(tx, dto.classId, sectionId, 'Grid replaced');
      return { count: batch.length };
    });
  }

  /** The recorded versions of a class/section grid, newest first. */
  async history(classId: string, sectionId?: string, termId?: string) {
    return this.prisma.client.timetableVersion.findMany({
      where: { classId, sectionId: sectionId ?? null, ...(termId ? { termId } : {}) },
      orderBy: { version: 'desc' },
    });
  }

  /** The grid as it stood at a moment: the latest version recorded on or before `at`. */
  async asOf(classId: string, sectionId: string | undefined, at: Date) {
    return this.prisma.client.timetableVersion.findFirst({
      where: { classId, sectionId: sectionId ?? null, createdAt: { lte: at } },
      orderBy: { version: 'desc' },
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
    await this.prisma.client.$transaction(async (tx: any) => {
      await tx.timetableSlot.updateMany({
        where: { classId, sectionId: sectionId ?? null },
        data: { published },
      });
      await this.snapshot(tx, classId, sectionId ?? null, published ? 'Published' : 'Unpublished');
    });
    return { published };
  }
}
