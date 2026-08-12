import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { dec, ZERO } from '../../kernel/common/money';
import { PostingService } from '../accounting/posting/posting.service';
import { AccountDeterminationService } from '../accounting/posting/account-determination.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const COMPONENT_TYPES = ['ALLOWANCE', 'DEDUCTION'];
const CALC_METHODS = ['FIXED', 'PERCENTAGE'];
const TAX_TYPES = ['PAYE', 'PENSION', 'SOCIAL_SECURITY', 'LOCAL'];
const PERIOD_TYPES = ['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'CUSTOM'];
const RUN_STATUSES = ['DRAFT', 'CALCULATED', 'APPROVED', 'REVERSED', 'PAID'];
const ADVANCE_STATUSES = ['PENDING', 'APPROVED', 'PAID', 'SETTLED', 'REJECTED'];
const LOAN_STATUSES = ['ACTIVE', 'PAID', 'DEFAULTED'];
const PAYMENT_METHODS = ['BANK', 'MOBILE_MONEY', 'CASH', 'CHEQUE'];
const BANK_PAYMENT_STATUSES = ['DRAFT', 'GENERATED', 'SENT', 'PAID'];

const MONTHLY_HOURS = 173.33;
const MONTHS_PER_YEAR = 12;

/**
 * HrPayrollService — the payroll engine: components, tax tables, periods,
 * runs (calculate → approve → post GL → payslips → bank payment), salary
 * advances and employee loans.
 *
 * Calculation model per employee per run:
 *   gross = base salary + allowances + overtime pay + commission + bonus
 *   deductions = PAYE + pension + social security + loan + advance + insurance + other
 *   net = gross − deductions
 *
 * GL posting (postingKey payroll_run:<runId>, journal GEN):
 *   Dr salaries expense (gross)
 *   Cr net pay payable | PAYE payable | pension payable | SSF payable |
 *      insurance payable | loan receivable | advance receivable
 */
@Injectable()
export class HrPayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly accounts: AccountDeterminationService,
  ) {}

  // ── Components ───────────────────────────────────────────────────────────

  async listComponents(query: any = {}) {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId };
    if (query.componentType) where.componentType = query.componentType;
    const [rows, total] = await Promise.all([
      this.prisma.client.hrPayrollComponent.findMany({
        where,
        orderBy: [{ name: 'asc' }],
        take: Math.min(Number(query.take ?? 100), 200),
        skip: Number(query.skip ?? 0),
      }),
      this.prisma.client.hrPayrollComponent.count({ where }),
    ]);
    return { rows, total };
  }

  async createComponent(dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    if (!dto.code || !dto.name) throw new BadRequestException('code and name are required');
    if (!dto.componentType || !COMPONENT_TYPES.includes(dto.componentType))
      throw new BadRequestException(`Invalid componentType: ${dto.componentType}`);
    if (dto.calcMethod && !CALC_METHODS.includes(dto.calcMethod))
      throw new BadRequestException(`Invalid calcMethod: ${dto.calcMethod}`);
    if (dto.calcMethod === 'FIXED' && dto.amount === undefined)
      throw new BadRequestException('FIXED components need an amount');
    if (dto.calcMethod === 'PERCENTAGE' && dto.rate === undefined)
      throw new BadRequestException('PERCENTAGE components need a rate');
    const existing = await this.prisma.client.hrPayrollComponent.findUnique({
      where: { organizationId_code: { organizationId: orgId, code: dto.code } },
    });
    if (existing) throw new BadRequestException(`Component code "${dto.code}" already exists`);
    return this.prisma.client.hrPayrollComponent.create({
      data: {
        organizationId: orgId,
        code: String(dto.code).toUpperCase(),
        name: dto.name,
        componentType: dto.componentType,
        calcMethod: dto.calcMethod ?? 'FIXED',
        amount: dto.amount ?? null,
        rate: dto.rate ?? null,
        isTaxable: dto.isTaxable ?? true,
        isRecurring: dto.isRecurring ?? true,
        appliesTo: dto.appliesTo ?? null,
        isActive: dto.isActive ?? true,
        createdBy: userId,
      },
    });
  }

  async updateComponent(id: string, dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrPayrollComponent.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!row) throw new NotFoundException('Component not found');
    const data: any = {};
    for (const f of ['name', 'componentType', 'calcMethod', 'amount', 'rate', 'isTaxable', 'isRecurring', 'appliesTo', 'isActive']) {
      if (dto[f] !== undefined) data[f] = dto[f];
    }
    data.updatedBy = userId;
    return this.prisma.client.hrPayrollComponent.update({ where: { id }, data });
  }

  async deleteComponent(id: string) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrPayrollComponent.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!row) throw new NotFoundException('Component not found');
    return this.prisma.client.hrPayrollComponent.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, updatedBy: userId },
    });
  }

  // ── Tax tables ───────────────────────────────────────────────────────────

  async listTaxTables(query: any = {}) {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId };
    if (query.taxType) where.taxType = query.taxType;
    const [rows, total] = await Promise.all([
      this.prisma.client.hrTaxTable.findMany({
        where,
        orderBy: [{ effectiveFrom: 'desc' }],
        take: Math.min(Number(query.take ?? 100), 200),
        skip: Number(query.skip ?? 0),
        include: { brackets: { orderBy: { fromAmount: 'asc' } } },
      }),
      this.prisma.client.hrTaxTable.count({ where }),
    ]);
    return { rows, total };
  }

  async createTaxTable(dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    if (!dto.code || !dto.name || !dto.effectiveFrom)
      throw new BadRequestException('code, name and effectiveFrom are required');
    if (dto.taxType && !TAX_TYPES.includes(dto.taxType))
      throw new BadRequestException(`Invalid taxType: ${dto.taxType}`);
    const existing = await this.prisma.client.hrTaxTable.findUnique({
      where: { organizationId_code: { organizationId: orgId, code: dto.code } },
    });
    if (existing) throw new BadRequestException(`Tax table code "${dto.code}" already exists`);
    const brackets = Array.isArray(dto.brackets) ? dto.brackets : [];
    return this.prisma.client.$transaction(async (tx: any) => {
      const table = await tx.hrTaxTable.create({
        data: {
          organizationId: orgId,
          code: String(dto.code).toUpperCase(),
          name: dto.name,
          countryCode: dto.countryCode ?? null,
          taxType: dto.taxType ?? 'PAYE',
          effectiveFrom: new Date(dto.effectiveFrom),
          isActive: dto.isActive ?? true,
          createdBy: userId,
        },
      });
      for (const b of brackets) {
        await tx.hrTaxBracket.create({
          data: {
            organizationId: orgId,
            taxTableId: table.id,
            fromAmount: b.fromAmount,
            toAmount: b.toAmount ?? null,
            rate: b.rate,
            createdBy: userId,
          },
        });
      }
      return tx.hrTaxTable.findUnique({
        where: { id: table.id },
        include: { brackets: { orderBy: { fromAmount: 'asc' } } },
      });
    });
  }

  async updateTaxTable(id: string, dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrTaxTable.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!row) throw new NotFoundException('Tax table not found');
    return this.prisma.client.$transaction(async (tx: any) => {
      const table = await tx.hrTaxTable.update({
        where: { id },
        data: {
          name: dto.name ?? row.name,
          countryCode: dto.countryCode !== undefined ? dto.countryCode : row.countryCode,
          taxType: dto.taxType ?? row.taxType,
          effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : row.effectiveFrom,
          isActive: dto.isActive ?? row.isActive,
          updatedBy: userId,
        },
      });
      if (Array.isArray(dto.brackets)) {
        await tx.hrTaxBracket.updateMany({
          where: { taxTableId: id, organizationId: orgId },
          data: { deletedAt: new Date() },
        });
        for (const b of dto.brackets) {
          await tx.hrTaxBracket.create({
            data: {
              organizationId: orgId,
              taxTableId: id,
              fromAmount: b.fromAmount,
              toAmount: b.toAmount ?? null,
              rate: b.rate,
              createdBy: userId,
            },
          });
        }
      }
      return tx.hrTaxTable.findUnique({
        where: { id: table.id },
        include: { brackets: { orderBy: { fromAmount: 'asc' } } },
      });
    });
  }

  async deleteTaxTable(id: string) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrTaxTable.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!row) throw new NotFoundException('Tax table not found');
    return this.prisma.client.hrTaxTable.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, updatedBy: userId },
    });
  }

  /** Progressive tax computation: sum (bracket ∩ income) × rate. */
  private computeProgressive(income: number, brackets: Array<{ fromAmount: any; toAmount: any; rate: any }>): number {
    let tax = 0;
    for (const b of brackets) {
      const from = Number(b.fromAmount);
      const to = b.toAmount === null || b.toAmount === undefined ? Infinity : Number(b.toAmount);
      const low = Math.max(from, 0);
      const high = Math.min(to, income);
      if (high > low) tax += (high - low) * Number(b.rate);
    }
    return tax;
  }

  /** Active tax table of a type for the run's period. */
  private async activeTaxTable(tx: any, orgId: string, taxType: string, runDate: Date) {
    return tx.hrTaxTable.findFirst({
      where: {
        organizationId: orgId,
        taxType,
        isActive: true,
        deletedAt: null,
        effectiveFrom: { lte: runDate },
      },
      include: { brackets: { orderBy: { fromAmount: 'asc' } } },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  // ── Periods ──────────────────────────────────────────────────────────────

  async listPeriods(query: any = {}) {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId };
    const [rows, total] = await Promise.all([
      this.prisma.client.hrPayrollPeriod.findMany({
        where,
        orderBy: [{ startDate: 'desc' }],
        take: Math.min(Number(query.take ?? 50), 200),
        skip: Number(query.skip ?? 0),
        include: { _count: { select: { runs: true } } },
      }),
      this.prisma.client.hrPayrollPeriod.count({ where }),
    ]);
    return { rows, total };
  }

  async createPeriod(dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    if (!dto.startDate || !dto.endDate)
      throw new BadRequestException('startDate and endDate are required');
    if (dto.periodType && !PERIOD_TYPES.includes(dto.periodType))
      throw new BadRequestException(`Invalid periodType: ${dto.periodType}`);
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (endDate < startDate) throw new BadRequestException('endDate must be after startDate');
    // Auto-generate periodCode: PRD-YYYY-MM
    const code =
      dto.periodCode ??
      `PRD-${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;
    const existing = await this.prisma.client.hrPayrollPeriod.findUnique({
      where: { organizationId_periodCode: { organizationId: orgId, periodCode: code } },
    });
    if (existing) throw new BadRequestException(`Period code "${code}" already exists`);
    return this.prisma.client.hrPayrollPeriod.create({
      data: {
        organizationId: orgId,
        periodCode: code,
        periodType: dto.periodType ?? 'MONTHLY',
        startDate,
        endDate,
        status: dto.status ?? 'OPEN',
        createdBy: userId,
      },
    });
  }

  async updatePeriod(id: string, dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrPayrollPeriod.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!row) throw new NotFoundException('Period not found');
    const data: any = {};
    if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) data.endDate = new Date(dto.endDate);
    if (dto.status !== undefined) data.status = dto.status;
    data.updatedBy = userId;
    return this.prisma.client.hrPayrollPeriod.update({ where: { id }, data });
  }

  // ── Runs ─────────────────────────────────────────────────────────────────

  async listRuns(query: any = {}) {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId };
    if (query.periodId) where.periodId = query.periodId;
    if (query.status) where.status = query.status;
    const [rows, total] = await Promise.all([
      this.prisma.client.hrPayrollRun.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        take: Math.min(Number(query.take ?? 50), 200),
        skip: Number(query.skip ?? 0),
        include: {
          period: true,
          _count: { select: { items: true } },
        },
      }),
      this.prisma.client.hrPayrollRun.count({ where }),
    ]);
    return { rows, total };
  }

  async getRun(id: string) {
    const orgId = this.tenant.organizationId;
    const row = await this.prisma.client.hrPayrollRun.findFirst({
      where: { id, organizationId: orgId },
      include: {
        period: true,
        items: {
          include: {
            employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, departmentId: true } },
            allowances: true,
            deductions: true,
            payslip: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        bankPayments: { include: { lines: true } },
      },
    });
    if (!row) throw new NotFoundException('Payroll run not found');
    return row;
  }

  async createRun(dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    if (!dto.periodId) throw new BadRequestException('periodId is required');
    const period = await this.prisma.client.hrPayrollPeriod.findFirst({
      where: { id: dto.periodId, organizationId: orgId },
    });
    if (!period) throw new NotFoundException('Payroll period not found');
    const existingRun = await this.prisma.client.hrPayrollRun.findFirst({
      where: { organizationId: orgId, periodId: period.id, deletedAt: null },
    });
    if (existingRun && existingRun.status !== 'REVERSED')
      throw new BadRequestException('A run already exists for this period (reverse it first)');
    const runNumber = await this.seq.next('hr_payroll_run', { prefix: 'PR-', padding: 6 });
    return this.prisma.client.hrPayrollRun.create({
      data: {
        organizationId: orgId,
        runNumber,
        periodId: period.id,
        status: 'DRAFT',
        paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : null,
        notes: dto.notes ?? null,
        createdBy: userId,
      },
    });
  }

  /**
   * Calculate every active employee's pay for the run. Idempotent: re-running
   * wipes and recomputes items (run must be DRAFT or CALCULATED).
   */
  async calculateRun(id: string) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const run = await this.prisma.client.hrPayrollRun.findFirst({
      where: { id, organizationId: orgId },
      include: { period: true },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status !== 'DRAFT' && run.status !== 'CALCULATED')
      throw new BadRequestException('Only DRAFT/CALCULATED runs can be recalculated');

    const period = run.period;
    const runDate = new Date();
    const monthStart = new Date(period.startDate);
    const monthEnd = new Date(period.endDate);

    return this.prisma.client.$transaction(async (tx: any) => {
      // Delete stale items + their child lines/payslips.
      const staleItems = await tx.hrPayrollItem.findMany({
        where: { runId: id, organizationId: orgId },
        select: { id: true },
      });
      for (const si of staleItems) {
        await tx.hrPayrollAllowance.deleteMany({ where: { itemId: si.id } });
        await tx.hrPayrollDeduction.deleteMany({ where: { itemId: si.id } });
        await tx.hrPayslip.deleteMany({ where: { itemId: si.id } });
        await tx.hrPayrollItem.deleteMany({ where: { id: si.id } });
      }

      const employees = await tx.hrEmployee.findMany({
        where: { organizationId: orgId, isActive: true, deletedAt: null },
        include: { department: true },
      });
      const components = await tx.hrPayrollComponent.findMany({
        where: { organizationId: orgId, isActive: true, deletedAt: null },
      });
      const payeTable = await this.activeTaxTable(tx, orgId, 'PAYE', runDate);
      const pensionTable = await this.activeTaxTable(tx, orgId, 'PENSION', runDate);
      const ssfTable = await this.activeTaxTable(tx, orgId, 'SOCIAL_SECURITY', runDate);

      // Advances/loans active during this period.
      const advances = await tx.hrSalaryAdvance.findMany({
        where: {
          organizationId: orgId,
          deletedAt: null,
          status: { in: ['APPROVED', 'PAID'] },
          OR: [
            { paidAt: null, approvedAt: { lte: runDate } },
            { paidAt: { lte: runDate } },
          ],
        },
      });
      const loans = await tx.hrEmployeeLoan.findMany({
        where: { organizationId: orgId, deletedAt: null, status: 'ACTIVE' },
      });

      const items = [];
      for (const emp of employees) {
        // 1. Base salary / hourly earnings.
        const payFreq = emp.payFrequency ?? 'MONTHLY';
        const baseSalary = emp.baseSalary ? Number(emp.baseSalary) : 0;
        const hourlyRate = emp.hourlyRate ? Number(emp.hourlyRate) : 0;

        // Attendance for the period (worked + overtime minutes).
        const attAgg = await tx.hrAttendance.aggregate({
          where: {
            organizationId: orgId,
            employeeId: emp.id,
            deletedAt: null,
            date: { gte: monthStart, lt: monthEnd },
          },
          _sum: { workedMinutes: true, overtimeMinutes: true },
        });
        const workedMin = attAgg._sum.workedMinutes ?? 0;
        const overtimeMin = attAgg._sum.overtimeMinutes ?? 0;

        let baseAmount = 0;
        if (payFreq === 'HOURLY') {
          const rate = hourlyRate || baseSalary / MONTHLY_HOURS;
          baseAmount = (workedMin / 60) * rate;
        } else {
          baseAmount = baseSalary;
        }
        const overtimeHours = overtimeMin / 60;
        const otRate = hourlyRate || baseSalary / MONTHLY_HOURS;
        const overtimePay = overtimeHours * otRate * 1.5;

        // 2. Allowances (recurring components + per-item allowance lines).
        const allowanceLines: any[] = [];
        let allowancesTotal = 0;
        for (const c of components) {
          if (c.componentType !== 'ALLOWANCE' || !c.isRecurring) continue;
          if (c.appliesTo && !this.componentApplies(c.appliesTo, emp)) continue;
          const amount =
            c.calcMethod === 'PERCENTAGE'
              ? (baseAmount + overtimePay) * (Number(c.rate) / 100)
              : Number(c.amount ?? 0);
          if (amount <= 0) continue;
          allowancesTotal += amount;
          allowanceLines.push({
            organizationId: orgId,
            name: c.name,
            amount: dec(amount),
            isTaxable: c.isTaxable,
            createdBy: userId,
          });
        }

        // 3. Recurring deductions (pension/SSF/insurance are config components).
        const deductionLines: any[] = [];
        const d = { tax: 0, pension: 0, ssf: 0, insurance: 0, other: 0 };
        for (const c of components) {
          if (c.componentType !== 'DEDUCTION' || !c.isRecurring) continue;
          if (c.appliesTo && !this.componentApplies(c.appliesTo, emp)) continue;
          const amount =
            c.calcMethod === 'PERCENTAGE'
              ? (baseAmount + overtimePay) * (Number(c.rate) / 100)
              : Number(c.amount ?? 0);
          if (amount <= 0) continue;
          const codeUp = (c.code ?? '').toUpperCase();
          if (codeUp.includes('PENSION')) d.pension += amount;
          else if (codeUp.includes('SSF') || codeUp.includes('SOCIAL')) d.ssf += amount;
          else if (codeUp.includes('INSURANCE')) d.insurance += amount;
          else d.other += amount;
          deductionLines.push({
            organizationId: orgId,
            name: c.name,
            amount: dec(amount),
            isTaxable: c.isTaxable,
            createdBy: userId,
          });
        }

        // 4. Gross (before loan/advance installments are capped).
        const gross = baseAmount + overtimePay + allowancesTotal;

        // 5. Tax (PAYE on taxable gross minus pension/SSF, progressive —
        // brackets are annual, so annualize then divide back to monthly).
        const taxableGross = Math.max(
          0,
          gross - d.pension - d.ssf,
        );
        const tax = payeTable
          ? this.computeProgressive(taxableGross * MONTHS_PER_YEAR, payeTable.brackets) /
            MONTHS_PER_YEAR
          : 0;
        if (tax > 0)
          deductionLines.push({
            organizationId: orgId,
            name: 'PAYE Tax',
            amount: dec(tax),
            isTaxable: false,
            createdBy: userId,
          });

        // 6. Loan + advance installments — capped so net pay never goes
        //    negative (keeps the GL journal balanced). Statutory deductions
        //    get priority; the remainder is split loans → advances.
        const statutoryDeductions =
          tax + d.pension + d.ssf + d.insurance + d.other;
        let availableForInstallments = Math.max(0, gross - statutoryDeductions);
        let loanDeduction = 0;
        let advanceDeduction = 0;
        for (const loan of loans) {
          if (loan.employeeId !== emp.id || Number(loan.balance) <= 0) continue;
          if (availableForInstallments <= 0) break;
          const planned = Math.min(Number(loan.installmentAmount), Number(loan.balance));
          const installment = Math.min(planned, availableForInstallments);
          loanDeduction += installment;
          availableForInstallments -= installment;
          deductionLines.push({
            organizationId: orgId,
            name: `Loan ${loan.loanCode}`,
            amount: dec(installment),
            isTaxable: false,
            createdBy: userId,
          });
        }
        for (const adv of advances) {
          if (adv.employeeId !== emp.id || Number(adv.balance) <= 0) continue;
          if (availableForInstallments <= 0) break;
          const planned = Math.min(Number(adv.monthlyDeduction), Number(adv.balance));
          const installment = Math.min(planned, availableForInstallments);
          advanceDeduction += installment;
          availableForInstallments -= installment;
          deductionLines.push({
            organizationId: orgId,
            name: `Advance ${adv.advanceCode}`,
            amount: dec(installment),
            isTaxable: false,
            createdBy: userId,
          });
        }

        const totalDeductions =
          statutoryDeductions + loanDeduction + advanceDeduction;
        const netPay = gross - totalDeductions;

        const item = await tx.hrPayrollItem.create({
          data: {
            organizationId: orgId,
            runId: id,
            employeeId: emp.id,
            baseSalary: dec(baseAmount),
            hourlyRate: dec(hourlyRate),
            regularHours: Math.round(workedMin / 60),
            overtimeHours: Math.round(overtimeHours * 100) / 100,
            overtimePay: dec(overtimePay),
            allowancesTotal: dec(allowancesTotal),
            commissionAmount: ZERO,
            bonusAmount: ZERO,
            grossPay: dec(gross),
            taxAmount: dec(tax),
            pensionAmount: dec(d.pension),
            socialSecurityAmount: dec(d.ssf),
            loanDeduction: dec(loanDeduction),
            advanceDeduction: dec(advanceDeduction),
            insuranceAmount: dec(d.insurance),
            otherDeductions: dec(d.other),
            totalDeductions: dec(totalDeductions),
            netPay: dec(netPay),
            absenceDays: ZERO,
            createdBy: userId,
          },
        });
        for (const al of allowanceLines) {
          await tx.hrPayrollAllowance.create({ data: { ...al, itemId: item.id } });
        }
        for (const dl of deductionLines) {
          await tx.hrPayrollDeduction.create({ data: { ...dl, itemId: item.id } });
        }
        items.push(item);
      }

      // Run totals.
      const grossSum = items.reduce((s: number, i: any) => s + Number(i.grossPay), 0);
      const dedSum = items.reduce((s: number, i: any) => s + Number(i.totalDeductions), 0);
      const netSum = items.reduce((s: number, i: any) => s + Number(i.netPay), 0);
      const run2 = await tx.hrPayrollRun.update({
        where: { id },
        data: {
          status: 'CALCULATED',
          totalGross: dec(grossSum),
          totalDeductions: dec(dedSum),
          totalNet: dec(netSum),
          processedById: userId,
          processedAt: new Date(),
          updatedBy: userId,
        },
      });
      // Re-read through the SAME transaction so the response carries the
      // freshly computed items + totals (the main client cannot see
      // uncommitted rows).
      const itemsFull = await tx.hrPayrollItem.findMany({
        where: { runId: id, organizationId: orgId },
        include: {
          employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
          allowances: true,
          deductions: true,
          payslip: true,
        },
        orderBy: { createdAt: 'asc' },
      });
      const periodFull = await tx.hrPayrollPeriod.findUnique({
        where: { id: run2.periodId },
      });
      return { ...run2, period: periodFull, items: itemsFull, bankPayments: [] };
    });
  }

  private componentApplies(appliesTo: string, emp: any): boolean {
    const [key, value] = appliesTo.split(':');
    if (!key || !value) return true;
    if (key === 'departmentId') return emp.departmentId === value;
    if (key === 'positionId') return emp.positionId === value;
    if (key === 'employmentType') return emp.employmentType === value;
    return true;
  }

  /** Approve a calculated run → generates payslips + posts the GL journal. */
  async approveRun(id: string) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const run = await this.prisma.client.hrPayrollRun.findFirst({
      where: { id, organizationId: orgId },
      include: {
        period: true,
        items: {
          include: {
            employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, bankName: true, bankAccountName: true, bankAccountNumber: true, mobileMoneyProvider: true, mobileMoneyNumber: true } },
            allowances: true,
            deductions: true,
          },
        },
      },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status !== 'CALCULATED')
      throw new BadRequestException('Only CALCULATED runs can be approved');
    if (run.items.length === 0) throw new BadRequestException('Run has no items — calculate first');

    return this.prisma.client.$transaction(async (tx: any) => {
      // 1. Payslips for every item.
      for (const item of run.items) {
        const payslipNumber = await this.seq.next('hr_payslip', { prefix: 'PS-', padding: 6 }, tx);
        await tx.hrPayslip.create({
          data: {
            organizationId: orgId,
            payslipNumber,
            itemId: item.id,
            status: 'ISSUED',
            issuedAt: new Date(),
            createdBy: userId,
          },
        });
      }

      // 2. GL posting — one journal per run.
      const [salaryExpense, netPayPayable, payePayable, pensionPayable, ssfPayable, insurancePayable, loanReceivable, advanceReceivable] =
        await Promise.all([
          this.accounts.mapped('salary_expense', tx),
          this.accounts.mapped('net_pay_payable', tx),
          this.accounts.mapped('paye_payable', tx),
          this.accounts.mapped('pension_payable', tx),
          this.accounts.mapped('social_security_payable', tx),
          this.accounts.mapped('insurance_payable', tx),
          this.accounts.mapped('employee_loan_receivable', tx),
          this.accounts.mapped('employee_advance_receivable', tx),
        ]);

      const totals = {
        gross: run.items.reduce((s: number, i: any) => s + Number(i.grossPay), 0),
        net: run.items.reduce((s: number, i: any) => s + Number(i.netPay), 0),
        tax: run.items.reduce((s: number, i: any) => s + Number(i.taxAmount), 0),
        pension: run.items.reduce((s: number, i: any) => s + Number(i.pensionAmount), 0),
        ssf: run.items.reduce((s: number, i: any) => s + Number(i.socialSecurityAmount), 0),
        insurance: run.items.reduce((s: number, i: any) => s + Number(i.insuranceAmount), 0),
        loans: run.items.reduce((s: number, i: any) => s + Number(i.loanDeduction), 0),
        advances: run.items.reduce((s: number, i: any) => s + Number(i.advanceDeduction), 0),
        other: run.items.reduce((s: number, i: any) => s + Number(i.otherDeductions), 0),
      };
      const lines: any[] = [
        { accountId: salaryExpense, debit: dec(totals.gross), description: 'Salaries & wages' },
      ];
      if (totals.net > 0)
        lines.push({ accountId: netPayPayable, credit: dec(totals.net), description: 'Net pay payable' });
      if (totals.tax > 0)
        lines.push({ accountId: payePayable, credit: dec(totals.tax), description: 'PAYE tax payable' });
      if (totals.pension > 0)
        lines.push({ accountId: pensionPayable, credit: dec(totals.pension), description: 'Pension payable' });
      if (totals.ssf > 0)
        lines.push({ accountId: ssfPayable, credit: dec(totals.ssf), description: 'Social security payable' });
      if (totals.insurance > 0)
        lines.push({ accountId: insurancePayable, credit: dec(totals.insurance), description: 'Insurance payable' });
      if (totals.loans > 0)
        lines.push({ accountId: loanReceivable, credit: dec(totals.loans), description: 'Employee loan installments' });
      if (totals.advances > 0)
        lines.push({ accountId: advanceReceivable, credit: dec(totals.advances), description: 'Employee advance installments' });
      if (totals.other > 0)
        lines.push({ accountId: salaryExpense, credit: dec(totals.other), description: 'Other deductions contra' });

      const journal = await this.posting.post(
        {
          journalCode: 'GEN',
          date: new Date(),
          description: `Payroll ${run.runNumber} — ${run.period.periodCode}`,
          sourceType: 'payroll_run',
          sourceId: run.id,
          postingType: 'primary',
          postingKey: `payroll_run:${run.id}`,
          lines,
        },
        tx,
      );

      // 3. Loan + advance balances tick down.
      const loans = await tx.hrEmployeeLoan.findMany({
        where: { organizationId: orgId, deletedAt: null, status: 'ACTIVE' },
      });
      for (const loan of loans) {
        const item = run.items.find((i: any) => i.employeeId === loan.employeeId);
        const installment = item ? Number(item.loanDeduction) : 0;
        if (installment > 0) {
          const newBalance = Math.max(0, Number(loan.balance) - installment);
          await tx.hrEmployeeLoan.update({
            where: { id: loan.id },
            data: {
              balance: dec(newBalance),
              installmentsPaid: loan.installmentsPaid + 1,
              status: newBalance <= 0 ? 'PAID' : loan.status,
              updatedBy: userId,
            },
          });
        }
      }
      const advances = await tx.hrSalaryAdvance.findMany({
        where: {
          organizationId: orgId,
          deletedAt: null,
          status: { in: ['APPROVED', 'PAID'] },
        },
      });
      for (const adv of advances) {
        const item = run.items.find((i: any) => i.employeeId === adv.employeeId);
        const installment = item ? Number(item.advanceDeduction) : 0;
        if (installment > 0) {
          const newBalance = Math.max(0, Number(adv.balance) - installment);
          await tx.hrSalaryAdvance.update({
            where: { id: adv.id },
            data: {
              balance: dec(newBalance),
              status: newBalance <= 0 ? 'SETTLED' : adv.status,
              updatedBy: userId,
            },
          });
        }
      }

      const run2 = await tx.hrPayrollRun.update({
        where: { id },
        data: {
          status: 'APPROVED',
          journalEntryId: journal.id,
          glPosted: true,
          updatedBy: userId,
        },
      });
      // Re-read through the SAME transaction so the response carries the new
      // status, journal id and generated payslips.
      const itemsFull = await tx.hrPayrollItem.findMany({
        where: { runId: id, organizationId: orgId },
        include: {
          employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
          allowances: true,
          deductions: true,
          payslip: true,
        },
        orderBy: { createdAt: 'asc' },
      });
      const periodFull = await tx.hrPayrollPeriod.findUnique({
        where: { id: run2.periodId },
      });
      const bankPayments = await tx.hrBankPayment.findMany({
        where: { runId: id, organizationId: orgId },
        include: { lines: true },
      });
      return { ...run2, period: periodFull, items: itemsFull, bankPayments };
    });
  }

  /** Reverse an approved run (posting reversal + status). */
  async reverseRun(id: string, dto: any = {}) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const run = await this.prisma.client.hrPayrollRun.findFirst({
      where: { id, organizationId: orgId },
      include: { period: true },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status === 'DRAFT' || run.status === 'CALCULATED') {
      return this.prisma.client.hrPayrollRun.update({
        where: { id },
        data: {
          status: 'REVERSED',
          notes: dto.reason ?? run.notes,
          updatedBy: userId,
        },
      });
    }
    if (run.status !== 'APPROVED' && run.status !== 'PAID')
      throw new BadRequestException('Only APPROVED/PAID runs can be reversed');
    return this.prisma.client.$transaction(async (tx: any) => {
      if (run.journalEntryId) {
        await this.posting.reverse(
          run.journalEntryId,
          { description: `Reversal — ${dto.reason ?? 'payroll run reversal'}` },
          tx,
        );
      }
      return tx.hrPayrollRun.update({
        where: { id },
        data: {
          status: 'REVERSED',
          glPosted: false,
          notes: dto.reason ?? run.notes,
          updatedBy: userId,
        },
      });
    });
  }

  async deleteRun(id: string) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const run = await this.prisma.client.hrPayrollRun.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status === 'APPROVED' || run.status === 'PAID')
      throw new BadRequestException('Approved/paid runs cannot be deleted — reverse them');
    return this.prisma.client.hrPayrollRun.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: userId },
    });
  }

  // ── Payslips ─────────────────────────────────────────────────────────────

  async listPayslips(query: any = {}) {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId };
    if (query.employeeId) where.item = { is: { employeeId: query.employeeId } };
    if (query.status) where.status = query.status;
    const [rows, total] = await Promise.all([
      this.prisma.client.hrPayslip.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        take: Math.min(Number(query.take ?? 50), 200),
        skip: Number(query.skip ?? 0),
        include: {
          item: {
            include: {
              employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
              run: { include: { period: true } },
              allowances: true,
              deductions: true,
            },
          },
        },
      }),
      this.prisma.client.hrPayslip.count({ where }),
    ]);
    return { rows, total };
  }

  async getPayslip(id: string) {
    const orgId = this.tenant.organizationId;
    const row = await this.prisma.client.hrPayslip.findFirst({
      where: { id, organizationId: orgId },
      include: {
        item: {
          include: {
            employee: { include: { department: true, position: true } },
            run: { include: { period: true } },
            allowances: true,
            deductions: true,
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Payslip not found');
    return row;
  }

  /** Mark a payslip (and optionally the whole run) as paid. */
  async markPaid(payslipId: string, dto: any = {}) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const slip = await this.prisma.client.hrPayslip.findFirst({
      where: { id: payslipId, organizationId: orgId },
    });
    if (!slip) throw new NotFoundException('Payslip not found');
    if (!dto.paymentMethod || !PAYMENT_METHODS.includes(dto.paymentMethod))
      throw new BadRequestException(`Invalid paymentMethod: ${dto.paymentMethod}`);
    return this.prisma.client.hrPayslip.update({
      where: { id: payslipId },
      data: {
        status: 'PAID',
        paymentMethod: dto.paymentMethod,
        paidAt: new Date(),
        updatedBy: userId,
      },
    });
  }

  // ── Bank payments ────────────────────────────────────────────────────────

  async listBankPayments(query: any = {}) {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId };
    if (query.runId) where.runId = query.runId;
    if (query.status) where.status = query.status;
    const [rows, total] = await Promise.all([
      this.prisma.client.hrBankPayment.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        take: Math.min(Number(query.take ?? 50), 200),
        skip: Number(query.skip ?? 0),
        include: { run: { include: { period: true } }, _count: { select: { lines: true } } },
      }),
      this.prisma.client.hrBankPayment.count({ where }),
    ]);
    return { rows, total };
  }

  /** Generate a bank payment file from an approved run's net pays. */
  async generateBankPayment(dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    if (!dto.runId) throw new BadRequestException('runId is required');
    const run = await this.prisma.client.hrPayrollRun.findFirst({
      where: { id: dto.runId, organizationId: orgId },
      include: {
        items: {
          include: {
            employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, bankName: true, bankAccountName: true, bankAccountNumber: true, mobileMoneyProvider: true, mobileMoneyNumber: true } },
          },
        },
      },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status !== 'APPROVED' && run.status !== 'PAID')
      throw new BadRequestException('Only APPROVED/PAID runs can generate bank payments');
    const method = dto.method ?? 'BANK';
    if (!PAYMENT_METHODS.includes(method))
      throw new BadRequestException(`Invalid method: ${method}`);

    return this.prisma.client.$transaction(async (tx: any) => {
      const paymentCode = await this.seq.next('hr_bank_payment', { prefix: 'BANK-', padding: 6 }, tx);
      const payable = run.items.filter((i: any) => Number(i.netPay) > 0);
      const totalAmount = payable.reduce((s: number, i: any) => s + Number(i.netPay), 0);
      const payment = await tx.hrBankPayment.create({
        data: {
          organizationId: orgId,
          paymentCode,
          runId: run.id,
          paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : new Date(),
          method,
          status: 'GENERATED',
          totalAmount: dec(totalAmount),
          notes: dto.notes ?? null,
          createdBy: userId,
        },
      });
      for (const item of payable) {
        const emp = item.employee;
        await tx.hrBankPaymentLine.create({
          data: {
            organizationId: orgId,
            bankPaymentId: payment.id,
            employeeId: emp.id,
            amount: dec(Number(item.netPay)),
            bankName: emp.bankName ?? null,
            bankAccountName: emp.bankAccountName ?? null,
            bankAccountNumber: emp.bankAccountNumber ?? null,
            mobileMoneyProvider: emp.mobileMoneyProvider ?? null,
            mobileMoneyNumber: emp.mobileMoneyNumber ?? null,
            createdBy: userId,
          },
        });
      }
      return tx.hrBankPayment.findUnique({
        where: { id: payment.id },
        include: { lines: true },
      });
    });
  }

  async updateBankPaymentStatus(id: string, dto: any = {}) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrBankPayment.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!row) throw new NotFoundException('Bank payment not found');
    if (!dto.status || !BANK_PAYMENT_STATUSES.includes(dto.status))
      throw new BadRequestException(`Invalid status: ${dto.status}`);
    return this.prisma.client.hrBankPayment.update({
      where: { id },
      data: {
        status: dto.status,
        fileName: dto.fileName ?? row.fileName,
        fileUrl: dto.fileUrl ?? row.fileUrl,
        processedById: userId,
        updatedBy: userId,
      },
    });
  }

  // ── Salary advances ──────────────────────────────────────────────────────

  async listAdvances(query: any = {}) {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId };
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.status) where.status = query.status;
    const [rows, total] = await Promise.all([
      this.prisma.client.hrSalaryAdvance.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        take: Math.min(Number(query.take ?? 50), 200),
        skip: Number(query.skip ?? 0),
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        },
      }),
      this.prisma.client.hrSalaryAdvance.count({ where }),
    ]);
    return { rows, total };
  }

  async createAdvance(dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    if (!dto.employeeId || !dto.amount)
      throw new BadRequestException('employeeId and amount are required');
    const advanceCode = await this.seq.next('hr_advance', { prefix: 'ADV-', padding: 6 });
    const amount = Number(dto.amount);
    const months = dto.installmentMonths ?? 3;
    if (amount <= 0) throw new BadRequestException('amount must be positive');
    return this.prisma.client.hrSalaryAdvance.create({
      data: {
        organizationId: orgId,
        advanceCode,
        employeeId: dto.employeeId,
        amount: dec(amount),
        installmentMonths: months,
        monthlyDeduction: dec(amount / months),
        balance: dec(amount),
        status: 'PENDING',
        requestedById: userId,
        notes: dto.notes ?? null,
        createdBy: userId,
      },
    });
  }

  async approveAdvance(id: string) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrSalaryAdvance.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!row) throw new NotFoundException('Advance not found');
    if (row.status !== 'PENDING')
      throw new BadRequestException('Only PENDING advances can be approved');
    return this.prisma.client.hrSalaryAdvance.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date(), updatedBy: userId },
    });
  }

  async markAdvancePaid(id: string) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrSalaryAdvance.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!row) throw new NotFoundException('Advance not found');
    if (row.status !== 'APPROVED')
      throw new BadRequestException('Only APPROVED advances can be marked paid');
    return this.prisma.client.hrSalaryAdvance.update({
      where: { id },
      data: { status: 'PAID', paidAt: new Date(), updatedBy: userId },
    });
  }

  async rejectAdvance(id: string, dto: any = {}) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrSalaryAdvance.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!row) throw new NotFoundException('Advance not found');
    if (row.status !== 'PENDING')
      throw new BadRequestException('Only PENDING advances can be rejected');
    return this.prisma.client.hrSalaryAdvance.update({
      where: { id },
      data: {
        status: 'REJECTED',
        notes: dto.reason ? `${row.notes ?? ''}\nRejected: ${dto.reason}`.trim() : row.notes,
        updatedBy: userId,
      },
    });
  }

  // ── Employee loans ───────────────────────────────────────────────────────

  async listLoans(query: any = {}) {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId };
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.status) where.status = query.status;
    const [rows, total] = await Promise.all([
      this.prisma.client.hrEmployeeLoan.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        take: Math.min(Number(query.take ?? 50), 200),
        skip: Number(query.skip ?? 0),
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        },
      }),
      this.prisma.client.hrEmployeeLoan.count({ where }),
    ]);
    return { rows, total };
  }

  async createLoan(dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    if (!dto.employeeId || !dto.principal || !dto.installmentsTotal)
      throw new BadRequestException('employeeId, principal and installmentsTotal are required');
    const loanCode = await this.seq.next('hr_loan', { prefix: 'LN-', padding: 6 });
    const principal = Number(dto.principal);
    const installments = Number(dto.installmentsTotal);
    const rate = Number(dto.interestRate ?? 0);
    if (principal <= 0 || installments <= 0)
      throw new BadRequestException('principal and installmentsTotal must be positive');
    const totalPayable = principal * (1 + rate);
    return this.prisma.client.hrEmployeeLoan.create({
      data: {
        organizationId: orgId,
        loanCode,
        employeeId: dto.employeeId,
        principal: dec(principal),
        interestRate: dec(rate),
        totalPayable: dec(totalPayable),
        installmentAmount: dec(totalPayable / installments),
        installmentsTotal: installments,
        installmentsPaid: 0,
        balance: dec(totalPayable),
        status: 'ACTIVE',
        disbursedAt: dto.disbursedAt ? new Date(dto.disbursedAt) : null,
        notes: dto.notes ?? null,
        createdBy: userId,
      },
    });
  }

  async updateLoan(id: string, dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrEmployeeLoan.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!row) throw new NotFoundException('Loan not found');
    const data: any = {};
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.balance !== undefined) data.balance = dec(Number(dto.balance));
    if (dto.installmentsPaid !== undefined) data.installmentsPaid = Number(dto.installmentsPaid);
    if (dto.disbursedAt !== undefined) data.disbursedAt = dto.disbursedAt ? new Date(dto.disbursedAt) : null;
    if (dto.notes !== undefined) data.notes = dto.notes;
    data.updatedBy = userId;
    return this.prisma.client.hrEmployeeLoan.update({ where: { id }, data });
  }

  async deleteLoan(id: string) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrEmployeeLoan.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!row) throw new NotFoundException('Loan not found');
    return this.prisma.client.hrEmployeeLoan.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'PAID', updatedBy: userId },
    });
  }
}
