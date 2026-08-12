import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';
import { AuditService } from '../../kernel/audit/audit.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TIMESHEET_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'];
const WORK_TYPES = [
  'REPAIR', 'HOTEL', 'SCHOOL', 'RENTAL', 'CLEANING',
  'MANUFACTURING', 'PROJECT', 'CUSTOMER', 'OTHER',
];
const LINKED_TYPES = ['Task', 'RepairOrder'];

/**
 * HrTimesheetService — weekly/bi-weekly timesheets with per-day entries.
 * Entries can link to existing Task / RepairOrder rows (repair work feeds
 * time), and approved entries roll into payroll as billable hours.
 */
@Injectable()
export class HrTimesheetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
  ) {}

  async list(query: any = {}) {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId };
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.status) where.status = query.status;
    const [rows, total] = await Promise.all([
      this.prisma.client.hrTimesheet.findMany({
        where,
        orderBy: [{ periodStart: 'desc' }],
        take: Math.min(Number(query.take ?? 50), 200),
        skip: Number(query.skip ?? 0),
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
          _count: { select: { entries: true } },
        },
      }),
      this.prisma.client.hrTimesheet.count({ where }),
    ]);
    return { rows, total };
  }

  async get(id: string) {
    const orgId = this.tenant.organizationId;
    const row = await this.prisma.client.hrTimesheet.findFirst({
      where: { id, organizationId: orgId },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        entries: { orderBy: { date: 'asc' } },
      },
    });
    if (!row) throw new NotFoundException('Timesheet not found');
    return row;
  }

  async create(dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    if (!dto.employeeId || !dto.periodStart || !dto.periodEnd)
      throw new BadRequestException('employeeId, periodStart and periodEnd are required');
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    if (periodEnd < periodStart) throw new BadRequestException('periodEnd must be after periodStart');
    const timesheetCode = await this.seq.next('hr_timesheet', { prefix: 'TS-', padding: 6 });
    return this.prisma.client.hrTimesheet.create({
      data: {
        organizationId: orgId,
        timesheetCode,
        employeeId: dto.employeeId,
        periodStart,
        periodEnd,
        status: 'DRAFT',
        notes: dto.notes ?? null,
        createdBy: userId,
      },
    });
  }

  async update(id: string, dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrTimesheet.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Timesheet not found');
    if (row.status !== 'DRAFT' && row.status !== 'REJECTED')
      throw new BadRequestException('Only DRAFT/REJECTED timesheets can be edited');
    return this.prisma.client.hrTimesheet.update({
      where: { id },
      data: {
        periodStart: dto.periodStart ? new Date(dto.periodStart) : row.periodStart,
        periodEnd: dto.periodEnd ? new Date(dto.periodEnd) : row.periodEnd,
        notes: dto.notes ?? row.notes,
        updatedBy: userId,
      },
    });
  }

  async submit(id: string) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrTimesheet.findFirst({
      where: { id, organizationId: orgId },
      include: { _count: { select: { entries: true } } },
    });
    if (!row) throw new NotFoundException('Timesheet not found');
    if (row.status !== 'DRAFT' && row.status !== 'REJECTED')
      throw new BadRequestException('Only DRAFT/REJECTED timesheets can be submitted');
    if (row._count.entries === 0)
      throw new BadRequestException('Add at least one entry before submitting');
    return this.prisma.client.hrTimesheet.update({
      where: { id },
      data: { status: 'SUBMITTED', submittedAt: new Date(), updatedBy: userId },
    });
  }

  async approve(id: string) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrTimesheet.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Timesheet not found');
    if (row.status !== 'SUBMITTED')
      throw new BadRequestException('Only SUBMITTED timesheets can be approved');
    return this.prisma.client.hrTimesheet.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date(), updatedBy: userId },
    });
  }

  async reject(id: string, dto: any = {}) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrTimesheet.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Timesheet not found');
    if (row.status !== 'SUBMITTED')
      throw new BadRequestException('Only SUBMITTED timesheets can be rejected');
    return this.prisma.client.hrTimesheet.update({
      where: { id },
      data: {
        status: 'REJECTED',
        notes: dto.reason ? `${row.notes ?? ''}\nRejected: ${dto.reason}`.trim() : row.notes,
        updatedBy: userId,
      },
    });
  }

  async delete(id: string) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrTimesheet.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Timesheet not found');
    if (row.status === 'APPROVED')
      throw new BadRequestException('Approved timesheets cannot be deleted');
    return this.prisma.client.hrTimesheet.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: userId },
    });
  }

  // ── Entries ──────────────────────────────────────────────────────────────

  async addEntry(timesheetId: string, dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const ts = await this.prisma.client.hrTimesheet.findFirst({
      where: { id: timesheetId, organizationId: orgId },
    });
    if (!ts) throw new NotFoundException('Timesheet not found');
    if (ts.status !== 'DRAFT' && ts.status !== 'REJECTED')
      throw new BadRequestException('Only DRAFT/REJECTED timesheets accept entries');
    if (!dto.date || !dto.startAt || !dto.endAt)
      throw new BadRequestException('date, startAt and endAt are required');
    if (dto.workType && !WORK_TYPES.includes(dto.workType))
      throw new BadRequestException(`Invalid workType: ${dto.workType}`);
    if (dto.linkedEntityType && !LINKED_TYPES.includes(dto.linkedEntityType))
      throw new BadRequestException(`Invalid linkedEntityType: ${dto.linkedEntityType}`);
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (endAt <= startAt) throw new BadRequestException('endAt must be after startAt');
    const minutes = Math.round((endAt.getTime() - startAt.getTime()) / 60000);
    const entry = await this.prisma.client.hrTimesheetEntry.create({
      data: {
        organizationId: orgId,
        timesheetId,
        date: new Date(dto.date),
        startAt,
        endAt,
        minutes,
        workType: dto.workType ?? 'OTHER',
        description: dto.description ?? null,
        linkedEntityType: dto.linkedEntityType ?? null,
        linkedEntityId: dto.linkedEntityId ?? null,
        isBillable: dto.isBillable ?? false,
        createdBy: userId,
      },
    });
    await this.recomputeTotal(timesheetId);
    return entry;
  }

  async updateEntry(entryId: string, dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const entry = await this.prisma.client.hrTimesheetEntry.findFirst({
      where: { id: entryId, organizationId: orgId },
    });
    if (!entry) throw new NotFoundException('Entry not found');
    const ts = await this.prisma.client.hrTimesheet.findFirst({
      where: { id: entry.timesheetId, organizationId: orgId },
    });
    if (ts && ts.status !== 'DRAFT' && ts.status !== 'REJECTED')
      throw new BadRequestException('Only DRAFT/REJECTED timesheets accept entry edits');
    if (dto.workType && !WORK_TYPES.includes(dto.workType))
      throw new BadRequestException(`Invalid workType: ${dto.workType}`);
    const data: any = {};
    if (dto.date !== undefined) data.date = new Date(dto.date);
    if (dto.startAt !== undefined || dto.endAt !== undefined) {
      const startAt = dto.startAt ? new Date(dto.startAt) : entry.startAt;
      const endAt = dto.endAt ? new Date(dto.endAt) : entry.endAt;
      if (endAt <= startAt) throw new BadRequestException('endAt must be after startAt');
      data.startAt = startAt;
      data.endAt = endAt;
      data.minutes = Math.round((endAt.getTime() - startAt.getTime()) / 60000);
    }
    if (dto.workType !== undefined) data.workType = dto.workType;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.linkedEntityType !== undefined) data.linkedEntityType = dto.linkedEntityType;
    if (dto.linkedEntityId !== undefined) data.linkedEntityId = dto.linkedEntityId;
    if (dto.isBillable !== undefined) data.isBillable = dto.isBillable;
    data.updatedBy = userId;
    const updated = await this.prisma.client.hrTimesheetEntry.update({ where: { id: entryId }, data });
    await this.recomputeTotal(entry.timesheetId);
    return updated;
  }

  async deleteEntry(entryId: string) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const entry = await this.prisma.client.hrTimesheetEntry.findFirst({
      where: { id: entryId, organizationId: orgId },
    });
    if (!entry) throw new NotFoundException('Entry not found');
    const ts = await this.prisma.client.hrTimesheet.findFirst({
      where: { id: entry.timesheetId, organizationId: orgId },
    });
    if (ts && ts.status !== 'DRAFT' && ts.status !== 'REJECTED')
      throw new BadRequestException('Only DRAFT/REJECTED timesheets accept entry edits');
    await this.prisma.client.hrTimesheetEntry.update({
      where: { id: entryId },
      data: { deletedAt: new Date(), updatedBy: userId },
    });
    await this.recomputeTotal(entry.timesheetId);
  }

  private async recomputeTotal(timesheetId: string) {
    const agg = await this.prisma.client.hrTimesheetEntry.aggregate({
      where: { timesheetId, deletedAt: null },
      _sum: { minutes: true },
    });
    await this.prisma.client.hrTimesheet.update({
      where: { id: timesheetId },
      data: { totalMinutes: agg._sum.minutes ?? 0 },
    });
  }
}
