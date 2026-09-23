import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { EventBus } from '../../kernel/events/event-bus';
import { EVENTS } from '@erp/shared';
import { PostingService } from '../accounting/posting/posting.service';
import { AccountDeterminationService } from '../accounting/posting/account-determination.service';
import { dec, round, sum, ZERO, type Money } from '../../kernel/common/money';
import { Prisma } from '@prisma/client';

const MS_PER_DAY = 86_400_000;
/** A calendar day at UTC midnight — payroll date arithmetic is calendar arithmetic. */
function utcDay(d: Date | string): Date {
  const dt = d instanceof Date ? d : new Date(d);
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
}
/** Days from `from` to `to`, both inclusive. */
function daysBetween(from: Date, to: Date): number {
  const n = Math.round((utcDay(to).getTime() - utcDay(from).getTime()) / MS_PER_DAY) + 1;
  return n > 0 ? n : 0;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

const CONTRACT_TYPES = [
  'permanent', 'fixed_term', 'probation', 'temporary', 'casual', 'part_time', 'contractor', 'internship',
];
const CONTRACT_STATUSES = ['draft', 'pending', 'active', 'expiring', 'expired', 'terminated'];
const OFFBOARD_REASONS = [
  'resignation', 'termination', 'retirement', 'contract_expiry', 'redundancy', 'death', 'dismissal',
];
const ACTION_TYPES = [
  'promotion', 'demotion', 'transfer', 'grade_change', 'salary_change', 'manager_change', 'campus_transfer',
];
const ONBOARD_STATUSES = ['pending', 'done'];

/**
 * HrLifecycleService — employee lifecycle over the existing payroll primitives.
 *  - Job grades + salary structures (configurable pay per grade/component).
 *  - Salary change history (append-only, audited).
 *  - Employment actions (promotion/transfer/grade/salary/manager changes).
 *  - Contracts (draft→active→expiring/expired/terminated) with expiring alerts.
 *  - Onboarding checklist.
 *  - Offboarding + final settlement (routed through the final payroll run:
 *    pro-rated salary, taxed leave encashment, full loan/advance recovery).
 */
@Injectable()
export class HrLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly accounts: AccountDeterminationService,
    private readonly events: EventBus,
  ) {}

  private num(v: any): number {
    return v == null ? 0 : Number(v);
  }

  // ── Job grades ──────────────────────────────────────────────────────────

  async listGrades(query: any = {}) {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId };
    if (query.search) {
      where.OR = [
        { code: { contains: query.search, mode: 'insensitive' } },
        { name: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.client.hrJobGrade.findMany({
        where,
        orderBy: [{ name: 'asc' }],
        include: { _count: { select: { structures: true, positions: true } } },
      }),
      this.prisma.client.hrJobGrade.count({ where }),
    ]);
    return { rows, total };
  }

  async getGrade(id: string) {
    const orgId = this.tenant.organizationId;
    const row = await this.prisma.client.hrJobGrade.findFirst({
      where: { id, organizationId: orgId },
      include: { structures: { include: { component: true } }, positions: true },
    });
    if (!row) throw new NotFoundException('Job grade not found');
    return row;
  }

  async createGrade(dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    if (!dto.code || !dto.name) throw new BadRequestException('code and name are required');
    const existing = await this.prisma.client.hrJobGrade.findUnique({
      where: { organizationId_code: { organizationId: orgId, code: String(dto.code).toUpperCase() } },
    });
    if (existing) throw new BadRequestException(`Grade code "${dto.code}" already exists`);
    return this.prisma.client.hrJobGrade.create({
      data: {
        organizationId: orgId,
        code: String(dto.code).toUpperCase(),
        name: dto.name,
        minSalary: dto.minSalary ?? null,
        midSalary: dto.midSalary ?? null,
        maxSalary: dto.maxSalary ?? null,
        isActive: dto.isActive ?? true,
        createdBy: userId,
      },
    });
  }

  async updateGrade(id: string, dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrJobGrade.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Job grade not found');
    return this.prisma.client.hrJobGrade.update({
      where: { id },
      data: {
        name: dto.name ?? row.name,
        minSalary: dto.minSalary !== undefined ? dto.minSalary : row.minSalary,
        midSalary: dto.midSalary !== undefined ? dto.midSalary : row.midSalary,
        maxSalary: dto.maxSalary !== undefined ? dto.maxSalary : row.maxSalary,
        isActive: dto.isActive ?? row.isActive,
        updatedBy: userId,
      },
    });
  }

  async deleteGrade(id: string) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrJobGrade.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Job grade not found');
    const used = await this.prisma.client.hrPosition.count({ where: { organizationId: orgId, gradeId: id } });
    if (used > 0) throw new BadRequestException('Grade still assigned to positions');
    return this.prisma.client.hrJobGrade.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: userId } });
  }

  // ── Salary structures ─────────────────────────────────────────────────────

  async listStructures(query: any = {}) {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId };
    if (query.gradeId) where.gradeId = query.gradeId;
    const [rows, total] = await Promise.all([
      this.prisma.client.hrSalaryStructure.findMany({
        where,
        orderBy: [{ gradeId: 'asc' }],
        include: { grade: true, component: true },
      }),
      this.prisma.client.hrSalaryStructure.count({ where }),
    ]);
    return { rows, total };
  }

  async createStructure(dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    if (!dto.gradeId || !dto.componentId) throw new BadRequestException('gradeId and componentId are required');
    const grade = await this.prisma.client.hrJobGrade.findFirst({ where: { id: dto.gradeId, organizationId: orgId } });
    if (!grade) throw new NotFoundException('Job grade not found');
    const comp = await this.prisma.client.hrPayrollComponent.findFirst({ where: { id: dto.componentId, organizationId: orgId } });
    if (!comp) throw new NotFoundException('Payroll component not found');
    const existing = await this.prisma.client.hrSalaryStructure.findUnique({
      where: { organizationId_gradeId_componentId: { organizationId: orgId, gradeId: dto.gradeId, componentId: dto.componentId } },
    });
    if (existing) throw new BadRequestException('Structure for this grade+component already exists');
    return this.prisma.client.hrSalaryStructure.create({
      data: {
        organizationId: orgId,
        gradeId: dto.gradeId,
        componentId: dto.componentId,
        amount: dto.amount ?? null,
        rate: dto.rate ?? null,
        isActive: dto.isActive ?? true,
        createdBy: userId,
      },
      include: { grade: true, component: true },
    });
  }

  async updateStructure(id: string, dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrSalaryStructure.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Salary structure not found');
    return this.prisma.client.hrSalaryStructure.update({
      where: { id },
      data: {
        amount: dto.amount !== undefined ? dto.amount : row.amount,
        rate: dto.rate !== undefined ? dto.rate : row.rate,
        isActive: dto.isActive ?? row.isActive,
        updatedBy: userId,
      },
      include: { grade: true, component: true },
    });
  }

  async deleteStructure(id: string) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrSalaryStructure.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Salary structure not found');
    return this.prisma.client.hrSalaryStructure.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: userId } });
  }

  // ── Salary change history (append-only) ───────────────────────────────────

  async listSalaryHistory(employeeId: string) {
    const orgId = this.tenant.organizationId;
    return this.prisma.client.hrSalaryChange.findMany({
      where: { organizationId: orgId, employeeId },
      orderBy: [{ effectiveDate: 'desc' }],
    });
  }

  /**
   * Records a salary change + an employment action, reusing the same
   * transaction. Called from `HrOrgService.updateEmployee` whenever
   * `baseSalary` actually changes.
   */
  async recordSalaryChange(
    tx: any,
    employeeId: string,
    prev: Prisma.Decimal.Value,
    next: Prisma.Decimal.Value,
    reason: string,
    changedById?: string,
  ) {
    const orgId = this.tenant.organizationId;
    await tx.hrSalaryChange.create({
      data: {
        organizationId: orgId,
        employeeId,
        effectiveDate: new Date(),
        previousAmount: dec(prev),
        newAmount: dec(next),
        reason,
        changedById: changedById ?? null,
        createdBy: changedById ?? null,
      },
    });
    await tx.hrEmploymentAction.create({
      data: {
        organizationId: orgId,
        employeeId,
        actionType: 'salary_change',
        fromValue: String(prev),
        toValue: String(next),
        effectiveDate: new Date(),
        reason,
        changedById: changedById ?? null,
        createdBy: changedById ?? null,
      },
    });
  }

  // ── Employment actions ────────────────────────────────────────────────────

  async listActions(employeeId: string) {
    const orgId = this.tenant.organizationId;
    return this.prisma.client.hrEmploymentAction.findMany({
      where: { organizationId: orgId, employeeId },
      orderBy: [{ effectiveDate: 'desc' }],
    });
  }

  // ── Contracts ─────────────────────────────────────────────────────────────

  async listContracts(query: any = {}) {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId };
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.status) where.status = query.status;
    const [rows, total] = await Promise.all([
      this.prisma.client.hrContract.findMany({
        where,
        orderBy: [{ startDate: 'desc' }],
        include: { employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } } },
      }),
      this.prisma.client.hrContract.count({ where }),
    ]);
    return { rows, total };
  }

  /** Contracts expiring within N days (for alerts). */
  async listExpiringContracts(days = 60) {
    const orgId = this.tenant.organizationId;
    const horizon = new Date(Date.now() + days * 86400000);
    return this.prisma.client.hrContract.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        status: { in: ['active', 'expiring'] },
        endDate: { gte: new Date(), lte: horizon },
      },
      include: { employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } } },
    });
  }

  async createContract(dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    if (!dto.employeeId || !dto.contractNumber || !dto.startDate)
      throw new BadRequestException('employeeId, contractNumber and startDate are required');
    if (dto.type && !CONTRACT_TYPES.includes(dto.type)) throw new BadRequestException(`Invalid contract type: ${dto.type}`);
    if (dto.status && !CONTRACT_STATUSES.includes(dto.status)) throw new BadRequestException(`Invalid contract status: ${dto.status}`);
    const emp = await this.prisma.client.hrEmployee.findFirst({ where: { id: dto.employeeId, organizationId: orgId } });
    if (!emp) throw new NotFoundException('Employee not found');
    const existing = await this.prisma.client.hrContract.findUnique({
      where: { organizationId_contractNumber: { organizationId: orgId, contractNumber: String(dto.contractNumber).toUpperCase() } },
    });
    if (existing) throw new BadRequestException(`Contract number "${dto.contractNumber}" already exists`);
    return this.prisma.client.hrContract.create({
      data: {
        organizationId: orgId,
        employeeId: dto.employeeId,
        contractNumber: String(dto.contractNumber).toUpperCase(),
        type: dto.type ?? 'permanent',
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        payFrequency: dto.payFrequency ?? null,
        salary: dto.salary ?? null,
        documentId: dto.documentId ?? null,
        status: dto.status ?? 'draft',
        signedAt: dto.signedAt ? new Date(dto.signedAt) : null,
        createdBy: userId,
      },
      include: { employee: true },
    });
  }

  async updateContract(id: string, dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrContract.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Contract not found');
    if (dto.status && !CONTRACT_STATUSES.includes(dto.status)) throw new BadRequestException(`Invalid contract status: ${dto.status}`);
    const data: any = { updatedBy: userId };
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) data.endDate = dto.endDate ? new Date(dto.endDate) : null;
    if (dto.payFrequency !== undefined) data.payFrequency = dto.payFrequency;
    if (dto.salary !== undefined) data.salary = dto.salary;
    if (dto.documentId !== undefined) data.documentId = dto.documentId;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.signedAt !== undefined) data.signedAt = dto.signedAt ? new Date(dto.signedAt) : null;
    return this.prisma.client.hrContract.update({ where: { id }, data, include: { employee: true } });
  }

  async deleteContract(id: string) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrContract.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Contract not found');
    return this.prisma.client.hrContract.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: userId } });
  }

  // ── Onboarding ────────────────────────────────────────────────────────────

  async listOnboarding(query: any = {}) {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId };
    if (query.employeeId) where.employeeId = query.employeeId;
    const [rows, total] = await Promise.all([
      this.prisma.client.hrOnboardingTask.findMany({ where, orderBy: [{ createdAt: 'asc' }] }),
      this.prisma.client.hrOnboardingTask.count({ where }),
    ]);
    return { rows, total };
  }

  async addOnboardingTask(dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    if (!dto.employeeId || !dto.task) throw new BadRequestException('employeeId and task are required');
    return this.prisma.client.hrOnboardingTask.create({
      data: {
        organizationId: orgId,
        employeeId: dto.employeeId,
        task: dto.task,
        status: 'pending',
        createdBy: userId,
      },
    });
  }

  async completeOnboardingTask(id: string) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrOnboardingTask.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Onboarding task not found');
    return this.prisma.client.hrOnboardingTask.update({
      where: { id },
      data: { status: 'done', doneById: userId, doneAt: new Date() },
    });
  }

  async removeOnboardingTask(id: string) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrOnboardingTask.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Onboarding task not found');
    return this.prisma.client.hrOnboardingTask.update({ where: { id }, data: { deletedAt: new Date(), createdBy: userId } });
  }

  // ── Offboarding + final settlement ────────────────────────────────────────

  /**
   * Final settlement. The settlement does NOT pay anyone itself — that used to
   * double-pay the final month (the settlement journal paid it, then the
   * payroll run paid the same leaver pro-rata again), and paid it untaxed.
   *
   * Instead:
   *  - the final month's salary is paid by the payroll run for the period that
   *    contains the last working day, pro-rated to that day, taxed as normal;
   *  - that final payslip recovers every outstanding loan and advance in full
   *    (as far as net pay allows — `calculateRun` treats it as the final pay);
   *  - unused ENCASHABLE leave for the current leave year becomes a taxable
   *    payroll input on that period, PENDING approval by someone with
   *    `hr:payroll` like any other one-off money.
   *
   * `post = false` returns the estimate without writing anything.
   */
  async computeFinalSettlement(employeeId: string, lastDay: string, post = false, dto: any = {}) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const ld = utcDay(lastDay);
    if (Number.isNaN(ld.getTime())) throw new BadRequestException('lastDay is not a valid date');
    if (dto.reason && !OFFBOARD_REASONS.includes(dto.reason))
      throw new BadRequestException(`Invalid reason: ${dto.reason}`);
    const year = ld.getUTCFullYear();
    const emp = await this.prisma.client.hrEmployee.findFirst({
      where: { id: employeeId, organizationId: orgId },
      include: {
        leaveBalances: { where: { year, deletedAt: null }, include: { leaveType: true } },
        loans: { where: { deletedAt: null, status: 'ACTIVE' } },
        salaryAdvances: { where: { deletedAt: null, status: 'PAID' } },
      },
    });
    if (!emp) throw new NotFoundException('Employee not found');
    if (emp.hireDate && ld.getTime() < utcDay(emp.hireDate).getTime())
      throw new BadRequestException('lastDay is before the hire date');

    const period = await this.prisma.client.hrPayrollPeriod.findFirst({
      where: { organizationId: orgId, startDate: { lte: ld }, endDate: { gte: ld } },
      orderBy: { startDate: 'desc' },
    });

    // Decimal end to end, rounded to the currency's minor unit.
    const dp = await this.currencyDecimals(orgId);
    const base = dec(emp.baseSalary ?? 0);
    const monthDays = new Date(Date.UTC(ld.getUTCFullYear(), ld.getUTCMonth() + 1, 0)).getUTCDate();
    const dailyRate = base.dividedBy(monthDays);

    // Estimate of the final period's pro-rated salary — informational; the
    // payroll run computes the real figure (unpaid leave, allowances, tax).
    let salaryDue: Money;
    if (period) {
      const pStart = utcDay(period.startDate);
      const pEnd = utcDay(period.endDate);
      const hire = emp.hireDate ? utcDay(emp.hireDate) : null;
      const from = hire && hire > pStart ? hire : pStart;
      const periodDays = daysBetween(pStart, pEnd);
      salaryDue = round(base.times(daysBetween(from, ld)).dividedBy(periodDays), dp);
    } else {
      salaryDue = round(dailyRate.times(ld.getUTCDate()), dp);
    }

    // Leave encashment: only leave types flagged encashable (annual leave), and
    // only this leave year — sick leave and last year's lapsed days are not money.
    let leaveDays = ZERO;
    const encashed: Array<{ balanceId: string; days: Money }> = [];
    for (const b of emp.leaveBalances as any[]) {
      if (!b.leaveType?.isEncashable) continue;
      const remaining = dec(b.accruedDays).plus(dec(b.adjustedDays)).minus(dec(b.usedDays));
      if (!remaining.greaterThan(ZERO)) continue;
      leaveDays = leaveDays.plus(remaining);
      encashed.push({ balanceId: b.id, days: remaining });
    }
    const leavePayout = round(dailyRate.times(leaveDays), dp);

    const loanOutstanding = sum(emp.loans.map((l: any) => dec(l.balance)));
    const advanceOutstanding = sum(emp.salaryAdvances.map((a: any) => dec(a.balance)));
    const netSettlement = salaryDue.plus(leavePayout).minus(loanOutstanding).minus(advanceOutstanding);

    const summary = {
      employeeId,
      lastWorkingDay: ld,
      finalPayrollPeriod: period ? { id: period.id, periodCode: period.periodCode } : null,
      salaryDue,
      leavePayout,
      leaveDays: leaveDays.toNumber(),
      loanOutstanding,
      advanceOutstanding,
      netSettlement,
      note:
        'Estimate before tax. The final salary and leave payout are paid, taxed and netted against ' +
        'outstanding loans/advances by the payroll run for the period containing the last working day.',
    };
    if (!post) return { ...summary, postable: !!period };

    if (!period)
      throw new BadRequestException(
        `Create the payroll period covering ${ld.toISOString().slice(0, 10)} first — the final pay is made through that period's payroll run.`,
      );
    const approvedRun = await this.prisma.client.hrPayrollRun.findFirst({
      where: { organizationId: orgId, periodId: period.id, deletedAt: null, status: { in: ['APPROVED', 'PAID'] } },
      select: { runNumber: true },
    });
    if (approvedRun)
      throw new BadRequestException(
        `Payroll ${approvedRun.runNumber} for ${period.periodCode} is already approved. Reverse it, settle, then ` +
          'recalculate — otherwise the leaver stays paid for the whole period.',
      );
    const alreadySettled = await this.prisma.client.hrOffboarding.findFirst({
      where: { organizationId: orgId, employeeId, status: 'settled' },
      select: { id: true },
    });
    if (alreadySettled) throw new BadRequestException('This employee already has a settled offboarding record');

    return this.prisma.client.$transaction(async (tx: any) => {
      const off = await tx.hrOffboarding.create({
        data: {
          organizationId: orgId,
          employeeId,
          reason: dto.reason ?? 'resignation',
          noticeDate: dto.noticeDate ? utcDay(dto.noticeDate) : null,
          lastWorkingDay: ld,
          status: 'settled',
          salaryDue,
          leavePayout,
          loanOutstanding,
          advanceOutstanding,
          netSettlement,
          notes: dto.notes ?? null,
          settledAt: new Date(),
          settledById: userId,
          createdBy: userId,
        },
      });

      let payrollInputId: string | null = null;
      if (leavePayout.greaterThan(ZERO)) {
        const input = await tx.hrPayrollInput.create({
          data: {
            organizationId: orgId,
            employeeId,
            periodId: period.id,
            inputType: 'ALLOWANCE',
            name: `Leave encashment (${leaveDays.toString()} days)`,
            amount: leavePayout,
            isTaxable: true,
            // Captured here, authorised by payroll — the same separation of
            // duties as any other one-off money.
            status: 'PENDING',
            reference: `offboarding:${off.id}`,
            createdBy: userId,
          },
        });
        payrollInputId = input.id;
        // The encashed days are consumed so they cannot be taken or paid again.
        for (const e of encashed) {
          const bal = await tx.hrLeaveBalance.findUnique({ where: { id: e.balanceId } });
          await tx.hrLeaveBalance.update({
            where: { id: e.balanceId },
            data: { adjustedDays: dec(bal.adjustedDays).minus(e.days) },
          });
        }
      }

      // Inactive, NOT deleted: the leaver must stay visible to the payroll run
      // that pays their final salary, and to every report after it.
      await tx.hrEmployee.update({
        where: { id: employeeId },
        data: { isActive: false, updatedBy: userId },
      });
      await tx.hrOffboarding.update({ where: { id: off.id }, data: { payrollInputId } });
      await this.audit.recordInTx(tx, {
        entity: 'HrOffboarding',
        entityId: off.id,
        action: 'post',
        newValues: {
          employeeId,
          lastWorkingDay: ld,
          finalPayrollPeriod: period.periodCode,
          salaryDue: salaryDue.toString(),
          leavePayout: leavePayout.toString(),
          leaveDays: leaveDays.toString(),
          loanOutstanding: loanOutstanding.toString(),
          advanceOutstanding: advanceOutstanding.toString(),
          payrollInputId,
        },
      });
      // A leaver loses system access with the posting, not whenever someone
      // remembers: the login is disabled and every session revoked in the same
      // transaction. The school vertical ends their teaching access on the event
      // (HR may not import the school module — ADR-011).
      if (emp.userId) {
        await tx.user.updateMany({ where: { id: emp.userId }, data: { isActive: false } });
        await tx.refreshToken.updateMany({
          where: { userId: emp.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.events.publishInTx(tx, EVENTS.HrEmployeeOffboarded, {
        organizationId: orgId,
        employeeId,
        partnerId: emp.partnerId ?? null,
        userId: emp.userId ?? null,
        lastWorkingDay: ld.toISOString(),
      });

      const saved = await tx.hrOffboarding.findUnique({ where: { id: off.id } });
      return { ...saved, finalPayrollPeriod: summary.finalPayrollPeriod };
    });
  }

  private async currencyDecimals(orgId: string): Promise<number> {
    const org = await this.prisma.client.organization.findUnique({ where: { id: orgId }, select: { currencyCode: true } });
    if (!org?.currencyCode) return 2;
    const cur = await this.prisma.client.currency.findUnique({ where: { code: org.currencyCode }, select: { decimalPlaces: true } });
    return cur?.decimalPlaces ?? 2;
  }

  async listOffboarding(query: any = {}) {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId };
    if (query.employeeId) where.employeeId = query.employeeId;
    const [rows, total] = await Promise.all([
      this.prisma.client.hrOffboarding.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        include: { employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } } },
      }),
      this.prisma.client.hrOffboarding.count({ where }),
    ]);
    return { rows, total };
  }

  // ── Employment action helper (used by org service on promotion/transfer) ──

  async recordEmploymentAction(tx: any, employeeId: string, actionType: string, fromValue: string, toValue: string, reason: string, changedById?: string) {
    const orgId = this.tenant.organizationId;
    if (!ACTION_TYPES.includes(actionType)) throw new BadRequestException(`Invalid action type: ${actionType}`);
    return tx.hrEmploymentAction.create({
      data: {
        organizationId: orgId,
        employeeId,
        actionType,
        fromValue,
        toValue,
        effectiveDate: new Date(),
        reason,
        changedById: changedById ?? null,
        createdBy: changedById ?? null,
      },
    });
  }

  // ── Audit trail (sensitive field changes) ─────────────────────────────────

  async listAuditTrail(employeeId: string) {
    const orgId = this.tenant.organizationId;
    return this.prisma.client.hrEmployeeAuditTrail.findMany({
      where: { organizationId: orgId, employeeId },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  async recordAudit(tx: any, employeeId: string, field: string, oldValue: string | null, newValue: string | null, reason: string, approverId?: string) {
    const orgId = this.tenant.organizationId;
    return tx.hrEmployeeAuditTrail.create({
      data: {
        organizationId: orgId,
        employeeId,
        field,
        oldValue: oldValue ?? null,
        newValue: newValue ?? null,
        reason,
        approverId: approverId ?? null,
        changedById: approverId ?? null,
      },
    });
  }
}
