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
const PAYROLL_INPUT_TYPES = ['BONUS', 'COMMISSION', 'ALLOWANCE', 'DEDUCTION', 'REIMBURSEMENT'];
const PAYROLL_INPUT_STATUSES = ['PENDING', 'APPROVED', 'APPLIED', 'CANCELLED'];

const MONTHLY_HOURS = 173.33;
const MONTHS_PER_YEAR = 12;
/** Overtime is paid at 1.5× the hourly rate. */
const OVERTIME_MULTIPLIER = 1.5;
/**
 * Interactive-transaction budget for `approveRun`. Prisma's default is 5s,
 * which a real payroll (hundreds of payslips + GL posting) blows through.
 */
const APPROVE_TX_TIMEOUT_MS = 120_000;

const MS_PER_DAY = 86_400_000;

/**
 * Payroll arithmetic is CALENDAR arithmetic, so every date is reduced to a UTC
 * midnight before it is compared or subtracted. Without this a `2026-09-01`
 * stored as a local-midnight timestamp and one stored as a UTC-midnight
 * timestamp differ by hours and a day count comes out one short.
 */
function startOfUtcDay(d: Date | string): Date {
  const dt = d instanceof Date ? d : new Date(d);
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
}

function addUtcDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * MS_PER_DAY);
}

/** Calendar days from `from` to `to`, counting BOTH ends. Sep 1 → Sep 30 is 30. */
function dayCount(from: Date, to: Date): number {
  const n = Math.round((startOfUtcDay(to).getTime() - startOfUtcDay(from).getTime()) / MS_PER_DAY) + 1;
  return n > 0 ? n : 0;
}

/**
 * Days covered by any of `ranges` that also fall inside [windowStart, windowEnd].
 * Overlapping ranges are counted once — two unpaid leave requests spanning the
 * same Friday cost the employee one day, not two.
 */
function overlapDays(
  ranges: Array<{ start: Date; end: Date }>,
  windowStart: Date,
  windowEnd: Date,
): number {
  const days = new Set<number>();
  for (const r of ranges) {
    const from = r.start.getTime() > windowStart.getTime() ? r.start : windowStart;
    const to = r.end.getTime() < windowEnd.getTime() ? r.end : windowEnd;
    for (let t = from.getTime(); t <= to.getTime(); t += MS_PER_DAY) days.add(t);
  }
  return days.size;
}

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
  /**
   * Recalculate a DRAFT/CALCULATED run from scratch.
   *
   * Everything time-sensitive resolves as at the PERIOD's last day, never as at
   * the clock. A September run recalculated in November has to use September's
   * tax table, September's attendance and September's headcount, or a routine
   * correction silently reprices history.
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
    const periodStart = startOfUtcDay(period.startDate);
    const periodEnd = startOfUtcDay(period.endDate);
    if (periodEnd.getTime() < periodStart.getTime())
      throw new BadRequestException('Payroll period ends before it starts');
    // The closing day is INSIDE the period. A `lt: endDate` bound silently
    // dropped every attendance record, leave day and input dated on it.
    const periodEndExclusive = addUtcDays(periodEnd, 1);
    const periodDays = dayCount(periodStart, periodEnd);
    /** Every date-sensitive lookup below resolves as at this instant. */
    const asOf = period.endDate;

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

      // ── Reference data, fetched ONCE ─────────────────────────────────────
      // The per-employee loop below is pure computation. The previous shape
      // issued an attendance aggregate and a component lookup per employee, so
      // a 400-staff school spent ~800 round trips inside one interactive
      // transaction and regularly ran up against the timeout.

      // Anyone hired on or before the closing day is a candidate; leavers are
      // filtered by last working day below, because someone who left on the
      // 12th must still be paid for the first twelve days.
      const employees = await tx.hrEmployee.findMany({
        where: {
          organizationId: orgId,
          deletedAt: null,
          OR: [{ hireDate: null }, { hireDate: { lt: periodEndExclusive } }],
        },
        include: {
          department: true,
          position: true,
          offboardings: {
            where: { deletedAt: null, lastWorkingDay: { not: null } },
            orderBy: { lastWorkingDay: 'desc' },
            take: 1,
          },
        },
        orderBy: { employeeCode: 'asc' },
      });

      const payeTable = await this.activeTaxTable(tx, orgId, 'PAYE', asOf);

      // Attendance summed in JS from one query — `groupBy` is avoided so the
      // tenancy client extension has nothing to reinterpret.
      const attendanceRows = await tx.hrAttendance.findMany({
        where: {
          organizationId: orgId,
          deletedAt: null,
          date: { gte: periodStart, lt: periodEndExclusive },
        },
        select: { employeeId: true, workedMinutes: true, overtimeMinutes: true },
      });
      const attendanceBy = new Map<string, { worked: number; overtime: number }>();
      for (const a of attendanceRows) {
        const acc = attendanceBy.get(a.employeeId) ?? { worked: 0, overtime: 0 };
        acc.worked += a.workedMinutes ?? 0;
        acc.overtime += a.overtimeMinutes ?? 0;
        attendanceBy.set(a.employeeId, acc);
      }

      // Approved leave on an UNPAID leave type is the only leave that changes
      // pay. Paid leave is already inside the salary.
      const unpaidLeave = await tx.hrLeaveRequest.findMany({
        where: {
          organizationId: orgId,
          deletedAt: null,
          status: 'APPROVED',
          startDate: { lt: periodEndExclusive },
          endDate: { gte: periodStart },
          leaveType: { isPaid: false },
        },
        select: { employeeId: true, startDate: true, endDate: true },
      });
      const unpaidLeaveBy = new Map<string, Array<{ start: Date; end: Date }>>();
      for (const l of unpaidLeave) {
        const list = unpaidLeaveBy.get(l.employeeId) ?? [];
        list.push({ start: startOfUtcDay(l.startDate), end: startOfUtcDay(l.endDate) });
        unpaidLeaveBy.set(l.employeeId, list);
      }

      // Ad-hoc inputs for this period. `APPLIED` rows are included only when
      // they were applied by THIS run, so a recalculate is idempotent while a
      // bonus already paid by another run in the same period is not paid twice.
      const inputs = await tx.hrPayrollInput.findMany({
        where: {
          organizationId: orgId,
          periodId: run.periodId,
          deletedAt: null,
          OR: [
            { status: 'APPROVED' },
            { status: 'APPLIED', appliedRunId: id },
          ],
        },
      });
      const inputsBy = new Map<string, any[]>();
      for (const inp of inputs) {
        const list = inputsBy.get(inp.employeeId) ?? [];
        list.push(inp);
        inputsBy.set(inp.employeeId, list);
      }

      // Component catalogue + grade structures, resolved per employee in JS.
      const globalComponents = await tx.hrPayrollComponent.findMany({
        where: { organizationId: orgId, isActive: true, deletedAt: null },
      });
      const structures = await tx.hrSalaryStructure.findMany({
        where: { organizationId: orgId, isActive: true, deletedAt: null },
        include: { component: true },
      });
      const structureByGrade = new Map<string, any[]>();
      for (const st of structures) {
        if (!st.component || st.component.isActive === false || st.component.deletedAt) continue;
        const list = structureByGrade.get(st.gradeId) ?? [];
        list.push({
          ...st.component,
          amount: st.amount ?? st.component.amount,
          rate: st.rate ?? st.component.rate,
        });
        structureByGrade.set(st.gradeId, list);
      }
      const componentsFor = (emp: any) => {
        const gradeId = emp.position?.gradeId ?? null;
        const graded = gradeId ? structureByGrade.get(gradeId) : undefined;
        return graded && graded.length > 0 ? graded : globalComponents;
      };

      // Advances/loans outstanding as at the period close.
      const advances = await tx.hrSalaryAdvance.findMany({
        where: {
          organizationId: orgId,
          deletedAt: null,
          status: { in: ['APPROVED', 'PAID'] },
          OR: [
            { paidAt: null, approvedAt: { lte: asOf } },
            { paidAt: { lte: asOf } },
          ],
        },
      });
      const loans = await tx.hrEmployeeLoan.findMany({
        where: { organizationId: orgId, deletedAt: null, status: 'ACTIVE' },
      });

      const items = [];
      const appliedInputIds: string[] = [];
      for (const emp of employees) {
        // ── Eligibility + pro-rata ───────────────────────────────────────
        // The window an employee was actually on the payroll during this
        // period. Someone hired mid-month or leaving mid-month is paid for
        // the days they held the post, not for the whole month.
        const hire = emp.hireDate ? startOfUtcDay(emp.hireDate) : null;
        const lastDayRaw = emp.offboardings?.[0]?.lastWorkingDay ?? null;
        const lastDay = lastDayRaw ? startOfUtcDay(lastDayRaw) : null;
        const payStart = hire && hire.getTime() > periodStart.getTime() ? hire : periodStart;
        const payEnd = lastDay && lastDay.getTime() < periodEnd.getTime() ? lastDay : periodEnd;
        if (payEnd.getTime() < payStart.getTime()) continue; // not employed in this period
        // An inactive employee with no recorded last working day is a leaver
        // from an earlier period; only a dated exit earns a final payslip.
        if (!emp.isActive && !lastDay) continue;

        const employedDays = dayCount(payStart, payEnd);
        const unpaidLeaveDays = overlapDays(unpaidLeaveBy.get(emp.id) ?? [], payStart, payEnd);
        const paidDaysRaw = employedDays - unpaidLeaveDays;
        const paidDays = paidDaysRaw > 0 ? paidDaysRaw : 0;
        const proRata = periodDays > 0 ? dec(paidDays).dividedBy(dec(periodDays)) : dec(1);
        // Nobody on the payroll for zero paid days and with no worked hours
        // belongs on the register at all — an empty payslip is noise.
        const att = attendanceBy.get(emp.id) ?? { worked: 0, overtime: 0 };
        if (paidDays === 0 && att.worked === 0 && att.overtime === 0) continue;

        // ── 1. Base salary / hourly earnings ─────────────────────────────
        const payFreq = emp.payFrequency ?? 'MONTHLY';
        const baseSalary = emp.baseSalary ? dec(emp.baseSalary) : ZERO;
        const hourlyRate = emp.hourlyRate ? dec(emp.hourlyRate) : ZERO;
        const workedMin = att.worked;
        const overtimeMin = att.overtime;

        // Falls back to a derived hourly rate when none is stored. Derived
        // from the FULL monthly salary — a rate is a rate, pro-rating it as
        // well as the days would cut the pay twice.
        const derivedHourly = hourlyRate.greaterThan(ZERO)
          ? hourlyRate
          : baseSalary.dividedBy(dec(MONTHLY_HOURS));
        // Hourly staff are paid for hours actually worked, which already
        // reflect a short month — pro-rata applies to salaried pay only.
        const baseAmount =
          payFreq === 'HOURLY'
            ? dec(workedMin).dividedBy(60).times(derivedHourly)
            : baseSalary.times(proRata);
        const overtimeHours = dec(overtimeMin).dividedBy(60);
        const overtimePay = overtimeHours
          .times(derivedHourly)
          .times(dec(OVERTIME_MULTIPLIER));
        const earningsBase = baseAmount.plus(overtimePay);

        // Taxable pay is tracked separately from gross: an allowance flagged
        // non-taxable (per-diem, receipted reimbursement) is money the
        // employee receives but is not taxed on. The old code taxed the whole
        // gross, which made `isTaxable` decorative.
        let taxableEarnings = earningsBase;

        // ── 2. Allowances (recurring components) ─────────────────────────
        const components = componentsFor(emp);
        const allowanceLines: any[] = [];
        let allowancesTotal = ZERO;
        for (const c of components) {
          if (c.componentType !== 'ALLOWANCE' || !c.isRecurring) continue;
          if (c.appliesTo && !this.componentApplies(c.appliesTo, emp)) continue;
          let amount = this.componentAmount(c, earningsBase);
          // A FIXED allowance is a monthly entitlement, so half a month earns
          // half of it. A PERCENTAGE allowance already rides on a pro-rated
          // earnings base and must not be scaled twice.
          if (c.calcMethod !== 'PERCENTAGE') amount = amount.times(proRata);
          if (!amount.greaterThan(ZERO)) continue;
          allowancesTotal = allowancesTotal.plus(amount);
          if (c.isTaxable) taxableEarnings = taxableEarnings.plus(amount);
          allowanceLines.push({
            organizationId: orgId,
            name: c.name,
            amount,
            isTaxable: c.isTaxable,
            createdBy: userId,
          });
        }

        // ── 3. Recurring deductions ──────────────────────────────────────
        // Deliberately NOT pro-rated: a fixed deduction is an obligation
        // (union dues, insurance premium), not a share of the month's pay.
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

        // ── 4. Ad-hoc inputs for this period ─────────────────────────────
        let bonusAmount = ZERO;
        let commissionAmount = ZERO;
        for (const inp of inputsBy.get(emp.id) ?? []) {
          const amount = dec(inp.amount);
          if (!amount.greaterThan(ZERO)) continue;
          appliedInputIds.push(inp.id);
          if (inp.inputType === 'DEDUCTION') {
            d.other = d.other.plus(amount);
            deductionLines.push({
              organizationId: orgId,
              name: inp.name,
              amount,
              isTaxable: false,
              createdBy: userId,
            });
            continue;
          }
          if (inp.inputType === 'BONUS') bonusAmount = bonusAmount.plus(amount);
          else if (inp.inputType === 'COMMISSION') commissionAmount = commissionAmount.plus(amount);
          else allowancesTotal = allowancesTotal.plus(amount);
          if (inp.isTaxable) taxableEarnings = taxableEarnings.plus(amount);
          allowanceLines.push({
            organizationId: orgId,
            name: inp.name,
            amount,
            isTaxable: inp.isTaxable,
            createdBy: userId,
          });
        }

        // ── 5. Gross ─────────────────────────────────────────────────────
        const gross = earningsBase
          .plus(allowancesTotal)
          .plus(bonusAmount)
          .plus(commissionAmount);

        // ── 6. PAYE on taxable pay less pension/SSF ──────────────────────
        // Brackets are ANNUAL, so annualise then divide back to the period.
        const taxableRaw = taxableEarnings.minus(d.pension).minus(d.ssf);
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

        // ── 7. Loan + advance installments ───────────────────────────────
        // Capped so net pay never goes negative (which would unbalance the GL
        // journal). Statutory deductions take priority; the remainder is split
        // loans → advances.
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
            // unaffected.
            overtimeHours: overtimeHours.toDecimalPlaces(0).toNumber(),
            overtimePay,
            allowancesTotal,
            commissionAmount,
            bonusAmount,
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
            absenceDays: dec(unpaidLeaveDays),
            unpaidLeaveDays: dec(unpaidLeaveDays),
            periodDays,
            paidDays: dec(paidDays),
            proRataFactor: proRata,
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
          inputsApplied: appliedInputIds.length,
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

      // Ad-hoc inputs consumed by this run are stamped APPLIED so a later run
      // in the same period cannot pay the same bonus a second time. Inside the
      // approval transaction: if the GL posting rolls back, so does this.
      await tx.hrPayrollInput.updateMany({
        where: {
          organizationId: orgId,
          periodId: run.periodId,
          status: 'APPROVED',
          deletedAt: null,
        },
        data: { status: 'APPLIED', appliedRunId: id, updatedBy: userId },
      });

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

      // Reversing has to undo everything approval did, not just the journal.
      // The GL reversal alone left loan balances written down, payslips issued
      // and one-off inputs consumed — so a reversed-and-rerun payroll recovered
      // an installment the employee never repaid and dropped their bonus.
      const items = await tx.hrPayrollItem.findMany({
        where: { runId: id, organizationId: orgId, deletedAt: null },
        select: { employeeId: true, loanDeduction: true, advanceDeduction: true },
      });

      // 1. Loan balances go back up by exactly what this run took.
      const loans = await tx.hrEmployeeLoan.findMany({
        where: { organizationId: orgId, deletedAt: null },
      });
      for (const loan of loans) {
        const taken = sum(
          items
            .filter((i: any) => i.employeeId === loan.employeeId)
            .map((i: any) => dec(i.loanDeduction)),
        );
        if (!taken.greaterThan(ZERO)) continue;
        await tx.hrEmployeeLoan.update({
          where: { id: loan.id },
          data: {
            balance: dec(loan.balance).plus(taken),
            installmentsPaid: loan.installmentsPaid > 0 ? loan.installmentsPaid - 1 : 0,
            // A loan closed by this run is open again now that the repayment
            // has been unwound.
            status: loan.status === 'PAID' ? 'ACTIVE' : loan.status,
            updatedBy: userId,
          },
        });
      }

      // 2. Same for salary advances.
      const advances = await tx.hrSalaryAdvance.findMany({
        where: { organizationId: orgId, deletedAt: null },
      });
      for (const adv of advances) {
        const taken = sum(
          items
            .filter((i: any) => i.employeeId === adv.employeeId)
            .map((i: any) => dec(i.advanceDeduction)),
        );
        if (!taken.greaterThan(ZERO)) continue;
        await tx.hrSalaryAdvance.update({
          where: { id: adv.id },
          data: {
            balance: dec(adv.balance).plus(taken),
            status: adv.status === 'SETTLED' ? 'APPROVED' : adv.status,
            updatedBy: userId,
          },
        });
      }

      // 3. Payslips are cancelled, never deleted — an employee may already hold
      //    a printed copy, so the number has to keep resolving to a voided slip.
      const itemIds = (
        await tx.hrPayrollItem.findMany({
          where: { runId: id, organizationId: orgId },
          select: { id: true },
        })
      ).map((i: any) => i.id);
      await tx.hrPayslip.updateMany({
        where: { organizationId: orgId, itemId: { in: itemIds } },
        data: { status: 'CANCELLED', updatedBy: userId },
      });

      // 4. One-off inputs this run consumed return to APPROVED so the corrected
      //    run picks them up again.
      await tx.hrPayrollInput.updateMany({
        where: { organizationId: orgId, appliedRunId: id, status: 'APPLIED' },
        data: { status: 'APPROVED', appliedRunId: null, updatedBy: userId },
      });

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
        newValues: {
          status: 'REVERSED',
          glPosted: false,
          reason: dto.reason ?? null,
          payslipsCancelled: itemIds.length,
        },
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

  // ── Ad-hoc payroll inputs (one-off bonuses, commissions, deductions) ─────
  //
  // Recurring money is a payroll COMPONENT — configuration that applies to a
  // grade, a department or everyone. One-off money for one person in one period
  // is an INPUT. Keeping them apart is what stops the component catalogue from
  // filling up with "Term 2 bonus — Sarah" rows that then quietly apply forever.

  async listPayrollInputs(query: any = {}) {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId, deletedAt: null };
    if (query.periodId) where.periodId = query.periodId;
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.status) {
      if (!PAYROLL_INPUT_STATUSES.includes(query.status))
        throw new BadRequestException(`status must be one of ${PAYROLL_INPUT_STATUSES.join(', ')}`);
      where.status = query.status;
    }
    if (query.inputType) {
      if (!PAYROLL_INPUT_TYPES.includes(query.inputType))
        throw new BadRequestException(`inputType must be one of ${PAYROLL_INPUT_TYPES.join(', ')}`);
      where.inputType = query.inputType;
    }
    return this.prisma.client.hrPayrollInput.findMany({
      where,
      include: {
        employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
        period: { select: { id: true, periodCode: true, startDate: true, endDate: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  async createPayrollInput(dto: any) {
    return this.createPayrollInputs({ inputs: [dto] }).then((rows) => rows[0]);
  }

  /**
   * Capture one or many inputs in a single act. Bulk is the normal case — a
   * bursar keys a whole bonus list off one memo — and doing it in one
   * transaction means a bad row rejects the entire list instead of leaving half
   * a bonus run behind.
   */
  async createPayrollInputs(dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const rows: any[] = Array.isArray(dto?.inputs) ? dto.inputs : [];
    if (rows.length === 0) throw new BadRequestException('inputs must be a non-empty array');

    const prepared = rows.map((r, idx) => {
      const at = `inputs[${idx}]`;
      if (!r.employeeId) throw new BadRequestException(`${at}.employeeId is required`);
      if (!r.periodId) throw new BadRequestException(`${at}.periodId is required`);
      if (!r.name) throw new BadRequestException(`${at}.name is required`);
      if (!PAYROLL_INPUT_TYPES.includes(r.inputType))
        throw new BadRequestException(`${at}.inputType must be one of ${PAYROLL_INPUT_TYPES.join(', ')}`);
      const amount = dec(r.amount ?? 0);
      if (!amount.greaterThan(ZERO))
        throw new BadRequestException(`${at}.amount must be positive`);
      return {
        organizationId: orgId,
        employeeId: r.employeeId,
        periodId: r.periodId,
        inputType: r.inputType,
        name: String(r.name),
        amount,
        // A reimbursement pays back a cost the employee already bore, so it is
        // not income and defaults to untaxed. Everything else defaults taxable.
        isTaxable: r.isTaxable ?? r.inputType !== 'REIMBURSEMENT',
        reference: r.reference ?? null,
        notes: r.notes ?? null,
        status: 'PENDING',
        createdBy: userId,
      };
    });

    return this.prisma.client.$transaction(async (tx: any) => {
      const periodIds = [...new Set(prepared.map((p) => p.periodId))];
      const periods = await tx.hrPayrollPeriod.findMany({
        where: { id: { in: periodIds }, organizationId: orgId, deletedAt: null },
      });
      const byId = new Map(periods.map((p: any) => [p.id, p]));
      for (const p of prepared) {
        const period: any = byId.get(p.periodId);
        if (!period) throw new NotFoundException(`Payroll period ${p.periodId} not found`);
        // A closed period's numbers are already reported. New money for it has
        // to go through a fresh period, not through a back-dated edit.
        if (period.status !== 'OPEN')
          throw new BadRequestException(`Payroll period ${period.periodCode} is ${period.status} — inputs can only be added to an OPEN period`);
      }
      const employeeIds = [...new Set(prepared.map((p) => p.employeeId))];
      const found = await tx.hrEmployee.findMany({
        where: { id: { in: employeeIds }, organizationId: orgId, deletedAt: null },
        select: { id: true },
      });
      const known = new Set(found.map((e: any) => e.id));
      for (const p of prepared) {
        if (!known.has(p.employeeId))
          throw new NotFoundException(`Employee ${p.employeeId} not found`);
      }

      const created = [];
      for (const p of prepared) {
        created.push(await tx.hrPayrollInput.create({ data: p }));
      }
      await this.audit.recordInTx(tx, {
        entity: 'HrPayrollInput',
        entityId: created.map((c: any) => c.id).join(','),
        action: 'create',
        newValues: { count: created.length, periodIds },
      });
      return created;
    });
  }

  async updatePayrollInput(id: string, dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrPayrollInput.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Payroll input not found');
    // Once a run has paid it, the input is history.
    if (row.status === 'APPLIED')
      throw new BadRequestException('An APPLIED input cannot be edited — reverse the payroll run first');
    const data: any = { updatedBy: userId };
    if (dto.name !== undefined) data.name = String(dto.name);
    if (dto.amount !== undefined) {
      const amount = dec(dto.amount);
      if (!amount.greaterThan(ZERO)) throw new BadRequestException('amount must be positive');
      data.amount = amount;
    }
    if (dto.isTaxable !== undefined) data.isTaxable = !!dto.isTaxable;
    if (dto.reference !== undefined) data.reference = dto.reference;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.inputType !== undefined) {
      if (!PAYROLL_INPUT_TYPES.includes(dto.inputType))
        throw new BadRequestException(`inputType must be one of ${PAYROLL_INPUT_TYPES.join(', ')}`);
      data.inputType = dto.inputType;
    }
    // Editing an approved input drops it back to PENDING: whoever approved an
    // amount did not approve the new one.
    if (row.status === 'APPROVED' && (data.amount || data.inputType))
      Object.assign(data, { status: 'PENDING', approvedById: null, approvedAt: null });
    return this.prisma.client.hrPayrollInput.update({ where: { id }, data });
  }

  /** Approve inputs so `calculateRun` will pick them up. Bulk by design. */
  async approvePayrollInputs(dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const ids: string[] = Array.isArray(dto?.ids) ? dto.ids : [];
    if (ids.length === 0) throw new BadRequestException('ids must be a non-empty array');
    return this.prisma.client.$transaction(async (tx: any) => {
      const rows = await tx.hrPayrollInput.findMany({
        where: { id: { in: ids }, organizationId: orgId, deletedAt: null },
      });
      if (rows.length !== ids.length)
        throw new NotFoundException('One or more payroll inputs were not found');
      for (const r of rows) {
        if (r.status !== 'PENDING')
          throw new BadRequestException(`Input ${r.name} is ${r.status} — only PENDING inputs can be approved`);
      }
      const approvedAt = new Date();
      await tx.hrPayrollInput.updateMany({
        where: { id: { in: ids }, organizationId: orgId },
        data: { status: 'APPROVED', approvedById: userId, approvedAt, updatedBy: userId },
      });
      await this.audit.recordInTx(tx, {
        entity: 'HrPayrollInput',
        entityId: ids.join(','),
        action: 'approve',
        newValues: { count: ids.length, total: sum(rows.map((r: any) => dec(r.amount))).toString() },
      });
      return tx.hrPayrollInput.findMany({ where: { id: { in: ids }, organizationId: orgId } });
    });
  }

  async cancelPayrollInput(id: string, dto: any = {}) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrPayrollInput.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Payroll input not found');
    if (row.status === 'APPLIED')
      throw new BadRequestException('An APPLIED input cannot be cancelled — reverse the payroll run first');
    return this.prisma.client.hrPayrollInput.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        notes: dto.reason ? `${row.notes ? row.notes + ' | ' : ''}cancelled: ${dto.reason}` : row.notes,
        updatedBy: userId,
      },
    });
  }

  async deletePayrollInput(id: string) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrPayrollInput.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Payroll input not found');
    if (row.status === 'APPLIED')
      throw new BadRequestException('An APPLIED input cannot be deleted — reverse the payroll run first');
    return this.prisma.client.hrPayrollInput.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: userId },
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

}

