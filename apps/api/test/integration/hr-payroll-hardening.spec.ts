/**
 * Integration — payroll production hardening (2026-09-21 review).
 *
 * One block per defect the review found. Each was money, compliance or control:
 *
 *  · two loans on one employee: approval reduced EACH loan by the employee's
 *    TOTAL installment, and reversal added the total back to each;
 *  · an input approved after calculation was stamped APPLIED without being paid;
 *  · editing a tax table left the old brackets live in the nested include, so
 *    PAYE was computed on old + new bands (doubled);
 *  · final settlement paid the last month in its own journal AND payroll paid
 *    it again, untaxed, summing every leave balance ever held;
 *  · PAYE was annualised ×12 regardless of period type;
 *  · paying staff, paying out advances and disbursing loans never reached the
 *    ledger; a run could generate any number of bank files;
 *  · the same user could request and approve an advance, approve their own
 *    leave, or approve one leave request twice concurrently;
 *  · a missing PAYE table silently computed zero tax;
 *  · "preview" of a DRAFT run wrote to the database.
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
import { HrLifecycleService } from '../../src/modules/hr/hr-lifecycle.service';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';

const utc = (y: number, m1: number, d: number) => new Date(Date.UTC(y, m1 - 1, d));
const iso = (y: number, m1: number, d: number) => utc(y, m1, d).toISOString();

describeDb('integration: payroll production hardening', () => {
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
  let lifecycle: HrLifecycleService;

  const stamp = Date.now();
  const organizationId = `org_hrhard_${stamp}`;
  const userA = `user_hrhard_a_${stamp}`;
  const userB = `user_hrhard_b_${stamp}`;
  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);
  const PERMS = ['hr:read', 'hr:employee', 'hr:payroll', 'hr:payroll_input', 'hr:leave', 'hr:offboarding', 'hr:loan', 'hr:advance', 'hr:payslip', 'hr:tax_table'];
  const as = <T>(userId: string, fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId, permissions: PERMS }, fn);
  const asA = <T>(fn: () => Promise<T>) => as(userA, fn);
  const asB = <T>(fn: () => Promise<T>) => as(userB, fn);

  const accountId: Record<string, string> = {};
  const emp: Record<string, string> = {};

  const newMonth = async (y: number, m1: number) => {
    const end = new Date(Date.UTC(y, m1, 0)).getUTCDate();
    const period = await asA(() => payroll.createPeriod({ periodType: 'MONTHLY', startDate: iso(y, m1, 1), endDate: iso(y, m1, end) }));
    const run = await asA(() => payroll.createRun({ periodId: period.id }));
    return { periodId: period.id as string, runId: run.id as string };
  };
  const itemOf = (runId: string, code: string) =>
    raw.hrPayrollItem.findFirst({
      where: { runId, employee: { employeeCode: code } },
      include: { deductions: true, allowances: true },
    });
  const journalLines = async (journalEntryId: string) =>
    (await raw.journalEntry.findUniqueOrThrow({ where: { id: journalEntryId }, include: { lines: true } })).lines;

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({ where: { code: 'UGX' }, update: {}, create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 } });
    await setOrg(organizationId);
    await raw.organization.create({ data: { id: organizationId, code: organizationId, name: 'Payroll Hardening Test', currencyCode: 'UGX' } });
    await raw.journal.create({ data: { organizationId, code: 'GEN', name: 'General', journalType: 'general' } });

    const mk = makeAccountFactory(raw, await ensureAccountCategories(raw));
    const mappings: Array<[string, string, string, TestAccountCategory]> = [
      ['salary_expense', 'HH-6000', 'Salaries', 'operating_expense'],
      ['net_pay_payable', 'HH-2100', 'Net Pay Payable', 'current_liability'],
      ['paye_payable', 'HH-2200', 'PAYE Payable', 'current_liability'],
      ['pension_payable', 'HH-2300', 'Pension Payable', 'current_liability'],
      ['social_security_payable', 'HH-2400', 'NSSF Payable', 'current_liability'],
      ['insurance_payable', 'HH-2500', 'Insurance Payable', 'current_liability'],
      ['employee_advance_receivable', 'HH-1300', 'Advances', 'current_asset'],
      ['employee_loan_receivable', 'HH-1400', 'Loans', 'current_asset'],
      ['default_bank', 'HH-1200', 'Bank', 'bank'],
      ['default_cash', 'HH-1100', 'Cash', 'cash'],
      ['bad_debt', 'HH-5500', 'Bad Debt', 'operating_expense'],
    ];
    for (const [key, code, name, category] of mappings) {
      const acct = await mk(organizationId, code, name, category);
      accountId[key] = acct.id;
      await raw.accountMapping.create({ data: { organizationId, key, accountId: acct.id } });
    }

    moduleRef = await Test.createTestingModule({ imports: [KernelModule, CoreModule, AccountingModule, HrModule] }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    payroll = moduleRef.get(HrPayrollService);
    org = moduleRef.get(HrOrgService);
    leave = moduleRef.get(HrLeaveService);
    lifecycle = moduleRef.get(HrLifecycleService);

    // A flat 10% PAYE: easy to verify by hand, and doubled bands show as 20%.
    await asA(() =>
      payroll.createTaxTable({
        code: 'PAYE-FLAT', name: 'Flat 10%', taxType: 'PAYE', effectiveFrom: iso(2020, 1, 1),
        brackets: [{ fromAmount: 0, rate: 0.1 }],
      }),
    );

    const roster: Array<[string, number]> = [['MULTI', 2_000_000], ['LEAVER', 3_100_000], ['SELF', 1_000_000]];
    for (const [code, salary] of roster) {
      const e = await asA(() =>
        org.createEmployee({
          firstName: code, lastName: 'Staff', employeeCode: code, employmentType: 'FULL_TIME',
          baseSalary: salary, payFrequency: 'MONTHLY', hireDate: iso(2020, 1, 1),
        }),
      );
      emp[code] = e.id;
    }
    // SELF is user A's own employee record (separation-of-duties checks).
    await raw.hrEmployee.update({ where: { id: emp.SELF }, data: { userId: userA } });
  });

  afterAll(async () => {
    if (moduleRef) await moduleRef.close();
    const w = { where: { organizationId } };
    await raw.hrBankPaymentLine.deleteMany(w);
    await raw.hrBankPayment.deleteMany(w);
    await raw.hrPayslip.deleteMany(w);
    await raw.hrPayrollAllowance.deleteMany(w);
    await raw.hrPayrollDeduction.deleteMany(w);
    await raw.hrPayrollItem.deleteMany(w);
    await raw.hrPayrollInput.deleteMany(w);
    await raw.hrPayrollRun.deleteMany(w);
    await raw.hrPayrollPeriod.deleteMany(w);
    await raw.hrEmployeeLoan.deleteMany(w);
    await raw.hrSalaryAdvance.deleteMany(w);
    await raw.hrOffboarding.deleteMany(w);
    await raw.hrAttendance.deleteMany(w);
    await raw.hrLeaveRequest.deleteMany(w);
    await raw.hrLeaveAccrual.deleteMany(w);
    await raw.hrLeaveBalance.deleteMany(w);
    await raw.hrLeaveType.deleteMany(w);
    await raw.hrTaxBracket.deleteMany(w);
    await raw.hrTaxTable.deleteMany(w);
    await raw.hrStatutoryConfig.deleteMany(w);
    await raw.hrPayrollComponent.deleteMany(w);
    await raw.hrEmploymentAction.deleteMany(w);
    await raw.hrSalaryChange.deleteMany(w);
    await raw.hrEmployee.deleteMany(w);
    await raw.journalLine.deleteMany(w);
    await raw.journalEntry.deleteMany(w);
    await raw.auditLog.deleteMany(w);
    await raw.eventOutbox.deleteMany(w);
    await raw.accountMapping.deleteMany(w);
    await raw.account.deleteMany(w);
    await raw.fiscalPeriod.deleteMany(w);
    await raw.journal.deleteMany(w);
    await raw.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
    await raw.$disconnect();
  });

  describe('guards', () => {
    it('refuses to calculate with no PAYE table in force', async () => {
      const period = await asA(() => payroll.createPeriod({ periodType: 'MONTHLY', startDate: iso(2019, 6, 1), endDate: iso(2019, 6, 30) }));
      const run = await asA(() => payroll.createRun({ periodId: period.id }));
      await expect(asA(() => payroll.calculateRun(run.id))).rejects.toThrow(/No active PAYE tax table/);
      await asA(() => payroll.deleteRun(run.id));
    });

    it('never writes when previewing a DRAFT run', async () => {
      const period = await asA(() => payroll.createPeriod({ periodType: 'MONTHLY', startDate: iso(2019, 7, 1), endDate: iso(2019, 7, 31) }));
      const run = await asA(() => payroll.createRun({ periodId: period.id }));
      await expect(asA(() => payroll.previewRun(run.id))).rejects.toThrow(/Calculate the run first/);
      expect(await raw.hrPayrollItem.count({ where: { runId: run.id } })).toBe(0);
      await asA(() => payroll.deleteRun(run.id));
    });

    it('refuses a second live run and an overlapping period', async () => {
      const { periodId, runId } = await newMonth(2019, 8);
      await expect(asA(() => payroll.createRun({ periodId }))).rejects.toThrow(/already exists/);
      await expect(
        asA(() => payroll.createPeriod({ periodType: 'MONTHLY', periodCode: 'X-OVERLAP', startDate: iso(2019, 8, 15), endDate: iso(2019, 9, 14) })),
      ).rejects.toThrow(/overlaps/);
      await asA(() => payroll.deleteRun(runId));
    });
  });

  describe('two loans on one employee', () => {
    let runId = '';
    let loan1 = '';
    let loan2 = '';

    beforeAll(async () => {
      loan1 = (await asA(() => payroll.createLoan({ employeeId: emp.MULTI, principal: 600_000, installmentsTotal: 6, disbursedAt: iso(2027, 1, 5) }))).id;
      loan2 = (await asA(() => payroll.createLoan({ employeeId: emp.MULTI, principal: 300_000, installmentsTotal: 3, disbursedAt: iso(2027, 1, 5) }))).id;
      ({ runId } = await newMonth(2027, 2));
      await asA(() => payroll.calculateRun(runId));
    });

    it('disburses each loan through the ledger', async () => {
      const l = await raw.hrEmployeeLoan.findUniqueOrThrow({ where: { id: loan1 } });
      expect(l.disbursementJournalEntryId).toBeTruthy();
      const lines = await journalLines(l.disbursementJournalEntryId!);
      expect(Number(lines.find((x) => x.accountId === accountId.employee_loan_receivable)!.baseDebit)).toBe(600_000);
      expect(Number(lines.find((x) => x.accountId === accountId.default_bank)!.baseCredit)).toBe(600_000);
    });

    it('takes one line per loan and settles each loan by its own line', async () => {
      const item = await itemOf(runId, 'MULTI');
      const loanLines = item!.deductions.filter((d) => d.sourceType === 'LOAN');
      expect(loanLines).toHaveLength(2);
      expect(Number(item!.loanDeduction)).toBe(200_000);

      await asA(() => payroll.approveRun(runId));
      const [l1, l2] = await Promise.all([
        raw.hrEmployeeLoan.findUniqueOrThrow({ where: { id: loan1 } }),
        raw.hrEmployeeLoan.findUniqueOrThrow({ where: { id: loan2 } }),
      ]);
      // The defect: each was reduced by 200,000 (the employee's TOTAL).
      expect(Number(l1.balance)).toBe(500_000);
      expect(Number(l2.balance)).toBe(200_000);
    });

    it('restores each loan by exactly its own line on reversal', async () => {
      await asA(() => payroll.reverseRun(runId, { reason: 'test' }));
      const [l1, l2] = await Promise.all([
        raw.hrEmployeeLoan.findUniqueOrThrow({ where: { id: loan1 } }),
        raw.hrEmployeeLoan.findUniqueOrThrow({ where: { id: loan2 } }),
      ]);
      expect(Number(l1.balance)).toBe(600_000);
      expect(Number(l2.balance)).toBe(300_000);
      expect(l1.installmentsPaid).toBe(0);
    });

    it('cannot edit a loan balance, and writes off through the ledger', async () => {
      await expect(asA(() => payroll.updateLoan(loan2, { status: 'PAID' }))).rejects.toThrow(/DEFAULTED/);
      const written = await asA(() => payroll.writeOffLoan(loan2, 'employee absconded'));
      expect(written.status).toBe('DEFAULTED');
      expect(Number(written.balance)).toBe(0);
      const entry = await raw.journalEntry.findFirstOrThrow({ where: { organizationId, sourceType: 'hr_loan_writeoff', sourceId: loan2 }, include: { lines: true } });
      expect(Number(entry.lines.find((x) => x.accountId === accountId.bad_debt)!.baseDebit)).toBe(300_000);
    });
  });

  describe('tax table edits', () => {
    it('never applies soft-deleted brackets', async () => {
      const table = await raw.hrTaxTable.findFirstOrThrow({ where: { organizationId, code: 'PAYE-FLAT' } });
      // Re-save the same single 10% band. Before the fix the old band stayed
      // in the include and PAYE came out at 20%.
      await asA(() => payroll.updateTaxTable(table.id, { brackets: [{ fromAmount: 0, rate: 0.1 }] }));
      const { runId } = await newMonth(2027, 3);
      await asA(() => payroll.calculateRun(runId));
      const item = await itemOf(runId, 'SELF');
      expect(Number(item!.taxAmount)).toBe(100_000); // 10% of 1,000,000
      await asA(() => payroll.reverseRun(runId, { reason: 'test' }));
    });
  });

  describe('advances, late inputs and payments', () => {
    let runId = '';
    let periodId = '';
    let advanceId = '';

    beforeAll(async () => {
      ({ runId, periodId } = await newMonth(2027, 4));
      advanceId = (await asA(() => payroll.createAdvance({ employeeId: emp.MULTI, amount: 300_000, installmentMonths: 3 }))).id;
    });

    it('refuses self-approval of an advance', async () => {
      await expect(asA(() => payroll.approveAdvance(advanceId))).rejects.toThrow(/requested yourself/);
      await asB(() => payroll.approveAdvance(advanceId));
    });

    it('does not recover an advance that has not been paid out', async () => {
      await asA(() => payroll.calculateRun(runId));
      const item = await itemOf(runId, 'MULTI');
      expect(Number(item!.advanceDeduction)).toBe(0);
    });

    it('posts the advance payout and then recovers it', async () => {
      const paid = await asA(() => payroll.markAdvancePaid(advanceId, { paymentMethod: 'CASH', paidAt: iso(2027, 4, 2) }));
      const lines = await journalLines(paid.disbursementJournalEntryId!);
      expect(Number(lines.find((x) => x.accountId === accountId.employee_advance_receivable)!.baseDebit)).toBe(300_000);
      expect(Number(lines.find((x) => x.accountId === accountId.default_cash)!.baseCredit)).toBe(300_000);
      await asA(() => payroll.calculateRun(runId));
      const item = await itemOf(runId, 'MULTI');
      expect(Number(item!.advanceDeduction)).toBe(100_000);
    });

    it('refuses to approve when an input was approved after calculation', async () => {
      const [input] = await asA(() =>
        payroll.createPayrollInputs({ inputs: [{ employeeId: emp.SELF, periodId, inputType: 'BONUS', name: 'Late bonus', amount: 50_000 }] }),
      );
      await asB(() => payroll.approvePayrollInputs({ ids: [input.id] }));
      await expect(asA(() => payroll.approveRun(runId))).rejects.toThrow(/recalculate/);
      await asA(() => payroll.calculateRun(runId));
      await asA(() => payroll.approveRun(runId));
      const after = await raw.hrPayrollInput.findUniqueOrThrow({ where: { id: input.id } });
      expect(after.status).toBe('APPLIED');
      expect(after.appliedRunId).toBe(runId);
      const item = await itemOf(runId, 'SELF');
      expect(Number(item!.bonusAmount)).toBe(50_000);
    });

    it('allows one live bank batch per run and posts the payment on PAID', async () => {
      const batch = await asA(() => payroll.generateBankPayment({ runId, method: 'BANK', paymentDate: iso(2027, 4, 30) }));
      await expect(asA(() => payroll.generateBankPayment({ runId }))).rejects.toThrow(/already open/);

      const totalNet = (await raw.hrPayrollItem.findMany({ where: { runId } })).reduce((s, i) => s + Number(i.netPay), 0);
      expect(Number(batch!.totalAmount)).toBe(totalNet);

      await asA(() => payroll.updateBankPaymentStatus(batch!.id, { status: 'PAID' }));
      const paidBatch = await raw.hrBankPayment.findUniqueOrThrow({ where: { id: batch!.id } });
      const lines = await journalLines(paidBatch.journalEntryId!);
      const netDr = lines.filter((x) => x.accountId === accountId.net_pay_payable).reduce((s, x) => s + Number(x.baseDebit), 0);
      expect(netDr).toBe(totalNet);
      expect(Number(lines.find((x) => x.accountId === accountId.default_bank)!.baseCredit)).toBe(totalNet);

      const run = await raw.hrPayrollRun.findUniqueOrThrow({ where: { id: runId } });
      expect(run.status).toBe('PAID');
      const slips = await raw.hrPayslip.findMany({ where: { item: { runId } } });
      for (const s of slips) expect(s.status).toBe('PAID');
    });

    it('will not reverse a paid run until the payment is reversed', async () => {
      await expect(asA(() => payroll.reverseRun(runId, { reason: 'x' }))).rejects.toThrow(/already paid/);
      const batch = await raw.hrBankPayment.findFirstOrThrow({ where: { organizationId, runId, status: 'PAID' } });
      await asA(() => payroll.reverseBankPayment(batch.id, { reason: 'bank rejected the file' }));
      const run = await raw.hrPayrollRun.findUniqueOrThrow({ where: { id: runId } });
      expect(run.status).toBe('APPROVED');
      const slips = await raw.hrPayslip.findMany({ where: { item: { runId } } });
      for (const s of slips) expect(s.status).toBe('ISSUED');
      await asA(() => payroll.reverseRun(runId, { reason: 'test' }));
    });
  });

  describe('leave approval controls', () => {
    let leaveTypeId = '';

    beforeAll(async () => {
      leaveTypeId = (await asA(() => leave.createType({ code: 'AL', name: 'Annual', daysPerYear: 21, accrualMethod: 'NONE', isEncashable: true }))).id;
      for (const code of ['SELF', 'MULTI']) {
        await asA(() => leave.adjustBalance({ employeeId: emp[code], leaveTypeId, year: 2027, adjustedDays: 10 }));
      }
    });

    it('refuses to let an employee approve their own leave', async () => {
      const req = await asA(() => leave.createRequest({ employeeId: emp.SELF, leaveTypeId, startDate: iso(2027, 5, 3), endDate: iso(2027, 5, 4) }));
      await expect(asA(() => leave.approveRequest(req.id, {}))).rejects.toThrow(/your own leave/);
      await asB(() => leave.approveRequest(req.id, {}));
    });

    it('deducts the balance once when two approvers click together', async () => {
      const req = await asA(() => leave.createRequest({ employeeId: emp.MULTI, leaveTypeId, startDate: iso(2027, 5, 10), endDate: iso(2027, 5, 11) }));
      const results = await Promise.allSettled([
        asA(() => leave.approveRequest(req.id, {})),
        asB(() => leave.approveRequest(req.id, {})),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const bal = await raw.hrLeaveBalance.findFirstOrThrow({ where: { organizationId, employeeId: emp.MULTI, leaveTypeId, year: 2027 } });
      expect(Number(bal.usedDays)).toBe(Number(req.days));
    });
  });

  describe('final settlement', () => {
    let periodId = '';
    let runId = '';
    let loanId = '';

    beforeAll(async () => {
      const al = await raw.hrLeaveType.findFirstOrThrow({ where: { organizationId, code: 'AL' } });
      await asA(() => leave.adjustBalance({ employeeId: emp.LEAVER, leaveTypeId: al.id, year: 2027, adjustedDays: 10 }));
      // Last year's unused days and a non-encashable type must NOT be paid out.
      await asA(() => leave.adjustBalance({ employeeId: emp.LEAVER, leaveTypeId: al.id, year: 2026, adjustedDays: 15 }));
      const sick = await asA(() => leave.createType({ code: 'SICK', name: 'Sick', daysPerYear: 30, accrualMethod: 'NONE' }));
      await asA(() => leave.adjustBalance({ employeeId: emp.LEAVER, leaveTypeId: sick.id, year: 2027, adjustedDays: 30 }));
      loanId = (await asA(() => payroll.createLoan({ employeeId: emp.LEAVER, principal: 1_000_000, installmentsTotal: 10, disbursedAt: iso(2027, 6, 1) }))).id;
      ({ periodId, runId } = await newMonth(2027, 8)); // August: 31 days → day rate 100,000
    });

    it('previews an estimate without writing', async () => {
      const est: any = await asA(() => lifecycle.computeFinalSettlement(emp.LEAVER, iso(2027, 8, 15), false));
      expect(Number(est.salaryDue)).toBe(1_500_000); // 3.1m × 15/31
      expect(est.leaveDays).toBe(10); // this year's ANNUAL only
      expect(Number(est.leavePayout)).toBe(1_000_000);
      expect(await raw.hrOffboarding.count({ where: { organizationId, employeeId: emp.LEAVER } })).toBe(0);
    });

    it('pays the final month once, taxes the leave payout and recovers the loan in full', async () => {
      await asA(() => lifecycle.computeFinalSettlement(emp.LEAVER, iso(2027, 8, 15), true, { reason: 'resignation' }));
      const employee = await raw.hrEmployee.findUniqueOrThrow({ where: { id: emp.LEAVER } });
      expect(employee.isActive).toBe(false);
      expect(employee.deletedAt).toBeNull(); // still visible to the final payroll

      // No settlement journal: the payroll run is the only payment.
      expect(await raw.journalEntry.count({ where: { organizationId, sourceType: 'hr_settlement' } })).toBe(0);

      const input = await raw.hrPayrollInput.findFirstOrThrow({ where: { organizationId, employeeId: emp.LEAVER, periodId } });
      expect(input.status).toBe('PENDING');
      expect(input.isTaxable).toBe(true);
      await asB(() => payroll.approvePayrollInputs({ ids: [input.id] }));

      await asA(() => payroll.calculateRun(runId));
      const item = await itemOf(runId, 'LEAVER');
      expect(Number(item!.baseSalary)).toBe(1_500_000);
      expect(Number(item!.grossPay)).toBe(2_500_000);
      expect(Number(item!.taxableIncome)).toBe(2_500_000);
      expect(Number(item!.taxAmount)).toBe(250_000);
      // Final pay: the whole 1,000,000 balance, not one 100,000 installment.
      expect(Number(item!.loanDeduction)).toBe(1_000_000);
      await asA(() => payroll.approveRun(runId));
      const loan = await raw.hrEmployeeLoan.findUniqueOrThrow({ where: { id: loanId } });
      expect(loan.status).toBe('PAID');
    });

    it('is not paid again in the following period', async () => {
      const { runId: sepRun } = await newMonth(2027, 9);
      await asA(() => payroll.calculateRun(sepRun));
      expect(await itemOf(sepRun, 'LEAVER')).toBeNull();
    });
  });

  describe('weekly periods', () => {
    it('annualises PAYE with 52 periods and pays only weekly-salaried staff', async () => {
      await asA(() =>
        payroll.createTaxTable({
          code: 'PAYE-PROG', name: 'Progressive', taxType: 'PAYE', effectiveFrom: iso(2027, 12, 1),
          brackets: [{ fromAmount: 0, toAmount: 5_200_000, rate: 0 }, { fromAmount: 5_200_000, rate: 0.3 }],
        }),
      );
      const weekly = await asA(() =>
        org.createEmployee({
          firstName: 'WEEKLY', lastName: 'Staff', employeeCode: 'WEEKLY', employmentType: 'CASUAL',
          baseSalary: 500_000, payFrequency: 'WEEKLY', hireDate: iso(2020, 1, 1),
        }),
      );
      emp.WEEKLY = weekly.id;
      const period = await asA(() => payroll.createPeriod({ periodType: 'WEEKLY', periodCode: 'WK-2027-49', startDate: iso(2027, 12, 6), endDate: iso(2027, 12, 12) }));
      const run = await asA(() => payroll.createRun({ periodId: period.id }));
      await asA(() => payroll.calculateRun(run.id));
      const items = await raw.hrPayrollItem.findMany({ where: { runId: run.id }, include: { employee: { select: { employeeCode: true } } } });
      // Monthly-salaried staff are not paid a full month in a week.
      expect(items.map((i) => i.employee.employeeCode)).toEqual(['WEEKLY']);
      // (500,000 × 52 − 5,200,000) × 30% ÷ 52 = 120,000. ×12 would give 20,000.
      expect(Number(items[0].taxAmount)).toBe(120_000);
    });
  });
});
