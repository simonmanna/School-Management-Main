import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { dec, sum, ZERO, type Money } from '../../kernel/common/money';
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
/** Overtime is paid at 1.5× the hourly rate. */
const OVERTIME_MULTIPLIER = 1.5;
/**
 * Interactive-transaction budget for `approveRun`. Prisma's default is 5s,
 * which a real payroll (hundreds of payslips + GL posting) blows through.
 */
const APPROVE_TX_TIMEOUT_MS = 120_000;

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

  /**
   * Progressive tax computation: sum (bracket ∩ income) × rate.
   *
   * Decimal end to end (FINANCIAL_INVARIANTS.md §"Money precision"). A float
   * here lands in `HrPayrollItem.taxAmount`, then in the GL control total,
   * where `PostingService.applyRounding` silently absorbs residuals ≤ 0.01
   * into a rounding account — so the drift would post with no error signal.
   *
   * NOTE `HrTaxBracket.rate` is a FRACTION (0.3 = 30%), unlike
   * `HrPayrollComponent.rate` which is a percentage (30 = 30%). Seeds must
   * follow that convention. A null `toAmount` means "and above".
   */
  private computeProgressive(
    income: Money,
    brackets: Array<{ fromAmount: any; toAmount: any; rate: any }>,
  ): Money {
    let tax = ZERO;
    for (const b of brackets) {
      const from = dec(b.fromAmount);
      const low = from.greaterThan(ZERO) ? from : ZERO;
      const to = b.toAmount === null || b.toAmount === undefined ? null : dec(b.toAmount);
      const high = to !== null && to.lessThan(income) ? to : income;
      if (high.greaterThan(low)) tax = tax.plus(high.minus(low).times(dec(b.rate)));
    }
    return tax;
  }

  /**
   * Resolve one payroll component to money. PERCENTAGE components are a
   * percentage (30 = 30%) of `earningsBase` (base + overtime); FIXED
   * components use `amount` as-is.
   */
  private componentAmount(
    c: { calcMethod: string; rate: any; amount: any },
    earningsBase: Money,
  ): Money {
    return c.calcMethod === 'PERCENTAGE'
      ? earningsBase.times(dec(c.rate ?? 0)).dividedBy(100)
      : dec(c.amount ?? 0);
  }

  /**
   * A loan/advance installment is min(planned, outstanding balance, what is
   * left of net pay). Capping at `available` is what keeps net pay from going
   * negative, which would unbalance the payroll journal.
   */
  private cappedInstallment(planned: Money, balance: Money, available: Money): Money {
    let v = planned.lessThan(balance) ? planned : balance;
    if (v.greaterThan(available)) v = available;
    return v.greaterThan(ZERO) ? v : ZERO;
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
        include: { department: true, position: true },
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
        const baseSalary = emp.baseSalary ? dec(emp.baseSalary) : ZERO;
        const hourlyRate = emp.hourlyRate ? dec(emp.hourlyRate) : ZERO;

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

        // Falls back to a derived hourly rate when none is stored, matching
        // the previous `hourlyRate || baseSalary / MONTHLY_HOURS` behaviour.
        const derivedHourly = hourlyRate.greaterThan(ZERO)
          ? hourlyRate
          : baseSalary.dividedBy(dec(MONTHLY_HOURS));
        const baseAmount =
          payFreq === 'HOURLY'
            ? dec(workedMin).dividedBy(60).times(derivedHourly)
            : baseSalary;
        const overtimeHours = dec(overtimeMin).dividedBy(60);
        const overtimePay = overtimeHours
          .times(derivedHourly)
          .times(dec(OVERTIME_MULTIPLIER));
        const earningsBase = baseAmount.plus(overtimePay);

        // 2. Allowances (recurring components + per-item allowance lines).
        const components = await this.resolveComponents(tx, orgId, emp);
        const allowanceLines: any[] = [];
        let allowancesTotal = ZERO;
        for (const c of components) {
          if (c.componentType !== 'ALLOWANCE' || !c.isRecurring) continue;
          if (c.appliesTo && !this.componentApplies(c.appliesTo, emp)) continue;
          const amount = this.componentAmount(c, earningsBase);
          if (!amount.greaterThan(ZERO)) continue;
          allowancesTotal = allowancesTotal.plus(amount);
          allowanceLines.push({
            organizationId: orgId,
            name: c.name,
            amount,
            isTaxable: c.isTaxable,
            createdBy: userId,
          });
        }

        // 3. Recurring deductions (pension/SSF/insurance are config components).
        const deductionLines: any[] = [];
        const d = { pension: ZERO, ssf: ZERO, insurance: ZERO, other: ZERO };
        for (const c of components) {
          if (c.componentType !== 'DEDUCTION' || !c.isRecurring) continue;
          if (c.appliesTo && !this.componentApplies(c.appliesTo, emp)) continue;
          const amount = this.componentAmount(c, earningsBase);
          if (!amount.greaterThan(ZERO)) continue;
          const codeUp = (c.code ?? '').toUpperCase();
          if (codeUp.includes('PENSION')) d.pension = d.pension.plus(amount);
          else if (codeUp.includes('SSF') || codeUp.includes('SOCIAL')) d.ssf = d.ssf.plus(amount);
          else if (codeUp.includes('INSURANCE')) d.insurance = d.insurance.plus(amount);
          else d.other = d.other.plus(amount);
          deductionLines.push({
            organizationId: orgId,
            name: c.name,
            amount,
            isTaxable: c.isTaxable,
            createdBy: userId,
          });
        }

        // 4. Gross (before loan/advance installments are capped).
        const gross = earningsBase.plus(allowancesTotal);

        // 5. Tax (PAYE on taxable gross minus pension/SSF, progressive —
        // brackets are ANNUAL, so annualize then divide back to monthly).
        const taxableRaw = gross.minus(d.pension).minus(d.ssf);
        const taxableGross = taxableRaw.greaterThan(ZERO) ? taxableRaw : ZERO;
        const tax = payeTable
          ? this.computeProgressive(
              taxableGross.times(MONTHS_PER_YEAR),
              payeTable.brackets,
            ).dividedBy(MONTHS_PER_YEAR)
          : ZERO;
        if (tax.greaterThan(ZERO))
          deductionLines.push({
            organizationId: orgId,
            name: 'PAYE Tax',
            amount: tax,
            isTaxable: false,
            createdBy: userId,
          });

        // 6. Loan + advance installments — capped so net pay never goes
        //    negative (keeps the GL journal balanced). Statutory deductions
        //    get priority; the remainder is split loans → advances.
        const statutoryDeductions = sum([tax, d.pension, d.ssf, d.insurance, d.other]);
        const availableRaw = gross.minus(statutoryDeductions);
        let availableForInstallments = availableRaw.greaterThan(ZERO) ? availableRaw : ZERO;
        let loanDeduction = ZERO;
        let advanceDeduction = ZERO;
        for (const loan of loans) {
          if (loan.employeeId !== emp.id || !dec(loan.balance).greaterThan(ZERO)) continue;
          if (!availableForInstallments.greaterThan(ZERO)) break;
          const installment = this.cappedInstallment(
            dec(loan.installmentAmount),
            dec(loan.balance),
            availableForInstallments,
          );
          loanDeduction = loanDeduction.plus(installment);
          availableForInstallments = availableForInstallments.minus(installment);
          deductionLines.push({
            organizationId: orgId,
            name: `Loan ${loan.loanCode}`,
            amount: installment,
            isTaxable: false,
            createdBy: userId,
          });
        }
        for (const adv of advances) {
          if (adv.employeeId !== emp.id || !dec(adv.balance).greaterThan(ZERO)) continue;
          if (!availableForInstallments.greaterThan(ZERO)) break;
          const installment = this.cappedInstallment(
            dec(adv.monthlyDeduction),
            dec(adv.balance),
            availableForInstallments,
          );
          advanceDeduction = advanceDeduction.plus(installment);
          availableForInstallments = availableForInstallments.minus(installment);
          deductionLines.push({
            organizationId: orgId,
            name: `Advance ${adv.advanceCode}`,
            amount: installment,
            isTaxable: false,
            createdBy: userId,
          });
        }

        const totalDeductions = statutoryDeductions
          .plus(loanDeduction)
          .plus(advanceDeduction);
        const netPay = gross.minus(totalDeductions);

        const item = await tx.hrPayrollItem.create({
          data: {
            organizationId: orgId,
            runId: id,
            employeeId: emp.id,
            baseSalary: baseAmount,
            hourlyRate: derivedHourly,
            regularHours: Math.round(workedMin / 60),
            // `overtimeHours` is an Int column, so it is a rounded DISPLAY
            // value. `overtimePay` above is computed from exact minutes and is
            // unaffected. (The previous `Math.round(h * 100) / 100` produced a
            // fractional value that Prisma rejects for an Int field — latent
            // because attendance overtime is currently always zero.)
            overtimeHours: overtimeHours.toDecimalPlaces(0).toNumber(),
            overtimePay,
            allowancesTotal,
            commissionAmount: ZERO,
            bonusAmount: ZERO,
            grossPay: gross,
            taxAmount: tax,
            pensionAmount: d.pension,
            socialSecurityAmount: d.ssf,
            loanDeduction,
            advanceDeduction,
            insuranceAmount: d.insurance,
            otherDeductions: d.other,
            totalDeductions,
            netPay,
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
      const grossSum = sum(items.map((i: any) => dec(i.grossPay)));
      const dedSum = sum(items.map((i: any) => dec(i.totalDeductions)));
      const netSum = sum(items.map((i: any) => dec(i.netPay)));
      const run2 = await tx.hrPayrollRun.update({
        where: { id },
        data: {
          status: 'CALCULATED',
          totalGross: grossSum,
          totalDeductions: dedSum,
          totalNet: netSum,
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

      await this.audit.recordInTx(tx, {
        entity: 'HrPayrollRun',
        entityId: id,
        action: 'update',
        newValues: {
          event: 'calculate',
          status: 'CALCULATED',
          employees: items.length,
          totalGross: grossSum.toString(),
          totalDeductions: dedSum.toString(),
          totalNet: netSum.toString(),
        },
      });

      return { ...run2, period: periodFull, items: itemsFull, bankPayments: [] };
    }, { timeout: APPROVE_TX_TIMEOUT_MS, maxWait: 10_000 });
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
            employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, partnerId: true, bankName: true, bankAccountName: true, bankAccountNumber: true, mobileMoneyProvider: true, mobileMoneyNumber: true } },
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
      // 1. Payslips for every item — numbers allocated in ONE round trip and
      //    inserted in ONE statement. Per-item `seq.next()` + `create()` cost
      //    2N round trips, which exceeds the transaction budget at real
      //    headcount.
      const issuedAt = new Date();
      const payslipNumbers = await this.seq.nextBatch(
        'hr_payslip',
        run.items.length,
        { prefix: 'PS-', padding: 6 },
        tx,
      );
      await tx.hrPayslip.createMany({
        data: run.items.map((item: any, idx: number) => ({
          organizationId: orgId,
          payslipNumber: payslipNumbers[idx],
          itemId: item.id,
          status: 'ISSUED',
          issuedAt,
          createdBy: userId,
        })),
      });

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

      // Control totals are Decimal sums of the stored item amounts, so the
      // journal ties to the payslips EXACTLY. A float here would leave a
      // residual that `PostingService.applyRounding` silently books to a
      // rounding account instead of failing.
      const totalOf = (field: string) =>
        sum(run.items.map((i: any) => dec((i as any)[field])));
      const totals = {
        gross: totalOf('grossPay'),
        net: totalOf('netPay'),
        tax: totalOf('taxAmount'),
        pension: totalOf('pensionAmount'),
        ssf: totalOf('socialSecurityAmount'),
        insurance: totalOf('insuranceAmount'),
        loans: totalOf('loanDeduction'),
        advances: totalOf('advanceDeduction'),
        other: totalOf('otherDeductions'),
      };
      const lines: any[] = [
        { accountId: salaryExpense, debit: totals.gross, description: 'Salaries & wages' },
      ];
      const credit = (amount: Money, accountId: string, description: string) => {
        if (amount.greaterThan(ZERO)) lines.push({ accountId, credit: amount, description });
      };
      // Per-employee GL subledger (Phase 5).
      //
      // Amounts owed to (or recoverable from) a PERSON get one line each,
      // carrying that person's `partnerId` — the same dimension school fees use
      // (FINANCIAL_INVARIANTS.md §"per-partner subledger"). Without it the
      // ledger could only say "we owe payroll 40m", never "we owe Sara 1.2m",
      // so net pay could not be reconciled or aged per employee.
      //
      // Amounts owed to an INSTITUTION (PAYE, pension, SSF, insurer) stay
      // aggregated — those creditors are not the employees.
      //
      // `partnerId` is undefined for an employee not yet bridged to a Partner;
      // the line still posts, it just carries no subledger dimension. A payroll
      // run must never fail because reconciliation is incomplete.
      const perEmployee = (
        field: string,
        accountId: string,
        kind: 'credit' | 'debit',
        label: string,
      ) => {
        for (const item of run.items as any[]) {
          const amount = dec(item[field]);
          if (!amount.greaterThan(ZERO)) continue;
          const who = `${item.employee?.firstName ?? ''} ${item.employee?.lastName ?? ''}`.trim()
            || item.employee?.employeeCode
            || 'employee';
          lines.push({
            accountId,
            [kind]: amount,
            partnerId: item.employee?.partnerId ?? undefined,
            description: `${label} — ${who}`,
          });
        }
      };

      perEmployee('netPay', netPayPayable, 'credit', 'Net pay payable');
      credit(totals.tax, payePayable, 'PAYE tax payable');
      credit(totals.pension, pensionPayable, 'Pension payable');
      credit(totals.ssf, ssfPayable, 'Social security payable');
      credit(totals.insurance, insurancePayable, 'Insurance payable');
      perEmployee('loanDeduction', loanReceivable, 'credit', 'Loan installment');
      perEmployee('advanceDeduction', advanceReceivable, 'credit', 'Advance installment');
      // NOTE: "other" deductions have no mapped payable account, so they are
      // credited back against salary expense. That balances the entry but
      // understates the expense and creates no liability — correct for a
      // reimbursement, wrong for something owed onward (e.g. union dues).
      // Needs an `other_deductions_payable` mapping to model properly.
      credit(totals.other, salaryExpense, 'Other deductions contra');

      const journal = await this.posting.post(
        {
          journalCode: 'GEN',
          // The expense belongs to the PERIOD, not to the day someone clicked
          // approve. Using `new Date()` books a June run into July and fails
          // outright when the current period is closed.
          date: run.period.endDate,
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
        const installment = item ? dec(item.loanDeduction) : ZERO;
        if (installment.greaterThan(ZERO)) {
          const raw = dec(loan.balance).minus(installment);
          const newBalance = raw.greaterThan(ZERO) ? raw : ZERO;
          await tx.hrEmployeeLoan.update({
            where: { id: loan.id },
            data: {
              balance: newBalance,
              installmentsPaid: loan.installmentsPaid + 1,
              status: newBalance.isZero() ? 'PAID' : loan.status,
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
        const installment = item ? dec(item.advanceDeduction) : ZERO;
        if (installment.greaterThan(ZERO)) {
          const raw = dec(adv.balance).minus(installment);
          const newBalance = raw.greaterThan(ZERO) ? raw : ZERO;
          await tx.hrSalaryAdvance.update({
            where: { id: adv.id },
            data: {
              balance: newBalance,
              status: newBalance.isZero() ? 'SETTLED' : adv.status,
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

      // ADR-006: `recordInTx` THROWS on failure so the whole approval rolls
      // back. Approving payroll moves money — it must never post unaudited.
      await this.audit.recordInTx(tx, {
        entity: 'HrPayrollRun',
        entityId: id,
        action: 'approve',
        oldValues: { status: run.status },
        newValues: {
          status: 'APPROVED',
          journalEntryId: journal.id,
          journalDate: run.period.endDate,
          employees: run.items.length,
          totalGross: totals.gross.toString(),
          totalNet: totals.net.toString(),
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
    }, { timeout: APPROVE_TX_TIMEOUT_MS, maxWait: 10_000 });
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
      const reversed = await tx.hrPayrollRun.update({
        where: { id },
        data: {
          status: 'REVERSED',
          glPosted: false,
          notes: dto.reason ?? run.notes,
          updatedBy: userId,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'HrPayrollRun',
        entityId: id,
        action: 'reverse',
        oldValues: { status: run.status, journalEntryId: run.journalEntryId, glPosted: true },
        newValues: { status: 'REVERSED', glPosted: false, reason: dto.reason ?? null },
      });
      return reversed;
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

  // ── Statutory config (versioned by effectiveFrom) ────────────────────────────

  async listStatutoryConfigs(query: any = {}) {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId };
    if (query.configType) where.configType = query.configType;
    const [rows, total] = await Promise.all([
      this.prisma.client.hrStatutoryConfig.findMany({ where, orderBy: [{ effectiveFrom: 'desc' }] }),
      this.prisma.client.hrStatutoryConfig.count({ where }),
    ]);
    return { rows, total };
  }

  async createStatutoryConfig(dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    if (!dto.code || !dto.name || !dto.effectiveFrom)
      throw new BadRequestException('code, name and effectiveFrom are required');
    const existing = await this.prisma.client.hrStatutoryConfig.findFirst({
      where: { organizationId: orgId, code: String(dto.code).toUpperCase(), effectiveFrom: new Date(dto.effectiveFrom) },
    });
    if (existing) throw new BadRequestException('A config with this code+effectiveFrom already exists');
    return this.prisma.client.hrStatutoryConfig.create({
      data: {
        organizationId: orgId,
        code: String(dto.code).toUpperCase(),
        name: dto.name,
        configType: dto.configType ?? 'PENSION',
        rate: dto.rate ?? null,
        employerRate: dto.employerRate ?? null,
        effectiveFrom: new Date(dto.effectiveFrom),
        isActive: dto.isActive ?? true,
        createdBy: userId,
      },
    });
  }

  async updateStatutoryConfig(id: string, dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrStatutoryConfig.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Statutory config not found');
    const data: any = { updatedBy: userId };
    for (const f of ['name', 'configType', 'rate', 'employerRate', 'isActive']) {
      if (dto[f] !== undefined) data[f] = dto[f];
    }
    if (dto.effectiveFrom !== undefined) data.effectiveFrom = new Date(dto.effectiveFrom);
    return this.prisma.client.hrStatutoryConfig.update({ where: { id }, data });
  }

  async deleteStatutoryConfig(id: string) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrStatutoryConfig.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Statutory config not found');
    return this.prisma.client.hrStatutoryConfig.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: userId } });
  }

  /** The active statutory config for a code as of a date (versioned rules). */
  private async activeStatutory(tx: any, orgId: string, code: string, asOf: Date) {
    return tx.hrStatutoryConfig.findFirst({
      where: { organizationId: orgId, code, deletedAt: null, effectiveFrom: { lte: asOf } },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  // ── Payroll preview / variance (before approval) ────────────────────────────

  /**
   * Returns a dry-run-ish preview of a calculated run: totals, headcount,
   * new/departed employees vs the previous run, large salary variances, and data
   * quality flags (missing bank/tax info, negative net). The run must be
   * CALCULATED (or DRAFT — then we compute on the fly).
   */
  async previewRun(id: string) {
    const orgId = this.tenant.organizationId;
    const run = await this.prisma.client.hrPayrollRun.findFirst({
      where: { id, organizationId: orgId },
      include: { period: true, items: { include: { employee: true } } },
    });
    if (!run) throw new NotFoundException('Payroll run not found');

    // Reuse calculation if not yet calculated (non-mutating copy of totals).
    if (run.status === 'DRAFT') {
      const calc = await this.calculateRun(id);
      run.items = calc.items;
      run.totalGross = calc.totalGross;
      run.totalNet = calc.totalNet;
      run.totalDeductions = calc.totalDeductions;
    }

    const items = run.items as any[];
    const gross = items.reduce((s, i) => s + Number(i.grossPay), 0);
    const deductions = items.reduce((s, i) => s + Number(i.totalDeductions), 0);
    const net = items.reduce((s, i) => s + Number(i.netPay), 0);

    const missingBank = items.filter((i) => !i.employee?.bankAccountNumber && !i.employee?.mobileMoneyNumber).length;
    const missingTax = items.filter((i) => !i.employee?.taxNumber).length;
    const negativeNet = items.filter((i) => Number(i.netPay) < 0).map((i) => i.employee?.employeeCode);

    // New vs previous run (compare employee sets).
    const prevRun = await this.prisma.client.hrPayrollRun.findFirst({
      where: { organizationId: orgId, periodId: run.periodId, id: { not: run.id }, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { items: { select: { employeeId: true, grossPay: true, netPay: true } } },
    });
    let newEmployees: string[] = [];
    let departed: string[] = [];
    const variances: any[] = [];
    if (prevRun) {
      const prevIds = new Set(prevRun.items.map((i: any) => i.employeeId));
      const curIds = new Set(items.map((i) => i.employeeId));
      newEmployees = items.filter((i) => !prevIds.has(i.employeeId)).map((i) => i.employee?.employeeCode);
      departed = prevRun.items.filter((i: any) => !curIds.has(i.employeeId)).map((i: any) => i.employeeId);
      const prevMap = new Map(prevRun.items.map((i: any) => [i.employeeId, i]));
      for (const i of items) {
        const p = prevMap.get(i.employeeId);
        if (p && Number(p.netPay) > 0) {
          const pct = ((Number(i.netPay) - Number(p.netPay)) / Number(p.netPay)) * 100;
          if (Math.abs(pct) >= 15) variances.push({ employeeCode: i.employee?.employeeCode, prevNet: Number(p.netPay), net: Number(i.netPay), pct: Math.round(pct) });
        }
      }
    }

    return {
      runId: run.id,
      periodCode: run.period?.periodCode,
      status: run.status,
      employeeCount: items.length,
      totalGross: gross,
      totalDeductions: deductions,
      totalNet: net,
      newEmployees,
      departedEmployees: departed.length,
      largeVariances: variances,
      missingBankDetails: missingBank,
      missingTaxInfo: missingTax,
      negativeNetEmployees: negativeNet,
    };
  }

  // ── Employee & manager self-service helpers ─────────────────────────────────

  /** Resolve the HrEmployee for the current auth user (for ESS). */
  async employeeForUser(userId: string) {
    const orgId = this.tenant.organizationId;
    return this.prisma.client.hrEmployee.findFirst({
      where: { organizationId: orgId, userId, deletedAt: null },
      include: { department: true, position: true },
    });
  }

  /** Managers see only their direct reports (supervisorId = manager's employee id). */
  async teamForManager(managerEmployeeId: string) {
    const orgId = this.tenant.organizationId;
    return this.prisma.client.hrEmployee.findMany({
      where: { organizationId: orgId, supervisorId: managerEmployeeId, deletedAt: null, isActive: true },
      include: { department: true, position: true },
    });
  }

  // ── Grade-aware component resolution (extend calculate) ─────────────────────

  /**
   * Builds the component list for an employee, preferring grade-specific salary
   * structures when the employee's position has a grade, falling back to global
   * recurring components. Returns allowance/deduction component descriptors.
   */
  private async resolveComponents(tx: any, orgId: string, emp: any) {
    const gradeId = emp.position?.gradeId ?? null;
    if (gradeId) {
      const structures = await tx.hrSalaryStructure.findMany({
        where: { organizationId: orgId, gradeId, isActive: true, deletedAt: null },
        include: { component: true },
      });
      if (structures.length > 0) {
        return structures.map((s: any) => ({
          ...s.component,
          calcMethod: s.component.calcMethod,
          isTaxable: s.component.isTaxable,
          amount: s.amount ?? s.component.amount,
          rate: s.rate ?? s.component.rate,
        }));
      }
    }
    return tx.hrPayrollComponent.findMany({ where: { organizationId: orgId, isActive: true, deletedAt: null } });
  }
}

