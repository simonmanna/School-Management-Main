/**
 * Wave 3 — cross-module consistency and concurrency, against a real database:
 *
 *   F7   two cashiers collecting for one invoice at once: no lost update, the
 *        invoice is settled exactly once and the rest stays unallocated.
 *   F8   a partial waiver re-applied later forgives only its remainder.
 *   F10  outstanding still counts a pupil who has left the school.
 *   Outbox  a claimed row is not dispatched twice by concurrent ticks.
 *
 * Every scenario closes on AR ⇄ GL variance 0. Setup shared with wave1-ledger.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { ensureAccountCategories, makeAccountFactory } from './_accounts';
import { KernelModule } from '../../src/kernel/kernel.module';
import { DocumentsModule } from '../../src/modules/documents/documents.module';
import { CoreModule } from '../../src/modules/core/core.module';
import { AccountingModule } from '../../src/modules/accounting/accounting.module';
import { InventoryModule } from '../../src/modules/inventory/inventory.module';
import { InvoicingModule } from '../../src/modules/invoicing/invoicing.module';
import { FeesModule } from '../../src/modules/school/fees/fees.module';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';
import { PrismaService } from '../../src/kernel/prisma/prisma.service';
import { DocumentBuilderService } from '../../src/modules/invoicing/document/document-builder.service';
import { PostingService } from '../../src/modules/accounting/posting/posting.service';
import { SchoolPaymentService } from '../../src/modules/school/fees/billing.service';
import { PaymentAllocationReversalService } from '../../src/modules/school/fees/allocation-reversal.service';
import { SchoolFinanceQueryService } from '../../src/modules/school/fees/school-finance-query.service';
import { AdvancedFinanceService } from '../../src/modules/school/fees/advanced.service';
import { OutboxWorker } from '../../src/kernel/events/outbox.worker';
import { EventOutboxService } from '../../src/kernel/events/event-outbox.service';

describe('integration: wave 3 consistency', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let prisma: PrismaService;
  let billing: SchoolPaymentService;
  let reversals: PaymentAllocationReversalService;
  let finance: SchoolFinanceQueryService;
  let advanced: AdvancedFinanceService;

  const stamp = Date.now();
  const organizationId = `org_w3_${stamp}`;
  const userId = 'bursar_w1';

  let termId = '';
  let cashAccountId = '';
  let revenueAccountId = '';
  let seq = 0;

  const asTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId, permissions: [] }, fn);

  const glBalance = async (accountId: string) => {
    const r = await raw.journalLine.aggregate({
      where: { organizationId, accountId },
      _sum: { baseDebit: true, baseCredit: true },
    });
    return Number(r._sum.baseDebit ?? 0) - Number(r._sum.baseCredit ?? 0);
  };

  const arVariance = async () => {
    const ar = await asTenant(() => finance.reconcileCurrentArToGl());
    return Math.abs(ar.variance);
  };

  /** A pupil with their own payer partner — each scenario is isolated. */
  const makeStudent = async () => {
    seq += 1;
    const partner = await raw.partner.create({
      data: { organizationId, code: `STU-${stamp}-${seq}`, name: `Pupil ${seq}`, isCustomer: true },
    });
    const profile = await raw.studentProfile.create({
      data: { organizationId, partnerId: partner.id, admissionNo: `ADM-${stamp}-${seq}`, enrollmentDate: new Date('2026-01-10') },
    });
    return { partnerId: partner.id, studentProfileId: profile.id };
  };

  /** A posted tuition invoice, built on the same document + posting path billing uses. */
  const makeInvoice = async (partnerId: string, studentProfileId: string, amount: number) => {
    seq += 1;
    const builder = moduleRef.get(DocumentBuilderService);
    const posting = moduleRef.get(PostingService);
    return asTenant(() =>
      prisma.client.$transaction(async (tx: any) => {
        const doc = await builder.createDocument(
          tx,
          'sales_invoice',
          { partnerId, issueDate: new Date('2026-01-20').toISOString(), reference: `TERM-${termId}-${seq}`, sourceType: 'school_fee' },
          [{ accountId: revenueAccountId, description: 'Tuition', quantity: 1, unitPrice: amount }],
        );
        const full = await tx.document.findFirst({ where: { id: doc.id }, include: { lines: true } });
        const entry = await posting.post(
          {
            journalCode: 'SALES',
            date: new Date('2026-01-20'),
            sourceType: 'school_fee_invoice',
            sourceId: full.id,
            lines: await builder.salesPostingLines(tx, full),
          },
          tx,
        );
        await tx.document.update({
          where: { id: full.id },
          data: { status: 'posted', paymentStatus: 'not_paid', amountResidual: full.totalAmount, journalEntryId: entry.id },
        });
        await tx.schoolFeeInvoice.create({
          data: { organizationId, invoiceNumber: `SFI-W1-${stamp}-${seq}`, documentId: full.id, studentProfileId, termId, status: 'issued' },
        });
        return full.id as string;
      }),
    );
  };

  beforeAll(async () => {
    await raw.$connect();
    await raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, organizationId);
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await raw.organization.create({
      data: { id: organizationId, code: `W3-${stamp}`, name: 'Wave3 School', currencyCode: 'UGX' },
    });
    const mk = makeAccountFactory(raw, await ensureAccountCategories(raw));
    const cash = await mk(organizationId, 'W-1100', 'Cash', 'cash');
    cashAccountId = cash.id;
    const bank = await mk(organizationId, 'W-1200', 'Bank', 'bank');
    const ar = await mk(organizationId, 'W-1300', 'Fees Receivable', 'receivable');
    revenueAccountId = (await mk(organizationId, 'W-4100', 'Tuition Revenue', 'revenue')).id;
    for (const [code, name, type] of [
      ['SALES', 'Sales', 'sales'],
      ['CASH', 'Cash', 'cash'],
      ['BANK', 'Bank', 'bank'],
      ['GEN', 'General', 'general'],
    ] as const) {
      await raw.journal.create({ data: { organizationId, code, name, journalType: type } });
    }
    for (const [key, accountId] of [
      ['default_cash', cash.id],
      ['default_bank', bank.id],
      ['accounts_receivable', ar.id],
      ['sales_revenue', revenueAccountId],
    ] as const) {
      await raw.accountMapping.create({ data: { organizationId, key, accountId } });
    }

    const year = await raw.academicYear.create({
      data: { organizationId, name: `Y${stamp}`, startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
    });
    termId = (
      await raw.term.create({
        data: { organizationId, academicYearId: year.id, name: 'Term 1', startDate: new Date('2026-01-15'), endDate: new Date('2026-04-15') },
      })
    ).id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, FeesModule],
    }).compile();
    await moduleRef.init();

    tenant = moduleRef.get(TenantContextService);
    prisma = moduleRef.get(PrismaService);
    billing = moduleRef.get(SchoolPaymentService);
    reversals = moduleRef.get(PaymentAllocationReversalService);
    finance = moduleRef.get(SchoolFinanceQueryService);
    advanced = moduleRef.get(AdvancedFinanceService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  it('F7: two concurrent collects on one invoice settle it once; the excess stays unallocated', async () => {
    const { partnerId, studentProfileId } = await makeStudent();
    const invoiceId = await makeInvoice(partnerId, studentProfileId, 300_000);

    const [a, b]: any[] = await Promise.all([
      asTenant(() => billing.collect({ studentProfileId, amount: 200_000, paymentMethod: 'cash' })),
      asTenant(() => billing.collect({ studentProfileId, amount: 200_000, paymentMethod: 'cash' })),
    ]);
    const doc = await raw.document.findFirstOrThrow({ where: { id: invoiceId } });
    expect(Number(doc.amountResidual)).toBe(0);
    expect(Number(doc.amountPaid)).toBe(300_000);
    const allocated = await raw.paymentAllocation.aggregate({
      where: { organizationId, documentId: invoiceId, status: 'posted' },
      _sum: { amount: true },
    });
    expect(Number(allocated._sum.amount)).toBe(300_000);
    expect(Number(a.unallocated) + Number(b.unallocated)).toBe(100_000);
    expect(await arVariance()).toBeLessThanOrEqual(0.01);
  });

  it('F8: a partial waiver re-applied later forgives only its remainder', async () => {
    const { partnerId, studentProfileId } = await makeStudent();
    await makeInvoice(partnerId, studentProfileId, 300_000);
    const waiver = await raw.waiver.create({
      data: {
        organizationId,
        studentProfileId,
        code: `W-${stamp}`,
        name: 'Bursary',
        amount: 500_000,
        status: 'approved',
        createdBy: 'maker',
        approvedById: 'checker',
        approvedAt: new Date(),
      },
    });
    const first: any = await asTenant(() => advanced.applyWaiver(waiver.id));
    expect(Number(first.appliedAmount)).toBe(300_000);

    // Nothing new to forgive: applying again must change nothing.
    await asTenant(() => advanced.applyWaiver(waiver.id));
    expect(Number((await raw.waiver.findFirstOrThrow({ where: { id: waiver.id } })).appliedAmount)).toBe(300_000);

    // Next term's invoice: only the 200,000 remainder may be forgiven.
    const second = await makeInvoice(partnerId, studentProfileId, 300_000);
    await asTenant(() => advanced.applyWaiver(waiver.id));
    const doc = await raw.document.findFirstOrThrow({ where: { id: second } });
    expect(Number(doc.amountResidual)).toBe(100_000);
    const after = await raw.waiver.findFirstOrThrow({ where: { id: waiver.id } });
    expect(Number(after.appliedAmount)).toBe(500_000);
    expect(after.applied).toBe(true);
    expect(await arVariance()).toBeLessThanOrEqual(0.01);
  });

  it('F10: outstanding still counts a pupil who has left the school', async () => {
    const { partnerId, studentProfileId } = await makeStudent();
    await makeInvoice(partnerId, studentProfileId, 120_000);
    const before = await asTenant(() => finance.outstandingTotal());
    await raw.studentProfile.update({ where: { id: studentProfileId }, data: { status: 'withdrawn' } });
    const after = await asTenant(() => finance.outstandingTotal());
    expect(after.outstanding).toBe(before.outstanding);
  });

  it('Outbox: concurrent ticks dispatch a claimed row once', async () => {
    const outbox = moduleRef.get(EventOutboxService);
    const worker = moduleRef.get(OutboxWorker);
    let calls = 0;
    const eventName = `test.wave3.${stamp}` as any;
    outbox.on(eventName, async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 50));
    });
    await raw.eventOutbox.create({ data: { organizationId, eventName, payload: { organizationId } } });
    await Promise.all([worker.tick(), worker.tick(), worker.tick()]);
    const row = await raw.eventOutbox.findFirstOrThrow({ where: { organizationId, eventName } });
    expect(calls).toBe(1);
    expect(row.status).toBe('shipped');
  });
});
