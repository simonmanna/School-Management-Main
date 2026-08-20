import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { PostingService } from '../accounting/posting/posting.service';
import { AccountDeterminationService } from '../accounting/posting/account-determination.service';
import { dec, ZERO } from '../../kernel/common/money';

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
 *  - Offboarding + final settlement (prorated salary, leave payout, outstanding
 *    loan/advance, optional GL posting via PostingService).
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

  /** Records a salary change + an employment action, reusing the same transaction. */
  async recordSalaryChange(tx: any, employeeId: string, prev: number, next: number, reason: string, changedById?: string) {
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
   * Computes the final settlement for an employee and (optionally) confirms it:
   * sets the employee inactive/archived, writes the offboarding record and posts
   * a GL journal (salary due + leave payout → net settlement payable).
   */
  async computeFinalSettlement(employeeId: string, lastDay: string, post = false) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const emp = await this.prisma.client.hrEmployee.findFirst({
      where: { id: employeeId, organizationId: orgId },
      include: {
        leaveBalances: true,
        loans: { where: { deletedAt: null, status: 'ACTIVE' } },
        salaryAdvances: { where: { deletedAt: null, status: { in: ['APPROVED', 'PAID'] } } },
      },
    });
    if (!emp) throw new NotFoundException('Employee not found');

    const base = this.num(emp.baseSalary);
    // Prorated salary for days worked in the final month (assume 30-day month).
    const ld = new Date(lastDay);
    const salaryDue = dec((base / 30) * ld.getDate());

    // Leave payout: remaining leave days × daily pay (gross daily).
    let leaveDays = 0;
    for (const b of emp.leaveBalances) {
      leaveDays += Math.max(0, this.num(b.accruedDays) + this.num(b.adjustedDays) - this.num(b.usedDays));
    }
    const leavePayout = dec((base / 30) * leaveDays);

    // Outstanding loan + advance balances.
    let loanOutstanding = ZERO;
    for (const l of emp.loans) loanOutstanding = dec(this.num(loanOutstanding) + this.num(l.balance));
    let advanceOutstanding = ZERO;
    for (const a of emp.salaryAdvances) advanceOutstanding = dec(this.num(advanceOutstanding) + this.num(a.balance));

    const netSettlement = this.num(salaryDue) + this.num(leavePayout) - this.num(loanOutstanding) - this.num(advanceOutstanding);

    if (!post) {
      return {
        employeeId,
        salaryDue,
        leavePayout,
        leaveDays,
        loanOutstanding,
        advanceOutstanding,
        netSettlement,
        postable: this.num(netSettlement) > 0,
      };
    }

    return this.prisma.client.$transaction(async (tx: any) => {
      // Deactivate employee + archive.
      await tx.hrEmployee.update({
        where: { id: employeeId },
        data: { isActive: false, deletedAt: new Date(), updatedBy: userId },
      });
      const off = await tx.hrOffboarding.create({
        data: {
          organizationId: orgId,
          employeeId,
          reason: 'resignation',
          lastWorkingDay: ld,
          status: 'settled',
          salaryDue,
          leavePayout,
          loanOutstanding,
          advanceOutstanding,
          netSettlement,
          settledAt: new Date(),
          settledById: userId,
          createdBy: userId,
        },
      });
      if (this.num(netSettlement) > 0) {
        const [salaryExpense, netPayPayable] = await Promise.all([
          this.accounts.mapped('salary_expense', tx),
          this.accounts.mapped('net_pay_payable', tx),
        ]);
        const journal = await this.posting.post(
          {
            journalCode: 'GEN',
            date: new Date(),
            description: `Final settlement — ${emp.firstName} ${emp.lastName ?? ''} (${emp.employeeCode})`,
            sourceType: 'hr_settlement',
            sourceId: off.id,
            postingType: 'primary',
            postingKey: `hr_settlement:${off.id}`,
            lines: [
              { accountId: salaryExpense, debit: this.num(salaryDue) + this.num(leavePayout), description: 'Salary + leave payout' },
              { accountId: netPayPayable, credit: netSettlement, description: 'Net final settlement payable' },
            ],
          },
          tx,
        );
        await tx.hrOffboarding.update({ where: { id: off.id }, data: { journalEntryId: journal.id } });
      }
      return tx.hrOffboarding.findUnique({ where: { id: off.id } });
    });
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
