/**
 * Wave 1 ledger fixes, end to end against a real database (E2E audit F2/F3/F4/F6):
 *
 *   1. Collect 500k against a 300k invoice → refund the 200k overpayment → a
 *      second 200k refund is REJECTED (F4: the entitlement used to be re-read
 *      as untouched, so the same overpayment could be paid out repeatedly).
 *   2. Collect → reversePayment → exactly ONE reversing entry for the receipt,
 *      and no per-allocation `school_allocation_reversal` entry (F2: the
 *      reversal used to post Dr AR / Cr Cash per allocation AND reverse the
 *      receipt, undoing the cash twice).
 *   3. Collect → reallocate to another invoice → the cash account does not
 *      move (F3: reallocation used to post a cash leg though no cash moved).
 *
 * Every scenario closes on `reconcileCurrentArToGl().variance === 0`.
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

describe('integration: wave 1 ledger fixes', () => {
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

  const stamp = Date.now();
  const organizationId = `org_w1l_${stamp}`;
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
      data: { id: organizationId, code: `W1L-${stamp}`, name: 'Wave1 Ledger School', currencyCode: 'UGX' },
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
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  it('an overpayment refunds once; a second refund of the same value is rejected (F4)', async () => {
    const { partnerId, studentProfileId } = await makeStudent();
    await makeInvoice(partnerId, studentProfileId, 300_000);

    const collected: any = await asTenant(() =>
      billing.collect({ studentProfileId, amount: 500_000, paymentMethod: 'cash' }),
    );
    expect(Number(collected.unallocated)).toBe(200_000);

    await asTenant(() => billing.refundFee({ studentProfileId, amount: 200_000, paymentMethod: 'cash' }));
    await expect(
      asTenant(() => billing.refundFee({ studentProfileId, amount: 200_000, paymentMethod: 'cash' })),
    ).rejects.toThrow();

    const outbound = await raw.payment.findMany({ where: { organizationId, partnerId, direction: 'outbound' } });
    expect(outbound).toHaveLength(1);
    const receipt = await raw.payment.findFirstOrThrow({ where: { id: collected.payment.id } });
    expect(Number(receipt.unallocatedAmount)).toBe(0);
    expect(await arVariance()).toBeLessThanOrEqual(0.01);
  });

  it('reversing a payment undoes the receipt once and posts no allocation-reversal entry (F2/F6)', async () => {
    const { partnerId, studentProfileId } = await makeStudent();
    const invoiceId = await makeInvoice(partnerId, studentProfileId, 300_000);
    const cashBefore = await glBalance(cashAccountId);

    const collected: any = await asTenant(() =>
      billing.collect({ studentProfileId, amount: 300_000, paymentMethod: 'cash' }),
    );
    expect(await glBalance(cashAccountId)).toBe(cashBefore + 300_000);

    await asTenant(() => reversals.reversePayment(collected.payment.id, 'keyed against the wrong pupil'));

    const payment = await raw.payment.findFirstOrThrow({ where: { id: collected.payment.id } });
    expect(payment.status).toBe('cancelled');
    const reversing = await raw.journalEntry.findMany({
      where: { organizationId, reversalOfId: payment.journalEntryId! },
    });
    expect(reversing).toHaveLength(1);
    expect(
      await raw.journalEntry.count({ where: { organizationId, sourceType: 'school_allocation_reversal' } }),
    ).toBe(0);

    // Cash is back where it started, and the invoice is open again in full.
    expect(await glBalance(cashAccountId)).toBe(cashBefore);
    const doc = await raw.document.findFirstOrThrow({ where: { id: invoiceId } });
    expect(Number(doc.amountResidual)).toBe(300_000);
    expect(await arVariance()).toBeLessThanOrEqual(0.01);
  });

  it('reallocating a receipt to another invoice does not move cash (F3)', async () => {
    const { partnerId, studentProfileId } = await makeStudent();
    const first = await makeInvoice(partnerId, studentProfileId, 200_000);
    const second = await makeInvoice(partnerId, studentProfileId, 200_000);

    const collected: any = await asTenant(() =>
      billing.collect({
        studentProfileId,
        amount: 150_000,
        paymentMethod: 'cash',
        allocations: [{ documentId: first, amount: 150_000 }],
      }),
    );
    const cashAfterCollect = await glBalance(cashAccountId);

    await asTenant(() =>
      reversals.reallocate(collected.payment.id, [{ documentId: second, amount: 150_000 }], 'parent asked for term 2'),
    );

    expect(await glBalance(cashAccountId)).toBe(cashAfterCollect);
    const [a, b] = await Promise.all([
      raw.document.findFirstOrThrow({ where: { id: first } }),
      raw.document.findFirstOrThrow({ where: { id: second } }),
    ]);
    expect(Number(a.amountResidual)).toBe(200_000);
    expect(Number(b.amountResidual)).toBe(50_000);
    expect(
      await raw.journalEntry.count({ where: { organizationId, sourceType: 'school_allocation_reversal' } }),
    ).toBe(0);
    expect(await arVariance()).toBeLessThanOrEqual(0.01);
  });
});
