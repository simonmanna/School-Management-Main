import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ExamVenue } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { PlacementLookupService } from '../enrollment/placement-lookup.service';
import type {
  AllocateSeatsDto,
  CreateExamVenueDto,
  RegisterCandidatesDto,
  UpdateExamRegistrationDto,
  UpdateExamVenueDto,
} from './exam-ops.dto';

@Injectable()
export class ExamVenueService extends BaseCrudService<ExamVenue, CreateExamVenueDto, UpdateExamVenueDto> {
  protected readonly entityName = 'ExamVenue';
  protected readonly searchFields = ['name', 'code'];
  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.examVenue as unknown as CrudDelegate);
  }
}

/**
 * Exam registration + seating (A4). Candidates are real rows (ExamRegistration),
 * not entries in the legacy Exam.classes JSON. Registration, seat allocation and
 * clash detection all read/write these rows.
 */
@Injectable()
export class ExamRegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly placements: PlacementLookupService,
  ) {}

  /** Register every active student in a class for an exam. Idempotent. */
  async registerClass(examId: string, classId: string) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const exam = await tx.exam.findFirst({ where: { id: examId } });
      if (!exam) throw new NotFoundException(`Exam ${examId} not found`);
      // Candidates are the learners placed in the class (ADR-027), not the
      // projection on StudentProfile.
      const studentsInClass = await tx.studentProfile.findMany({
        where: { status: 'active', ...this.placements.studentWhere({ classIds: [classId] }) },
      });
      let created = 0;
      for (const s of studentsInClass) {
        const existing = await tx.examRegistration.findFirst({ where: { examId, studentProfileId: s.id } });
        if (existing) continue;
        await tx.examRegistration.create({
          data: { organizationId, examId, studentProfileId: s.id, classId, status: 'registered' },
        });
        created += 1;
      }
      await this.audit.recordInTx(tx, {
        entity: 'ExamRegistration',
        entityId: examId,
        action: 'create',
        newValues: { action: 'register_class', classId, created },
      });
      return { examId, classId, created, total: studentsInClass.length };
    });
  }

  async register(dto: RegisterCandidatesDto) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const rows = [];
      for (const studentProfileId of dto.studentProfileIds) {
        const row = await tx.examRegistration.upsert({
          where: { examId_studentProfileId: { examId: dto.examId, studentProfileId } },
          create: { organizationId, examId: dto.examId, studentProfileId, classId: dto.classId ?? null, status: 'registered' },
          update: { classId: dto.classId ?? undefined },
        });
        rows.push(row);
      }
      return { count: rows.length };
    });
  }

  async updateStatus(id: string, dto: UpdateExamRegistrationDto) {
    const res = await this.prisma.client.examRegistration.updateMany({
      where: { id },
      data: { status: dto.status, ...(dto.venueId !== undefined ? { venueId: dto.venueId } : {}), ...(dto.seatNumber !== undefined ? { seatNumber: dto.seatNumber } : {}) },
    });
    if (res.count === 0) throw new NotFoundException(`ExamRegistration ${id} not found`);
    return this.prisma.client.examRegistration.findFirst({ where: { id } });
  }

  /**
   * Allocate seats in a venue to an exam's yet-unseated candidates, sequentially
   * (A1, A2, …), refusing to exceed the venue capacity.
   */
  async allocateSeats(dto: AllocateSeatsDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const venue = await tx.examVenue.findFirst({ where: { id: dto.venueId } });
      if (!venue) throw new NotFoundException(`ExamVenue ${dto.venueId} not found`);
      const alreadyInVenue = await tx.examRegistration.count({ where: { examId: dto.examId, venueId: dto.venueId } });
      const unseated = await tx.examRegistration.findMany({
        where: { examId: dto.examId, venueId: null },
        orderBy: { createdAt: 'asc' },
      });
      const room = venue.capacity - alreadyInVenue;
      if (room <= 0) throw new BadRequestException(`Venue ${venue.name} is full (${venue.capacity})`);
      const toSeat = unseated.slice(0, room);
      let seat = alreadyInVenue;
      for (const reg of toSeat) {
        seat += 1;
        await tx.examRegistration.updateMany({ where: { id: reg.id }, data: { venueId: dto.venueId, seatNumber: `A${seat}` } });
      }
      return { venue: venue.name, seated: toSeat.length, remainingUnseated: unseated.length - toSeat.length };
    });
  }

  async byExam(examId: string) {
    return this.prisma.client.examRegistration.findMany({
      where: { examId },
      orderBy: [{ venueId: 'asc' }, { seatNumber: 'asc' }],
    });
  }

  /**
   * Detect venue / invigilator double-booking at the same date + start time.
   * Returns structured conflicts (empty = clear). Used by the schedule create
   * guard and exposed for a pre-check.
   */
  async checkScheduleClashes(dto: { date: string; startTime: string; venueId?: string; invigilatorId?: string; excludeScheduleId?: string }) {
    const day = new Date(dto.date);
    const start = new Date(day); start.setHours(0, 0, 0, 0);
    const end = new Date(day); end.setHours(23, 59, 59, 999);
    const conflicts: Array<{ code: string; detail: string; scheduleId: string }> = [];

    const sameSlot = await this.prisma.client.examSchedule.findMany({
      where: {
        date: { gte: start, lte: end },
        startTime: dto.startTime,
        ...(dto.excludeScheduleId ? { id: { not: dto.excludeScheduleId } } : {}),
      },
    });
    for (const s of sameSlot) {
      if (dto.venueId && s.venueId === dto.venueId) {
        conflicts.push({ code: 'VENUE_CLASH', detail: `venue already booked at ${dto.startTime}`, scheduleId: s.id });
      }
      if (dto.invigilatorId && s.invigilatorId === dto.invigilatorId) {
        conflicts.push({ code: 'INVIGILATOR_CLASH', detail: `invigilator already assigned at ${dto.startTime}`, scheduleId: s.id });
      }
    }
    return conflicts;
  }
}
