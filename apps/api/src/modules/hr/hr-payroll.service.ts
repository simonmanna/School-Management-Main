import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { dec, round, sum, ZERO, type Money } from '../../kernel/common/money';
import { PostingService } from '../accounting/posting/posting.service';
import { AccountDeterminationService } from '../accounting/posting/account-determination.service';
import { AccountResolverService } from '../accounting/posting/account-resolver.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const COMPONENT_TYPES = ['ALLOWANCE', 'DEDUCTION'];
const CALC_METHODS = ['FIXED', 'PERCENTAGE'];
const TAX_TYPES = ['PAYE', 'PENSION', 'SOCIAL_SECURITY', 'LOCAL'];
const PERIOD_TYPES = ['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'CUSTOM'];
const PAYMENT_METHODS = ['BANK', 'MOBILE_MONEY', 'CASH', 'CHEQUE'];
const BANK_PAYMENT_STATUSES = ['DRAFT', 'GENERATED', 'SENT', 'PAID', 'CANCELLED'];
const PAYROLL_INPUT_TYPES = ['BONUS', 'COMMISSION', 'ALLOWANCE', 'DEDUCTION', 'REIMBURSEMENT'];
const PAYROLL_INPUT_STATUSES = ['PENDING', 'APPROVED', 'APPLIED', 'CANCELLED'];
/** Deduction categories — where a deduction's credit posts. See HrPayrollComponent.deductionCategory. */
const DEDUCTION_CATEGORIES = ['PENSION', 'SOCIAL_SECURITY', 'INSURANCE', 'OTHER_PAYABLE', 'RECOVERY'];
const CONTRIBUTION_BASES = ['GROSS', 'BASIC'];

const MONTHLY_HOURS = 173.33;
/** Standard hours in one unit of `baseSalary`, per pay frequency — for a derived hourly (overtime) rate. */
const STANDARD_HOURS: Record<string, number> = { MONTHLY: MONTHLY_HOURS, BIWEEKLY: 80, WEEKLY: 40, DAILY: 8 };
/** Default overtime premium; override per org with a statutory config of type OVERTIME. */
const DEFAULT_OVERTIME_MULTIPLIER = 1.5;
/** Pay periods per year by period type. CUSTOM periods derive it from their length. */
const PERIODS_PER_YEAR: Record<string, number> = { WEEKLY: 52, BIWEEKLY: 26, MONTHLY: 12 };

/**
 * Journal accounts payroll posts to that orgs created before 2026-09-21 may not
 * have mapped yet. Resolved through `ensureByCode`, which maps the seeded COA
 * account when present and provisions it otherwise — a payroll run must never
 * fail because a newer mapping was not configured by hand.
 */
const PAYROLL_AUTO_ACCOUNTS = {
  employer_contribution_expense: { code: '5720', name: 'Employer Statutory Contributions', categoryKey: 'operating_expense', mappingKey: 'employer_contribution_expense' },
  local_tax_payable: { code: '2250', name: 'Local Service Tax Payable', categoryKey: 'current_liability', mappingKey: 'local_tax_payable' },
  other_deductions_payable: { code: '2260', name: 'Payroll Deductions Payable', categoryKey: 'current_liability', mappingKey: 'other_deductions_payable' },
  staff_loan_interest_income: { code: '4290', name: 'Staff Loan Interest Income', categoryKey: 'other_income', mappingKey: 'staff_loan_interest_income' },
} as const;

/** Legacy deduction classification by component code, for components with no explicit category. */
function legacyDeductionCategory(code: string | null | undefined): string {
  const up = (code ?? '').toUpperCase();
  if (up.includes('PENSION')) return 'PENSION';
  if (up.includes('SSF') || up.includes('SOCIAL') || up.includes('NSSF')) return 'SOCIAL_SECURITY';
  if (up.includes('INSURANCE')) return 'INSURANCE';
  return 'RECOVERY';
}

/** HrPaymentMethod → the settlement-account method key AccountDeterminationService understands. */
function settlementMethodKey(method: string | null | undefined): string {
  switch (method) {
    case 'BANK':
      return 'bank';
    case 'CHEQUE':
      return 'cheque';
    case 'MOBILE_MONEY':
      return 'mobile_money';
    default:
      return 'cash';
  }
}
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
    private readonly resolver: AccountResolverService,
  ) {}

  // ── Shared helpers ───────────────────────────────────────────────────────

  /** Minor-unit precision of the organisation's currency (UGX 0, USD 2). */
  private async currencyDecimals(tx: any, orgId: string): Promise<number> {
    const org = await tx.organization.findUnique({ where: { id: orgId }, select: { currencyCode: true } });
    if (!org?.currencyCode) return 2;
    const cur = await tx.currency.findUnique({ where: { code: org.currencyCode }, select: { decimalPlaces: true } });
    return cur?.decimalPlaces ?? 2;
  }

  /** A payroll-owned account that may pre-date the org's mapping set. */
  private autoAccount(key: keyof typeof PAYROLL_AUTO_ACCOUNTS, tx: any): Promise<string> {
    const def = PAYROLL_AUTO_ACCOUNTS[key];
    return this.resolver.ensureByCode(def.code, def, tx);
  }

  /** Bank / cash / mobile-money clearing account money leaves from. */
  private settlementAccount(method: string | null | undefined, tx: any): Promise<string> {
    return this.accounts.settlementAccount(settlementMethodKey(method), tx);
  }

  /**
   * Serialise concurrent writers on one key for the life of the transaction.
   * Used where a check-then-insert would otherwise race (two runs for one
   * period, two bank batches for one run).
   */
  private async lockKey(tx: any, key: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  }

  /**
   * Claim a row's state transition. Postgres re-evaluates the WHERE after a
   * concurrent writer commits, so exactly one of two simultaneous approvals
   * (or leave decisions, or payments) sees count 1 — the check and the write
   * are one statement, never a read followed by a write.
   */
  private async claim(delegate: any, id: string, orgId: string, from: string[], data: any, message: string) {
    const res = await delegate.updateMany({
      where: { id, organizationId: orgId, status: { in: from } },
      data,
    });
    if (res.count !== 1) throw new ConflictException(message);
  }

  private async employeeIdForUser(tx: any, orgId: string, userId: string | undefined): Promise<string | null> {
    if (!userId) return null;
    const emp = await tx.hrEmployee.findFirst({ where: { organizationId: orgId, userId }, select: { id: true } });
    return emp?.id ?? null;
  }

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
    this.assertDeductionCategory(dto.componentType, dto.deductionCategory);
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
        deductionCategory: dto.componentType === 'DEDUCTION' ? (dto.deductionCategory ?? null) : null,
        isActive: dto.isActive ?? true,
        createdBy: userId,
      },
    });
  }

  private assertDeductionCategory(componentType: string | undefined, category: string | null | undefined) {
    if (category === undefined || category === null) return;
    if (componentType && componentType !== 'DEDUCTION')
      throw new BadRequestException('deductionCategory applies to DEDUCTION components only');
    if (!DEDUCTION_CATEGORIES.includes(category))
      throw new BadRequestException(`Invalid deductionCategory: ${category}`);
  }

  async updateComponent(id: string, dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrPayrollComponent.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!row) throw new NotFoundException('Component not found');
    this.assertDeductionCategory(dto.componentType ?? row.componentType, dto.deductionCategory);
    const data: any = {};
    for (const f of ['name', 'componentType', 'calcMethod', 'amount', 'rate', 'isTaxable', 'isRecurring', 'appliesTo', 'deductionCategory', 'isActive']) {
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

  /**
   * Brackets MUST be filtered explicitly. The tenancy extension's soft-delete
   * filter only rewrites the top-level `where`; a nested `include` is not
   * touched. `updateTaxTable` soft-deletes the old bands and inserts new ones,
   * so without this filter a PAYE computation summed the old AND the new
   * bands — tax doubled after any table edit.
   */
  private static readonly LIVE_BRACKETS = {
    where: { deletedAt: null },
    orderBy: { fromAmount: 'asc' as const },
  };

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
        include: { brackets: HrPayrollService.LIVE_BRACKETS },
      }),
      this.prisma.client.hrTaxTable.count({ where }),
    ]);
    return { rows, total };
  }

  private validateBrackets(taxType: string, brackets: any[]) {
    let prevTo: Money | null = null;
    const sorted = [...brackets].sort((a, b) => Number(a.fromAmount) - Number(b.fromAmount));
    sorted.forEach((b, i) => {
      const from = dec(b.fromAmount ?? 0);
      const to = b.toAmount === undefined || b.toAmount === null ? null : dec(b.toAmount);
      if (to !== null && to.lessThanOrEqualTo(from))
        throw new BadRequestException(`Bracket ${i + 1}: toAmount must be greater than fromAmount`);
      if (to === null && i !== sorted.length - 1)
        throw new BadRequestException('Only the highest bracket may be open-ended (no toAmount)');
      if (prevTo !== null && from.lessThan(prevTo))
        throw new BadRequestException(`Bracket ${i + 1} overlaps the band below it`);
      if (taxType === 'PAYE' && dec(b.rate ?? 0).greaterThan(1))
        throw new BadRequestException('PAYE bracket rate is a FRACTION (0.3 = 30%), not a percentage');
      prevTo = to;
    });
  }

  private parseCollectionMonths(v: string | null | undefined): string | null {
    if (v === undefined || v === null || String(v).trim() === '') return null;
    const months = String(v).split(',').map((m) => Number(m.trim()));
    if (months.some((m) => !Number.isInteger(m) || m < 1 || m > 12))
      throw new BadRequestException('collectionMonths must be comma-separated months 1–12, e.g. "7,8,9,10"');
    return [...new Set(months)].sort((a, b) => a - b).join(',');
  }

  private bracketRows(orgId: string, taxTableId: string, userId: string | undefined, brackets: any[]) {
    return brackets.map((b) => ({
      organizationId: orgId,
      taxTableId,
      fromAmount: b.fromAmount,
      toAmount: b.toAmount ?? null,
      rate: b.rate ?? 0,
      fixedAmount: b.fixedAmount ?? null,
      createdBy: userId,
    }));
  }

  async createTaxTable(dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    if (!dto.code || !dto.name || !dto.effectiveFrom)
      throw new BadRequestException('code, name and effectiveFrom are required');
    if (dto.taxType && !TAX_TYPES.includes(dto.taxType))
      throw new BadRequestException(`Invalid taxType: ${dto.taxType}`);
    const code = String(dto.code).toUpperCase();
    const existing = await this.prisma.client.hrTaxTable.findUnique({
      where: { organizationId_code: { organizationId: orgId, code } },
    });
    if (existing) throw new BadRequestException(`Tax table code "${code}" already exists`);
    const taxType = dto.taxType ?? 'PAYE';
    const brackets = Array.isArray(dto.brackets) ? dto.brackets : [];
    this.validateBrackets(taxType, brackets);
    return this.prisma.client.$transaction(async (tx: any) => {
      const table = await tx.hrTaxTable.create({
        data: {
          organizationId: orgId,
          code,
          name: dto.name,
          countryCode: dto.countryCode ?? null,
          taxType,
          effectiveFrom: new Date(dto.effectiveFrom),
          contributionsDeductible: dto.contributionsDeductible ?? false,
          collectionMonths: this.parseCollectionMonths(dto.collectionMonths),
          isActive: dto.isActive ?? true,
          createdBy: userId,
        },
      });
      if (brackets.length > 0)
        await tx.hrTaxBracket.createMany({ data: this.bracketRows(orgId, table.id, userId, brackets) });
      await this.audit.recordInTx(tx, {
        entity: 'HrTaxTable',
        entityId: table.id,
        action: 'create',
        newValues: { code, taxType, effectiveFrom: table.effectiveFrom, brackets },
      });
      return tx.hrTaxTable.findUnique({
        where: { id: table.id },
        include: { brackets: HrPayrollService.LIVE_BRACKETS },
      });
    });
  }

  async updateTaxTable(id: string, dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrTaxTable.findFirst({
      where: { id, organizationId: orgId },
      include: { brackets: HrPayrollService.LIVE_BRACKETS },
    });
    if (!row) throw new NotFoundException('Tax table not found');
    const taxType = dto.taxType ?? row.taxType;
    if (Array.isArray(dto.brackets)) this.validateBrackets(taxType, dto.brackets);
    return this.prisma.client.$transaction(async (tx: any) => {
      const table = await tx.hrTaxTable.update({
        where: { id },
        data: {
          name: dto.name ?? row.name,
          countryCode: dto.countryCode !== undefined ? dto.countryCode : row.countryCode,
          taxType,
          effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : row.effectiveFrom,
          contributionsDeductible: dto.contributionsDeductible ?? row.contributionsDeductible,
          collectionMonths:
            dto.collectionMonths !== undefined ? this.parseCollectionMonths(dto.collectionMonths) : row.collectionMonths,
          isActive: dto.isActive ?? row.isActive,
          updatedBy: userId,
        },
      });
      if (Array.isArray(dto.brackets)) {
        await tx.hrTaxBracket.updateMany({
          where: { taxTableId: id, organizationId: orgId, deletedAt: null },
          data: { deletedAt: new Date() },
        });
        if (dto.brackets.length > 0)
          await tx.hrTaxBracket.createMany({ data: this.bracketRows(orgId, id, userId, dto.brackets) });
      }
      // Tax tables price every future recalculation, so every edit is audited
      // with the bands it replaced.
      await this.audit.recordInTx(tx, {
        entity: 'HrTaxTable',
        entityId: id,
        action: 'update',
        oldValues: {
          effectiveFrom: row.effectiveFrom,
          contributionsDeductible: row.contributionsDeductible,
          brackets: row.brackets.map((b: any) => ({ from: String(b.fromAmount), to: b.toAmount === null ? null : String(b.toAmount), rate: String(b.rate) })),
        },
        newValues: { ...dto },
      });
      return tx.hrTaxTable.findUnique({
        where: { id: table.id },
        include: { brackets: HrPayrollService.LIVE_BRACKETS },
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
   * Local service tax for one period. Bands are MONTHLY income bands (the way
   * the law states them); a band carries either a fixed ANNUAL charge
   * (`fixedAmount`, collected in equal instalments over `collectionMonths`) or
   * a rate on the month's income.
   */
  private computeLocalTax(
    table: any,
    monthlyIncome: Money,
    periodEnd: Date,
    periodType: string,
    dp: number,
  ): Money {
    if (!table || periodType !== 'MONTHLY') return ZERO;
    const months = table.collectionMonths
      ? String(table.collectionMonths).split(',').map((m: string) => Number(m))
      : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    if (!months.includes(periodEnd.getUTCMonth() + 1)) return ZERO;
    const band = (table.brackets as any[]).find((b) => {
      const from = dec(b.fromAmount);
      const to = b.toAmount === null || b.toAmount === undefined ? null : dec(b.toAmount);
      return monthlyIncome.greaterThanOrEqualTo(from) && (to === null || monthlyIncome.lessThanOrEqualTo(to));
    });
    if (!band) return ZERO;
    if (band.fixedAmount !== null && band.fixedAmount !== undefined)
      return round(dec(band.fixedAmount).dividedBy(months.length), dp);
    return round(monthlyIncome.times(dec(band.rate ?? 0)), dp);
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
      include: { brackets: HrPayrollService.LIVE_BRACKETS },
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

  /** Two periods of the same type may not cover the same day — that is how one month gets paid twice. */
  private async assertNoOverlap(orgId: string, periodType: string, start: Date, end: Date, excludeId?: string) {
    const clash = await this.prisma.client.hrPayrollPeriod.findFirst({
      where: {
        organizationId: orgId,
        periodType: periodType as any,
        startDate: { lte: end },
        endDate: { gte: start },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { periodCode: true },
    });
    if (clash) throw new BadRequestException(`Period overlaps existing period ${clash.periodCode}`);
  }

  async createPeriod(dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    if (!dto.startDate || !dto.endDate)
      throw new BadRequestException('startDate and endDate are required');
    if (dto.periodType && !PERIOD_TYPES.includes(dto.periodType))
      throw new BadRequestException(`Invalid periodType: ${dto.periodType}`);
    const startDate = startOfUtcDay(dto.startDate);
    const endDate = startOfUtcDay(dto.endDate);
    if (endDate < startDate) throw new BadRequestException('endDate must be after startDate');
    const periodType = dto.periodType ?? 'MONTHLY';
    // Auto-generate periodCode: PRD-YYYY-MM (UTC — a local-time month flips at midnight UTC+3).
    const code =
      dto.periodCode ??
      `PRD-${startDate.getUTCFullYear()}-${String(startDate.getUTCMonth() + 1).padStart(2, '0')}`;
    const existing = await this.prisma.client.hrPayrollPeriod.findUnique({
      where: { organizationId_periodCode: { organizationId: orgId, periodCode: code } },
    });
    if (existing) throw new BadRequestException(`Period code "${code}" already exists`);
    await this.assertNoOverlap(orgId, periodType, startDate, endDate);
    return this.prisma.client.hrPayrollPeriod.create({
      data: {
        organizationId: orgId,
        periodCode: code,
        periodType,
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
    const datesChange = dto.startDate !== undefined || dto.endDate !== undefined;
    if (datesChange) {
      // A posted run's pro-rata, tax and journal date all came from these
      // dates; moving them afterwards makes every payslip unexplainable.
      const posted = await this.prisma.client.hrPayrollRun.findFirst({
        where: { organizationId: orgId, periodId: id, status: { in: ['APPROVED', 'PAID'] } },
        select: { runNumber: true },
      });
      if (posted)
        throw new BadRequestException(`Run ${posted.runNumber} is approved for this period — reverse it before changing the dates`);
      const start = dto.startDate !== undefined ? startOfUtcDay(dto.startDate) : startOfUtcDay(row.startDate);
      const end = dto.endDate !== undefined ? startOfUtcDay(dto.endDate) : startOfUtcDay(row.endDate);
      if (end < start) throw new BadRequestException('endDate must be after startDate');
      await this.assertNoOverlap(orgId, row.periodType, start, end, id);
      data.startDate = start;
      data.endDate = end;
    }
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

  private assertPeriodOpen(period: any) {
    if (period.status !== 'OPEN')
      throw new BadRequestException(`Payroll period ${period.periodCode} is ${period.status} — reopen it first`);
  }

  async createRun(dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    if (!dto.periodId) throw new BadRequestException('periodId is required');
    const period = await this.prisma.client.hrPayrollPeriod.findFirst({
      where: { id: dto.periodId, organizationId: orgId },
    });
    if (!period) throw new NotFoundException('Payroll period not found');
    this.assertPeriodOpen(period);
    return this.prisma.client.$transaction(async (tx: any) => {
      // Two clerks pressing "new run" at once must not both pass the check.
      await this.lockKey(tx, `hr_payroll_run:${orgId}:${period.id}`);
      const existingRun = await tx.hrPayrollRun.findFirst({
        where: { organizationId: orgId, periodId: period.id, deletedAt: null, status: { not: 'REVERSED' } },
      });
      if (existingRun)
        throw new BadRequestException(`Run ${existingRun.runNumber} already exists for this period (reverse or delete it first)`);
      const runNumber = await this.seq.next('hr_payroll_run', { prefix: 'PR-', padding: 6 }, tx);
      return tx.hrPayrollRun.create({
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
    });
  }

  /** Latest version of each statutory config code effective at `asOf`, retired versions dropped. */
  private async activeStatutoryConfigs(tx: any, orgId: string, asOf: Date) {
    const rows = await tx.hrStatutoryConfig.findMany({
      where: { organizationId: orgId, deletedAt: null, effectiveFrom: { lte: asOf } },
      orderBy: { effectiveFrom: 'desc' },
    });
    const latest = new Map<string, any>();
    for (const r of rows) if (!latest.has(r.code)) latest.set(r.code, r);
    return [...latest.values()].filter((r) => r.isActive);
  }

  /**
   * Recalculate a DRAFT/CALCULATED run from scratch.
   *
   * Everything time-sensitive resolves as at the PERIOD's last day, never as at
   * the clock. A September run recalculated in November has to use September's
   * tax table, September's attendance and September's headcount, or a routine
   * correction silently reprices history.
   *
   * Every money figure is rounded to the currency's minor unit AS IT IS
   * PRODUCED, so an item's totals are exact sums of its stored lines and the
   * journal built from them balances without a rounding line.
   *
   * Every deduction and allowance line records its source (component, input,
   * loan, advance, statutory config). Approval and reversal settle exactly those
   * sources; nothing downstream reconstructs them from per-employee totals.
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
    this.assertPeriodOpen(period);
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
    // Annual tax bands are applied to a period by annualising: a weekly run
    // must multiply by 52, not by 12.
    const periodsPerYear = dec(PERIODS_PER_YEAR[period.periodType] ?? 365 / Math.max(periodDays, 1));
    /** Monthly caps (contribution ceilings) scale to the period by this. */
    const monthsInPeriod = dec(12).dividedBy(periodsPerYear);

    return this.prisma.client.$transaction(async (tx: any) => {
      await this.claim(
        tx.hrPayrollRun, id, orgId, ['DRAFT', 'CALCULATED'], { updatedBy: userId },
        'Run changed status while calculating — reload and try again',
      );
      const dp = await this.currencyDecimals(tx, orgId);
      const r = (m: Money) => round(m, dp);

      // Delete stale items + their child lines/payslips, in bulk.
      const staleIds = (
        await tx.hrPayrollItem.findMany({ where: { runId: id, organizationId: orgId }, select: { id: true } })
      ).map((si: any) => si.id);
      if (staleIds.length > 0) {
        await tx.hrPayrollAllowance.deleteMany({ where: { itemId: { in: staleIds } } });
        await tx.hrPayrollDeduction.deleteMany({ where: { itemId: { in: staleIds } } });
        await tx.hrPayslip.deleteMany({ where: { itemId: { in: staleIds } } });
        await tx.hrPayrollItem.deleteMany({ where: { id: { in: staleIds } } });
      }

      // ── Reference data, fetched ONCE ─────────────────────────────────────
      // The per-employee loop below is pure computation.

      // PAYE is not optional. A missing table used to compute zero tax for the
      // whole school without a word; an exempt organisation says so with a 0% table.
      const payeTable = await this.activeTaxTable(tx, orgId, 'PAYE', asOf);
      if (!payeTable)
        throw new BadRequestException(
          `No active PAYE tax table is effective on ${periodEnd.toISOString().slice(0, 10)}. ` +
            'Configure one (a single 0% band if staff are genuinely exempt) before calculating payroll.',
        );
      const localTable = await this.activeTaxTable(tx, orgId, 'LOCAL', asOf);
      const statutory = await this.activeStatutoryConfigs(tx, orgId, asOf);
      const contributions = statutory.filter((c: any) => c.configType === 'PENSION' || c.configType === 'SOCIAL_SECURITY');
      const overtimeCfg = statutory.find((c: any) => c.configType === 'OVERTIME');
      const overtimeMultiplier = overtimeCfg?.rate ? dec(overtimeCfg.rate) : dec(DEFAULT_OVERTIME_MULTIPLIER);
      const statutoryCategories = new Set(contributions.map((c: any) => c.configType));

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
      const attendanceBy = new Map<string, { worked: number; overtime: number; days: number }>();
      for (const a of attendanceRows) {
        const acc = attendanceBy.get(a.employeeId) ?? { worked: 0, overtime: 0, days: 0 };
        acc.worked += a.workedMinutes ?? 0;
        acc.overtime += a.overtimeMinutes ?? 0;
        if ((a.workedMinutes ?? 0) > 0) acc.days += 1;
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
        orderBy: { createdAt: 'asc' },
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
        orderBy: { code: 'asc' },
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

      // Advances are recovered only once they have actually been PAID OUT —
      // recovering an approved-but-unpaid advance takes money the employee
      // never received. Loans likewise only once disbursed through the ledger.
      const advances = await tx.hrSalaryAdvance.findMany({
        where: {
          organizationId: orgId,
          deletedAt: null,
          status: 'PAID',
          paidAt: { lt: periodEndExclusive },
        },
        orderBy: { paidAt: 'asc' },
      });
      const loans = await tx.hrEmployeeLoan.findMany({
        where: {
          organizationId: orgId,
          deletedAt: null,
          status: 'ACTIVE',
          disbursementJournalEntryId: { not: null },
          disbursedAt: { lt: periodEndExclusive },
        },
        orderBy: { disbursedAt: 'asc' },
      });

      const itemRows: any[] = [];
      const allowanceRows: any[] = [];
      const deductionRows: any[] = [];
      const appliedInputIds: string[] = [];
      for (const emp of employees) {
        // ── Eligibility + pro-rata ───────────────────────────────────────
        const hire = emp.hireDate ? startOfUtcDay(emp.hireDate) : null;
        const lastDayRaw = emp.offboardings?.[0]?.lastWorkingDay ?? null;
        const lastDay = lastDayRaw ? startOfUtcDay(lastDayRaw) : null;
        const payStart = hire && hire.getTime() > periodStart.getTime() ? hire : periodStart;
        const payEnd = lastDay && lastDay.getTime() < periodEnd.getTime() ? lastDay : periodEnd;
        if (payEnd.getTime() < payStart.getTime()) continue; // not employed in this period
        // An inactive employee with no recorded last working day is a leaver
        // from an earlier period; only a dated exit earns a final payslip.
        if (!emp.isActive && !lastDay) continue;
        // `baseSalary` is a salary PER PAY FREQUENCY. A monthly salary in a
        // weekly period would be paid in full every week, so salaried staff are
        // paid only in periods of their own frequency. Hourly and daily staff
        // are paid for what they worked, in whatever period it falls. CUSTOM
        // periods keep the historical behaviour (base pro-rated by days).
        const payFreq = emp.payFrequency ?? 'MONTHLY';
        const salaried = payFreq === 'MONTHLY' || payFreq === 'WEEKLY' || payFreq === 'BIWEEKLY';
        if (salaried && period.periodType !== 'CUSTOM' && payFreq !== period.periodType) continue;
        /** The final payslip: outstanding loans and advances are recovered in full. */
        const isFinalPay = lastDay !== null && lastDay.getTime() <= periodEnd.getTime();

        const employedDays = dayCount(payStart, payEnd);
        const unpaidLeaveDays = overlapDays(unpaidLeaveBy.get(emp.id) ?? [], payStart, payEnd);
        const paidDaysRaw = employedDays - unpaidLeaveDays;
        const paidDays = paidDaysRaw > 0 ? paidDaysRaw : 0;
        const proRata = periodDays > 0 ? dec(paidDays).dividedBy(dec(periodDays)) : dec(1);
        const att = attendanceBy.get(emp.id) ?? { worked: 0, overtime: 0, days: 0 };
        const empInputs = inputsBy.get(emp.id) ?? [];
        // Nobody on the payroll for zero paid days, with no worked hours and no
        // one-off money belongs on the register at all.
        if (paidDays === 0 && att.worked === 0 && att.overtime === 0 && empInputs.length === 0) continue;

        const itemId = randomUUID();
        const line = (name: string, amount: Money, isTaxable: boolean, sourceType: string, sourceId: string | null) => ({
          id: randomUUID(),
          organizationId: orgId,
          itemId,
          name,
          amount,
          isTaxable,
          sourceType,
          sourceId,
          createdBy: userId,
        });

        // ── 1. Base salary / hourly earnings ─────────────────────────────
        const baseSalary = emp.baseSalary ? dec(emp.baseSalary) : ZERO;
        const hourlyRate = emp.hourlyRate ? dec(emp.hourlyRate) : ZERO;
        const workedMin = att.worked;
        const overtimeMin = att.overtime;

        // Falls back to a derived hourly rate when none is stored. Derived
        // from the FULL monthly salary — a rate is a rate, pro-rating it as
        // well as the days would cut the pay twice.
        const derivedHourly = hourlyRate.greaterThan(ZERO)
          ? hourlyRate
          : baseSalary.dividedBy(dec(STANDARD_HOURS[payFreq] ?? MONTHLY_HOURS));
        // Hourly staff are paid for hours actually worked and daily staff for
        // days actually attended (`baseSalary` is then the DAY rate) — both
        // already reflect a short month, so pro-rata applies to salaried pay only.
        const baseAmount = r(
          payFreq === 'HOURLY'
            ? dec(workedMin).dividedBy(60).times(derivedHourly)
            : payFreq === 'DAILY'
              ? baseSalary.times(att.days)
              : baseSalary.times(proRata),
        );
        const overtimeHours = dec(overtimeMin).dividedBy(60);
        const overtimePay = r(overtimeHours.times(derivedHourly).times(overtimeMultiplier));
        const earningsBase = baseAmount.plus(overtimePay);

        // Taxable pay is tracked separately from gross: an allowance flagged
        // non-taxable (per-diem, receipted reimbursement) is money the
        // employee receives but is not taxed on.
        let taxableEarnings = earningsBase;
        /** Reimbursements are not wages: excluded from the contribution base. */
        let reimbursements = ZERO;

        // ── 2. Allowances (recurring components) ─────────────────────────
        const components = componentsFor(emp);
        let allowancesTotal = ZERO;
        for (const c of components) {
          if (c.componentType !== 'ALLOWANCE' || !c.isRecurring) continue;
          if (c.appliesTo && !this.componentApplies(c.appliesTo, emp)) continue;
          let amount = this.componentAmount(c, earningsBase);
          // A FIXED allowance is a monthly entitlement, so half a month earns
          // half of it. A PERCENTAGE allowance already rides on a pro-rated
          // earnings base and must not be scaled twice.
          if (c.calcMethod !== 'PERCENTAGE') amount = amount.times(proRata);
          amount = r(amount);
          if (!amount.greaterThan(ZERO)) continue;
          allowancesTotal = allowancesTotal.plus(amount);
          if (c.isTaxable) taxableEarnings = taxableEarnings.plus(amount);
          allowanceRows.push(line(c.name, amount, c.isTaxable, 'COMPONENT', c.id));
        }

        // ── 3. Recurring deductions ──────────────────────────────────────
        // Deliberately NOT pro-rated: a fixed deduction is an obligation
        // (union dues, insurance premium), not a share of the month's pay.
        const d = { pension: ZERO, ssf: ZERO, insurance: ZERO, otherPayable: ZERO, recovery: ZERO };
        for (const c of components) {
          if (c.componentType !== 'DEDUCTION' || !c.isRecurring) continue;
          if (c.appliesTo && !this.componentApplies(c.appliesTo, emp)) continue;
          const category = c.deductionCategory ?? legacyDeductionCategory(c.code);
          // A contribution configured BOTH as a statutory config and as a
          // component would be deducted twice. Refuse rather than guess.
          if (statutoryCategories.has(category))
            throw new BadRequestException(
              `Component ${c.code} is a ${category} deduction, but ${category} is already configured as a ` +
                'statutory contribution. Deactivate one of them so staff are not deducted twice.',
            );
          const amount = r(this.componentAmount(c, earningsBase));
          if (!amount.greaterThan(ZERO)) continue;
          if (category === 'PENSION') d.pension = d.pension.plus(amount);
          else if (category === 'SOCIAL_SECURITY') d.ssf = d.ssf.plus(amount);
          else if (category === 'INSURANCE') d.insurance = d.insurance.plus(amount);
          else if (category === 'OTHER_PAYABLE') d.otherPayable = d.otherPayable.plus(amount);
          else d.recovery = d.recovery.plus(amount);
          deductionRows.push(line(c.name, amount, false, 'COMPONENT', c.id));
        }

        // ── 4. Ad-hoc inputs for this period ─────────────────────────────
        let bonusAmount = ZERO;
        let commissionAmount = ZERO;
        for (const inp of empInputs) {
          const amount = r(dec(inp.amount));
          if (!amount.greaterThan(ZERO)) continue;
          appliedInputIds.push(inp.id);
          if (inp.inputType === 'DEDUCTION') {
            d.recovery = d.recovery.plus(amount);
            deductionRows.push(line(inp.name, amount, false, 'INPUT', inp.id));
            continue;
          }
          if (inp.inputType === 'BONUS') bonusAmount = bonusAmount.plus(amount);
          else if (inp.inputType === 'COMMISSION') commissionAmount = commissionAmount.plus(amount);
          else allowancesTotal = allowancesTotal.plus(amount);
          if (inp.inputType === 'REIMBURSEMENT') reimbursements = reimbursements.plus(amount);
          if (inp.isTaxable) taxableEarnings = taxableEarnings.plus(amount);
          allowanceRows.push(line(inp.name, amount, inp.isTaxable, 'INPUT', inp.id));
        }

        // ── 5. Gross ─────────────────────────────────────────────────────
        const gross = earningsBase.plus(allowancesTotal).plus(bonusAmount).plus(commissionAmount);

        // ── 6. Statutory contributions (versioned config) ────────────────
        // Employee share is a deduction; employer share is a cost to the
        // school carried on the item for the GL and the statutory return.
        let employerPension = ZERO;
        let employerSsf = ZERO;
        const contributableGross = gross.minus(reimbursements);
        for (const cfg of contributions) {
          let base = cfg.contributionBase === 'BASIC' ? earningsBase : contributableGross;
          if (cfg.ceiling !== null && cfg.ceiling !== undefined) {
            const cap = dec(cfg.ceiling).times(monthsInPeriod);
            if (base.greaterThan(cap)) base = cap;
          }
          const employeeShare = r(base.times(dec(cfg.rate ?? 0)));
          const employerShare = r(base.times(dec(cfg.employerRate ?? 0)));
          if (cfg.configType === 'PENSION') {
            d.pension = d.pension.plus(employeeShare);
            employerPension = employerPension.plus(employerShare);
          } else {
            d.ssf = d.ssf.plus(employeeShare);
            employerSsf = employerSsf.plus(employerShare);
          }
          if (employeeShare.greaterThan(ZERO))
            deductionRows.push(line(cfg.name, employeeShare, false, 'STATUTORY', cfg.id));
        }

        // ── 7. Local service tax ─────────────────────────────────────────
        const monthlyGross = gross.times(periodsPerYear).dividedBy(12);
        const localTax = this.computeLocalTax(localTable, monthlyGross, periodEnd, period.periodType, dp);
        if (localTax.greaterThan(ZERO))
          deductionRows.push(line(localTable.name ?? 'Local Service Tax', localTax, false, 'LOCAL_TAX', localTable.id));

        // ── 8. PAYE ──────────────────────────────────────────────────────
        // Whether contributions reduce the PAYE base is country law, carried
        // on the tax table: Uganda NO, Kenya yes. Brackets are ANNUAL, so
        // annualise with the period's real frequency, then divide back.
        let taxableIncome = taxableEarnings;
        if (payeTable.contributionsDeductible) taxableIncome = taxableIncome.minus(d.pension).minus(d.ssf);
        if (localTable?.contributionsDeductible) taxableIncome = taxableIncome.minus(localTax);
        if (!taxableIncome.greaterThan(ZERO)) taxableIncome = ZERO;
        const tax = r(
          this.computeProgressive(taxableIncome.times(periodsPerYear), payeTable.brackets).dividedBy(periodsPerYear),
        );
        if (tax.greaterThan(ZERO)) deductionRows.push(line('PAYE Tax', tax, false, 'PAYE', payeTable.id));

        // ── 9. Loan + advance installments ───────────────────────────────
        // Capped so net pay never goes negative. Statutory deductions take
        // priority; the remainder is split loans → advances. On the final
        // payslip the whole outstanding balance is recovered where pay allows.
        const other = d.otherPayable.plus(d.recovery);
        const statutoryDeductions = sum([tax, d.pension, d.ssf, d.insurance, other, localTax]);
        const availableRaw = gross.minus(statutoryDeductions);
        let available = availableRaw.greaterThan(ZERO) ? availableRaw : ZERO;
        let loanDeduction = ZERO;
        let advanceDeduction = ZERO;
        for (const loan of loans) {
          if (loan.employeeId !== emp.id || !dec(loan.balance).greaterThan(ZERO)) continue;
          if (!available.greaterThan(ZERO)) break;
          const planned = isFinalPay ? dec(loan.balance) : dec(loan.installmentAmount);
          const installment = r(this.cappedInstallment(planned, dec(loan.balance), available));
          if (!installment.greaterThan(ZERO)) continue;
          loanDeduction = loanDeduction.plus(installment);
          available = available.minus(installment);
          deductionRows.push(line(`Loan ${loan.loanCode}`, installment, false, 'LOAN', loan.id));
        }
        for (const adv of advances) {
          if (adv.employeeId !== emp.id || !dec(adv.balance).greaterThan(ZERO)) continue;
          if (!available.greaterThan(ZERO)) break;
          const planned = isFinalPay ? dec(adv.balance) : dec(adv.monthlyDeduction);
          const installment = r(this.cappedInstallment(planned, dec(adv.balance), available));
          if (!installment.greaterThan(ZERO)) continue;
          advanceDeduction = advanceDeduction.plus(installment);
          available = available.minus(installment);
          deductionRows.push(line(`Advance ${adv.advanceCode}`, installment, false, 'ADVANCE', adv.id));
        }

        const totalDeductions = statutoryDeductions.plus(loanDeduction).plus(advanceDeduction);
        const netPay = gross.minus(totalDeductions);

        itemRows.push({
          id: itemId,
          organizationId: orgId,
          runId: id,
          employeeId: emp.id,
          baseSalary: baseAmount,
          hourlyRate: derivedHourly,
          regularHours: Math.round(workedMin / 60),
          // `overtimeHours` is an Int column, so it is a rounded DISPLAY
          // value. `overtimePay` above is computed from exact minutes.
          overtimeHours: overtimeHours.toDecimalPlaces(0).toNumber(),
          overtimePay,
          allowancesTotal,
          commissionAmount,
          bonusAmount,
          grossPay: gross,
          taxAmount: tax,
          taxableIncome,
          pensionAmount: d.pension,
          socialSecurityAmount: d.ssf,
          employerPensionAmount: employerPension,
          employerSocialSecurityAmount: employerSsf,
          loanDeduction,
          advanceDeduction,
          insuranceAmount: d.insurance,
          localTaxAmount: localTax,
          otherDeductions: other,
          otherPayableAmount: d.otherPayable,
          totalDeductions,
          netPay,
          absenceDays: dec(unpaidLeaveDays),
          unpaidLeaveDays: dec(unpaidLeaveDays),
          periodDays,
          paidDays: dec(paidDays),
          proRataFactor: proRata,
          createdBy: userId,
        });
      }

      // Bulk inserts: three statements regardless of headcount.
      if (itemRows.length > 0) await tx.hrPayrollItem.createMany({ data: itemRows });
      if (allowanceRows.length > 0) await tx.hrPayrollAllowance.createMany({ data: allowanceRows });
      if (deductionRows.length > 0) await tx.hrPayrollDeduction.createMany({ data: deductionRows });

      // Run totals.
      const grossSum = sum(itemRows.map((i: any) => i.grossPay));
      const dedSum = sum(itemRows.map((i: any) => i.totalDeductions));
      const netSum = sum(itemRows.map((i: any) => i.netPay));
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
      // freshly computed items + totals.
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
          employees: itemRows.length,
          inputsApplied: appliedInputIds.length,
          payeTable: payeTable.code,
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

  /** Sum deduction lines of one source type, keyed by source id. */
  private linesBySource(items: any[], sourceType: string): Map<string, Money> {
    const out = new Map<string, Money>();
    for (const item of items) {
      for (const l of item.deductions ?? []) {
        if (l.sourceType !== sourceType || !l.sourceId) continue;
        out.set(l.sourceId, (out.get(l.sourceId) ?? ZERO).plus(dec(l.amount)));
      }
    }
    return out;
  }

  /** Approve a calculated run → generates payslips + posts the GL journal. */
  async approveRun(id: string) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const pre = await this.prisma.client.hrPayrollRun.findFirst({
      where: { id, organizationId: orgId },
      include: { period: true },
    });
    if (!pre) throw new NotFoundException('Payroll run not found');
    if (pre.status !== 'CALCULATED')
      throw new BadRequestException('Only CALCULATED runs can be approved');
    this.assertPeriodOpen(pre.period);

    return this.prisma.client.$transaction(async (tx: any) => {
      // Claim first, read second: a concurrent approve blocks here and then
      // fails, instead of both reading CALCULATED and posting twice.
      await this.claim(
        tx.hrPayrollRun, id, orgId, ['CALCULATED'], { updatedBy: userId },
        'Only CALCULATED runs can be approved (the run changed status concurrently)',
      );
      const run = await tx.hrPayrollRun.findFirst({
        where: { id, organizationId: orgId },
        include: {
          period: true,
          items: {
            include: {
              employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, partnerId: true } },
              allowances: true,
              deductions: true,
            },
          },
        },
      });
      if (run.items.length === 0) throw new BadRequestException('Run has no items — calculate first');

      // Nobody can be paid a negative amount; the journal could not balance.
      const negative = run.items.filter((i: any) => dec(i.netPay).lessThan(ZERO));
      if (negative.length > 0)
        throw new BadRequestException(
          `Net pay is negative for ${negative.map((i: any) => i.employee?.employeeCode).join(', ')} — ` +
            'reduce their deductions or inputs and recalculate',
        );

      // ── Staleness: the run must pay exactly the inputs it was calculated with.
      const appliedInputIds = new Set<string>();
      for (const item of run.items)
        for (const l of [...item.allowances, ...item.deductions])
          if (l.sourceType === 'INPUT' && l.sourceId) appliedInputIds.add(l.sourceId);
      const liveApproved = await tx.hrPayrollInput.findMany({
        where: { organizationId: orgId, periodId: run.periodId, status: 'APPROVED', deletedAt: null },
        select: { id: true },
      });
      const missed = liveApproved.filter((i: any) => !appliedInputIds.has(i.id));
      if (missed.length > 0)
        throw new BadRequestException(
          `${missed.length} payroll input(s) were approved after this run was calculated — recalculate before approving`,
        );
      if (appliedInputIds.size > 0) {
        const stamped = await tx.hrPayrollInput.updateMany({
          where: {
            id: { in: [...appliedInputIds] },
            organizationId: orgId,
            deletedAt: null,
            OR: [{ status: 'APPROVED' }, { status: 'APPLIED', appliedRunId: id }],
          },
          data: { status: 'APPLIED', appliedRunId: id, updatedBy: userId },
        });
        if (stamped.count !== appliedInputIds.size)
          throw new BadRequestException(
            'A payroll input used by this run was cancelled or changed after calculation — recalculate before approving',
          );
      }

      // 1. Payslips for every item — numbers allocated in ONE round trip and
      //    inserted in ONE statement.
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
      // journal ties to the payslips EXACTLY.
      const totalOf = (field: string) =>
        sum(run.items.map((i: any) => dec((i as any)[field])));
      const totals = {
        gross: totalOf('grossPay'),
        net: totalOf('netPay'),
        tax: totalOf('taxAmount'),
        pension: totalOf('pensionAmount'),
        ssf: totalOf('socialSecurityAmount'),
        employerPension: totalOf('employerPensionAmount'),
        employerSsf: totalOf('employerSocialSecurityAmount'),
        insurance: totalOf('insuranceAmount'),
        localTax: totalOf('localTaxAmount'),
        loans: totalOf('loanDeduction'),
        advances: totalOf('advanceDeduction'),
        other: totalOf('otherDeductions'),
        otherPayable: totalOf('otherPayableAmount'),
      };
      const employerCost = totals.employerPension.plus(totals.employerSsf);
      const lines: any[] = [
        { accountId: salaryExpense, debit: totals.gross, description: 'Salaries & wages' },
      ];
      if (employerCost.greaterThan(ZERO))
        lines.push({
          accountId: await this.autoAccount('employer_contribution_expense', tx),
          debit: employerCost,
          description: 'Employer statutory contributions',
        });
      const credit = (amount: Money, accountId: string, description: string) => {
        if (amount.greaterThan(ZERO)) lines.push({ accountId, credit: amount, description });
      };
      // Per-employee GL subledger: amounts owed to (or recoverable from) a
      // PERSON get one line each carrying that person's `partnerId`. Amounts
      // owed to an INSTITUTION (PAYE, pension, SSF, insurer) stay aggregated.
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
      // The fund is owed both shares; the employer share is the contribution
      // the school remits on top of what it withheld.
      credit(totals.pension.plus(totals.employerPension), pensionPayable, 'Pension payable (employee + employer)');
      credit(totals.ssf.plus(totals.employerSsf), ssfPayable, 'Social security payable (employee + employer)');
      credit(totals.insurance, insurancePayable, 'Insurance payable');
      if (totals.localTax.greaterThan(ZERO))
        credit(totals.localTax, await this.autoAccount('local_tax_payable', tx), 'Local service tax payable');
      if (totals.otherPayable.greaterThan(ZERO))
        credit(totals.otherPayable, await this.autoAccount('other_deductions_payable', tx), 'Payroll deductions payable');
      perEmployee('loanDeduction', loanReceivable, 'credit', 'Loan installment');
      perEmployee('advanceDeduction', advanceReceivable, 'credit', 'Advance installment');
      // Recoveries (staff shop, damage, ad-hoc deductions) are money the school
      // takes back out of pay it expensed: a contra to the salary expense.
      credit(totals.other.minus(totals.otherPayable), salaryExpense, 'Payroll recoveries');

      const journal = await this.posting.post(
        {
          journalCode: 'GEN',
          // The expense belongs to the PERIOD, not to the day someone clicked approve.
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

      // 3. Loans + advances tick down by EXACTLY what each one's own line took.
      for (const [loanId, taken] of this.linesBySource(run.items, 'LOAN')) {
        const loan = await tx.hrEmployeeLoan.findFirst({ where: { id: loanId, organizationId: orgId } });
        if (!loan || loan.status !== 'ACTIVE' || dec(loan.balance).lessThan(taken))
          throw new BadRequestException(`Loan ${loan?.loanCode ?? loanId} changed after calculation — recalculate before approving`);
        const newBalance = dec(loan.balance).minus(taken);
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
      for (const [advId, taken] of this.linesBySource(run.items, 'ADVANCE')) {
        const adv = await tx.hrSalaryAdvance.findFirst({ where: { id: advId, organizationId: orgId } });
        if (!adv || adv.status !== 'PAID' || dec(adv.balance).lessThan(taken))
          throw new BadRequestException(`Advance ${adv?.advanceCode ?? advId} changed after calculation — recalculate before approving`);
        const newBalance = dec(adv.balance).minus(taken);
        await tx.hrSalaryAdvance.update({
          where: { id: adv.id },
          data: {
            balance: newBalance,
            status: newBalance.isZero() ? 'SETTLED' : adv.status,
            updatedBy: userId,
          },
        });
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
        oldValues: { status: 'CALCULATED' },
        newValues: {
          status: 'APPROVED',
          journalEntryId: journal.id,
          journalDate: run.period.endDate,
          employees: run.items.length,
          totalGross: totals.gross.toString(),
          totalNet: totals.net.toString(),
          employerCost: employerCost.toString(),
          inputsApplied: appliedInputIds.size,
        },
      });

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

  /** Reverse a run: undo the journal and everything approval did. */
  async reverseRun(id: string, dto: any = {}) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const run = await this.prisma.client.hrPayrollRun.findFirst({
      where: { id, organizationId: orgId },
      include: { period: true },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status === 'DRAFT' || run.status === 'CALCULATED') {
      return this.prisma.client.$transaction(async (tx: any) => {
        await this.claim(
          tx.hrPayrollRun, id, orgId, ['DRAFT', 'CALCULATED'],
          { status: 'REVERSED', notes: dto.reason ?? run.notes, updatedBy: userId },
          'Run changed status concurrently — reload and try again',
        );
        return tx.hrPayrollRun.findUnique({ where: { id } });
      });
    }
    if (run.status !== 'APPROVED' && run.status !== 'PAID')
      throw new BadRequestException('Only APPROVED/PAID runs can be reversed');
    return this.prisma.client.$transaction(async (tx: any) => {
      await this.claim(
        tx.hrPayrollRun, id, orgId, ['APPROVED', 'PAID'], { updatedBy: userId },
        'Run changed status concurrently — reload and try again',
      );
      const items = await tx.hrPayrollItem.findMany({
        where: { runId: id, organizationId: orgId },
        include: { deductions: true, payslip: true },
      });
      // Money that has left the bank cannot be un-owed by reversing the
      // accrual: the payment must be reversed first, or a corrected re-run
      // pays the same people a second time.
      const paid = items.filter((i: any) => i.payslip?.status === 'PAID');
      if (paid.length > 0)
        throw new BadRequestException(
          `${paid.length} payslip(s) of this run are already paid. Reverse the payment(s) first, then reverse the run.`,
        );

      if (run.journalEntryId) {
        await this.posting.reverse(
          run.journalEntryId,
          { description: `Reversal — ${dto.reason ?? 'payroll run reversal'}` },
          tx,
        );
      }

      // 1. Each loan gets back exactly what its own line took.
      for (const [loanId, taken] of this.linesBySource(items, 'LOAN')) {
        const loan = await tx.hrEmployeeLoan.findFirst({ where: { id: loanId, organizationId: orgId } });
        if (!loan) continue;
        await tx.hrEmployeeLoan.update({
          where: { id: loan.id },
          data: {
            balance: dec(loan.balance).plus(taken),
            installmentsPaid: loan.installmentsPaid > 0 ? loan.installmentsPaid - 1 : 0,
            status: loan.status === 'PAID' ? 'ACTIVE' : loan.status,
            updatedBy: userId,
          },
        });
      }

      // 2. Same for salary advances.
      for (const [advId, taken] of this.linesBySource(items, 'ADVANCE')) {
        const adv = await tx.hrSalaryAdvance.findFirst({ where: { id: advId, organizationId: orgId } });
        if (!adv) continue;
        await tx.hrSalaryAdvance.update({
          where: { id: adv.id },
          data: {
            balance: dec(adv.balance).plus(taken),
            status: adv.status === 'SETTLED' ? 'PAID' : adv.status,
            updatedBy: userId,
          },
        });
      }

      // 3. Payslips are cancelled, never deleted — an employee may already hold
      //    a printed copy, so the number has to keep resolving to a voided slip.
      const itemIds = items.map((i: any) => i.id);
      await tx.hrPayslip.updateMany({
        where: { organizationId: orgId, itemId: { in: itemIds } },
        data: { status: 'CANCELLED', updatedBy: userId },
      });
      // Unpaid bank batches for this run are void with it.
      await tx.hrBankPayment.updateMany({
        where: { organizationId: orgId, runId: id, status: { in: ['DRAFT', 'GENERATED', 'SENT'] } },
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
    }, { timeout: APPROVE_TX_TIMEOUT_MS, maxWait: 10_000 });
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

  /**
   * Payment clears what approval accrued: Dr net pay payable (per employee,
   * with their partner) / Cr the bank, cash or mobile-money account the money
   * left from. Without this the liability grew every month and never came down.
   */
  private async postNetPayPayment(
    tx: any,
    opts: {
      slips: Array<{ netPay: Money; partnerId?: string | null; who: string }>;
      method: string;
      date: Date;
      description: string;
      sourceType: string;
      sourceId: string;
    },
  ) {
    const [netPayPayable, cashAccount] = await Promise.all([
      this.accounts.mapped('net_pay_payable', tx),
      this.settlementAccount(opts.method, tx),
    ]);
    const lines: any[] = [];
    let total = ZERO;
    for (const s of opts.slips) {
      if (!s.netPay.greaterThan(ZERO)) continue;
      total = total.plus(s.netPay);
      lines.push({
        accountId: netPayPayable,
        debit: s.netPay,
        partnerId: s.partnerId ?? undefined,
        description: `Net pay paid — ${s.who}`,
      });
    }
    if (!total.greaterThan(ZERO)) return null;
    lines.push({ accountId: cashAccount, credit: total, description: opts.description });
    return this.posting.post(
      {
        journalCode: 'GEN',
        date: opts.date,
        description: opts.description,
        sourceType: opts.sourceType,
        sourceId: opts.sourceId,
        postingType: 'primary',
        postingKey: `${opts.sourceType}:${opts.sourceId}`,
        lines,
      },
      tx,
    );
  }

  /** When every live payslip of a run is paid, the run is PAID. */
  private async syncRunPaidStatus(tx: any, orgId: string, runId: string, userId: string | undefined) {
    const items = await tx.hrPayrollItem.findMany({
      where: { runId, organizationId: orgId },
      select: { payslip: { select: { status: true } } },
    });
    const allPaid = items.length > 0 && items.every((i: any) => i.payslip?.status === 'PAID');
    await tx.hrPayrollRun.updateMany({
      where: { id: runId, organizationId: orgId, status: allPaid ? 'APPROVED' : 'PAID' },
      data: { status: allPaid ? 'PAID' : 'APPROVED', updatedBy: userId },
    });
  }

  private slipWho(emp: any): string {
    return `${emp?.firstName ?? ''} ${emp?.lastName ?? ''}`.trim() || emp?.employeeCode || 'employee';
  }

  /** Pay ONE payslip outside a bank batch (cash, cheque, a one-off transfer). */
  async markPaid(payslipId: string, dto: any = {}) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    if (!dto.paymentMethod || !PAYMENT_METHODS.includes(dto.paymentMethod))
      throw new BadRequestException(`Invalid paymentMethod: ${dto.paymentMethod}`);
    const slip = await this.prisma.client.hrPayslip.findFirst({
      where: { id: payslipId, organizationId: orgId },
      include: { item: { include: { employee: true, run: true } } },
    });
    if (!slip) throw new NotFoundException('Payslip not found');
    if (slip.status !== 'ISSUED')
      throw new BadRequestException(`Payslip is ${slip.status} — only ISSUED payslips can be paid`);
    if (slip.bankPaymentId)
      throw new BadRequestException('This payslip is in a bank payment batch — pay or cancel the batch instead');
    const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();

    return this.prisma.client.$transaction(async (tx: any) => {
      await this.claim(
        tx.hrPayslip, payslipId, orgId, ['ISSUED'],
        { status: 'PAID', paymentMethod: dto.paymentMethod, paidAt, updatedBy: userId },
        'Payslip was paid or cancelled concurrently',
      );
      const journal = await this.postNetPayPayment(tx, {
        slips: [{ netPay: dec(slip.item.netPay), partnerId: slip.item.employee?.partnerId, who: this.slipWho(slip.item.employee) }],
        method: dto.paymentMethod,
        date: paidAt,
        description: `Salary payment ${slip.payslipNumber}`,
        sourceType: 'hr_payslip_payment',
        sourceId: payslipId,
      });
      await tx.hrPayslip.update({
        where: { id: payslipId },
        data: { paymentJournalEntryId: journal?.id ?? null },
      });
      await this.syncRunPaidStatus(tx, orgId, slip.item.runId, userId);
      await this.audit.recordInTx(tx, {
        entity: 'HrPayslip',
        entityId: payslipId,
        action: 'post',
        newValues: { method: dto.paymentMethod, netPay: String(slip.item.netPay), journalEntryId: journal?.id ?? null },
      });
      return tx.hrPayslip.findUnique({ where: { id: payslipId } });
    });
  }

  /** Undo a single-slip payment (bounced cheque, wrong account). */
  async reversePayslipPayment(payslipId: string, dto: any = {}) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const slip = await this.prisma.client.hrPayslip.findFirst({
      where: { id: payslipId, organizationId: orgId },
      include: { item: true },
    });
    if (!slip) throw new NotFoundException('Payslip not found');
    if (slip.status !== 'PAID') throw new BadRequestException('Only PAID payslips can have their payment reversed');
    if (slip.bankPaymentId)
      throw new BadRequestException('This payslip was paid in a bank batch — reverse the batch instead');
    return this.prisma.client.$transaction(async (tx: any) => {
      await this.claim(
        tx.hrPayslip, payslipId, orgId, ['PAID'],
        { status: 'ISSUED', paymentMethod: null, paidAt: null, paymentJournalEntryId: null, updatedBy: userId },
        'Payslip changed concurrently',
      );
      if (slip.paymentJournalEntryId)
        await this.posting.reverse(slip.paymentJournalEntryId, { description: `Payment reversal — ${dto.reason ?? slip.payslipNumber}` }, tx);
      await this.syncRunPaidStatus(tx, orgId, slip.item.runId, userId);
      await this.audit.recordInTx(tx, {
        entity: 'HrPayslip',
        entityId: payslipId,
        action: 'reverse',
        oldValues: { status: 'PAID', paymentJournalEntryId: slip.paymentJournalEntryId },
        newValues: { status: 'ISSUED', reason: dto.reason ?? null },
      });
      return tx.hrPayslip.findUnique({ where: { id: payslipId } });
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

  /**
   * Generate the payment batch for an approved run: one line per UNPAID
   * payslip. At most one live batch per run — a second file for the same run
   * is how a school pays its staff twice.
   */
  async generateBankPayment(dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    if (!dto.runId) throw new BadRequestException('runId is required');
    const method = dto.method ?? 'BANK';
    if (!PAYMENT_METHODS.includes(method))
      throw new BadRequestException(`Invalid method: ${method}`);

    return this.prisma.client.$transaction(async (tx: any) => {
      await this.lockKey(tx, `hr_bank_payment:${orgId}:${dto.runId}`);
      const run = await tx.hrPayrollRun.findFirst({
        where: { id: dto.runId, organizationId: orgId },
        include: {
          items: {
            include: {
              payslip: true,
              employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, bankName: true, bankAccountName: true, bankAccountNumber: true, mobileMoneyProvider: true, mobileMoneyNumber: true } },
            },
          },
        },
      });
      if (!run) throw new NotFoundException('Payroll run not found');
      if (run.status !== 'APPROVED')
        throw new BadRequestException('Only APPROVED runs with unpaid payslips can generate a payment batch');
      const live = await tx.hrBankPayment.findFirst({
        where: { organizationId: orgId, runId: run.id, status: { in: ['DRAFT', 'GENERATED', 'SENT'] } },
        select: { paymentCode: true },
      });
      if (live)
        throw new BadRequestException(`Batch ${live.paymentCode} is already open for this run — pay or cancel it first`);

      const payable = run.items.filter(
        (i: any) => i.payslip?.status === 'ISSUED' && !i.payslip?.bankPaymentId && dec(i.netPay).greaterThan(ZERO),
      );
      if (payable.length === 0) throw new BadRequestException('Every payslip of this run is already paid');
      const totalAmount = sum(payable.map((i: any) => dec(i.netPay)));
      const paymentCode = await this.seq.next('hr_bank_payment', { prefix: 'BANK-', padding: 6 }, tx);
      const payment = await tx.hrBankPayment.create({
        data: {
          organizationId: orgId,
          paymentCode,
          runId: run.id,
          paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : new Date(),
          method,
          status: 'GENERATED',
          totalAmount,
          notes: dto.notes ?? null,
          createdBy: userId,
        },
      });
      await tx.hrBankPaymentLine.createMany({
        data: payable.map((item: any) => ({
          organizationId: orgId,
          bankPaymentId: payment.id,
          employeeId: item.employee.id,
          amount: dec(item.netPay),
          bankName: item.employee.bankName ?? null,
          bankAccountName: item.employee.bankAccountName ?? null,
          bankAccountNumber: item.employee.bankAccountNumber ?? null,
          mobileMoneyProvider: item.employee.mobileMoneyProvider ?? null,
          mobileMoneyNumber: item.employee.mobileMoneyNumber ?? null,
          createdBy: userId,
        })),
      });
      // The slips are now committed to this batch; they cannot also be paid singly.
      await tx.hrPayslip.updateMany({
        where: { organizationId: orgId, id: { in: payable.map((i: any) => i.payslip.id) } },
        data: { bankPaymentId: payment.id, updatedBy: userId },
      });
      await this.audit.recordInTx(tx, {
        entity: 'HrBankPayment',
        entityId: payment.id,
        action: 'create',
        newValues: { runId: run.id, method, lines: payable.length, totalAmount: totalAmount.toString() },
      });
      return tx.hrBankPayment.findUnique({ where: { id: payment.id }, include: { lines: true } });
    });
  }

  /**
   * Batch life cycle: GENERATED → SENT → PAID, or → CANCELLED before PAID.
   * PAID posts the payment journal and marks every slip in the batch paid;
   * a PAID batch is undone only through `reverseBankPayment`.
   */
  async updateBankPaymentStatus(id: string, dto: any = {}) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrBankPayment.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!row) throw new NotFoundException('Bank payment not found');
    if (!dto.status || !BANK_PAYMENT_STATUSES.includes(dto.status))
      throw new BadRequestException(`Invalid status: ${dto.status}`);
    if (row.status === 'PAID')
      throw new BadRequestException('A PAID batch cannot change status — reverse the payment instead');
    if (row.status === 'CANCELLED') throw new BadRequestException('A cancelled batch cannot change status');
    const fileData = {
      fileName: dto.fileName ?? row.fileName,
      fileUrl: dto.fileUrl ?? row.fileUrl,
      processedById: userId,
      updatedBy: userId,
    };

    if (dto.status === 'CANCELLED') {
      return this.prisma.client.$transaction(async (tx: any) => {
        await this.claim(tx.hrBankPayment, id, orgId, ['DRAFT', 'GENERATED', 'SENT'], { status: 'CANCELLED', ...fileData }, 'Batch changed concurrently');
        await tx.hrPayslip.updateMany({
          where: { organizationId: orgId, bankPaymentId: id, status: 'ISSUED' },
          data: { bankPaymentId: null, updatedBy: userId },
        });
        await this.audit.recordInTx(tx, { entity: 'HrBankPayment', entityId: id, action: 'cancel', oldValues: { status: row.status } });
        return tx.hrBankPayment.findUnique({ where: { id } });
      });
    }

    if (dto.status !== 'PAID') {
      return this.prisma.client.$transaction(async (tx: any) => {
        await this.claim(tx.hrBankPayment, id, orgId, ['DRAFT', 'GENERATED', 'SENT'], { status: dto.status, ...fileData }, 'Batch changed concurrently');
        return tx.hrBankPayment.findUnique({ where: { id } });
      });
    }

    const paidAt = dto.paidAt ? new Date(dto.paidAt) : row.paymentDate ?? new Date();
    return this.prisma.client.$transaction(async (tx: any) => {
      await this.claim(tx.hrBankPayment, id, orgId, ['DRAFT', 'GENERATED', 'SENT'], { status: 'PAID', paidAt, ...fileData }, 'Batch changed concurrently');
      const slips = await tx.hrPayslip.findMany({
        where: { organizationId: orgId, bankPaymentId: id, status: 'ISSUED' },
        include: { item: { include: { employee: true } } },
      });
      const journal = await this.postNetPayPayment(tx, {
        slips: slips.map((s: any) => ({ netPay: dec(s.item.netPay), partnerId: s.item.employee?.partnerId, who: this.slipWho(s.item.employee) })),
        method: row.method,
        date: paidAt,
        description: `Salary payment batch ${row.paymentCode}`,
        sourceType: 'hr_bank_payment',
        sourceId: id,
      });
      await tx.hrPayslip.updateMany({
        where: { organizationId: orgId, id: { in: slips.map((s: any) => s.id) } },
        data: { status: 'PAID', paidAt, paymentMethod: row.method, paymentJournalEntryId: journal?.id ?? null, updatedBy: userId },
      });
      await tx.hrBankPayment.update({ where: { id }, data: { journalEntryId: journal?.id ?? null } });
      await this.syncRunPaidStatus(tx, orgId, row.runId, userId);
      await this.audit.recordInTx(tx, {
        entity: 'HrBankPayment',
        entityId: id,
        action: 'post',
        oldValues: { status: row.status },
        newValues: { status: 'PAID', payslips: slips.length, journalEntryId: journal?.id ?? null },
      });
      return tx.hrBankPayment.findUnique({ where: { id }, include: { lines: true } });
    });
  }

  /** Undo a PAID batch (the bank rejected the file): reverse the journal, reopen the slips. */
  async reverseBankPayment(id: string, dto: any = {}) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrBankPayment.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Bank payment not found');
    if (row.status !== 'PAID') throw new BadRequestException('Only a PAID batch can be reversed');
    return this.prisma.client.$transaction(async (tx: any) => {
      await this.claim(tx.hrBankPayment, id, orgId, ['PAID'], { status: 'CANCELLED', updatedBy: userId }, 'Batch changed concurrently');
      if (row.journalEntryId)
        await this.posting.reverse(row.journalEntryId, { description: `Payment batch reversal — ${dto.reason ?? row.paymentCode}` }, tx);
      await tx.hrPayslip.updateMany({
        where: { organizationId: orgId, bankPaymentId: id, status: 'PAID' },
        data: { status: 'ISSUED', paidAt: null, paymentMethod: null, paymentJournalEntryId: null, bankPaymentId: null, updatedBy: userId },
      });
      await this.syncRunPaidStatus(tx, orgId, row.runId, userId);
      await this.audit.recordInTx(tx, {
        entity: 'HrBankPayment',
        entityId: id,
        action: 'reverse',
        oldValues: { status: 'PAID', journalEntryId: row.journalEntryId },
        newValues: { status: 'CANCELLED', reason: dto.reason ?? null },
      });
      return tx.hrBankPayment.findUnique({ where: { id } });
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
    const amount = dec(dto.amount);
    const months = Number(dto.installmentMonths ?? 3);
    if (!amount.greaterThan(ZERO)) throw new BadRequestException('amount must be positive');
    if (!Number.isInteger(months) || months < 1) throw new BadRequestException('installmentMonths must be a positive integer');
    const emp = await this.prisma.client.hrEmployee.findFirst({
      where: { id: dto.employeeId, organizationId: orgId, deletedAt: null },
      select: { isActive: true },
    });
    if (!emp) throw new NotFoundException('Employee not found');
    if (!emp.isActive) throw new BadRequestException('Advances cannot be issued to an inactive employee');
    const dp = await this.currencyDecimals(this.prisma.client, orgId);
    const advanceCode = await this.seq.next('hr_advance', { prefix: 'ADV-', padding: 6 });
    return this.prisma.client.hrSalaryAdvance.create({
      data: {
        organizationId: orgId,
        advanceCode,
        employeeId: dto.employeeId,
        amount,
        installmentMonths: months,
        // Rounded UP so the advance clears in the stated number of months
        // instead of leaving a few shillings for a month nobody planned.
        monthlyDeduction: amount.dividedBy(months).toDecimalPlaces(dp, Prisma.Decimal.ROUND_UP),
        balance: amount,
        status: 'PENDING',
        requestedById: userId,
        notes: dto.notes ?? null,
        createdBy: userId,
      },
    });
  }

  /** Separation of duties: nobody approves an advance they asked for, or one paid to themselves. */
  private async assertNotSelfApproval(tx: any, orgId: string, requestedById: string | null, employeeId: string, what: string) {
    const userId = this.tenant.userId;
    if (requestedById && userId && requestedById === userId)
      throw new ForbiddenException(`You cannot approve ${what} you requested yourself`);
    const own = await this.employeeIdForUser(tx, orgId, userId);
    if (own && own === employeeId) throw new ForbiddenException(`You cannot approve ${what} made out to yourself`);
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
    return this.prisma.client.$transaction(async (tx: any) => {
      await this.assertNotSelfApproval(tx, orgId, row.requestedById, row.employeeId, 'an advance');
      await this.claim(
        tx.hrSalaryAdvance, id, orgId, ['PENDING'],
        { status: 'APPROVED', approvedById: userId, approvedAt: new Date(), updatedBy: userId },
        'Advance was decided concurrently',
      );
      await this.audit.recordInTx(tx, {
        entity: 'HrSalaryAdvance', entityId: id, action: 'approve',
        newValues: { amount: String(row.amount), employeeId: row.employeeId },
      });
      return tx.hrSalaryAdvance.findUnique({ where: { id } });
    });
  }

  /**
   * Pay the advance out: Dr employee_advance_receivable (per employee) /
   * Cr bank or cash. Only a PAID advance is recovered by payroll — recovery
   * credits the same receivable, so an advance paid off the books drove that
   * receivable negative.
   */
  async markAdvancePaid(id: string, dto: any = {}) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const method = dto.paymentMethod ?? 'CASH';
    if (!PAYMENT_METHODS.includes(method)) throw new BadRequestException(`Invalid paymentMethod: ${method}`);
    const row = await this.prisma.client.hrSalaryAdvance.findFirst({
      where: { id, organizationId: orgId },
      include: { employee: true },
    });
    if (!row) throw new NotFoundException('Advance not found');
    if (row.status !== 'APPROVED')
      throw new BadRequestException('Only APPROVED advances can be marked paid');
    const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
    return this.prisma.client.$transaction(async (tx: any) => {
      await this.claim(
        tx.hrSalaryAdvance, id, orgId, ['APPROVED'],
        { status: 'PAID', paidAt, paymentMethod: method, updatedBy: userId },
        'Advance was paid concurrently',
      );
      const [receivable, cash] = await Promise.all([
        this.accounts.mapped('employee_advance_receivable', tx),
        this.settlementAccount(method, tx),
      ]);
      const who = this.slipWho(row.employee);
      const journal = await this.posting.post(
        {
          journalCode: 'GEN',
          date: paidAt,
          description: `Salary advance ${row.advanceCode} — ${who}`,
          sourceType: 'hr_advance',
          sourceId: id,
          postingType: 'primary',
          postingKey: `hr_advance:${id}`,
          lines: <any[]>[
            { accountId: receivable, debit: dec(row.amount), partnerId: row.employee?.partnerId ?? undefined, description: `Advance to ${who}` },
            { accountId: cash, credit: dec(row.amount), description: `Advance ${row.advanceCode} paid` },
          ],
        },
        tx,
      );
      await tx.hrSalaryAdvance.update({ where: { id }, data: { disbursementJournalEntryId: journal.id } });
      await this.audit.recordInTx(tx, {
        entity: 'HrSalaryAdvance', entityId: id, action: 'post',
        newValues: { method, amount: String(row.amount), journalEntryId: journal.id },
      });
      return tx.hrSalaryAdvance.findUnique({ where: { id } });
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
    return this.prisma.client.$transaction(async (tx: any) => {
      await this.claim(
        tx.hrSalaryAdvance, id, orgId, ['PENDING'],
        {
          status: 'REJECTED',
          notes: dto.reason ? `${row.notes ?? ''}\nRejected: ${dto.reason}`.trim() : row.notes,
          updatedBy: userId,
        },
        'Advance was decided concurrently',
      );
      return tx.hrSalaryAdvance.findUnique({ where: { id } });
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

  /**
   * Create a staff loan. `interestRate` is a flat FRACTION of principal
   * (0.1 = 10%). With `disbursedAt` the loan is disbursed through the ledger
   * in the same transaction; otherwise call `disburseLoan` when the money goes
   * out. Payroll recovers only disbursed loans.
   */
  async createLoan(dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    if (!dto.employeeId || !dto.principal || !dto.installmentsTotal)
      throw new BadRequestException('employeeId, principal and installmentsTotal are required');
    const principal = dec(dto.principal);
    const installments = Number(dto.installmentsTotal);
    const rate = dec(dto.interestRate ?? 0);
    if (!principal.greaterThan(ZERO) || !Number.isInteger(installments) || installments <= 0)
      throw new BadRequestException('principal and installmentsTotal must be positive');
    if (rate.greaterThan(1)) throw new BadRequestException('interestRate is a FRACTION (0.1 = 10%)');
    const emp = await this.prisma.client.hrEmployee.findFirst({
      where: { id: dto.employeeId, organizationId: orgId, deletedAt: null },
      select: { isActive: true },
    });
    if (!emp) throw new NotFoundException('Employee not found');
    if (!emp.isActive) throw new BadRequestException('Loans cannot be issued to an inactive employee');
    const dp = await this.currencyDecimals(this.prisma.client, orgId);
    const totalPayable = round(principal.times(dec(1).plus(rate)), dp);
    const loanCode = await this.seq.next('hr_loan', { prefix: 'LN-', padding: 6 });
    return this.prisma.client.$transaction(async (tx: any) => {
      const loan = await tx.hrEmployeeLoan.create({
        data: {
          organizationId: orgId,
          loanCode,
          employeeId: dto.employeeId,
          principal,
          interestRate: rate,
          totalPayable,
          installmentAmount: totalPayable.dividedBy(installments).toDecimalPlaces(dp, Prisma.Decimal.ROUND_UP),
          installmentsTotal: installments,
          installmentsPaid: 0,
          balance: totalPayable,
          status: 'ACTIVE',
          disbursedAt: null,
          notes: dto.notes ?? null,
          createdBy: userId,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'HrEmployeeLoan', entityId: loan.id, action: 'create',
        newValues: { employeeId: dto.employeeId, principal: principal.toString(), totalPayable: totalPayable.toString(), installments },
      });
      if (dto.disbursedAt)
        return this.disburseLoanTx(tx, loan.id, { disbursedAt: dto.disbursedAt, method: dto.disbursementMethod });
      return loan;
    });
  }

  async disburseLoan(id: string, dto: any = {}) {
    return this.prisma.client.$transaction((tx: any) => this.disburseLoanTx(tx, id, dto));
  }

  /**
   * Dr employee_loan_receivable (total payable, per employee) /
   * Cr bank or cash (principal) / Cr staff_loan_interest_income (interest).
   * Recognising the flat interest at disbursement keeps the receivable equal to
   * what payroll will actually recover.
   */
  private async disburseLoanTx(tx: any, id: string, dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const method = dto.method ?? dto.disbursementMethod ?? 'BANK';
    if (!PAYMENT_METHODS.includes(method)) throw new BadRequestException(`Invalid method: ${method}`);
    const loan = await tx.hrEmployeeLoan.findFirst({ where: { id, organizationId: orgId }, include: { employee: true } });
    if (!loan) throw new NotFoundException('Loan not found');
    if (loan.disbursementJournalEntryId) throw new BadRequestException('Loan is already disbursed');
    if (loan.status !== 'ACTIVE') throw new BadRequestException(`Loan is ${loan.status}`);
    const disbursedAt = dto.disbursedAt ? new Date(dto.disbursedAt) : new Date();
    const claimed = await tx.hrEmployeeLoan.updateMany({
      where: { id, organizationId: orgId, disbursementJournalEntryId: null },
      data: { disbursedAt, disbursementMethod: method, updatedBy: userId },
    });
    if (claimed.count !== 1) throw new ConflictException('Loan was disbursed concurrently');
    const principal = dec(loan.principal);
    const interest = dec(loan.totalPayable).minus(principal);
    const who = this.slipWho(loan.employee);
    const lines: any[] = [
      {
        accountId: await this.accounts.mapped('employee_loan_receivable', tx),
        debit: dec(loan.totalPayable),
        partnerId: loan.employee?.partnerId ?? undefined,
        description: `Staff loan ${loan.loanCode} — ${who}`,
      },
      { accountId: await this.settlementAccount(method, tx), credit: principal, description: `Loan ${loan.loanCode} disbursed` },
    ];
    if (interest.greaterThan(ZERO))
      lines.push({ accountId: await this.autoAccount('staff_loan_interest_income', tx), credit: interest, description: `Interest on loan ${loan.loanCode}` });
    const journal = await this.posting.post(
      {
        journalCode: 'GEN',
        date: disbursedAt,
        description: `Staff loan ${loan.loanCode} — ${who}`,
        sourceType: 'hr_loan',
        sourceId: id,
        postingType: 'primary',
        postingKey: `hr_loan:${id}`,
        lines,
      },
      tx,
    );
    await tx.hrEmployeeLoan.update({ where: { id }, data: { disbursementJournalEntryId: journal.id } });
    await this.audit.recordInTx(tx, {
      entity: 'HrEmployeeLoan', entityId: id, action: 'issue',
      newValues: { method, principal: principal.toString(), interest: interest.toString(), journalEntryId: journal.id },
    });
    return tx.hrEmployeeLoan.findUnique({ where: { id } });
  }

  /**
   * Loans are a ledger-backed subledger: the balance moves ONLY through
   * payroll recovery, reversal, or a write-off. Free edits of `balance` or
   * `installmentsPaid` (previously allowed to anyone with `hr:loan`, unaudited)
   * made the subledger disagree with the GL — and were a way to forgive a debt
   * silently.
   */
  async updateLoan(id: string, dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrEmployeeLoan.findFirst({
      where: { id, organizationId: orgId },
      include: { employee: true },
    });
    if (!row) throw new NotFoundException('Loan not found');
    if (dto.status !== undefined && dto.status !== row.status) {
      if (dto.status !== 'DEFAULTED')
        throw new BadRequestException('A loan can only be moved to DEFAULTED (written off); PAID follows from recovery');
      return this.writeOffLoan(id, dto.reason ?? dto.notes);
    }
    return this.prisma.client.hrEmployeeLoan.update({
      where: { id },
      data: { notes: dto.notes ?? row.notes, updatedBy: userId },
    });
  }

  /** Write off an uncollectable balance: Dr bad_debt / Cr employee_loan_receivable. */
  async writeOffLoan(id: string, reason?: string) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    if (!reason) throw new BadRequestException('A reason is required to write off a loan');
    return this.prisma.client.$transaction(async (tx: any) => {
      const loan = await tx.hrEmployeeLoan.findFirst({ where: { id, organizationId: orgId }, include: { employee: true } });
      if (!loan) throw new NotFoundException('Loan not found');
      await this.claim(tx.hrEmployeeLoan, id, orgId, ['ACTIVE'], { status: 'DEFAULTED', updatedBy: userId }, 'Only an ACTIVE loan can be written off');
      const balance = dec(loan.balance);
      let journalId: string | null = null;
      if (balance.greaterThan(ZERO) && loan.disbursementJournalEntryId) {
        const journal = await this.posting.post(
          {
            journalCode: 'GEN',
            date: new Date(),
            description: `Write-off of staff loan ${loan.loanCode}`,
            sourceType: 'hr_loan_writeoff',
            sourceId: id,
            postingType: 'primary',
            postingKey: `hr_loan_writeoff:${id}`,
            lines: <any[]>[
              { accountId: await this.accounts.mapped('bad_debt', tx), debit: balance, description: `Loan ${loan.loanCode} written off` },
              { accountId: await this.accounts.mapped('employee_loan_receivable', tx), credit: balance, partnerId: loan.employee?.partnerId ?? undefined, description: `Loan ${loan.loanCode} written off` },
            ],
          },
          tx,
        );
        journalId = journal.id;
      }
      await tx.hrEmployeeLoan.update({
        where: { id },
        data: { balance: ZERO, notes: `${loan.notes ? loan.notes + ' | ' : ''}written off: ${reason}` },
      });
      await this.audit.recordInTx(tx, {
        entity: 'HrEmployeeLoan', entityId: id, action: 'adjust',
        oldValues: { status: loan.status, balance: balance.toString() },
        newValues: { status: 'DEFAULTED', reason, journalEntryId: journalId },
      });
      return tx.hrEmployeeLoan.findUnique({ where: { id } });
    });
  }

  /** Only a loan that never left the building can be deleted; anything else is written off. */
  async deleteLoan(id: string) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrEmployeeLoan.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!row) throw new NotFoundException('Loan not found');
    if (row.disbursementJournalEntryId || row.installmentsPaid > 0)
      throw new BadRequestException('A disbursed loan cannot be deleted — write it off instead');
    return this.prisma.client.$transaction(async (tx: any) => {
      const updated = await tx.hrEmployeeLoan.update({
        where: { id },
        data: { deletedAt: new Date(), updatedBy: userId },
      });
      await this.audit.recordInTx(tx, { entity: 'HrEmployeeLoan', entityId: id, action: 'delete', oldValues: { principal: String(row.principal) } });
      return updated;
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

  private validateStatutory(dto: any) {
    for (const f of ['rate', 'employerRate'])
      if (dto[f] !== undefined && dto[f] !== null && dto.configType !== 'OVERTIME' && dec(dto[f]).greaterThan(1))
        throw new BadRequestException(`${f} is a FRACTION (0.05 = 5%)`);
    if (dto.contributionBase !== undefined && !CONTRIBUTION_BASES.includes(dto.contributionBase))
      throw new BadRequestException(`Invalid contributionBase: ${dto.contributionBase}`);
  }

  async createStatutoryConfig(dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    if (!dto.code || !dto.name || !dto.effectiveFrom)
      throw new BadRequestException('code, name and effectiveFrom are required');
    this.validateStatutory(dto);
    const existing = await this.prisma.client.hrStatutoryConfig.findFirst({
      where: { organizationId: orgId, code: String(dto.code).toUpperCase(), effectiveFrom: new Date(dto.effectiveFrom) },
    });
    if (existing) throw new BadRequestException('A config with this code+effectiveFrom already exists');
    return this.prisma.client.$transaction(async (tx: any) => {
      const row = await tx.hrStatutoryConfig.create({
        data: {
          organizationId: orgId,
          code: String(dto.code).toUpperCase(),
          name: dto.name,
          configType: dto.configType ?? 'PENSION',
          rate: dto.rate ?? null,
          employerRate: dto.employerRate ?? null,
          contributionBase: dto.contributionBase ?? 'GROSS',
          ceiling: dto.ceiling ?? null,
          effectiveFrom: new Date(dto.effectiveFrom),
          isActive: dto.isActive ?? true,
          createdBy: userId,
        },
      });
      await this.audit.recordInTx(tx, { entity: 'HrStatutoryConfig', entityId: row.id, action: 'create', newValues: { ...dto } });
      return row;
    });
  }

  async updateStatutoryConfig(id: string, dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrStatutoryConfig.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Statutory config not found');
    this.validateStatutory({ configType: row.configType, ...dto });
    const data: any = { updatedBy: userId };
    for (const f of ['name', 'configType', 'rate', 'employerRate', 'contributionBase', 'ceiling', 'isActive']) {
      if (dto[f] !== undefined) data[f] = dto[f];
    }
    if (dto.effectiveFrom !== undefined) data.effectiveFrom = new Date(dto.effectiveFrom);
    return this.prisma.client.$transaction(async (tx: any) => {
      const updated = await tx.hrStatutoryConfig.update({ where: { id }, data });
      await this.audit.recordInTx(tx, {
        entity: 'HrStatutoryConfig', entityId: id, action: 'update',
        oldValues: { rate: String(row.rate), employerRate: String(row.employerRate), effectiveFrom: row.effectiveFrom },
        newValues: { ...dto },
      });
      return updated;
    });
  }

  async deleteStatutoryConfig(id: string) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrStatutoryConfig.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Statutory config not found');
    return this.prisma.client.hrStatutoryConfig.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: userId } });
  }

  // ── Payroll preview / variance (before approval) ────────────────────────────

  /**
   * Pre-approval review of a CALCULATED run: totals, employer cost, headcount
   * movement against the previous period's run, large net-pay variances and
   * data-quality flags. Read-only — a DRAFT run must be calculated first.
   */
  async previewRun(id: string) {
    const orgId = this.tenant.organizationId;
    const run = await this.prisma.client.hrPayrollRun.findFirst({
      where: { id, organizationId: orgId },
      include: { period: true, items: { include: { employee: true } } },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status === 'DRAFT')
      throw new BadRequestException('Calculate the run first — a preview never writes to the database');

    const items = run.items as any[];
    const total = (f: string) => sum(items.map((i) => dec(i[f] ?? 0)));
    const employerCost = total('employerPensionAmount').plus(total('employerSocialSecurityAmount'));

    const missingBank = items.filter((i) => !i.employee?.bankAccountNumber && !i.employee?.mobileMoneyNumber).length;
    const missingTax = items.filter((i) => !i.employee?.taxNumber).length;
    const negativeNet = items.filter((i) => dec(i.netPay).lessThan(ZERO)).map((i) => i.employee?.employeeCode);

    // Compare with the most recent run of the PREVIOUS period.
    const prevRun = await this.prisma.client.hrPayrollRun.findFirst({
      where: {
        organizationId: orgId,
        deletedAt: null,
        status: { in: ['APPROVED', 'PAID'] },
        period: { endDate: { lt: run.period.startDate } },
      },
      orderBy: [{ period: { endDate: 'desc' } }, { createdAt: 'desc' }],
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
        const p: any = prevMap.get(i.employeeId);
        if (p && dec(p.netPay).greaterThan(ZERO)) {
          const pct = dec(i.netPay).minus(dec(p.netPay)).dividedBy(dec(p.netPay)).times(100);
          if (pct.abs().greaterThanOrEqualTo(15))
            variances.push({ employeeCode: i.employee?.employeeCode, prevNet: Number(p.netPay), net: Number(i.netPay), pct: Math.round(pct.toNumber()) });
        }
      }
    }

    return {
      runId: run.id,
      periodCode: run.period?.periodCode,
      status: run.status,
      employeeCount: items.length,
      totalGross: total('grossPay').toNumber(),
      totalDeductions: total('totalDeductions').toNumber(),
      totalNet: total('netPay').toNumber(),
      totalPaye: total('taxAmount').toNumber(),
      employerCost: employerCost.toNumber(),
      totalCostToSchool: total('grossPay').plus(employerCost).toNumber(),
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

