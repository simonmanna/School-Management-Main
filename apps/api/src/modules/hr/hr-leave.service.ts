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
import { dec, ZERO, type Money } from '../../kernel/common/money';
import { EventOutboxService } from '../../kernel/events/event-outbox.service';
import { EVENTS } from '@erp/shared';

/* eslint-disable @typescript-eslint/no-explicit-any */

const LEAVE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];
const ACCRUAL_METHODS = ['ANNUAL_UPFRONT', 'MONTHLY', 'NONE'];

/**
 * Leave days are Decimal(10,2) (half-days are real). Decimal arithmetic only:
 * `decimalBalance + jsNumber` STRING-CONCATENATES in JS — adjusting a balance
 * of 5 by 2 produced "52", which Prisma then wrote as 52 days.
 */
function availableDays(b: { accruedDays: any; adjustedDays: any; usedDays: any }): Money {
  return dec(b.accruedDays).plus(dec(b.adjustedDays)).minus(dec(b.usedDays));
}

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
    private readonly outbox: EventOutboxService,
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
    if (dto.accrualMethod && !ACCRUAL_METHODS.includes(dto.accrualMethod))
      throw new BadRequestException(`accrualMethod must be one of ${ACCRUAL_METHODS.join(', ')}`);
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
        // ANNUAL_UPFRONT preserves the historical behaviour for any caller that
        // does not state a method.
        accrualMethod: dto.accrualMethod ?? 'ANNUAL_UPFRONT',
        accrualStartsAfterMonths: dto.accrualStartsAfterMonths ?? 0,
        carryForwardExpiryMonths: dto.carryForwardExpiryMonths ?? null,
        maxBalanceDays: dto.maxBalanceDays ?? null,
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
    if (dto.accrualMethod && !ACCRUAL_METHODS.includes(dto.accrualMethod))
      throw new BadRequestException(`accrualMethod must be one of ${ACCRUAL_METHODS.join(', ')}`);
    for (const f of [
      'name', 'daysPerYear', 'isPaid', 'carryForwardDays', 'maxConsecutiveDays', 'isActive',
      'accrualMethod', 'accrualStartsAfterMonths', 'carryForwardExpiryMonths', 'maxBalanceDays',
    ]) {
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
    // Only an ANNUAL_UPFRONT type is entitled to the whole year on day one.
    // A MONTHLY type earns its days month by month through
    // HrLeaveAccrualService, and seeding the full entitlement here would let an
    // employee take a year's leave in January and then resign. A NONE type is
    // granted case by case and starts at nothing by definition.
    //
    // Any accrual already recorded in the ledger wins over both: this row is a
    // cache of that ledger, so it must never be created disagreeing with it.
    const accrued = await tx.hrLeaveAccrual.findMany({
      where: { organizationId: orgId, employeeId, leaveTypeId, year },
      select: { days: true },
    });
    const fromLedger = accrued.reduce((a: Money, r: any) => a.plus(dec(r.days)), ZERO);
    const seed = accrued.length > 0
      ? fromLedger
      : (leaveType?.accrualMethod ?? 'ANNUAL_UPFRONT') === 'ANNUAL_UPFRONT'
        ? dec(leaveType?.daysPerYear ?? 0)
        : ZERO;
    return tx.hrLeaveBalance.create({
      data: {
        organizationId: orgId,
        employeeId,
        leaveTypeId,
        year,
        accruedDays: seed,
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
      const delta = dec(dto.adjustedDays ?? 0);
      const updated = await tx.hrLeaveBalance.update({
        where: { id: balance.id },
        data: {
          adjustedDays: dec(balance.adjustedDays).plus(delta),
          createdBy: userId,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'HrLeaveBalance',
        entityId: balance.id,
        action: 'adjust',
        oldValues: { adjustedDays: String(balance.adjustedDays) },
        newValues: {
          adjustedDays: String(updated.adjustedDays),
          delta: delta.toString(),
          employeeId: dto.employeeId,
          leaveTypeId: dto.leaveTypeId,
          year,
          notes: dto.notes ?? null,
        },
      });
      return updated;
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
      const available = availableDays(balance);
      if (dto.checkBalance !== false && available.lessThan(days)) {
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
      const available = availableDays(balance);
      if (available.lessThan(dec(row.days))) {
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
        data: { usedDays: dec(balance.usedDays).plus(dec(row.days)) },
      });
      // Stamp each covered day as ON_LEAVE in attendance.
      const cursor = new Date(row.startDate);
      const end = new Date(row.endDate);
      while (cursor <= end) {
        await this.attendance.markLeaveDay(tx, row.employeeId, cursor, row.requestCode);
        cursor.setDate(cursor.getDate() + 1);
      }
      // Published INSIDE the transaction (EventOutboxService, not EventBus):
      // approved leave is a recorded fact the timetable acts on, so it must not
      // survive a rollback. The school vertical subscribes to project it into
      // TeacherAvailability — HR must not import school code (ADR-011).
      await this.outbox.publish(tx, EVENTS.HrLeaveApproved, {
        organizationId: orgId,
        leaveRequestId: id,
        employeeId: row.employeeId,
        staffProfileId: await this.staffProfileIdFor(tx, row.employeeId),
        startDate: new Date(row.startDate).toISOString(),
        endDate: new Date(row.endDate).toISOString(),
      });

      await this.audit.recordInTx(tx, {
        entity: 'HrLeaveRequest',
        entityId: id,
        action: 'approve',
        oldValues: { status: row.status },
        newValues: {
          status: 'APPROVED',
          employeeId: row.employeeId,
          leaveTypeId: row.leaveTypeId,
          days: String(row.days),
          startDate: row.startDate,
          endDate: row.endDate,
        },
      });
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
    return this.prisma.client.$transaction(async (tx: any) => {
      const updated = await tx.hrLeaveRequest.update({
        where: { id },
        data: {
          status: 'REJECTED',
          notes: dto.reason ? `${row.notes ?? ''}\nRejected: ${dto.reason}`.trim() : row.notes,
          updatedBy: userId,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'HrLeaveRequest',
        entityId: id,
        action: 'reject',
        oldValues: { status: row.status },
        newValues: { status: 'REJECTED', reason: dto.reason ?? null },
      });
      return updated;
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
          data: { usedDays: (() => {
            const back = dec(balance.usedDays).minus(dec(row.days));
            return back.greaterThan(ZERO) ? back : ZERO;
          })() },
        });
      }
      if (row.status === 'APPROVED') {
        // Only a previously-approved request had a timetable effect to undo.
        await this.outbox.publish(tx, EVENTS.HrLeaveCancelled, {
          organizationId: orgId,
          leaveRequestId: id,
          employeeId: row.employeeId,
          staffProfileId: await this.staffProfileIdFor(tx, row.employeeId),
          startDate: new Date(row.startDate).toISOString(),
          endDate: new Date(row.endDate).toISOString(),
        });
      }

      await this.audit.recordInTx(tx, {
        entity: 'HrLeaveRequest',
        entityId: id,
        action: 'cancel',
        oldValues: { status: row.status, days: String(row.days) },
        newValues: { status: 'CANCELLED', balanceRestored: row.status === 'APPROVED' },
      });
      return updated;
    });
  }

  /**
   * The school-side staff profile for an HR employee, via the Partner bridge.
   * Null when the employee is not bridged — the subscriber then has nothing to
   * project, which is correct rather than an error.
   */
  private async staffProfileIdFor(tx: any, employeeId: string): Promise<string | null> {
    const employee = await tx.hrEmployee.findFirst({
      where: { id: employeeId },
      select: { partnerId: true },
    });
    if (!employee?.partnerId) return null;
    const profile = await tx.staffProfile.findFirst({
      where: { partnerId: employee.partnerId, deletedAt: null },
      select: { id: true },
    });
    return profile?.id ?? null;
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
