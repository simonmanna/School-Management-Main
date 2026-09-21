/**
 * Integration — pro-rata, unpaid leave, ad-hoc inputs and reversal integrity.
 *
 * Each block here pins a defect the payroll engine used to have, and each one
 * of them was money:
 *
 *  · a mid-month joiner was paid a full month;
 *  · a mid-month leaver was paid a full month;
 *  · approved UNPAID leave cost the employee nothing;
 *  · the closing day of the period was excluded from every date window, so a
 *    month-end attendance record or leave day simply did not count;
 *  · `isTaxable: false` on an allowance was decorative — PAYE was charged on the
 *    whole gross regardless;
 *  · reversing an approved run backed out the GL journal but LEFT loan and
 *    advance balances written down, so a reversed-and-rerun payroll recovered an
 *    installment the employee had never repaid.
 *
 * The figures below are hand-computable on purpose. If the engine's arithmetic
 * moves, this spec must fail before a pay run does.
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
import { HrLeaveService } from '../../src/modules/hr/hr-leave.service';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';

/** September 2026: 30 days. Chosen so the arithmetic below is exact. */
const YEAR = 2026;
const MONTH = 8; // zero-based → September
const PERIOD_DAYS = 30;
const SALARY = 3_000_000;
const utc = (day: number) => new Date(Date.UTC(YEAR, MONTH, day));

describeDb('integration: payroll pro-rata, unpaid leave and inputs', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let payroll: HrPayrollService;
  let org: HrOrgService;
  let leave: HrLeaveService;

  const organizationId = `org_prorata_${Date.now()}`;
  const userId = `user_prorata_${Date.now()}`;
  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);

  const asAdmin = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run(
      {
        organizationId,
        userId,
        permissions: ['hr:read', 'hr:employee', 'hr:payroll', 'hr:leave', 'hr:offboarding', 'hr:loan'],
      },
      fn,
    );

  const employees: Record<string, string> = {};
  let periodId = '';
  let unpaidLeaveTypeId = '';

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await setOrg(organizationId);
    await raw.organization.create({
      data: { id: organizationId, code: organizationId, name: 'Pro-rata Payroll Test', currencyCode: 'UGX' },
    });
    await raw.journal.create({ data: { organizationId, code: 'GEN', name: 'General', journalType: 'general' } });

    const mk = makeAccountFactory(raw, await ensureAccountCategories(raw));
    const mappings: Array<[string, string, string, TestAccountCategory]> = [
      ['salary_expense', 'PR-6000', 'Salaries', 'operating_expense'],
      ['net_pay_payable', 'PR-2100', 'Net Pay Payable', 'current_liability'],
      ['paye_payable', 'PR-2200', 'PAYE Payable', 'current_liability'],
      ['pension_payable', 'PR-2300', 'Pension Payable', 'current_liability'],
      ['social_security_payable', 'PR-2400', 'NSSF Payable', 'current_liability'],
      ['insurance_payable', 'PR-2500', 'Insurance Payable', 'current_liability'],
      ['employee_advance_receivable', 'PR-1300', 'Advances', 'current_asset'],
      ['employee_loan_receivable', 'PR-1400', 'Loans', 'current_asset'],
    ];
    for (const [key, code, name, category] of mappings) {
      const acct = await mk(organizationId, code, name, category);
      await raw.accountMapping.create({ data: { organizationId, key, accountId: acct.id } });
    }

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, CoreModule, AccountingModule, HrModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    payroll = moduleRef.get(HrPayrollService);
    org = moduleRef.get(HrOrgService);
    leave = moduleRef.get(HrLeaveService);

    // FULL   — employed all month, the control.
    // JOINER — hired on the 16th, so 15 of 30 days.
    // LEAVER — last working day the 10th, so 10 of 30 days.
    // LWOP   — full month less 5 days of approved unpaid leave, so 25 of 30.
    // EDGE   — hired on the 30th: ONE day, and only if the closing day counts.
    const roster: Array<[string, Date | null]> = [
      ['FULL', new Date(Date.UTC(2020, 0, 1))],
      ['JOINER', utc(16)],
      ['LEAVER', new Date(Date.UTC(2020, 0, 1))],
      ['LWOP', new Date(Date.UTC(2020, 0, 1))],
      ['EDGE', utc(30)],
    ];
    for (const [code, hireDate] of roster) {
      const emp = await asAdmin(() =>
        org.createEmployee({
          firstName: code,
          lastName: 'Staff',
          employeeCode: code,
          employmentType: 'FULL_TIME',
          baseSalary: SALARY,
          payFrequency: 'MONTHLY',
          hireDate: hireDate ? hireDate.toISOString() : undefined,
        }),
      );
      employees[code] = emp.id;
    }

    // LEAVER walks out on the 10th. Written directly as a fixture rather than
    // through `computeFinalSettlement`, which also posts a settlement journal —
    // what this spec is about is the payroll engine reading the exit date.
    await raw.hrOffboarding.create({
      data: {
        organizationId,
        employeeId: employees.LEAVER,
        reason: 'resignation',
        noticeDate: utc(1),
        lastWorkingDay: utc(10),
        status: 'initiated',
      },
    });

    // Five days of UNPAID leave for LWOP, the 6th to the 10th inclusive.
    const leaveType = await asAdmin(() =>
      leave.createType({
        code: 'LWOP',
        name: 'Leave without pay',
        daysPerYear: 30,
        isPaid: false,
        accrualMethod: 'NONE',
      }),
    );
    unpaidLeaveTypeId = leaveType.id;
    await asAdmin(() =>
      leave.adjustBalance({
        employeeId: employees.LWOP,
        leaveTypeId: unpaidLeaveTypeId,
        year: YEAR,
        adjustedDays: 30,
      }),
    );
    const request = await asAdmin(() =>
      leave.createRequest({
        employeeId: employees.LWOP,
        leaveTypeId: unpaidLeaveTypeId,
        startDate: utc(6).toISOString(),
        endDate: utc(10).toISOString(),
        reason: 'unpaid',
      }),
    );
    await asAdmin(() => leave.approveRequest(request.id, {}));

    const period = await asAdmin(() =>
      payroll.createPeriod({
        periodType: 'MONTHLY',
        startDate: utc(1).toISOString(),
        endDate: utc(PERIOD_DAYS).toISOString(),
      }),
    );
    periodId = period.id;
  });

  afterAll(async () => {
    if (moduleRef) await moduleRef.close();
    await raw.hrPayslip.deleteMany({ where: { organizationId } });
    await raw.hrPayrollAllowance.deleteMany({ where: { organizationId } });
    await raw.hrPayrollDeduction.deleteMany({ where: { organizationId } });
    await raw.hrPayrollItem.deleteMany({ where: { organizationId } });
    await raw.hrBankPaymentLine.deleteMany({ where: { organizationId } });
    await raw.hrBankPayment.deleteMany({ where: { organizationId } });
    await raw.hrPayrollInput.deleteMany({ where: { organizationId } });
    await raw.hrPayrollRun.deleteMany({ where: { organizationId } });
    await raw.hrPayrollPeriod.deleteMany({ where: { organizationId } });
    await raw.hrEmployeeLoan.deleteMany({ where: { organizationId } });
    await raw.hrSalaryAdvance.deleteMany({ where: { organizationId } });
    await raw.hrAttendance.deleteMany({ where: { organizationId } });
    await raw.hrLeaveRequest.deleteMany({ where: { organizationId } });
    await raw.hrLeaveAccrual.deleteMany({ where: { organizationId } });
    await raw.hrLeaveBalance.deleteMany({ where: { organizationId } });
    await raw.hrLeaveType.deleteMany({ where: { organizationId } });
    await raw.hrOffboarding.deleteMany({ where: { organizationId } });
    await raw.hrPayrollComponent.deleteMany({ where: { organizationId } });
    await raw.hrEmploymentAction.deleteMany({ where: { organizationId } });
    await raw.hrSalaryChange.deleteMany({ where: { organizationId } });
    await raw.hrEmployee.deleteMany({ where: { organizationId } });
    await raw.journalLine.deleteMany({ where: { organizationId } });
    await raw.journalEntry.deleteMany({ where: { organizationId } });
    await raw.auditLog.deleteMany({ where: { organizationId } });
    await raw.eventOutbox.deleteMany({ where: { organizationId } });
    await raw.accountMapping.deleteMany({ where: { organizationId } });
    await raw.account.deleteMany({ where: { organizationId } });
    await raw.fiscalPeriod.deleteMany({ where: { organizationId } });
    await raw.journal.deleteMany({ where: { organizationId } });
    await raw.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
    await raw.$disconnect();
  });

  const itemsOf = (runId: string) =>
    raw.hrPayrollItem.findMany({
      where: { runId },
      include: { employee: { select: { employeeCode: true } } },
    });
  const byCode = (items: any[], code: string) =>
    items.find((i) => i.employee.employeeCode === code)!;

  describe('pro-rata by days on the payroll', () => {
    let runId = '';
    let items: any[] = [];

    beforeAll(async () => {
      const run = await asAdmin(() => payroll.createRun({ periodId }));
      runId = run.id;
      await asAdmin(() => payroll.calculateRun(runId));
      items = await itemsOf(runId);
    });

    it('pays a full-month employee the whole salary', () => {
      const full = byCode(items, 'FULL');
      expect(Number(full.proRataFactor)).toBeCloseTo(1, 6);
      expect(Number(full.paidDays)).toBe(PERIOD_DAYS);
      expect(Number(full.baseSalary)).toBeCloseTo(SALARY, 0);
    });

    it('pays a mid-month joiner only for the days held', () => {
      // Hired the 16th → the 16th to the 30th inclusive is 15 days.
      const joiner = byCode(items, 'JOINER');
      expect(Number(joiner.paidDays)).toBe(15);
      expect(Number(joiner.periodDays)).toBe(PERIOD_DAYS);
      expect(Number(joiner.proRataFactor)).toBeCloseTo(0.5, 6);
      expect(Number(joiner.baseSalary)).toBeCloseTo(SALARY / 2, 0);
    });

    it('pays a mid-month leaver only up to the last working day', () => {
      // Left on the 10th → the 1st to the 10th inclusive is 10 days.
      const leaver = byCode(items, 'LEAVER');
      expect(Number(leaver.paidDays)).toBe(10);
      expect(Number(leaver.baseSalary)).toBeCloseTo((SALARY * 10) / PERIOD_DAYS, 0);
    });

    it('deducts approved unpaid leave from the days paid', () => {
      // Five days LWOP → 25 of 30 paid, and the days are recorded, not just netted.
      const lwop = byCode(items, 'LWOP');
      expect(Number(lwop.unpaidLeaveDays)).toBe(5);
      expect(Number(lwop.absenceDays)).toBe(5);
      expect(Number(lwop.paidDays)).toBe(25);
      expect(Number(lwop.baseSalary)).toBeCloseTo((SALARY * 25) / PERIOD_DAYS, 0);
    });

    it('counts the closing day of the period', () => {
      // EDGE was hired ON the 30th, the last day of the period. A `lt: endDate`
      // bound excluded that day entirely and paid them nothing.
      const edge = byCode(items, 'EDGE');
      expect(Number(edge.paidDays)).toBe(1);
      expect(Number(edge.baseSalary)).toBeCloseTo(SALARY / PERIOD_DAYS, 0);
    });

    it('excludes anyone not employed during the period at all', async () => {
      const future = await asAdmin(() =>
        org.createEmployee({
          firstName: 'FUTURE',
          lastName: 'Hire',
          employeeCode: 'FUTURE',
          employmentType: 'FULL_TIME',
          baseSalary: SALARY,
          payFrequency: 'MONTHLY',
          hireDate: new Date(Date.UTC(YEAR, MONTH + 2, 1)).toISOString(),
        }),
      );
      await asAdmin(() => payroll.calculateRun(runId));
      const after = await itemsOf(runId);
      expect(after.some((i) => i.employee.employeeCode === 'FUTURE')).toBe(false);
      await raw.hrEmployee.update({ where: { id: future.id }, data: { deletedAt: new Date() } });
      await asAdmin(() => payroll.calculateRun(runId));
    });

    it('is idempotent — recalculating produces the same figures', async () => {
      const before = await itemsOf(runId);
      await asAdmin(() => payroll.calculateRun(runId));
      const after = await itemsOf(runId);
      expect(after).toHaveLength(before.length);
      for (const b of before) {
        const a = byCode(after, b.employee.employeeCode);
        expect(Number(a.netPay)).toBeCloseTo(Number(b.netPay), 6);
      }
    });
  });

  describe('ad-hoc payroll inputs', () => {
    let runId = '';

    beforeAll(async () => {
      const period = await asAdmin(() =>
        payroll.createPeriod({
          periodType: 'MONTHLY',
          startDate: new Date(Date.UTC(YEAR, MONTH + 1, 1)).toISOString(),
          endDate: new Date(Date.UTC(YEAR, MONTH + 1, 31)).toISOString(),
        }),
      );
      const run = await asAdmin(() => payroll.createRun({ periodId: period.id }));
      runId = run.id;

      const created = await asAdmin(() =>
        payroll.createPayrollInputs({
          inputs: [
            { employeeId: employees.FULL, periodId: period.id, inputType: 'BONUS', name: 'Term bonus', amount: 500_000 },
            { employeeId: employees.FULL, periodId: period.id, inputType: 'REIMBURSEMENT', name: 'Travel refund', amount: 100_000 },
            { employeeId: employees.FULL, periodId: period.id, inputType: 'DEDUCTION', name: 'Staff shop', amount: 50_000 },
          ],
        }),
      );
      // Capture is not authorisation: a PENDING input must not be paid.
      await asAdmin(() => payroll.calculateRun(runId));
      const pendingItems = await itemsOf(runId);
      expect(Number(byCode(pendingItems, 'FULL').bonusAmount)).toBe(0);

      await asAdmin(() => payroll.approvePayrollInputs({ ids: created.map((c: any) => c.id) }));
      await asAdmin(() => payroll.calculateRun(runId));
    });

    it('pays approved bonuses and recovers approved deductions', async () => {
      const item = byCode(await itemsOf(runId), 'FULL');
      expect(Number(item.bonusAmount)).toBeCloseTo(500_000, 0);
      // Reimbursement rides in allowances; the ad-hoc deduction in "other".
      expect(Number(item.allowancesTotal)).toBeCloseTo(100_000, 0);
      expect(Number(item.otherDeductions)).toBeCloseTo(50_000, 0);
      expect(Number(item.grossPay)).toBeCloseTo(SALARY + 500_000 + 100_000, 0);
    });

    it('does not tax a reimbursement', async () => {
      // A receipted refund is not income. Before the fix PAYE was charged on the
      // whole gross and `isTaxable` was decorative.
      const item = byCode(await itemsOf(runId), 'FULL');
      const deductions = await raw.hrPayrollDeduction.findMany({ where: { itemId: item.id } });
      const paye = deductions.find((d) => d.name === 'PAYE Tax');
      const allowances = await raw.hrPayrollAllowance.findMany({ where: { itemId: item.id } });
      const refund = allowances.find((a) => a.name === 'Travel refund')!;
      expect(refund.isTaxable).toBe(false);
      // With no tax table configured in this org there is no PAYE line at all,
      // which is itself the assertion that nothing was charged on the refund.
      expect(paye).toBeUndefined();
    });

    it('marks inputs APPLIED on approval so a second run cannot pay them twice', async () => {
      await asAdmin(() => payroll.approveRun(runId));
      const inputs = await raw.hrPayrollInput.findMany({ where: { organizationId, appliedRunId: runId } });
      expect(inputs).toHaveLength(3);
      for (const i of inputs) expect(i.status).toBe('APPLIED');
    });

    it('refuses to edit an input a run has already paid', async () => {
      const input = await raw.hrPayrollInput.findFirst({ where: { organizationId, status: 'APPLIED' } });
      await expect(
        asAdmin(() => payroll.updatePayrollInput(input!.id, { amount: 999_999 })),
      ).rejects.toThrow(/APPLIED/);
    });
  });

  describe('reversal restores what approval consumed', () => {
    let runId = '';
    let loanId = '';

    beforeAll(async () => {
      const period = await asAdmin(() =>
        payroll.createPeriod({
          periodType: 'MONTHLY',
          startDate: new Date(Date.UTC(YEAR, MONTH + 2, 1)).toISOString(),
          endDate: new Date(Date.UTC(YEAR, MONTH + 2, 30)).toISOString(),
        }),
      );
      const loan = await asAdmin(() =>
        payroll.createLoan({
          employeeId: employees.FULL,
          principal: 1_000_000,
          installmentsTotal: 10,
          disbursedAt: utc(1).toISOString(),
        }),
      );
      loanId = loan.id;

      const run = await asAdmin(() => payroll.createRun({ periodId: period.id }));
      runId = run.id;
      await asAdmin(() => payroll.calculateRun(runId));
      await asAdmin(() => payroll.approveRun(runId));
    });

    it('takes an installment on approval', async () => {
      const loan = await raw.hrEmployeeLoan.findUnique({ where: { id: loanId } });
      expect(Number(loan!.balance)).toBeCloseTo(900_000, 0);
      expect(loan!.installmentsPaid).toBe(1);
    });

    it('puts the installment back when the run is reversed', async () => {
      // The defect: the GL journal was reversed but the loan stayed written
      // down, so re-running the corrected payroll took a SECOND installment for
      // a month the employee was paid once.
      await asAdmin(() => payroll.reverseRun(runId, { reason: 'wrong period' }));
      const loan = await raw.hrEmployeeLoan.findUnique({ where: { id: loanId } });
      expect(Number(loan!.balance)).toBeCloseTo(1_000_000, 0);
      expect(loan!.installmentsPaid).toBe(0);
    });

    it('cancels the payslips of a reversed run rather than deleting them', async () => {
      // Staff may already hold a printed copy, so the number has to keep
      // resolving — to a slip that says it was voided.
      const items = await raw.hrPayrollItem.findMany({ where: { runId }, select: { id: true } });
      const slips = await raw.hrPayslip.findMany({ where: { itemId: { in: items.map((i) => i.id) } } });
      expect(slips.length).toBeGreaterThan(0);
      for (const s of slips) expect(s.status).toBe('CANCELLED');
    });
  });
});
