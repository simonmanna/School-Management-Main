import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Invigilator } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { CreateInvigilatorDto, UpdateInvigilatorDto, AssignInvigilatorDto } from './invigilator.dto';

/**
 * P0-B: invigilator roster + assignment.
 *
 * Schools maintain a pool of invigilators (teachers and/or external staff) and
 * assign them to exam sittings (ExamSchedule). Assignments feed the clash check
 * already implemented in ExamScheduleService.create (INVIGILATOR_CLASH) — that
 * guard kicks in when an invigilatorId is set directly on a schedule, so we
 * additionally guard here against double-booking an invigilator across
 * different schedules sharing the same date + start time.
 */
@Injectable()
export class InvigilatorService extends BaseCrudService<Invigilator, CreateInvigilatorDto, UpdateInvigilatorDto> {
  protected readonly entityName = 'Invigilator';
  protected readonly searchFields = ['name', 'note'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {
    super(prisma.client.invigilator as unknown as CrudDelegate);
  }

  /** List invigilators, optionally filtering by active status. */
  async list(q: PaginationDto) {
    return super.list(q);
  }

  /** Assign an invigilator to an exam schedule, refusing a double-booking. */
  async assign(dto: AssignInvigilatorDto) {
    const organizationId = this.tenant.organizationId;
    const schedule = await this.prisma.client.examSchedule.findFirst({
      where: { id: dto.examScheduleId },
    });
    if (!schedule) throw new NotFoundException(`ExamSchedule ${dto.examScheduleId} not found`);
    const invigilator = await this.prisma.client.invigilator.findFirst({
      where: { id: dto.invigilatorId },
    });
    if (!invigilator) throw new NotFoundException(`Invigilator ${dto.invigilatorId} not found`);

    // Clash: same invigilator, same date + start time, different schedule.
    const clash = await this.prisma.client.examSchedule.findFirst({
      where: {
        date: schedule.date,
        startTime: schedule.startTime,
        invigilatorId: dto.invigilatorId,
        NOT: { id: dto.examScheduleId },
      },
    });
    if (clash) {
      throw new BadRequestException({
        message: 'Invigilator clash',
        conflicts: [{ code: 'INVIGILATOR_CLASH', detail: `invigilator busy at ${schedule.startTime} on ${schedule.date}` }],
      });
    }

    // Also set the schedule's own invigilatorId (drives ExamScheduleService guard).
    await this.prisma.client.examSchedule.updateMany({
      where: { id: dto.examScheduleId },
      data: { invigilatorId: dto.invigilatorId },
    });

    const assignment = await this.prisma.client.invigilatorAssignment.upsert({
      where: { examScheduleId_invigilatorId: { examScheduleId: dto.examScheduleId, invigilatorId: dto.invigilatorId } },
      create: { organizationId, examScheduleId: dto.examScheduleId, invigilatorId: dto.invigilatorId },
      update: {},
    });
    await this.audit.record({
      entity: 'InvigilatorAssignment',
      entityId: assignment.id,
      action: 'create',
      newValues: { examScheduleId: dto.examScheduleId, invigilatorId: dto.invigilatorId },
    });
    return assignment;
  }

  /** Remove an invigilator from a schedule (clears schedule.invigilatorId too). */
  async unassign(examScheduleId: string, invigilatorId: string) {
    await this.prisma.client.invigilatorAssignment.deleteMany({
      where: { examScheduleId, invigilatorId },
    });
    const remaining = await this.prisma.client.invigilatorAssignment.findFirst({
      where: { examScheduleId },
    });
    if (!remaining) {
      await this.prisma.client.examSchedule.updateMany({
        where: { id: examScheduleId },
        data: { invigilatorId: null },
      });
    }
    return { ok: true };
  }

  /** Invigilators assigned to a given schedule. */
  async bySchedule(examScheduleId: string) {
    return this.prisma.client.invigilatorAssignment.findMany({
      where: { examScheduleId },
      include: { invigilator: true },
    });
  }
}
