/**
 * Wave 18 — money races and fail-closed checks on the fee side, real database.
 *
 * - Mobile money: a success callback whose amount differs from the request, or
 *   that carries no currency, is held for review and posts nothing; a payout
 *   must name its collections and cannot sweep one collection twice.
 * - Two concurrent reversals of one journal entry reverse it once.
 * - Two concurrent reversals of one receipt reverse its journal once.
 * - A reversal of an allocation racing a new collection leaves the invoice's
 *   cached residual equal to total − live allocations.
 * - Two concurrent drawer closes close it once.
 * - The generic payment void refuses a pupil's payment.
 */
import { createHmac } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';
import { ensureAccountCategories, makeAccountFactory } from './_accounts';
import { KernelModule } from '../../src/kernel/kernel.module';
import { DocumentsModule } from '../../src/modules/documents/documents.module';
import { CoreModule } from '../../src/modules/core/core.module';
import { AccountingModule } from '../../src/modules/accounting/accounting.module';
import { InventoryModule } from '../../src/modules/inventory/inventory.module';
import { InvoicingModule } from '../../src/modules/invoicing/invoicing.module';
import { FeesModule } from '../../src/modules/school/fees/fees.module';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';
import { BillingService, SchoolPaymentService } from '../../src/modules/school/fees/billing.service';
import { MobileMoneyService } from '../../src/modules/school/fees/mobile-money.service';
import { PaymentAllocationReversalService } from '../../src/modules/school/fees/allocation-reversal.service';
import { PostingService } from '../../src/modules/accounting/posting/posting.service';
import { CashSessionService } from '../../src/modules/accounting/treasury/cash-session.service';
import { PaymentService } from '../../src/modules/invoicing/payment/payment.service';
import { placeInClass } from './_placement';

describeDb('integration: wave 18 concurrency and fail-closed money paths', () => {
  const raw = new PrismaClient();
  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let momo: MobileMoneyService;
  let collect: SchoolPaymentService;
  let reversals: PaymentAllocationReversalService;
  let posting: PostingService;
  let cash: CashSessionService;
  let genericPayments: PaymentService;

  const stamp = Date.now();
  const organizationId = `org_w18c_${stamp}`;
  const SECRET = 'w18-momo-secret';
  const TUITION = 600_000;
  let studentProfileId = '';
  let termId = '';
  let invoiceId = '';
  let cashId = '';
  let bankId = '';
  let revenueId = '';
  let registerId = '';
  const bursar = `bursar_w18c_${stamp}`;
  const bursar2 = `bursar2_w18c_${stamp}`;

  const as = <T>(fn: () => Promise<T>, userId = bursar): Promise<T> =>
    tenant.run({ organizationId, userId, permissions: ['*'] }, fn);
  const sign = (body: string) => createHmac('sha256', SECRET).update(body).digest('hex');
  const pendingRequest = (ref: string, amount: number) =>
    raw.mobileMoneyRequest.create({
      data: { organizationId, studentProfileId, provider: 'mtn', providerRef: ref, msisdn: '256772000009', amount, currency: 'UGX' },
    });

  beforeAll(async () => {
    process.env.ENABLE_LIVE_MOBILE_MONEY = 'true';
    await raw.$connect();
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, organizationId);
    await raw.organization.create({ data: { id: organizationId, code: `W18C-${stamp}`, name: 'W18 Concurrency', currencyCode: 'UGX' } });
    for (const id of [bursar, bursar2]) {
      await raw.user.create({ data: { id, organizationId, email: `${id}@w18c.test`, passwordHash: 'x', firstName: id } });
    }

    const mk = makeAccountFactory(raw, await ensureAccountCategories(raw));
    cashId = (await mk(organizationId, 'C-1100', 'Cash', 'cash')).id;
    bankId = (await mk(organizationId, 'C-1200', 'Bank', 'bank')).id;
    const clearing = (await mk(organizationId, 'C-1150', 'MoMo Clearing', 'bank')).id;
    const ar = (await mk(organizationId, 'C-1300', 'Fees Receivable', 'receivable')).id;
    revenueId = (await mk(organizationId, 'C-4100', 'Tuition', 'revenue')).id;
    const shortOver = (await mk(organizationId, 'C-6900', 'Cash Short/Over', 'other_expense')).id;
    for (const [code, name, type] of [['SALES', 'Sales', 'sales'], ['CASH', 'Cash', 'cash'], ['BANK', 'Bank', 'bank'], ['GEN', 'General', 'general']] as const) {
      await raw.journal.create({ data: { organizationId, code, name, journalType: type } });
    }
    await raw.accountMapping.create({ data: { organizationId, key: 'default_cash', accountId: cashId } });
    await raw.accountMapping.create({ data: { organizationId, key: 'accounts_receivable', accountId: ar } });
    await raw.accountMapping.create({ data: { organizationId, key: 'cash_short_over', accountId: shortOver } });
    registerId = (await raw.cashRegister.create({ data: { organizationId, code: 'FEE-1', name: 'Fee desk', defaultAccountId: cashId } })).id;

    const category = await raw.productCategory.create({ data: { organizationId, name: 'School Fees', incomeAccountId: revenueId } });
    const product = await raw.product.create({
      data: { organizationId, code: 'TUITION', name: 'Tuition', productType: 'service', categoryId: category.id, salesPrice: TUITION },
    });
    const year = await raw.academicYear.create({
      data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
    });
    termId = (
      await raw.term.create({
        data: { organizationId, academicYearId: year.id, name: 'Term 1', startDate: new Date('2026-01-15'), endDate: new Date('2026-04-15'), isCurrent: true },
      })
    ).id;
    const grade = await raw.gradeLevel.create({ data: { organizationId, name: 'P4', order: 4 } });
    const klass = await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'P4 East' } });
    const partner = await raw.partner.create({
      data: { organizationId, code: 'STU-W18C-1', name: 'Race Pupil', isCustomer: true, receivableAccountId: ar },
    });
    studentProfileId = (
      await raw.studentProfile.create({
        data: { organizationId, partnerId: partner.id, admissionNo: 'ADM-W18C-1', enrollmentDate: new Date('2026-01-10'), status: 'active' },
      })
    ).id;
    await placeInClass(raw, { organizationId, studentProfileId, classId: klass.id });
    const fs = await raw.feeStructure.create({
      data: {
        organizationId,
        name: 'P4 Fees',
        academicYearId: year.id,
        status: 'draft',
        components: [{ code: 'TUITION', productId: product.id, amount: TUITION }],
        applicableTo: { classIds: [klass.id] },
      },
    });
    const v1 = await raw.feeStructureVersion.create({ data: { organizationId, feeStructureId: fs.id, versionNo: 1, publishedAt: new Date('2026-01-01') } });
    await raw.feeItem.create({
      data: { organizationId, feeStructureVersionId: v1.id, code: 'TUITION', name: 'Tuition', productId: product.id, amount: TUITION, isOptional: false },
    });
    await raw.feeStructure.update({ where: { id: fs.id }, data: { status: 'published', currentVersionId: v1.id } });
    await raw.feeSchedule.create({ data: { organizationId, feeStructureId: fs.id, termId, dueDate: new Date('2026-02-15') } });

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, FeesModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    momo = moduleRef.get(MobileMoneyService);
    collect = moduleRef.get(SchoolPaymentService);
    reversals = moduleRef.get(PaymentAllocationReversalService);
    posting = moduleRef.get(PostingService);
    cash = moduleRef.get(CashSessionService);
    genericPayments = moduleRef.get(PaymentService);

    const billed: any = await as(() => moduleRef.get(BillingService).billSingleStudent(studentProfileId, termId));
    invoiceId = billed.documentId;
    await as(() => momo.upsertGateway('mtn', { callbackSecret: SECRET, clearingAccountId: clearing, currency: 'UGX' } as any));
  }, 120_000);

  afterAll(async () => {
    delete process.env.ENABLE_LIVE_MOBILE_MONEY;
    await moduleRef?.close();
    await raw.$disconnect();
  });

  const bankReceipt = (amount: number, userId = bursar) =>
    as(
      () =>
        collect.collect({
          studentProfileId,
          amount,
          paymentMethod: 'bank',
          bankAccountId: bankId,
          paymentDate: '2026-02-01',
          reference: `race-${amount}-${Math.random()}`,
        } as any),
      userId,
    );

  describe('mobile money', () => {
    it('holds a success callback whose amount differs from the request', async () => {
      const ref = `MTN-SHORT-${stamp}`;
      await pendingRequest(ref, 200_000);
      const body = JSON.stringify({ externalId: ref, status: 'SUCCESSFUL', amount: '150000', currency: 'UGX' });
      await momo.handleCallback('mtn', body, sign(body));
      const req = await raw.mobileMoneyRequest.findFirst({ where: { organizationId, providerRef: ref } });
      expect(req!.status).toBe('needs_review');
      expect(req!.failureReason).toMatch(/Received 150000, requested 200000/);
      expect(await raw.payment.count({ where: { organizationId, externalReference: ref } })).toBe(0);
    });

    it('holds a success callback that carries no currency', async () => {
      const ref = `MTN-NOCUR-${stamp}`;
      await pendingRequest(ref, 50_000);
      const body = JSON.stringify({ externalId: ref, status: 'SUCCESSFUL', amount: '50000' });
      await momo.handleCallback('mtn', body, sign(body));
      const req = await raw.mobileMoneyRequest.findFirst({ where: { organizationId, providerRef: ref } });
      expect(req!.status).toBe('needs_review');
      expect(await raw.payment.count({ where: { organizationId, externalReference: ref } })).toBe(0);
    });

    it('a payout must name its collections and cannot sweep one twice', async () => {
      const ref = `MTN-SETTLE-${stamp}`;
      const req = await pendingRequest(ref, 40_000);
      const body = JSON.stringify({ externalId: ref, status: 'SUCCESSFUL', amount: '40000', currency: 'UGX' });
      await momo.handleCallback('mtn', body, sign(body));
      expect((await raw.mobileMoneyRequest.findUnique({ where: { id: req.id } }))!.status).toBe('succeeded');

      await expect(
        as(() => momo.recordSettlement({ provider: 'mtn', reference: `PO-A-${stamp}`, grossAmount: 40_000, bankAccountId: bankId } as any)),
      ).rejects.toThrow(/Select the collections/);

      const settle = (reference: string) =>
        as(() =>
          momo.recordSettlement({ provider: 'mtn', reference, grossAmount: 40_000, bankAccountId: bankId, requestIds: [req.id] } as any),
        );
      const results = await Promise.allSettled([settle(`PO-B-${stamp}`), settle(`PO-C-${stamp}`)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await raw.mobileMoneySettlement.count({ where: { organizationId } })).toBe(1);
    });
  });

  it('two concurrent reversals of one journal entry reverse it once', async () => {
    const je = await as(() =>
      posting.post({
        journalCode: 'GEN',
        date: '2026-02-02',
        lines: [
          { accountId: cashId, debit: 1_000 },
          { accountId: revenueId, credit: 1_000 },
        ],
      }),
    );
    const results = await Promise.allSettled([as(() => posting.reverse(je.id)), as(() => posting.reverse(je.id))]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await raw.journalEntry.count({ where: { organizationId, reversalOfId: je.id } })).toBe(1);
  });

  it('two concurrent reversals of one receipt reverse its journal once', async () => {
    const receipt: any = await bankReceipt(10_000);
    const paymentId = receipt.payment.id;
    const results = await Promise.allSettled([
      as(() => reversals.reversePayment(paymentId, 'keyed against the wrong pupil')),
      as(() => reversals.reversePayment(paymentId, 'keyed against the wrong pupil'), bursar2),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const pay = await raw.payment.findUnique({ where: { id: paymentId } });
    expect(pay!.status).toBe('cancelled');
    expect(await raw.journalEntry.count({ where: { organizationId, reversalOfId: pay!.journalEntryId! } })).toBe(1);
  });

  it('an allocation reversal racing a new collection keeps the invoice residual honest', async () => {
    const first: any = await bankReceipt(100_000);
    const alloc = await raw.paymentAllocation.findFirst({ where: { paymentId: first.payment.id, status: 'posted' } });
    await Promise.allSettled([
      as(() => reversals.reverseAllocation(alloc!.id, 'moved to next term')),
      bankReceipt(80_000, bursar2),
    ]);
    const doc = await raw.document.findUnique({ where: { id: invoiceId } });
    const live = await raw.paymentAllocation.aggregate({
      where: { documentId: invoiceId, status: 'posted' },
      _sum: { amount: true },
    });
    expect(Number(doc!.amountResidual)).toBe(Number(doc!.totalAmount) - Number(live._sum.amount ?? 0));
    expect(Number(doc!.amountPaid)).toBe(Number(live._sum.amount ?? 0));
  });

  it('two concurrent drawer closes close it once', async () => {
    const session: any = await as(() => cash.open({ cashRegisterId: registerId, openingFloat: 0 }));
    const close = () =>
      as(() => cash.close({ sessionId: session.id, closingCounted: 5_000, varianceReason: 'float found in drawer' }), bursar);
    const results = await Promise.allSettled([close(), close()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      await raw.journalEntry.count({ where: { organizationId, sourceType: 'cash_session_variance', sourceId: session.id } }),
    ).toBe(1);
  });

  it('the generic payment void refuses a pupil payment', async () => {
    const receipt: any = await bankReceipt(5_000);
    // Take the money back off the invoice first so the old allocation marker
    // is gone; the pupil's account is what now stops the generic void.
    const alloc = await raw.paymentAllocation.findFirst({ where: { paymentId: receipt.payment.id, status: 'posted' } });
    if (alloc) await as(() => reversals.reverseAllocation(alloc.id, 'unallocate for test'));
    await expect(
      tenant.run({ organizationId, userId: bursar, permissions: ['payment:void'] }, () =>
        genericPayments.void(receipt.payment.id),
      ),
    ).rejects.toThrow(/school-fee receipt/);
  });
});
