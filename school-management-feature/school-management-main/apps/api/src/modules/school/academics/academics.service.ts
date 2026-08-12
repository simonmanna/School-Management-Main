import { Injectable, NotFoundException } from '@nestjs/common';
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
  protected readonly defaultInclude = { subjects: { include: { subject: true } } };

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {
    super(prisma.client.curriculum as unknown as CrudDelegate);
  }

  async create(dto: CreateCurriculumDto): Promise<Curriculum> {
    return this.prisma.client.$transaction(async (tx: any) => {
      const organizationId = this.tenant.organizationId;
      const row = await tx.curriculum.create({
        data: {
          organizationId,
          classId: dto.classId,
          academicYearId: dto.academicYearId,
          name: dto.name,
          description: dto.description ?? null,
          subjects: {
            create: dto.subjects.map((s) => ({
              subjectId: s.subjectId,
              periodsPerWeek: s.periodsPerWeek,
              isCore: s.isCore ?? true,
            })),
          },
        },
        include: { subjects: { include: { subject: true } } },
      });
      await this.audit.recordInTx(tx, { entity: 'Curriculum', entityId: row.id, action: 'create', newValues: row });
      return row;
    });
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
        action: 'publish' as any,
        oldValues: { status: before.status },
        newValues: { status: 'published' },
      });
      this.events.publish(EVENTS.LessonPlanPublished, {
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
      throw new (await import('@nestjs/common')).BadRequestException(`Timetable conflicts: ${conflicts.join('; ')}`);
    }
    return super.create(dto);
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