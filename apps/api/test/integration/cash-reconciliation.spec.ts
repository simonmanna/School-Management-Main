/**
 * F-CASH-1 / F-CASH-2 regression — cash reconciliation.
 *
 * Guards two bugs found in the production-readiness audit:
 *   - F-CASH-1: the treasury "Cash Accounts" view computed balances with
 *     `status:'posted'` only, so a `reversed` entry's original leg was dropped
 *     and the cash-register balance diverged from the trial balance / GL.
 *   - F-CASH-2: the Cash Flow statement double-counted (summed cash accounts
 *     AND their counter-entries) and never tied to the balance sheet.
 *
 * The fixture deliberately includes a reversed entry (the case that broke
 * F-CASH-1) and a cash-to-cash transfer (a bank deposit — must NOT show as a
 * cash flow). It asserts:
 *   1. treasury cash-account balance === trial-balance balance (per account)
 *   2. cash-flow netCashFlow === change in cash+bank, and `reconciled` is true
 *   3. closingCash === the GL cash+bank balance (ties to the balance sheet)
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';
import { ensureAccountCategories, makeAccountFactory, type TestAccountCategory } from './_accounts';
import { KernelModule } from '../../src/kernel/kernel.module';
import { CoreModule } from '../../src/modules/core/core.module';
import { AccountingModule } from '../../src/modules/accounting/accounting.module';
import { CashFlowService } from '../../src/modules/accounting/treasury/cash-flow.service';
import { CashFlowReportService } from '../../src/modules/accounting/reporting/cash-flow-report.service';
import { AccountingReportingService } from '../../src/modules/accounting/reporting/accounting-reporting.service';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';

describeDb('integration: cash reconciliation (F-CASH-1 / F-CASH-2)', () => {
  const prisma = new PrismaClient();
  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let treasury: CashFlowService;
  let cashFlowReport: CashFlowReportService;
  let reporting: AccountingReportingService;

  let organizationId = '';
  let cashId = '';
  let bankId = '';
  let revenueId = '';
  let expenseId = '';

  const D = (s: string) => new Date(s);

  beforeAll(async () => {
    await prisma.$connect();
    const org = await prisma.organization.create({
      data: { code: `INT-CASH-${Date.now()}`, name: 'Cash Reconciliation Org', currencyCode: 'USD' },
    });
    organizationId = org.id;

    const journal = await prisma.journal.create({
      data: { organizationId, code: 'GEN', name: 'General', journalType: 'general' },
    });

    const make = makeAccountFactory(prisma, await ensureAccountCategories(prisma));
    const mk = (code: string, name: string, category: TestAccountCategory) =>
      make(organizationId, code, name, category);
    // Cash-flow section now comes from the category (cashFlowClass), not a
    // per-account column, so 'cash'/'bank' already classify as operating.
    cashId = (await mk('CASH-1100', 'Cash', 'cash')).id;
    bankId = (await mk('BANK-1200', 'Bank', 'bank')).id;
    revenueId = (await mk('REV-4100', 'Revenue', 'revenue')).id;
    expenseId = (await mk('EXP-5100', 'Expense', 'operating_expense')).id;

    const post = async (
      entryNumber: string,
      status: 'posted' | 'reversed',
      lines: Array<{ accountId: string; debit?: number; credit?: number }>,
    ) => {
      await prisma.journalEntry.create({
        data: {
          organizationId,
          journalId: journal.id,
          entryNumber,
          postingDate: D('2026-03-15'),
          status,
          lines: {
            create: lines.map((l, i) => ({
              organizationId,
              accountId: l.accountId,
              debit: l.debit ?? 0,
              credit: l.credit ?? 0,
              baseDebit: l.debit ?? 0,
              baseCredit: l.credit ?? 0,
              lineNumber: i + 1,
            })),
          },
        },
      });
    };

    // 1) Sale: Dr Cash 1000 / Cr Revenue 1000
    await post('REC-1', 'posted', [{ accountId: cashId, debit: 1000 }, { accountId: revenueId, credit: 1000 }]);
    // 2) Expense paid in cash: Dr Expense 300 / Cr Cash 300
    await post('REC-2', 'posted', [{ accountId: expenseId, debit: 300 }, { accountId: cashId, credit: 300 }]);
    // 3) A voided sale — original entry now `reversed` (its legs are STILL real,
    //    cancelled by REC-4). This is the case that broke F-CASH-1.
    await post('REC-3', 'reversed', [{ accountId: cashId, debit: 500 }, { accountId: revenueId, credit: 500 }]);
    // 4) The mirror reversal (posted).
    await post('REC-4', 'posted', [{ accountId: revenueId, debit: 500 }, { accountId: cashId, credit: 500 }]);
    // 5) Bank deposit — cash-to-cash, must NOT appear as a cash flow.
    await post('REC-5', 'posted', [{ accountId: bankId, debit: 200 }, { accountId: cashId, credit: 200 }]);

    moduleRef = await Test.createTestingModule({ imports: [KernelModule, CoreModule, AccountingModule] }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    treasury = moduleRef.get(CashFlowService);
    cashFlowReport = moduleRef.get(CashFlowReportService);
    reporting = moduleRef.get(AccountingReportingService);
  }, 30_000);

  afterAll(async () => {
    if (organizationId) {
      await prisma.journalLine.deleteMany({ where: { organizationId } });
      await prisma.journalEntry.deleteMany({ where: { organizationId } });
      await prisma.account.deleteMany({ where: { organizationId } });
      await prisma.journal.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } });
    }
    await moduleRef?.close();
    await prisma.$disconnect();
  });

  it('F-CASH-1: treasury cash-account balances equal the trial balance (incl. reversed entry)', async () => {
    await tenant.run({ organizationId, userId: 'test' }, async () => {
      const cashAccounts = await treasury.getCashAccounts();
      const tb: any = await reporting.trialBalance({});
      const tbRows: any[] = tb.rows ?? tb.lines ?? tb.accounts ?? tb;

      const byCode = (rows: any[], code: string) =>
        rows.find((r) => (r.code ?? r.accountCode ?? r.account?.code) === code);

      const tbBal = (code: string) => {
        const r = byCode(tbRows, code);
        return Number(r?.balance ?? Number(r?.debit ?? 0) - Number(r?.credit ?? 0));
      };
      const trBal = (code: string) => Number(cashAccounts.find((a) => a.code === code)?.balance ?? 0);

      // Cash: 1000 - 300 + 500(reversed orig) - 500(reversal) - 200(deposit) = 500
      expect(trBal('CASH-1100')).toBe(500);
      expect(trBal('BANK-1200')).toBe(200);
      // The whole point: treasury must match the GL/trial balance exactly.
      expect(trBal('CASH-1100')).toBe(tbBal('CASH-1100'));
      expect(trBal('BANK-1200')).toBe(tbBal('BANK-1200'));
    });
  });

  it('F-CASH-2: cash-flow statement reconciles to cash and ties to the balance sheet', async () => {
    await tenant.run({ organizationId, userId: 'test' }, async () => {
      const cf: any = await cashFlowReport.cashFlow({ from: '2026-01-01', to: '2026-12-31' });

      // Operating = +1000 (sale) -300 (expense) +500 (reversed orig) -500 (reversal) = 700.
      // Bank deposit (cash-to-cash) contributes 0. Investing/financing = 0.
      expect(Number(cf.operating)).toBe(700);
      expect(Number(cf.investing)).toBe(0);
      expect(Number(cf.financing)).toBe(0);
      expect(Number(cf.netCashFlow)).toBe(700);
      expect(Number(cf.openingCash)).toBe(0);
      expect(Number(cf.closingCash)).toBe(700);

      // Ties out independently: closing == actual cash+bank GL balance (== balance sheet cash).
      expect(Number(cf.actualClosingCash)).toBe(700);
      expect(cf.reconciled).toBe(true);
      expect(Number(cf.closingCash)).toBe(Number(cf.actualClosingCash));
    });
  });

  it('F-CASH-2: opening cash carries forward when the period starts after the postings', async () => {
    await tenant.run({ organizationId, userId: 'test' }, async () => {
      const cf: any = await cashFlowReport.cashFlow({ from: '2026-06-01', to: '2026-12-31' });
      // All activity was in March, so this window sees no movement but a 700 opening.
      expect(Number(cf.openingCash)).toBe(700);
      expect(Number(cf.netCashFlow)).toBe(0);
      expect(Number(cf.closingCash)).toBe(700);
      expect(cf.reconciled).toBe(true);
    });
  });
});
