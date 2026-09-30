/**
 * Wave 18 — bank reconciliation against the general ledger, real database.
 *
 * The old matcher compared Payment.accountId (a ledger account) with
 * BankAccount.id and could only see Payment rows, so fee receipts rarely
 * matched and expense payments / mobile-money payouts never could. Now every
 * ledger line on the bank's GL account is a candidate, signed the bank's way.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';
import { ensureAccountCategories, makeAccountFactory } from './_accounts';
import { KernelModule } from '../../src/kernel/kernel.module';
import { CoreModule } from '../../src/modules/core/core.module';
import { AccountingModule } from '../../src/modules/accounting/accounting.module';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';
import { PostingService } from '../../src/modules/accounting/posting/posting.service';
import { BankReconciliationService } from '../../src/modules/accounting/treasury/bank-reconciliation.service';

describeDb('integration: wave 18 bank reconciliation (GL-based)', () => {
  const prisma = new PrismaClient();
  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let posting: PostingService;
  let recon: BankReconciliationService;

  const stamp = Date.now();
  let organizationId = '';
  let otherOrgId = '';
  let bankLedgerId = '';
  let bankAccountId = '';
  let arId = '';
  let expenseId = '';
  let clearingId = '';
  let userId = '';

  const as = <T>(fn: () => Promise<T>, org = organizationId): Promise<T> =>
    tenant.run({ organizationId: org, userId, permissions: ['*'] }, fn);

  const je = (date: string, lines: Array<{ accountId: string; debit?: number; credit?: number }>, description: string) =>
    as(() => posting.post({ journalCode: 'BANK', date, description, lines }));

  // Statement as the bank printed it: money in positive, money out negative.
  const statement = [
    { postedAt: '2026-03-02', externalRef: 'FT-001', description: 'Fees Okello family', amount: '500000' },
    { postedAt: '2026-03-04', externalRef: 'CHQ-17', description: 'Stationers Ltd', amount: '-120000' },
    { postedAt: '2026-03-06', externalRef: 'MTN-PAYOUT-9', description: 'MTN MoMo settlement', amount: '297000' },
    { postedAt: '2026-03-07', externalRef: 'FT-002', description: 'Refund Namuli', amount: '-50000' },
    { postedAt: '2026-03-08', description: 'Ledger fee', amount: '-5000' },
    // Two identical deposits on the same day with no bank reference.
    { postedAt: '2026-03-09', description: 'Cash deposit', amount: '80000' },
    { postedAt: '2026-03-09', description: 'Cash deposit', amount: '80000' },
  ];

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Uganda Shilling', decimalPlaces: 0 },
    });
    for (const suffix of ['A', 'B']) {
      const org = await prisma.organization.create({
        data: { code: `W18B-${suffix}-${stamp}`, name: `Wave 18 Bank ${suffix}`, currencyCode: 'UGX' },
      });
      if (suffix === 'A') organizationId = org.id;
      else otherOrgId = org.id;
    }
    userId = (
      await prisma.user.create({ data: { organizationId, email: `b-${stamp}@w18b.test`, passwordHash: 'x', firstName: 'B' } })
    ).id;
    await prisma.journal.create({ data: { organizationId, code: 'BANK', name: 'Bank', journalType: 'bank' } });
    const make = makeAccountFactory(prisma, await ensureAccountCategories(prisma));
    bankLedgerId = (await make(organizationId, '1200', 'Stanbic Current', 'bank')).id;
    arId = (await make(organizationId, '1300', 'Fees Receivable', 'receivable')).id;
    expenseId = (await make(organizationId, '6100', 'Stationery', 'operating_expense')).id;
    clearingId = (await make(organizationId, '1150', 'MoMo Clearing', 'bank')).id;
    const cashId = (await make(organizationId, '1100', 'Cash', 'cash')).id;
    const chargesId = (await make(organizationId, '6800', 'MoMo Charges', 'operating_expense')).id;
    bankAccountId = (
      await prisma.bankAccount.create({ data: { organizationId, accountId: bankLedgerId, name: 'Stanbic', bankName: 'Stanbic' } })
    ).id;

    moduleRef = await Test.createTestingModule({ imports: [KernelModule, CoreModule, AccountingModule] }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    posting = moduleRef.get(PostingService);
    recon = moduleRef.get(BankReconciliationService);

    // The books: a fee receipt, an expense cheque, a MoMo payout net of charges,
    // a fee refund, two cash deposits, a reversed pair, and a deposit in transit.
    await je('2026-03-01T09:00:00Z', [{ accountId: bankLedgerId, debit: 500_000 }, { accountId: arId, credit: 500_000 }], 'Receipt Okello');
    await je('2026-03-03T09:00:00Z', [{ accountId: expenseId, debit: 120_000 }, { accountId: bankLedgerId, credit: 120_000 }], 'Expense EXP-00012');
    await je(
      '2026-03-06T09:00:00Z',
      [
        { accountId: bankLedgerId, debit: 297_000 },
        { accountId: chargesId, debit: 3_000 },
        { accountId: clearingId, credit: 300_000 },
      ],
      'MTN settlement',
    );
    await je('2026-03-07T09:00:00Z', [{ accountId: arId, debit: 50_000 }, { accountId: bankLedgerId, credit: 50_000 }], 'Refund Namuli');
    await je('2026-03-09T08:00:00Z', [{ accountId: bankLedgerId, debit: 80_000 }, { accountId: cashId, credit: 80_000 }], 'Banking day 1');
    await je('2026-03-09T08:00:00Z', [{ accountId: bankLedgerId, debit: 80_000 }, { accountId: cashId, credit: 80_000 }], 'Banking day 2');
    const wrong = await je('2026-03-05T09:00:00Z', [{ accountId: bankLedgerId, debit: 500_000 }, { accountId: arId, credit: 500_000 }], 'Keyed twice');
    await as(() => posting.reverse(wrong.id, { date: '2026-03-05T10:00:00Z' }));
    await je('2026-03-31T15:00:00Z', [{ accountId: bankLedgerId, debit: 40_000 }, { accountId: cashId, credit: 40_000 }], 'Deposit in transit');
  }, 60_000);

  afterAll(async () => {
    await moduleRef?.close();
    await prisma.$disconnect();
  });

  it('imports once: a re-import skips every line, identical unreferenced rows both land', async () => {
    const first = await as(() => recon.importStatement(bankAccountId, statement));
    expect(first).toEqual({ imported: 7, skipped: 0 });
    const again = await as(() => recon.importStatement(bankAccountId, statement));
    expect(again).toEqual({ imported: 0, skipped: 7 });
  });

  it('auto-matches receipts, expense payments, MoMo payouts and refunds by signed ledger amount', async () => {
    const run = await as(() => recon.match(bankAccountId, { dateToleranceDays: 3 }));
    // FT-001, CHQ-17, MTN payout, refund → matched; ledger fee → no candidate;
    // the two identical deposits each have two equally good candidates → a person decides.
    expect(run.matched).toBe(4);
    expect(run.ambiguous).toBe(2);
    const lines = await as(() => recon.statementLines(bankAccountId));
    const byRef = new Map(lines.map((l: any) => [l.externalRef ?? `${l.description}-${l.id}`, l]));
    expect((byRef.get('FT-001') as any).match.entryNumber).toBeTruthy();
    expect((byRef.get('CHQ-17') as any).status).toBe('matched');
    expect((byRef.get('MTN-PAYOUT-9') as any).status).toBe('matched');
    expect((byRef.get('FT-002') as any).status).toBe('matched');
  });

  it('a second run does not re-match anything already reconciled', async () => {
    const run = await as(() => recon.match(bankAccountId, { dateToleranceDays: 7 }));
    expect(run.matched).toBe(0);
    const live = await prisma.bankReconciliationMatch.count({ where: { organizationId, unmatchedAt: null } });
    expect(live).toBe(4);
  });

  it('manual match, unmatch and exclude are conditional and audited', async () => {
    const open = await as(() => recon.statementLines(bankAccountId, 'unmatched'));
    const deposits = open.filter((l: any) => l.description === 'Cash deposit');
    const ledger = (await as(() => recon.openLedgerLines(bankAccountId))).filter(
      (l: any) => l.amount === '80000' && !l.reversal,
    );
    expect(deposits).toHaveLength(2);
    expect(ledger).toHaveLength(2);

    await as(() => recon.matchLine(deposits[0].id, ledger[0].id));
    await expect(as(() => recon.matchLine(deposits[1].id, ledger[0].id))).rejects.toThrow(/already reconciled/);
    await as(() => recon.matchLine(deposits[1].id, ledger[1].id));

    // A wrong amount is refused.
    const fee = open.find((l: any) => l.description === 'Ledger fee')!;
    await expect(as(() => recon.matchLine(fee.id, ledger[0].id))).rejects.toThrow(/Amounts differ/);

    // Unmatch keeps history; re-match works.
    await as(() => recon.unmatch(deposits[1].id, 'checking the slip'));
    const history = await prisma.bankReconciliationMatch.findMany({ where: { statementLineId: deposits[1].id } });
    expect(history).toHaveLength(1);
    expect(history[0].unmatchedAt).not.toBeNull();
    await as(() => recon.matchLine(deposits[1].id, ledger[1].id));

    await as(() => recon.exclude(fee.id, 'Bank charge — journal raised next month'));
    await expect(as(() => recon.exclude(fee.id, 'again'))).rejects.toThrow(/excluded/);

    const audits = await prisma.auditLog.count({ where: { organizationId, entity: 'BankStatementLine' } });
    expect(audits).toBeGreaterThanOrEqual(5);
  });

  it('the reconciliation statement ties: difference 0 with reconciling items shown', async () => {
    const closing = statement.reduce((t, l) => t + Number(l.amount), 0); // 782,000
    const r = await as(() => recon.report(bankAccountId, '2026-03-31', String(closing)));
    expect(r.statementClosingBalance).toBe('782000');
    // Ledger: 500 −120 +297 −50 +80 +80 +40 (+500 −500 reversed pair) = 827,000
    expect(r.ledgerBalance).toBe('827000');
    // In the books, not the bank: the deposit in transit (the reversed pair nets to 0).
    expect(r.ledgerItemsNotOnStatement).toBe('40000');
    // In the bank, not the books: the excluded ledger fee.
    expect(r.statementItemsNotInLedger).toBe('-5000');
    expect(r.difference).toBe('0');
    expect(r.reconciled).toBe(true);
  });

  it('another tenant cannot see or touch this bank account', async () => {
    await expect(as(() => recon.status(bankAccountId), otherOrgId)).rejects.toThrow(/Bank account not found/);
    const anyLine = await prisma.bankStatementLine.findFirst({ where: { organizationId } });
    await expect(as(() => recon.unmatch(anyLine!.id), otherOrgId)).rejects.toThrow(/not found/);
  });
});
