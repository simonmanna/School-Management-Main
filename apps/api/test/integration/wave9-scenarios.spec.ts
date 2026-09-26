/**
 * Re-audit #3 (2026-09-25) business scenarios, end to end against a real
 * database. Ledger scenarios close on `reconcileCurrentArToGl().variance === 0`.
 *
 *   P0-2  a bounced receipt that funded a credit: unspent credit voided, spent
 *         credit re-opens the invoice it paid, refunded credit becomes a
 *         recovery charge (owner decision D2).
 *   P0-3  a refund naming another family's receipt is refused.
 *   P0-4  a batch row re-submitted with its key replays instead of re-collecting.
 *   P1-7  converting an overpayment does not shrink later refundable cash.
 *   D1    arrears in a financially closed term are still collectible.
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

describe('integration: re-audit #3 business scenarios (wave 9)', () => {
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
  let closedTermId = '';

  const stamp = Date.now();
  const organizationId = `org_w9_${stamp}`;
  const userId = 'bursar_w9';

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
  const makeInvoice = async (partnerId: string, studentProfileId: string, amount: number, forTerm?: string) => {
    seq += 1;
    const builder = moduleRef.get(DocumentBuilderService);
    const posting = moduleRef.get(PostingService);
    return asTenant(() =>
      prisma.client.$transaction(async (tx: any) => {
        const doc = await builder.createDocument(
          tx,
          'sales_invoice',
          { partnerId, issueDate: new Date('2026-01-20').toISOString(), reference: `TERM-${forTerm ?? termId}-${seq}`, sourceType: 'school_fee' },
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
          data: { organizationId, invoiceNumber: `SFI-W9-${stamp}-${seq}`, documentId: full.id, studentProfileId, termId: forTerm ?? termId, status: 'issued' },
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
      data: { id: organizationId, code: `W9-${stamp}`, name: 'Wave9 Scenario School', currencyCode: 'UGX' },
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

    closedTermId = (
      await raw.term.create({
        data: { organizationId, academicYearId: year.id, name: 'Term 0', startDate: new Date('2026-01-02'), endDate: new Date('2026-01-14') },
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

  it('P0-2 bounced receipt voids the unspent credit it funded', async () => {
    const { partnerId, studentProfileId } = await makeStudent();
    const inv = await makeInvoice(partnerId, studentProfileId, 300_000);
    const c: any = await asTenant(() =>
      billing.collect({ studentProfileId, amount: 500_000, paymentMethod: 'cash', convertOverpaymentToCredit: true } as any),
    );
    expect(c.overpaymentCredit).toBeTruthy();
    await asTenant(() => reversals.reversePayment(c.payment.id, 'cheque bounced'));

    const credit = await raw.feeCredit.findFirstOrThrow({ where: { id: c.overpaymentCredit.id } });
    expect(credit.status).toBe('reversed');
    expect(Number(credit.remaining)).toBe(0);
    expect(Number((await raw.document.findFirstOrThrow({ where: { id: inv } })).amountResidual)).toBe(300_000);
    expect(await arVariance()).toBeLessThanOrEqual(0.01);
  });

  it('P0-2 …and re-opens the invoice the credit already paid', async () => {
    const { partnerId, studentProfileId } = await makeStudent();
    await makeInvoice(partnerId, studentProfileId, 300_000);
    const c: any = await asTenant(() =>
      billing.collect({ studentProfileId, amount: 500_000, paymentMethod: 'cash', convertOverpaymentToCredit: true } as any),
    );
    const next = await makeInvoice(partnerId, studentProfileId, 200_000);
    await asTenant(() => advanced.applyCredits(studentProfileId));
    expect(Number((await raw.document.findFirstOrThrow({ where: { id: next } })).amountResidual)).toBe(0);

    await asTenant(() => reversals.reversePayment(c.payment.id, 'cheque bounced'));
    expect(Number((await raw.document.findFirstOrThrow({ where: { id: next } })).amountResidual)).toBe(200_000);
    expect(await arVariance()).toBeLessThanOrEqual(0.01);
  });

  it('P0-2 …and turns a credit already refunded into a recovery charge on the family', async () => {
    const { partnerId, studentProfileId } = await makeStudent();
    await makeInvoice(partnerId, studentProfileId, 300_000);
    const c: any = await asTenant(() =>
      billing.collect({ studentProfileId, amount: 500_000, paymentMethod: 'cash', convertOverpaymentToCredit: true } as any),
    );
    await asTenant(() => billing.refundFee({ studentProfileId, amount: 200_000, paymentMethod: 'cash' }));
    const res: any = await asTenant(() => reversals.reversePayment(c.payment.id, 'cheque bounced'));

    expect(res.recoveryDocumentId).toBeTruthy();
    const rec = await raw.document.findFirstOrThrow({ where: { id: res.recoveryDocumentId } });
    expect(rec.sourceType).toBe('school_payment_recovery');
    expect(rec.partnerId).toBe(partnerId);
    expect(Number(rec.amountResidual)).toBe(200_000);
    const bal: any = await asTenant(() => finance.studentBalance(studentProfileId));
    // The 300k invoice is open again and the 200k paid out is owed back.
    expect(Number(bal.balance)).toBe(500_000);
    expect(await arVariance()).toBeLessThanOrEqual(0.01);
  });

  it("P0-3 a refund naming another family's receipt is refused and touches nothing", async () => {
    const other = await makeStudent();
    const otherInv = await makeInvoice(other.partnerId, other.studentProfileId, 100_000);
    const paid: any = await asTenant(() =>
      billing.collect({ studentProfileId: other.studentProfileId, amount: 100_000, paymentMethod: 'cash' }),
    );
    const me = await makeStudent();
    await expect(
      asTenant(() =>
        billing.refundFee({
          studentProfileId: me.studentProfileId,
          amount: 100_000,
          paymentMethod: 'cash',
          allocatedPaymentId: paid.payment.id,
        } as any),
      ),
    ).rejects.toThrow(/not a live receipt/);
    expect(Number((await raw.document.findFirstOrThrow({ where: { id: otherInv } })).amountResidual)).toBe(0);
  });

  it('P0-4 a re-submitted batch row replays instead of collecting twice', async () => {
    const { partnerId, studentProfileId } = await makeStudent();
    await makeInvoice(partnerId, studentProfileId, 100_000);
    const row = {
      studentProfileId,
      amount: 60_000,
      paymentMethod: 'cash' as const,
      externalReference: `batch-${stamp}-x`,
      externalReferenceType: 'import_row',
    };
    const first: any = await asTenant(() => billing.collectBatch({ rows: [row] }));
    const second: any = await asTenant(() => billing.collectBatch({ rows: [row] }));
    expect(first.results[0].status).toBe('posted');
    expect(second.results[0].status).toBe('replayed');
    expect(await raw.payment.count({ where: { organizationId, partnerId, direction: 'inbound' } })).toBe(1);
    expect(await arVariance()).toBeLessThanOrEqual(0.01);
  });

  it('P1-7 a converted overpayment does not shrink later refundable cash', async () => {
    const { partnerId, studentProfileId } = await makeStudent();
    await makeInvoice(partnerId, studentProfileId, 100_000);
    await asTenant(() =>
      billing.collect({ studentProfileId, amount: 300_000, paymentMethod: 'cash', convertOverpaymentToCredit: true } as any),
    );
    await asTenant(() =>
      billing.collect({ studentProfileId, amount: 50_000, paymentMethod: 'cash', convertOverpaymentToCredit: false } as any),
    );
    const r = await asTenant(() => finance.refundableBreakdown(partnerId, studentProfileId));
    expect(r.fromPayments).toBe(50_000);
    expect(r.fromCredits).toBe(200_000);
    expect(r.total).toBe(250_000);
  });

  it('D1 arrears in a financially closed term are still collectible', async () => {
    const { partnerId, studentProfileId } = await makeStudent();
    const old = await makeInvoice(partnerId, studentProfileId, 80_000, closedTermId);
    await raw.termFinancialClose.create({ data: { organizationId, termId: closedTermId, status: 'closed', closedAt: new Date() } });
    const c: any = await asTenant(() => billing.collect({ studentProfileId, amount: 80_000, paymentMethod: 'cash' }));
    expect(c.payment).toBeTruthy();
    expect(Number((await raw.document.findFirstOrThrow({ where: { id: old } })).amountResidual)).toBe(0);
    expect(await arVariance()).toBeLessThanOrEqual(0.01);
  });
});
