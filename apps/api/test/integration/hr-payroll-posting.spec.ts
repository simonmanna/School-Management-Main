/**
 * Integration — HR payroll calculate → approve → GL posting, against a real DB.
 *
 * Payroll is 1,469 LOC that posts to the general ledger, in a repo whose
 * FINANCIAL_INVARIANTS.md names "HR Payroll" explicitly — yet it had no test.
 * These are the invariants that a wrong line silently violates:
 *
 *   - the run journal balances EXACTLY and books to the payroll accounts only
 *     (no residual swept into a rounding account — the tell of the float-sum
 *     bug that Phase 0 fixed);
 *   - the journal is dated to the PERIOD END, not the approval day;
 *   - approval is idempotent (a run posts exactly one journal);
 *   - reversal writes a compensating entry and unsets glPosted;
 *   - a run cannot post into a closed fiscal period.
 *
 * Runs as an HR admin via `tenant.run(...)`, exactly what the JWT would carry.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';
import { ensureAccountCategories, makeAccountFactory, type TestAccountCategory } from './_accounts';
import { KernelModule } from '../../src/kernel/kernel.module';
import { CoreModule } from '../../src/modules/core/core.module';
import { AccountingModule } from '../../src/modules/accounting/accounting.module';
import { HrModule } from '../../src/modules/hr/hr.module';
import { HrPayrollService } from '../../src/modules/hr/hr-payroll.service';
import { HrOrgService } from '../../src/modules/hr/hr-org.service';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';

describeDb('integration: HR payroll → GL posting', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let payroll: HrPayrollService;
  let org: HrOrgService;

  const organizationId = `org_hrpay_${Date.now()}`;
  const userId = `user_hrpay_${Date.now()}`;
  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);

  /** Every account the payroll journal is allowed to touch. A line on anything
   *  else — e.g. an auto-created rounding account — is the failure we hunt. */
  const payrollAccountIds = new Set<string>();
  let employeeId = '';

  const asAdmin = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run(
      {
        organizationId,
        userId,
        permissions: ['hr:read', 'hr:employee', 'hr:payroll', 'hr:report'],
      },
      fn,
    );

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await setOrg(organizationId);
    await raw.organization.create({
      data: { id: organizationId, code: `HRPAY-${Date.now()}`, name: 'Payroll Test School', currencyCode: 'UGX' },
    });

    // General journal the payroll engine posts through (journalCode 'GEN').
    await raw.journal.create({
      data: { organizationId, code: 'GEN', name: 'General', journalType: 'general' },
    });

    // Chart of accounts + the 8 required payroll mappings.
    const mk = makeAccountFactory(raw, await ensureAccountCategories(raw));
    const mappings: Array<[string, string, string, TestAccountCategory]> = [
      ['salary_expense', 'HR-6000', 'Salaries & Wages', 'operating_expense'],
      ['net_pay_payable', 'HR-2100', 'Net Pay Payable', 'current_liability'],
      ['paye_payable', 'HR-2200', 'PAYE Payable', 'current_liability'],
      ['pension_payable', 'HR-2300', 'Pension Payable', 'current_liability'],
      ['social_security_payable', 'HR-2400', 'Social Security Payable', 'current_liability'],
      ['insurance_payable', 'HR-2500', 'Insurance Payable', 'current_liability'],
      ['employee_advance_receivable', 'HR-1300', 'Employee Advances', 'current_asset'],
      ['employee_loan_receivable', 'HR-1400', 'Employee Loans', 'current_asset'],
    ];
    for (const [key, code, name, category] of mappings) {
      const acct = await mk(organizationId, code, name, category);
      payrollAccountIds.add(acct.id);
      await raw.accountMapping.create({ data: { organizationId, key, accountId: acct.id } });
    }

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, CoreModule, AccountingModule, HrModule],
    }).compile();
    await moduleRef.init();

    tenant = moduleRef.get(TenantContextService);
    payroll = moduleRef.get(HrPayrollService);
    org = moduleRef.get(HrOrgService);

    // One active employee on a flat monthly salary. UGX has 0 decimal places
    // but payroll math is Decimal(20,6) regardless.
    const emp = await asAdmin(() =>
      org.createEmployee({
        firstName: 'Sara',
        lastName: 'Teacher',
        employmentType: 'FULL_TIME',
        baseSalary: 1_200_000,
        payFrequency: 'MONTHLY',
      }),
    );
    employeeId = emp.id;

    // Bridge her to a master-data Partner so the GL subledger has a dimension
    // to carry (Phase 2 + Phase 5).
    const partner = await raw.partner.create({
      data: { organizationId, code: 'P-SARA', name: 'Sara Teacher', isEmployee: true },
    });
    await raw.hrEmployee.update({ where: { id: employeeId }, data: { partnerId: partner.id } });
  });

  afterAll(async () => {
    if (moduleRef) await moduleRef.close();
    if (organizationId) {
      // Children first — payroll rows fan out under run → item → allowance/
      // deduction/payslip, plus the GL entries and audit trail.
      await raw.hrPayslip.deleteMany({ where: { organizationId } });
      await raw.hrPayrollAllowance.deleteMany({ where: { organizationId } });
      await raw.hrPayrollDeduction.deleteMany({ where: { organizationId } });
      await raw.hrPayrollItem.deleteMany({ where: { organizationId } });
      await raw.hrPayrollRun.deleteMany({ where: { organizationId } });
      await raw.hrPayrollPeriod.deleteMany({ where: { organizationId } });
      await raw.hrTaxBracket.deleteMany({ where: { organizationId } });
      await raw.hrTaxTable.deleteMany({ where: { organizationId } });
      await raw.hrPayrollComponent.deleteMany({ where: { organizationId } });
      await raw.hrSalaryChange.deleteMany({ where: { organizationId } });
      await raw.hrEmploymentAction.deleteMany({ where: { organizationId } });
      await raw.hrEmployee.deleteMany({ where: { organizationId } });
      await raw.partner.deleteMany({ where: { organizationId } });
      await raw.journalLine.deleteMany({ where: { organizationId } });
      await raw.journalEntry.deleteMany({ where: { organizationId } });
      await raw.auditLog.deleteMany({ where: { organizationId } });
      await raw.eventOutbox.deleteMany({ where: { organizationId } });
      await raw.accountMapping.deleteMany({ where: { organizationId } });
      await raw.account.deleteMany({ where: { organizationId } });
      await raw.fiscalPeriod.deleteMany({ where: { organizationId } });
      await raw.journal.deleteMany({ where: { organizationId } });
      await raw.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
    }
    await raw.$disconnect();
  });

  /** Create + calculate + approve a run for a fresh month; return the run id. */
  const runMonth = async (year: number, month0: number) => {
    const start = new Date(Date.UTC(year, month0, 1));
    const end = new Date(Date.UTC(year, month0 + 1, 0));
    const period = await asAdmin(() =>
      payroll.createPeriod({ periodType: 'MONTHLY', startDate: start.toISOString(), endDate: end.toISOString() }),
    );
    const run = await asAdmin(() => payroll.createRun({ periodId: period.id }));
    await asAdmin(() => payroll.calculateRun(run.id));
    await asAdmin(() => payroll.approveRun(run.id));
    return { runId: run.id, periodEnd: end };
  };

  it('posts a balanced journal booked only to payroll accounts, dated to period end', async () => {
    const { runId, periodEnd } = await runMonth(2026, 0); // January 2026

    const run = await raw.hrPayrollRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.status).toBe('APPROVED');
    expect(run.glPosted).toBe(true);
    expect(run.journalEntryId).toBeTruthy();

    const je = await raw.journalEntry.findUniqueOrThrow({
      where: { id: run.journalEntryId! },
      include: { lines: true },
    });

    // Dated to the PERIOD END, not "now". (Was `new Date()` before Phase 0.)
    expect(je.postingDate.toISOString().slice(0, 10)).toBe(periodEnd.toISOString().slice(0, 10));

    // Balances EXACTLY — integer UGX totals, compared as numbers.
    const sumDr = je.lines.reduce((s, l) => s + Number(l.baseDebit), 0);
    const sumCr = je.lines.reduce((s, l) => s + Number(l.baseCredit), 0);
    expect(sumDr).toBe(sumCr);

    // With no allowances/deductions, gross == net == base.
    expect(sumDr).toBe(1_200_000);

    // No line escapes the payroll account set — a rounding-account line (the
    // float-sum tell) would have an id outside it.
    for (const line of je.lines) {
      expect(payrollAccountIds.has(line.accountId)).toBe(true);
    }
    // Exactly two lines: Dr salary expense, Cr net pay payable (one employee).
    expect(je.lines).toHaveLength(2);

    // Phase 5 — the net-pay credit carries the employee's Partner, so the GL
    // can answer "what do we owe THIS person", not just "what do we owe payroll".
    const emp = await raw.hrEmployee.findFirstOrThrow({ where: { organizationId, id: employeeId } });
    const netLine = je.lines.find((l) => Number(l.baseCredit) > 0)!;
    expect(netLine.partnerId).toBe(emp.partnerId);
    expect(netLine.partnerId).toBeTruthy();

    // The payslip control totals equal the sum of the items, exactly.
    const items = await raw.hrPayrollItem.findMany({ where: { runId } });
    expect(items).toHaveLength(1);
    expect(items[0].netPay.toString()).toBe('1200000');
    expect(run.totalGross.toString()).toBe('1200000');
    expect(run.totalNet.toString()).toBe('1200000');
  });

  it('is idempotent — re-approving a posted run does not double-post', async () => {
    const period = await raw.hrPayrollPeriod.findFirstOrThrow({
      where: { organizationId, periodType: 'MONTHLY' },
      orderBy: { startDate: 'asc' },
    });
    const run = await raw.hrPayrollRun.findFirstOrThrow({ where: { organizationId, periodId: period.id } });

    // A posted run is APPROVED, so a second approve is rejected by the guard.
    await expect(asAdmin(() => payroll.approveRun(run.id))).rejects.toThrow(/CALCULATED/i);

    // And exactly one journal entry references this run.
    const entries = await raw.journalEntry.findMany({
      where: { organizationId, sourceType: 'payroll_run', sourceId: run.id },
    });
    expect(entries).toHaveLength(1);
  });

  it('keeps the journal exactly balanced with statutory + pension deductions and no rounding line', async () => {
    // A recurring pension deduction (5% of earnings) for every employee, plus a
    // progressive PAYE table. These produce non-round intermediate values that
    // a float sum would drift on; Decimal must tie out to the last unit.
    await asAdmin(() =>
      payroll.createComponent({
        code: 'PENSION',
        name: 'Pension 5%',
        componentType: 'DEDUCTION',
        calcMethod: 'PERCENTAGE',
        rate: 5,
        isRecurring: true,
      }),
    );
    await asAdmin(() =>
      payroll.createTaxTable({
        code: 'PAYE-2026',
        name: 'PAYE 2026',
        taxType: 'PAYE',
        effectiveFrom: new Date(Date.UTC(2025, 0, 1)).toISOString(),
        // Annual brackets; `rate` is a FRACTION. Above ~2.82M/yr → 30%.
        brackets: [
          { fromAmount: 0, toAmount: 2_820_000, rate: 0 },
          { fromAmount: 2_820_000, rate: 0.3 },
        ],
      }),
    );

    const { runId } = await runMonth(2026, 1); // February 2026

    const run = await raw.hrPayrollRun.findUniqueOrThrow({ where: { id: runId } });
    const je = await raw.journalEntry.findUniqueOrThrow({
      where: { id: run.journalEntryId! },
      include: { lines: true },
    });

    const sumDr = je.lines.reduce((s, l) => s + Number(l.baseDebit), 0);
    const sumCr = je.lines.reduce((s, l) => s + Number(l.baseCredit), 0);
    expect(sumDr).toBe(sumCr);
    for (const line of je.lines) {
      expect(payrollAccountIds.has(line.accountId)).toBe(true);
    }

    // Per-employee identity: gross = net + total deductions, exactly.
    const item = await raw.hrPayrollItem.findFirstOrThrow({ where: { runId } });
    const gross = item.grossPay;
    const recomputed = item.netPay.plus(item.totalDeductions);
    expect(recomputed.toString()).toBe(gross.toString());
    // Deductions actually happened (pension + PAYE both > 0).
    expect(Number(item.pensionAmount)).toBeGreaterThan(0);
    expect(Number(item.taxAmount)).toBeGreaterThan(0);
    // Salary-expense debit still equals gross (deductions are contra-credits).
    expect(Number(item.grossPay)).toBe(1_200_000);
  });

  it('reverses an approved run with a compensating entry and unsets glPosted', async () => {
    const period = await raw.hrPayrollPeriod.findFirstOrThrow({
      where: { organizationId, periodType: 'MONTHLY' },
      orderBy: { startDate: 'asc' },
    });
    const run = await raw.hrPayrollRun.findFirstOrThrow({ where: { organizationId, periodId: period.id } });
    const originalJournalId = run.journalEntryId!;

    await asAdmin(() => payroll.reverseRun(run.id, { reason: 'test reversal' }));

    const after = await raw.hrPayrollRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(after.status).toBe('REVERSED');
    expect(after.glPosted).toBe(false);

    // A reversal (mirror) entry now exists for the original journal.
    const reversal = await raw.journalEntry.findFirst({
      where: { organizationId, reversalOfId: originalJournalId },
    });
    expect(reversal).toBeTruthy();
  });

  it('refuses to approve into a closed fiscal period', async () => {
    // A closed period covering March 2026.
    const mStart = new Date(Date.UTC(2026, 2, 1));
    const mEnd = new Date(Date.UTC(2026, 2, 31));
    await raw.fiscalPeriod.create({
      data: {
        organizationId,
        name: 'FY2026-03 (closed)',
        startDate: mStart,
        endDate: mEnd,
        status: 'closed',
      },
    });

    const period = await asAdmin(() =>
      payroll.createPeriod({ periodType: 'MONTHLY', startDate: mStart.toISOString(), endDate: mEnd.toISOString() }),
    );
    const run = await asAdmin(() => payroll.createRun({ periodId: period.id }));
    await asAdmin(() => payroll.calculateRun(run.id));

    await expect(asAdmin(() => payroll.approveRun(run.id))).rejects.toThrow(/closed/i);

    // The run did not flip to APPROVED and nothing posted.
    const stuck = await raw.hrPayrollRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(stuck.status).toBe('CALCULATED');
    expect(stuck.glPosted).toBe(false);
  });
});
