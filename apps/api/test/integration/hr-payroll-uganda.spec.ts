/**
 * Integration — Uganda PAYE + NSSF, worked example per band (Phase 6).
 *
 * These are the numbers a bursar would check by hand, so they are computed here
 * from first principles and asserted exactly. If a rate or band moves, this
 * spec fails loudly rather than a pay run quietly paying the wrong amount.
 *
 * Uganda PAYE, resident individuals, MONTHLY chargeable income:
 *        0 –    235,000   0%
 *   235,001 –    335,000  10% of the excess over 235,000
 *   335,001 –    410,000  20% of the excess over 335,000  (+10,000)
 *   410,001 – 10,000,000  30% of the excess over 410,000  (+25,000)
 *      over   10,000,000  additional 10% (40% top marginal)
 *
 * NSSF: 5% employee (reduces net pay), 10% employer (a school cost).
 * Chargeable income is gross MINUS the NSSF employee contribution.
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

const MONTHS = 12;
const m = (monthly: number) => monthly * MONTHS;
const NSSF_EMPLOYEE_RATE = 0.05;

/** The hand-computed monthly PAYE for a given monthly chargeable income. */
function expectedMonthlyPaye(chargeable: number): number {
  if (chargeable <= 235_000) return 0;
  if (chargeable <= 335_000) return (chargeable - 235_000) * 0.1;
  if (chargeable <= 410_000) return 10_000 + (chargeable - 335_000) * 0.2;
  if (chargeable <= 10_000_000) return 25_000 + (chargeable - 410_000) * 0.3;
  return 25_000 + (10_000_000 - 410_000) * 0.3 + (chargeable - 10_000_000) * 0.4;
}

describeDb('integration: Uganda PAYE + NSSF', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let payroll: HrPayrollService;
  let org: HrOrgService;

  const organizationId = `org_ugtax_${Date.now()}`;
  const userId = `user_ugtax_${Date.now()}`;
  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);

  /** One employee per band, so a single run exercises the whole table. */
  const SALARIES: Array<{ code: string; gross: number; band: string }> = [
    { code: 'UG-A', gross: 200_000, band: 'nil rate' },
    { code: 'UG-B', gross: 300_000, band: '10%' },
    { code: 'UG-C', gross: 400_000, band: '20%' },
    { code: 'UG-D', gross: 1_200_000, band: '30%' },
    { code: 'UG-E', gross: 12_000_000, band: '40% top marginal' },
  ];

  const asAdmin = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId, permissions: ['hr:read', 'hr:employee', 'hr:payroll'] }, fn);

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({ where: { code: 'UGX' }, update: {}, create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 } });
    await setOrg(organizationId);
    await raw.organization.create({ data: { id: organizationId, code: organizationId, name: 'Uganda Payroll Test', currencyCode: 'UGX' } });
    await raw.journal.create({ data: { organizationId, code: 'GEN', name: 'General', journalType: 'general' } });

    const mk = makeAccountFactory(raw, await ensureAccountCategories(raw));
    const mappings: Array<[string, string, string, TestAccountCategory]> = [
      ['salary_expense', 'UG-6000', 'Salaries', 'operating_expense'],
      ['net_pay_payable', 'UG-2100', 'Net Pay Payable', 'current_liability'],
      ['paye_payable', 'UG-2200', 'PAYE Payable', 'current_liability'],
      ['pension_payable', 'UG-2300', 'Pension Payable', 'current_liability'],
      ['social_security_payable', 'UG-2400', 'NSSF Payable', 'current_liability'],
      ['insurance_payable', 'UG-2500', 'Insurance Payable', 'current_liability'],
      ['employee_advance_receivable', 'UG-1300', 'Advances', 'current_asset'],
      ['employee_loan_receivable', 'UG-1400', 'Loans', 'current_asset'],
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

    for (const s of SALARIES) {
      await asAdmin(() =>
        org.createEmployee({
          firstName: s.code,
          lastName: 'Staff',
          employeeCode: s.code,
          employmentType: 'FULL_TIME',
          baseSalary: s.gross,
          payFrequency: 'MONTHLY',
        }),
      );
    }

    // Statutory setup, mirroring prisma/seed-hr-uganda.ts.
    await asAdmin(() =>
      payroll.createComponent({
        code: 'NSSF-SSF',
        name: 'NSSF employee (5%)',
        componentType: 'DEDUCTION',
        calcMethod: 'PERCENTAGE',
        rate: 5, // PERCENT
        isTaxable: false,
        isRecurring: true,
      }),
    );
    await asAdmin(() =>
      payroll.createTaxTable({
        code: 'UG-PAYE',
        name: 'Uganda PAYE',
        countryCode: 'UG',
        taxType: 'PAYE',
        effectiveFrom: new Date('2024-07-01').toISOString(),
        // Annualised marginal bands; `rate` is a FRACTION.
        brackets: [
          { fromAmount: m(0), toAmount: m(235_000), rate: 0 },
          { fromAmount: m(235_000), toAmount: m(335_000), rate: 0.1 },
          { fromAmount: m(335_000), toAmount: m(410_000), rate: 0.2 },
          { fromAmount: m(410_000), toAmount: m(10_000_000), rate: 0.3 },
          { fromAmount: m(10_000_000), rate: 0.4 },
        ],
      }),
    );
  });

  afterAll(async () => {
    if (moduleRef) await moduleRef.close();
    await raw.hrPayslip.deleteMany({ where: { organizationId } });
    await raw.hrPayrollAllowance.deleteMany({ where: { organizationId } });
    await raw.hrPayrollDeduction.deleteMany({ where: { organizationId } });
    await raw.hrPayrollItem.deleteMany({ where: { organizationId } });
    await raw.hrPayrollRun.deleteMany({ where: { organizationId } });
    await raw.hrPayrollPeriod.deleteMany({ where: { organizationId } });
    await raw.hrTaxBracket.deleteMany({ where: { organizationId } });
    await raw.hrTaxTable.deleteMany({ where: { organizationId } });
    await raw.hrPayrollComponent.deleteMany({ where: { organizationId } });
    await raw.hrStatutoryConfig.deleteMany({ where: { organizationId } });
    await raw.hrSalaryChange.deleteMany({ where: { organizationId } });
    await raw.hrEmploymentAction.deleteMany({ where: { organizationId } });
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

  let runId = '';

  it('calculates PAYE and NSSF correctly in every band', async () => {
    const period = await asAdmin(() =>
      payroll.createPeriod({
        periodType: 'MONTHLY',
        startDate: new Date(Date.UTC(2026, 5, 1)).toISOString(),
        endDate: new Date(Date.UTC(2026, 5, 30)).toISOString(),
      }),
    );
    const run = await asAdmin(() => payroll.createRun({ periodId: period.id }));
    await asAdmin(() => payroll.calculateRun(run.id));
    runId = run.id;

    const items = await raw.hrPayrollItem.findMany({
      where: { runId },
      include: { employee: { select: { employeeCode: true } } },
    });
    expect(items).toHaveLength(SALARIES.length);

    for (const s of SALARIES) {
      const item = items.find((i) => i.employee.employeeCode === s.code)!;
      expect(item).toBeTruthy();

      const nssf = s.gross * NSSF_EMPLOYEE_RATE;
      const chargeable = s.gross - nssf;
      const paye = expectedMonthlyPaye(chargeable);

      // Rounded to the shilling: UGX has no minor unit, and Decimal(20,6)
      // carries the exact value, so a 1-unit tolerance is generous.
      expect(Number(item.grossPay)).toBeCloseTo(s.gross, 0);
      expect(Number(item.socialSecurityAmount)).toBeCloseTo(nssf, 0);
      expect(Number(item.taxAmount)).toBeCloseTo(paye, 0);
      expect(Number(item.netPay)).toBeCloseTo(s.gross - nssf - paye, 0);
    }
  });

  it('charges no PAYE below the 235,000 threshold', async () => {
    const items = await raw.hrPayrollItem.findMany({
      where: { runId },
      include: { employee: { select: { employeeCode: true } } },
    });
    const nilBand = items.find((i) => i.employee.employeeCode === 'UG-A')!;
    // 200,000 gross − 10,000 NSSF = 190,000 chargeable, under the threshold.
    expect(Number(nilBand.taxAmount)).toBe(0);
    expect(Number(nilBand.socialSecurityAmount)).toBeCloseTo(10_000, 0);
  });

  it('applies the 40% top marginal rate above 10,000,000', async () => {
    const items = await raw.hrPayrollItem.findMany({
      where: { runId },
      include: { employee: { select: { employeeCode: true } } },
    });
    const top = items.find((i) => i.employee.employeeCode === 'UG-E')!;
    const chargeable = 12_000_000 - 12_000_000 * NSSF_EMPLOYEE_RATE; // 11,400,000
    expect(Number(top.taxAmount)).toBeCloseTo(expectedMonthlyPaye(chargeable), 0);
    // Sanity: the top slice really is taxed at 40%, not 30%.
    const at30Only = 25_000 + (chargeable - 410_000) * 0.3;
    expect(Number(top.taxAmount)).toBeGreaterThan(at30Only);
  });

  it('posts a balanced journal with NSSF and PAYE on their own payables', async () => {
    await asAdmin(() => payroll.approveRun(runId));
    const run = await raw.hrPayrollRun.findUniqueOrThrow({ where: { id: runId } });
    const je = await raw.journalEntry.findUniqueOrThrow({
      where: { id: run.journalEntryId! },
      include: { lines: true },
    });
    const dr = je.lines.reduce((s, l) => s + Number(l.baseDebit), 0);
    const cr = je.lines.reduce((s, l) => s + Number(l.baseCredit), 0);
    expect(dr).toBe(cr);

    // Gross expense equals the sum of every employee's gross.
    const totalGross = SALARIES.reduce((s, x) => s + x.gross, 0);
    expect(dr).toBeCloseTo(totalGross, 0);

    // PAYE and NSSF are separate liabilities, not netted into pay.
    const payeAcct = await raw.accountMapping.findFirstOrThrow({ where: { organizationId, key: 'paye_payable' } });
    const nssfAcct = await raw.accountMapping.findFirstOrThrow({ where: { organizationId, key: 'social_security_payable' } });
    const payeLine = je.lines.find((l) => l.accountId === payeAcct.accountId);
    const nssfLine = je.lines.find((l) => l.accountId === nssfAcct.accountId);
    expect(Number(payeLine?.baseCredit ?? 0)).toBeGreaterThan(0);
    expect(Number(nssfLine?.baseCredit ?? 0)).toBeCloseTo(totalGross * NSSF_EMPLOYEE_RATE, 0);
  });
});
