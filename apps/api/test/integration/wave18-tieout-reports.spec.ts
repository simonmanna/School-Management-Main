/**
 * Wave 18 — reporting truthfulness, real database.
 *
 * - A tie-out that cannot run (missing mapping, historical date) is stored as
 *   `not_run` and never as balanced; it runs outside any ambient tenant.
 * - A manual journal on the AR control account shows as a variance; its
 *   reversal clears it.
 * - Report date ranges are calendar days in the school's time zone: a 23:30
 *   Kampala posting on 31 January is in January, a 00:30 posting on 1 February
 *   is not.
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
import { TieOutService } from '../../src/modules/accounting/reporting/tieout.service';
import { AccountingReportingService } from '../../src/modules/accounting/reporting/accounting-reporting.service';
import { CashFlowReportService } from '../../src/modules/accounting/reporting/cash-flow-report.service';

describeDb('integration: wave 18 tie-out and report ranges', () => {
  const prisma = new PrismaClient();
  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let posting: PostingService;
  let tieOut: TieOutService;
  let reporting: AccountingReportingService;
  let cashFlow: CashFlowReportService;

  const stamp = Date.now();
  let organizationId = '';
  let arId = '';
  let revenueId = '';
  let cashId = '';

  const as = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId: undefined as any, permissions: ['*'] }, fn);

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Uganda Shilling', decimalPlaces: 0 },
    });
    organizationId = (
      await prisma.organization.create({
        data: { code: `W18T-${stamp}`, name: 'Wave 18 Tie-out', currencyCode: 'UGX', timezone: 'Africa/Kampala' },
      })
    ).id;
    await prisma.journal.create({ data: { organizationId, code: 'GEN', name: 'General', journalType: 'general' } });
    const make = makeAccountFactory(prisma, await ensureAccountCategories(prisma));
    arId = (await make(organizationId, '1300', 'Receivable', 'receivable')).id;
    revenueId = (await make(organizationId, '4100', 'Tuition', 'revenue')).id;
    cashId = (await make(organizationId, '1100', 'Cash', 'cash')).id;

    moduleRef = await Test.createTestingModule({ imports: [KernelModule, CoreModule, AccountingModule] }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    posting = moduleRef.get(PostingService);
    tieOut = moduleRef.get(TieOutService);
    reporting = moduleRef.get(AccountingReportingService);
    cashFlow = moduleRef.get(CashFlowReportService);
  }, 60_000);

  afterAll(async () => {
    await moduleRef?.close();
    await prisma.$disconnect();
  });

  it('missing control mappings → not_run, never balanced (and runs with no ambient tenant)', async () => {
    // Called outside tenant.run on purpose, as the nightly job does.
    const r = await tieOut.run(organizationId);
    expect(r.status).toBe('not_run');
    expect(r.arBalanced).toBe(false);
    expect(r.apBalanced).toBe(false);
    expect(r.reason).toMatch(/accounts_receivable and accounts_payable/);
    const snap = await prisma.reportTieoutSnapshot.findFirst({ where: { organizationId }, orderBy: { builtAt: 'desc' } });
    expect(snap!.status).toBe('not_run');
    expect(snap!.arBalanced).toBe(false);
  });

  it('a manual AR journal shows as a variance; its reversal clears it', async () => {
    const ap = await makeAccountFactory(prisma, await ensureAccountCategories(prisma))(organizationId, '2100', 'Payable', 'payable');
    await prisma.accountMapping.create({ data: { organizationId, key: 'accounts_receivable', accountId: arId } });
    await prisma.accountMapping.create({ data: { organizationId, key: 'accounts_payable', accountId: ap.id } });

    const je = await as(() =>
      posting.post({
        journalCode: 'GEN',
        date: new Date(Date.now() - 60_000),
        lines: [
          { accountId: arId, debit: 25_000 },
          { accountId: revenueId, credit: 25_000 },
        ],
      }),
    );
    const drift = await tieOut.run(organizationId);
    expect(drift.status).toBe('ran');
    expect(drift.arBalanced).toBe(false);
    expect(drift.arVariance).toBe('25000');

    await as(() => posting.reverse(je.id));
    const clean = await tieOut.run(organizationId);
    expect(clean.arBalanced).toBe(true);
    expect(clean.apBalanced).toBe(true);
  });

  it('a historical as-of date is not_run rather than a false variance', async () => {
    const r = await tieOut.run(organizationId, new Date('2026-01-01T00:00:00Z'));
    expect(r.status).toBe('not_run');
    expect(r.reason).toMatch(/as of today/);
  });

  it('report ranges are Kampala calendar days', async () => {
    const post = (date: string, amount: number) =>
      as(() =>
        posting.post({
          journalCode: 'GEN',
          date,
          lines: [
            { accountId: cashId, debit: amount },
            { accountId: revenueId, credit: amount },
          ],
        }),
      );
    await post('2026-01-31T20:30:00.000Z', 1_000); // 23:30 on 31 Jan in Kampala
    await post('2026-01-31T21:30:00.000Z', 7_000); // 00:30 on 1 Feb in Kampala

    const jan: any = await as(() => reporting.trialBalance({ from: '2026-01-01', to: '2026-01-31' }));
    const cashRow = (jan.rows ?? jan.accounts ?? jan).find?.((r: any) => r.accountId === cashId);
    expect(cashRow).toBeTruthy();
    expect(Number(cashRow.debit ?? cashRow.totalDebit ?? cashRow.balance)).toBe(1_000);

    const feb: any = await as(() => cashFlow.cashFlow({ from: '2026-02-01', to: '2026-02-28' }));
    expect(Number(feb.netCashFlow)).toBe(7_000);
  });
});
