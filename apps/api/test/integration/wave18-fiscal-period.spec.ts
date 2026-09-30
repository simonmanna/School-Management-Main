/**
 * Wave 18 — finance review P1 on fiscal close, against a real database.
 *
 * - Periods are created open, with end-of-day bounds in the school's time zone
 *   (a 23:30 Kampala posting on the last day is inside the period).
 * - Overlapping periods are refused by the service and by the database.
 * - Only open periods can be edited.
 * - Reopen needs a reason, reverses the closing entry, is audited, and the
 *   period can be closed again; a locked period needs `unlock`; a later closed
 *   period blocks reopening an earlier one.
 * - Close and posting serialize: nothing lands in a period after it closes.
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
import { PeriodCloseService } from '../../src/modules/accounting/posting/period-close.service';
import { FiscalPeriodLifecycleService } from '../../src/modules/accounting/posting/fiscal-period-lifecycle.service';

describeDb('integration: wave 18 fiscal periods', () => {
  const prisma = new PrismaClient();
  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let posting: PostingService;
  let closer: PeriodCloseService;
  let periods: FiscalPeriodLifecycleService;

  const stamp = Date.now();
  let organizationId = '';
  let userA = '';
  let cashId = '';
  let revenueId = '';
  let expenseId = '';

  const as = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId: userA, permissions: ['*'] }, fn);

  const sale = (date: string | Date, amount: number) =>
    as(() =>
      posting.post({
        journalCode: 'GEN',
        date,
        description: 'Fee income',
        lines: [
          { accountId: cashId, debit: amount },
          { accountId: revenueId, credit: amount },
        ],
      }),
    );

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Uganda Shilling', decimalPlaces: 0 },
    });
    const org = await prisma.organization.create({
      data: { code: `W18P-${stamp}`, name: 'Wave 18 Periods', currencyCode: 'UGX', timezone: 'Africa/Kampala' },
    });
    organizationId = org.id;
    userA = (
      await prisma.user.create({ data: { organizationId, email: `a-${stamp}@w18p.test`, passwordHash: 'x', firstName: 'A' } })
    ).id;
    await prisma.journal.create({ data: { organizationId, code: 'GEN', name: 'General', journalType: 'general' } });
    const make = makeAccountFactory(prisma, await ensureAccountCategories(prisma));
    cashId = (await make(organizationId, '1100', 'Cash', 'cash')).id;
    revenueId = (await make(organizationId, '4100', 'Tuition', 'revenue')).id;
    expenseId = (await make(organizationId, '6100', 'Stationery', 'operating_expense')).id;
    const re = await make(organizationId, '3200', 'Retained Earnings', 'equity');
    await prisma.accountMapping.create({ data: { organizationId, key: 'retained_earnings', accountId: re.id } });

    moduleRef = await Test.createTestingModule({ imports: [KernelModule, CoreModule, AccountingModule] }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    posting = moduleRef.get(PostingService);
    closer = moduleRef.get(PeriodCloseService);
    periods = moduleRef.get(FiscalPeriodLifecycleService);
  }, 60_000);

  afterAll(async () => {
    await moduleRef?.close();
    await prisma.$disconnect();
  });

  it('creates periods open with Kampala end-of-day bounds; a 23:30 last-day posting is inside', async () => {
    const jan = await as(() => periods.create({ name: 'Jan 2026', startDate: '2026-01-01', endDate: '2026-01-31' }));
    expect(jan.status).toBe('open');
    // Kampala is UTC+3: 1 Jan 00:00 local = 31 Dec 21:00Z; 31 Jan 23:59:59.999 local = 31 Jan 20:59:59.999Z.
    expect(jan.startDate.toISOString()).toBe('2025-12-31T21:00:00.000Z');
    expect(jan.endDate.toISOString()).toBe('2026-01-31T20:59:59.999Z');

    await sale('2026-01-31T20:30:00.000Z', 100_000); // 23:30 in Kampala
    await as(() => closer.close(jan.id));
    await expect(sale('2026-01-31T20:30:00.000Z', 1)).rejects.toThrow(/closed/);
  });

  it('refuses an overlapping period (service and database)', async () => {
    await expect(
      as(() => periods.create({ name: 'Jan overlap', startDate: '2026-01-15', endDate: '2026-02-10' })),
    ).rejects.toThrow(/overlap/);
    await expect(
      prisma.fiscalPeriod.create({
        data: {
          organizationId,
          name: `raw-overlap-${stamp}`,
          startDate: new Date('2026-01-10T00:00:00Z'),
          endDate: new Date('2026-01-20T00:00:00Z'),
        },
      }),
    ).rejects.toThrow();
  });

  it('only an open period can be edited', async () => {
    const jan = await prisma.fiscalPeriod.findFirst({ where: { organizationId, name: 'Jan 2026' } });
    await expect(as(() => periods.update(jan!.id, { endDate: '2026-02-05' }))).rejects.toThrow(/only open periods/);
  });

  it('reopen needs a reason, reverses the closing entry, is audited, and can close again', async () => {
    const jan = await prisma.fiscalPeriod.findFirst({ where: { organizationId, name: 'Jan 2026' } });
    await expect(as(() => periods.reopen(jan!.id, '', 'reopen'))).rejects.toThrow(/reason/);

    const closing = await prisma.journalEntry.findFirst({
      where: { organizationId, sourceType: 'period_close', sourceId: jan!.id, status: 'posted' },
    });
    expect(closing).toBeTruthy();
    // The closing entry is not reversible from the outside.
    await expect(as(() => posting.reverse(closing!.id))).rejects.toThrow(/reopening the fiscal period/);

    const r = await as(() => periods.reopen(jan!.id, 'Late stationery invoice for January', 'reopen'));
    expect(r.reversedClosingEntryId).toBe(closing!.id);
    const after = await prisma.fiscalPeriod.findUnique({ where: { id: jan!.id } });
    expect(after!.status).toBe('open');
    expect(after!.closedAt).toBeNull();
    const reversedClosing = await prisma.journalEntry.findUnique({ where: { id: closing!.id } });
    expect(reversedClosing!.status).toBe('reversed');
    const audit = await prisma.auditLog.findFirst({
      where: { entity: 'FiscalPeriod', entityId: jan!.id, action: 'update' },
      orderBy: { createdAt: 'desc' },
    });
    expect((audit!.newValues as any).op).toBe('reopen');
    expect((audit!.newValues as any).reason).toMatch(/Late stationery/);
    expect((audit!.oldValues as any).status).toBe('closed');

    // Book the late expense, then close again: the new close reflects both.
    await as(() =>
      posting.post({
        journalCode: 'GEN',
        date: '2026-01-20T08:00:00Z',
        lines: [
          { accountId: expenseId, debit: 30_000 },
          { accountId: cashId, credit: 30_000 },
        ],
      }),
    );
    const reclosed = await as(() => closer.close(jan!.id));
    expect(reclosed.netIncome).toBe('70000');
  });

  it('a locked period reopens only through unlock', async () => {
    const jan = await prisma.fiscalPeriod.findFirst({ where: { organizationId, name: 'Jan 2026' } });
    await as(() => closer.lock(jan!.id));
    await expect(as(() => closer.lock(jan!.id))).rejects.toThrow(/already locked/);
    await expect(as(() => periods.reopen(jan!.id, 'Auditor adjustment', 'reopen'))).rejects.toThrow(
      /fiscal_period:unlock/,
    );
    const r = await as(() => periods.reopen(jan!.id, 'Auditor adjustment', 'unlock'));
    expect(r.fromStatus).toBe('locked');
    const audit = await prisma.auditLog.findFirst({
      where: { entity: 'FiscalPeriod', entityId: jan!.id, action: 'update' },
      orderBy: { createdAt: 'desc' },
    });
    expect((audit!.newValues as any).op).toBe('unlock');
  });

  it('a later closed period blocks reopening an earlier one', async () => {
    const jan = await prisma.fiscalPeriod.findFirst({ where: { organizationId, name: 'Jan 2026' } });
    await as(() => closer.close(jan!.id));
    const feb = await as(() => periods.create({ name: 'Feb 2026', startDate: '2026-02-01', endDate: '2026-02-28' }));
    await sale('2026-02-10T09:00:00Z', 50_000);
    await as(() => closer.close(feb.id));
    await expect(as(() => periods.reopen(jan!.id, 'Should be blocked', 'reopen'))).rejects.toThrow(
      /Reopen 'Feb 2026' first/,
    );
  });

  it('close and posting serialize — nothing lands in a period after it closes', async () => {
    const mar = await as(() => periods.create({ name: 'Mar 2026', startDate: '2026-03-01', endDate: '2026-03-31' }));
    await sale('2026-03-05T09:00:00Z', 10_000);
    const results = await Promise.allSettled([
      as(() => closer.close(mar.id)),
      sale('2026-03-06T09:00:00Z', 5_000),
      sale('2026-03-07T09:00:00Z', 7_000),
    ]);
    expect(results[0].status).toBe('fulfilled');
    const closedAt = (await prisma.fiscalPeriod.findUnique({ where: { id: mar.id } }))!.closedAt!;
    const late = await prisma.journalEntry.count({
      where: {
        organizationId,
        postingDate: { gte: mar.startDate, lte: mar.endDate },
        postedAt: { gt: closedAt },
        sourceType: { not: 'period_close' },
      },
    });
    expect(late).toBe(0);
    // Every revenue posted in March is inside the closing entry: revenue nets to zero.
    const rev = await prisma.journalLine.aggregate({
      where: {
        accountId: revenueId,
        entry: { status: { in: ['posted', 'reversed'] }, postingDate: { gte: mar.startDate, lte: mar.endDate } },
      },
      _sum: { baseDebit: true, baseCredit: true },
    });
    expect(Number(rev._sum.baseCredit) - Number(rev._sum.baseDebit)).toBe(0);
  });

  it('refuses an open-period delete once it has ever been closed', async () => {
    const jan = await prisma.fiscalPeriod.findFirst({ where: { organizationId, name: 'Jan 2026' } });
    await expect(as(() => periods.remove(jan!.id))).rejects.toThrow(/cannot be deleted/);
  });
});
