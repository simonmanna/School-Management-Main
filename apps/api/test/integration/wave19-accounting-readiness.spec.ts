/**
 * Wave 19 — accounting production readiness, against a real database.
 *
 * - A closed period still reports its profit: P&L, income statement, revenue
 *   analysis and the equity statement read activity before the closing journal.
 * - The equity statement carries earlier unclosed earnings in opening equity.
 * - Periods close in date order; a holiday period with no activity closes;
 *   draft journals dated in a period block its close.
 * - Manual journals: no sub-ledger control accounts, exact balance, rules
 *   re-checked when the checker approves.
 * - A document's journal is not reversible from the journal-entry screen.
 * - Currency: the Currency row id resolves to its code; a missing rate refuses.
 * - FX revaluation ignores base-currency lines and does not double-book on re-run.
 * - Opening balances: difference to Opening Balance Equity, maker-checker.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { ensureAccountCategories, makeAccountFactory } from './_accounts';
import { KernelModule } from '../../src/kernel/kernel.module';
import { CoreModule } from '../../src/modules/core/core.module';
import { AccountingModule } from '../../src/modules/accounting/accounting.module';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';
import { PostingService } from '../../src/modules/accounting/posting/posting.service';
import { PeriodCloseService } from '../../src/modules/accounting/posting/period-close.service';
import { FiscalPeriodLifecycleService } from '../../src/modules/accounting/posting/fiscal-period-lifecycle.service';
import { FinancialReportsService } from '../../src/modules/accounting/reporting/financial-reports.service';
import { PnLReportService } from '../../src/modules/accounting/reporting/pnl-report.service';
import { JournalEntryService } from '../../src/modules/accounting/journal-entry/journal-entry.service';
import { RevaluationService } from '../../src/modules/accounting/currency/revaluation.service';
import { OpeningBalanceService } from '../../src/modules/accounting/opening-balance/opening-balance.service';

describe('integration: wave 19 accounting readiness', () => {
  const prisma = new PrismaClient();
  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let posting: PostingService;
  let closer: PeriodCloseService;
  let periods: FiscalPeriodLifecycleService;
  let reports: FinancialReportsService;
  let pnl: PnLReportService;
  let entries: JournalEntryService;
  let reval: RevaluationService;
  let opening: OpeningBalanceService;

  const stamp = Date.now();
  const fx = `X${String(stamp).slice(-2)}`;
  let organizationId = '';
  let maker = '';
  let checker = '';
  const acct: Record<string, string> = {};
  const periodId: Record<string, string> = {};
  let ugxId = '';
  let fxId = '';

  const as = <T>(userId: string, fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId, permissions: ['*'] }, fn);

  const post = (date: string, debitId: string, creditId: string, amount: number, extra: Record<string, unknown> = {}) =>
    as(maker, () =>
      posting.post({
        journalCode: 'GEN',
        date,
        description: 'test',
        ...extra,
        lines: [
          { accountId: debitId, debit: amount },
          { accountId: creditId, credit: amount },
        ],
      }),
    );

  const draft = (userId: string, date: string, lines: any[]) =>
    as(userId, () => entries.createManual({ journalCode: 'GEN', date, description: 'manual', lines } as any));

  beforeAll(async () => {
    await prisma.$connect();
    ugxId = (
      await prisma.currency.upsert({
        where: { code: 'UGX' },
        update: {},
        create: { code: 'UGX', symbol: 'USh', name: 'Uganda Shilling', decimalPlaces: 0 },
      })
    ).id;
    fxId = (await prisma.currency.create({ data: { code: fx, symbol: fx, name: `Test ${fx}`, decimalPlaces: 2 } })).id;
    await prisma.currencyRate.create({
      data: { fromCode: fx, toCode: 'UGX', asOf: new Date('2026-06-01T00:00:00Z'), rate: 3700 },
    });

    const org = await prisma.organization.create({
      data: { code: `W19-${stamp}`, name: 'Wave 19 Accounting', currencyCode: 'UGX', timezone: 'Africa/Kampala' },
    });
    organizationId = org.id;
    maker = (await prisma.user.create({ data: { organizationId, email: `m-${stamp}@w19.test`, passwordHash: 'x', firstName: 'M' } })).id;
    checker = (await prisma.user.create({ data: { organizationId, email: `c-${stamp}@w19.test`, passwordHash: 'x', firstName: 'C' } })).id;
    await prisma.journal.create({ data: { organizationId, code: 'GEN', name: 'General', journalType: 'general' } });

    const make = makeAccountFactory(prisma, await ensureAccountCategories(prisma));
    acct.cash = (await make(organizationId, '1100', 'Cash', 'cash')).id;
    acct.bank = (await make(organizationId, '1200', 'Bank UGX', 'bank')).id;
    acct.bankFx = (await make(organizationId, '1250', 'Bank FX', 'bank')).id;
    acct.ar = (await make(organizationId, '1300', 'Fees Receivable', 'receivable', { controlAccountType: 'ar' })).id;
    acct.arMapped = (await make(organizationId, '1310', 'Other Receivable', 'receivable')).id;
    acct.revenue = (await make(organizationId, '4100', 'Tuition', 'revenue')).id;
    acct.expense = (await make(organizationId, '6100', 'Stationery', 'operating_expense')).id;
    acct.re = (await make(organizationId, '3100', 'Retained Earnings', 'equity')).id;
    acct.fxGain = (await make(organizationId, '7100', 'FX Gain', 'other_income')).id;
    acct.fxLoss = (await make(organizationId, '8100', 'FX Loss', 'other_expense')).id;
    for (const [key, accountId] of [
      ['retained_earnings', acct.re],
      ['accounts_receivable', acct.arMapped],
      ['fx_gain', acct.fxGain],
      ['fx_loss', acct.fxLoss],
    ]) {
      await prisma.accountMapping.create({ data: { organizationId, key, accountId } });
    }

    moduleRef = await Test.createTestingModule({ imports: [KernelModule, CoreModule, AccountingModule] }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    posting = moduleRef.get(PostingService);
    closer = moduleRef.get(PeriodCloseService);
    periods = moduleRef.get(FiscalPeriodLifecycleService);
    reports = moduleRef.get(FinancialReportsService);
    pnl = moduleRef.get(PnLReportService);
    entries = moduleRef.get(JournalEntryService);
    reval = moduleRef.get(RevaluationService);
    opening = moduleRef.get(OpeningBalanceService);

    for (const [name, start, end] of [
      ['Mar 2026', '2026-03-01', '2026-03-31'],
      ['Apr 2026', '2026-04-01', '2026-04-30'],
      ['May 2026', '2026-05-01', '2026-05-31'],
      ['Jun 2026', '2026-06-01', '2026-06-30'],
    ]) {
      periodId[name] = (await as(maker, () => periods.create({ name, startDate: start, endDate: end }))).id;
    }
  }, 120_000);

  afterAll(async () => {
    await moduleRef?.close();
    await prisma.$disconnect();
  });

  it('a closed period still reports its profit', async () => {
    await post('2026-03-10T09:00:00Z', acct.cash, acct.revenue, 300_000);
    await post('2026-03-12T09:00:00Z', acct.expense, acct.cash, 100_000);
    const closed = await as(maker, () => closer.close(periodId['Mar 2026']));
    expect(closed.netIncome).toBe('200000');

    const range = { from: '2026-03-01', to: '2026-03-31' };
    const is = await as(maker, () => reports.incomeStatement(range));
    expect(is.subtotals.find((s: any) => s.key === 'net_profit')!.amount).toBe('200000');
    const live = await as(maker, () => pnl.pnl(range));
    expect(live.revenue).toBe('300000');
    expect(live.netProfit).toBe('200000');
    const rev = await as(maker, () => reports.revenueAnalysis(range));
    expect(rev.totals.amount).toBe('300000');
    const eq = await as(maker, () => reports.equityStatement(range));
    expect(eq.profitForPeriod).toBe('200000');
    expect(eq.totals.closing).toBe('200000');
  });

  it('opening equity includes earlier earnings that were never closed', async () => {
    await post('2026-04-15T09:00:00Z', acct.cash, acct.revenue, 50_000);
    const eq = await as(maker, () => reports.equityStatement({ from: '2026-05-01', to: '2026-05-31' }));
    // 200 000 closed into retained earnings in March + 50 000 April profit still open.
    expect(eq.totals.opening).toBe('250000');
    expect(eq.totals.closing).toBe('250000');
  });

  it('periods close in date order; drafts block; an empty period closes', async () => {
    await expect(as(maker, () => closer.close(periodId['Jun 2026']))).rejects.toThrow(/Close 'Apr 2026' first/);

    const d = await draft(maker, '2026-04-20', [
      { accountId: acct.expense, debit: 1_000 },
      { accountId: acct.cash, credit: 1_000 },
    ]);
    await expect(as(maker, () => closer.close(periodId['Apr 2026']))).rejects.toThrow(/draft journal entr/);
    await as(maker, () => entries.discard(d.id));
    await as(maker, () => closer.close(periodId['Apr 2026']));

    const may = await as(maker, () => closer.close(periodId['May 2026']));
    expect(may.journalEntryId).toBeNull();
    expect((await prisma.fiscalPeriod.findUnique({ where: { id: periodId['May 2026'] } }))!.status).toBe('closed');
  });

  it('manual journals stay off sub-ledger control accounts and balance exactly', async () => {
    await expect(
      draft(maker, '2026-06-05', [
        { accountId: acct.ar, debit: 5_000 },
        { accountId: acct.revenue, credit: 5_000 },
      ]),
    ).rejects.toThrow(/sub-ledger control account/);
    await expect(
      draft(maker, '2026-06-05', [
        { accountId: acct.arMapped, debit: 5_000 },
        { accountId: acct.revenue, credit: 5_000 },
      ]),
    ).rejects.toThrow(/sub-ledger control account/);
    await expect(
      draft(maker, '2026-06-05', [
        { accountId: acct.expense, debit: 5_000.005 },
        { accountId: acct.cash, credit: 5_000 },
      ]),
    ).rejects.toThrow(/Unbalanced/);

    // Approval re-checks the accounts as they are now.
    const d = await draft(maker, '2026-06-05', [
      { accountId: acct.expense, debit: 2_000 },
      { accountId: acct.cash, credit: 2_000 },
    ]);
    await prisma.account.update({ where: { id: acct.expense }, data: { isActive: false } });
    await expect(as(checker, () => entries.post(d.id))).rejects.toThrow(/inactive/);
    await prisma.account.update({ where: { id: acct.expense }, data: { isActive: true } });
    await expect(as(maker, () => entries.post(d.id))).rejects.toThrow(/maker-checker/);
    const posted = await as(checker, () => entries.post(d.id));
    expect(posted.status).toBe('posted');

    // A manual entry is reversible from the journal screen…
    const rev = await as(checker, () => entries.reverse(d.id, { date: '2026-06-06' }));
    expect(rev.reversalOfId).toBe(d.id);
  });

  it("a document's journal is corrected from the document, not the journal screen", async () => {
    const doc = await post('2026-06-07T09:00:00Z', acct.cash, acct.revenue, 7_000, {
      sourceType: 'fee_payment',
      sourceId: `pay-${stamp}`,
    });
    await expect(as(checker, () => entries.reverse(doc.id, {}))).rejects.toThrow(/cancel, void or reverse that document/);
  });

  it('resolves the Currency row id to its code and refuses a missing rate', async () => {
    const base = await post('2026-06-08T09:00:00Z', acct.bank, acct.revenue, 10_000, { currencyId: ugxId });
    expect(String(base.lines[0].exchangeRate)).toBe('1');

    // No rate on record: refused rather than booked 1:1.
    await prisma.currencyRate.deleteMany({ where: { fromCode: fx } });
    await expect(post('2026-06-10T09:00:00Z', acct.bankFx, acct.revenue, 100, { currencyId: fxId })).rejects.toThrow(
      new RegExp(`No exchange rate from ${fx} to UGX`),
    );
    await prisma.currencyRate.create({
      data: { fromCode: fx, toCode: 'UGX', asOf: new Date('2026-06-01T00:00:00Z'), rate: 3700 },
    });
    const foreign = await post('2026-06-10T09:00:00Z', acct.bankFx, acct.revenue, 100, { currencyId: fxId });
    expect(foreign.lines.find((l: any) => l.accountId === acct.bankFx).baseDebit.toString()).toBe('370000');
  });

  it('FX revaluation skips base-currency lines and does not double-book on re-run', async () => {
    await prisma.currencyRate.create({
      data: { fromCode: fx, toCode: 'UGX', asOf: new Date('2026-06-29T00:00:00Z'), rate: 3800 },
    });
    const asOf = new Date('2026-06-30T12:00:00Z');
    const first = await as(maker, () => reval.run(asOf));
    expect(first.totalGain).toBe('10000');
    const second = await as(maker, () => reval.run(asOf));
    expect(second.totalGain).toBe('0');
    const fxEntries = await prisma.journalEntry.count({ where: { organizationId, sourceType: 'fx_revaluation' } });
    expect(fxEntries).toBe(1);
  });

  it('opening balances: difference to Opening Balance Equity, maker-checker, no control accounts', async () => {
    await expect(
      as(maker, () =>
        opening.stage({ date: '2026-06-01', lines: [{ accountId: acct.ar, debit: 1_000 }] } as any),
      ),
    ).rejects.toThrow(/sub-ledger control account/);

    const d = await as(maker, () =>
      opening.stage({
        date: '2026-06-01',
        lines: [
          { accountId: acct.cash, debit: 500_000 },
          { accountId: acct.bank, debit: 200_000 },
        ],
      } as any),
    );
    expect(d.status).toBe('draft');
    expect(d.lines).toHaveLength(3);
    await expect(as(maker, () => entries.post(d.id))).rejects.toThrow(/maker-checker/);
    await as(checker, () => entries.post(d.id));

    const summary = await as(maker, () => opening.summary());
    expect(summary.entries).toHaveLength(1);
    expect(summary.entries[0].status).toBe('posted');
    expect(summary.openingBalanceEquity!.balance).toBe('700000');
    const list = await as(maker, () => entries.list({ origin: 'manual', status: 'posted' } as any));
    expect(list.data.some((e: any) => e.id === d.id)).toBe(true);
  });
});
