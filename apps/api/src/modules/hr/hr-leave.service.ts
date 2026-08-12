import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { HrAttendanceService } from './hr-attendance.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const LEAVE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];

function dayStart(d: Date | string): Date {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

/**
 * HrLeaveService — leave types, per-employee annual balances, requests and
 * public holidays. Approving a request deducts the balance and stamps every
 * covered day as ON_LEAVE in attendance.
 */
@Injectable()
export class HrLeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
    private readonly attendance: HrAttendanceService,
  ) {}

  // ── Leave types ──────────────────────────────────────────────────────────

  async listTypes(query: any = {}) {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId };
    const [rows, total] = await Promise.all([
      this.prisma.client.hrLeaveType.findMany({
        where,
        orderBy: [{ name: 'asc' }],
        take: Math.min(Number(query.take ?? 100), 200),
        skip: Number(query.skip ?? 0),
      }),
      this.prisma.client.hrLeaveType.count({ where }),
    ]);
    return { rows, total };
  }

  async createType(dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    if (!dto.code || !dto.name) throw new BadRequestException('code and name are required');
    const existing = await this.prisma.client.hrLeaveType.findUnique({
      where: { organizationId_code: { organizationId: orgId, code: dto.code } },
    });
    if (existing) throw new BadRequestException(`Leave type code "${dto.code}" already exists`);
    return this.prisma.client.hrLeaveType.create({
      data: {
        organizationId: orgId,
        code: String(dto.code).toUpperCase(),
        name: dto.name,
        daysPerYear: dto.daysPerYear ?? 0,
        isPaid: dto.isPaid ?? true,
        carryForwardDays: dto.carryForwardDays ?? 0,
        maxConsecutiveDays: dto.maxConsecutiveDays ?? null,
        isActive: dto.isActive ?? true,
        createdBy: userId,
      },
    });
  }

  async updateType(id: string, dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrLeaveType.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Leave type not found');
    const data: any = {};
    for (const f of ['name', 'daysPerYear', 'isPaid', 'carryForwardDays', 'maxConsecutiveDays', 'isActive']) {
      if (dto[f] !== undefined) data[f] = dto[f];
    }
    data.updatedBy = userId;
    return this.prisma.client.hrLeaveType.update({ where: { id }, data });
  }

  async deleteType(id: string) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrLeaveType.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Leave type not found');
    const used = await this.prisma.client.hrLeaveRequest.count({
      where: { organizationId: orgId, leaveTypeId: id, deletedAt: null },
    });
    if (used > 0)
      throw new BadRequestException('Leave type has requests — deactivate instead of deleting');
    return this.prisma.client.hrLeaveType.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, updatedBy: userId },
    });
  }

  // ── Balances ─────────────────────────────────────────────────────────────

  /** Ensure a balance row exists for (employee, type, year) — upsert on zero. */
  private async ensureBalance(tx: any, employeeId: string, leaveTypeId: string, year: number) {
    const orgId = this.tenant.organizationId;
    const balance = await tx.hrLeaveBalance.findUnique({
      where: {
        organizationId_employeeId_leaveTypeId_year: {
          organizationId: orgId,
          employeeId,
          leaveTypeId,
          year,
        },
      },
    });
    if (balance) return balance;
    const leaveType = await tx.hrLeaveType.findUnique({ where: { id: leaveTypeId } });
    return tx.hrLeaveBalance.create({
      data: {
        organizationId: orgId,
        employeeId,
        leaveTypeId,
        year,
        accruedDays: leaveType?.daysPerYear ?? 0,
      },
    });
  }

  async listBalances(query: any = {}) {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId };
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.year) where.year = Number(query.year);
    const [rows, total] = await Promise.all([
      this.prisma.client.hrLeaveBalance.findMany({
        where,
        orderBy: [{ year: 'desc' }, { createdAt: 'desc' }],
        take: Math.min(Number(query.take ?? 100), 200),
        skip: Number(query.skip ?? 0),
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
          leaveType: true,
        },
      }),
      this.prisma.client.hrLeaveBalance.count({ where }),
    ]);
    return { rows, total };
  }

  /** Grant/revoke manual adjustments to a balance. */
  async adjustBalance(dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    if (!dto.employeeId || !dto.leaveTypeId)
      throw new BadRequestException('employeeId and leaveTypeId are required');
    const year = dto.year ?? new Date().getFullYear();
    return this.prisma.client.$transaction(async (tx: any) => {
      const balance = await this.ensureBalance(tx, dto.employeeId, dto.leaveTypeId, year);
      const adjustedDays = dto.adjustedDays ?? 0;
      return tx.hrLeaveBalance.update({
        where: { id: balance.id },
        data: {
          adjustedDays: balance.adjustedDays + adjustedDays,
          createdBy: userId,
        },
      });
    });
  }

  // ── Requests ─────────────────────────────────────────────────────────────

  async listRequests(query: any = {}) {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId };
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.leaveTypeId) where.leaveTypeId = query.leaveTypeId;
    if (query.status) where.status = query.status;
    if (query.from) where.startDate = { ...(where.startDate ?? {}), gte: dayStart(query.from) };
    const [rows, total] = await Promise.all([
      this.prisma.client.hrLeaveRequest.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        take: Math.min(Number(query.take ?? 50), 200),
        skip: Number(query.skip ?? 0),
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
          leaveType: true,
        },
      }),
      this.prisma.client.hrLeaveRequest.count({ where }),
    ]);
    return { rows, total };
  }

  async createRequest(dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    if (!dto.employeeId || !dto.leaveTypeId || !dto.startDate || !dto.endDate)
      throw new BadRequestException('employeeId, leaveTypeId, startDate and endDate are required');
    const startDate = dayStart(dto.startDate);
    const endDate = dayStart(dto.endDate);
    if (endDate < startDate) throw new BadRequestException('endDate must be after startDate');
    const days = Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
    const requestCode = await this.seq.next('hr_leave_request', { prefix: 'LV-', padding: 6 });
    return this.prisma.client.$transaction(async (tx: any) => {
      const balance = await this.ensureBalance(tx, dto.employeeId, dto.leaveTypeId, startDate.getFullYear());
      const available = Number(balance.accruedDays) + Number(balance.adjustedDays) - Number(balance.usedDays);
      if (dto.checkBalance !== false && available < days) {
        throw new BadRequestException(
          `Insufficient leave balance: ${available} day(s) available, ${days} requested`,
        );
      }
      return tx.hrLeaveRequest.create({
        data: {
          organizationId: orgId,
          requestCode,
          employeeId: dto.employeeId,
          leaveTypeId: dto.leaveTypeId,
          startDate,
          endDate,
          days,
          reason: dto.reason ?? null,
          notes: dto.notes ?? null,
          createdBy: userId,
        },
      });
    });
  }

  async approveRequest(id: string, dto: any = {}) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrLeaveRequest.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!row) throw new NotFoundException('Leave request not found');
    if (row.status !== 'PENDING')
      throw new BadRequestException('Only PENDING requests can be approved');
    return this.prisma.client.$transaction(async (tx: any) => {
      const balance = await this.ensureBalance(tx, row.employeeId, row.leaveTypeId, row.startDate.getFullYear());
      const available = Number(balance.accruedDays) + Number(balance.adjustedDays) - Number(balance.usedDays);
      if (available < Number(row.days)) {
        throw new BadRequestException(
          `Insufficient balance: ${available} day(s) available, ${row.days} on request`,
        );
      }
      const updated = await tx.hrLeaveRequest.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approverId: userId,
          approvedAt: new Date(),
          notes: dto.notes ?? row.notes,
          updatedBy: userId,
        },
      });
      await tx.hrLeaveBalance.update({
        where: { id: balance.id },
        data: { usedDays: Number(balance.usedDays) + Number(row.days) },
      });
      // Stamp each covered day as ON_LEAVE in attendance.
      let cursor = new Date(row.startDate);
      const end = new Date(row.endDate);
      while (cursor <= end) {
        await this.attendance.markLeaveDay(tx, row.employeeId, cursor, row.requestCode);
        cursor.setDate(cursor.getDate() + 1);
      }
      return updated;
    });
  }

  async rejectRequest(id: string, dto: any = {}) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrLeaveRequest.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!row) throw new NotFoundException('Leave request not found');
    if (row.status !== 'PENDING')
      throw new BadRequestException('Only PENDING requests can be rejected');
    return this.prisma.client.hrLeaveRequest.update({
      where: { id },
      data: {
        status: 'REJECTED',
        notes: dto.reason ? `${row.notes ?? ''}\nRejected: ${dto.reason}`.trim() : row.notes,
        updatedBy: userId,
      },
    });
  }

  async cancelRequest(id: string) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrLeaveRequest.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!row) throw new NotFoundException('Leave request not found');
    if (row.status !== 'PENDING' && row.status !== 'APPROVED')
      throw new BadRequestException('Only PENDING/APPROVED requests can be cancelled');
    return this.prisma.client.$transaction(async (tx: any) => {
      const updated = await tx.hrLeaveRequest.update({
        where: { id },
        data: { status: 'CANCELLED', updatedBy: userId },
      });
      if (row.status === 'APPROVED') {
        const balance = await this.ensureBalance(tx, row.employeeId, row.leaveTypeId, row.startDate.getFullYear());
        await tx.hrLeaveBalance.update({
          where: { id: balance.id },
          data: { usedDays: Math.max(0, Number(balance.usedDays) - Number(row.days)) },
        });
      }
      return updated;
    });
  }

  // ── Holidays ─────────────────────────────────────────────────────────────

  async listHolidays(query: any = {}) {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId };
    if (query.year) {
      const from = new Date(Number(query.year), 0, 1);
      const to = new Date(Number(query.year) + 1, 0, 1);
      where.date = { gte: from, lt: to };
    }
    const [rows, total] = await Promise.all([
      this.prisma.client.hrHoliday.findMany({
        where,
        orderBy: [{ date: 'asc' }],
        take: Math.min(Number(query.take ?? 100), 200),
        skip: Number(query.skip ?? 0),
      }),
      this.prisma.client.hrHoliday.count({ where }),
    ]);
    return { rows, total };
  }

  async createHoliday(dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    if (!dto.name || !dto.date) throw new BadRequestException('name and date are required');
    return this.prisma.client.hrHoliday.create({
      data: {
        organizationId: orgId,
        name: dto.name,
        date: dayStart(dto.date),
        isRecurring: dto.isRecurring ?? false,
        createdBy: userId,
      },
    });
  }

  async updateHoliday(id: string, dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrHoliday.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Holiday not found');
    return this.prisma.client.hrHoliday.update({
      where: { id },
      data: {
        name: dto.name ?? row.name,
        date: dto.date ? dayStart(dto.date) : row.date,
        isRecurring: dto.isRecurring ?? row.isRecurring,
        updatedBy: userId,
      },
    });
  }

  async deleteHoliday(id: string) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrHoliday.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Holiday not found');
    return this.prisma.client.hrHoliday.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: userId },
    });
  }
}
