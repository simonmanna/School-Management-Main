/**
 * Regression tests for the Fees & Finance Phase 0 ("stop the bleeding") fixes.
 *
 * Each test below corresponds to a P0 defect from the production-hardening
 * audit and fails against the pre-fix code. They are unit-level guards on the
 * specific query shapes and guard clauses; the end-to-end AR/GL consequences
 * are proven against a real database in the integration suite.
 */
import { Prisma } from '@prisma/client';
import { SchoolPaymentService } from '../../src/modules/school/fees/billing.service';
import {
  ACTIVE_FEE_STATUSES,
  OPEN_FEE_WHERE,
  POSTED_FEE_WHERE,
  SCHOOL_FEE_SOURCE_TYPES,
} from '../../src/modules/school/fees/fee-document.constants';

/* ─────────────────── P0-1 / P0-7: canonical filters ─────────────────── */

describe('fee document constants (P0-1, P0-7)', () => {
  it('counts every kind of school charge, not just tuition', () => {
    // P0-1: the parent portal filtered sourceType 'school_fee' alone, so
    // penalties, library fines and meal charges silently vanished from the
    // balance a parent was shown.
    // Transport and admission fees are receivables too — leaving them out made
    // a posted invoice invisible to balance, aging, portal and clearance.
    expect([...SCHOOL_FEE_SOURCE_TYPES].sort()).toEqual(
      ['library_fine', 'school_admission_fee', 'school_fee', 'school_meal', 'school_penalty', 'school_transport'].sort(),
    );
  });

  it('treats a fully-settled invoice as still financially active', () => {
    // PaymentService promotes a document to status 'paid' once its residual
    // hits zero. Filtering on 'posted' alone would make a student's BILLED
    // total shrink as they paid it off.
    expect([...ACTIVE_FEE_STATUSES]).toContain('posted');
    expect([...ACTIVE_FEE_STATUSES]).toContain('paid');
  });

  it('excludes draft and cancelled documents from every balance', () => {
    // P0-7: these were counted as receivables.
    const statuses = (POSTED_FEE_WHERE.status as { in: string[] }).in;
    expect(statuses).not.toContain('draft');
    expect(statuses).not.toContain('cancelled');
  });

  it('narrows the open-balance filter to unsettled documents only', () => {
    expect(OPEN_FEE_WHERE.paymentStatus).toEqual({ in: ['not_paid', 'partial'] });
    expect(OPEN_FEE_WHERE.amountResidual).toEqual({ gt: 0 });
    // ...while inheriting the lifecycle guard rather than restating it.
    expect(OPEN_FEE_WHERE.status).toEqual(POSTED_FEE_WHERE.status);
  });
});

/* ─────────────── P0-7: collect must not settle dead invoices ─────────────── */

function makeCollectService(openInvoices: any[] = []) {
  const tenant = { organizationId: 'org_test' };
  const events = { publish: jest.fn(), publishInTx: jest.fn(async () => undefined) };
  const documentFindMany = jest.fn().mockResolvedValue(openInvoices);
  const tx = {
    $queryRawUnsafe: jest.fn(async () => []), // F7 per-payer row lock
    studentProfile: { findFirst: jest.fn().mockResolvedValue({ id: 'stu_1', partnerId: 'p_1' }) },
    document: { findMany: documentFindMany },
    payment: { findFirst: jest.fn().mockResolvedValue({ id: 'pay_1', allocations: [] }) },
  };
  const prisma = { client: { $transaction: jest.fn(async (cb: any) => cb(tx)) } };
  const payments = { createReceipt: jest.fn().mockResolvedValue({ id: 'pay_1' }) };
  const finance = {
    refundableAmount: jest.fn().mockResolvedValue(0),
    refundableBreakdown: jest.fn().mockResolvedValue({ fromPayments: 0, fromCredits: 0, total: 0, credits: [] }),
  };
  // Posting collaborators are used only by the credit-funded half of a refund
  // (P0-C); collect never reaches them.
  const posting = { post: jest.fn() };
  const accounts = { receivableAccount: jest.fn() };
  const resolver = { ensureByCode: jest.fn() };
  // P1-B: period control. Open by default; a closed-term test overrides it.
  const controls = { assertDocumentsPeriodOpen: jest.fn().mockResolvedValue(undefined) };
  // P1-C: only reached by the allocatedPaymentId refund mode.
  const reversals = { reverseAllocation: jest.fn().mockResolvedValue({ alreadyReversed: false }) };
  // B1: only reached when a tender exceeds what is owed.
  const advanced = { createCredit: jest.fn().mockResolvedValue({ id: 'cr_1', code: 'CR-000001' }) };
  const service = new SchoolPaymentService(
    prisma as any,
    tenant as any,
    events as any,
    payments as any,
    finance as any,
    posting as any,
    accounts as any,
    resolver as any,
    controls as any,
    reversals as any,
    advanced as any,
  );
  return { service, documentFindMany };
}

describe('SchoolPaymentService.collect — lifecycle filtering (P0-7)', () => {
  it('restricts the oldest-first auto-fill to financially active invoices', async () => {
    const { service, documentFindMany } = makeCollectService([]);
    await service.collect({ studentProfileId: 'stu_1', amount: 50_000, paymentMethod: 'cash' } as any);

    // Before the fix this query had no `status` predicate at all, so a
    // cancelled invoice that still carried a residual would be picked up and
    // settled with a parent's money.
    const where = documentFindMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: [...ACTIVE_FEE_STATUSES] });
    expect((where.status as { in: string[] }).in).not.toContain('cancelled');
  });

  it('restricts explicitly-listed documentIds to active invoices too', async () => {
    const { service, documentFindMany } = makeCollectService([]);
    await service.collect({
      studentProfileId: 'stu_1',
      amount: 50_000,
      paymentMethod: 'cash',
      documentIds: ['doc_cancelled'],
    } as any);

    // Naming a document explicitly must not bypass the lifecycle guard.
    const where = documentFindMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: [...ACTIVE_FEE_STATUSES] });
  });
});

/* ─────────────────── P0-6: refunds must be capped ─────────────────── */

function makeRefundService(opts: { unallocated: number; creditRemaining: number }) {
  const tenant = { organizationId: 'org_test' };
  const events = { publish: jest.fn(), publishInTx: jest.fn(async () => undefined) };
  const createCustomerRefund = jest.fn().mockResolvedValue({ id: 'refund_1' });
  const feeCreditUpdate = jest.fn().mockResolvedValue({});
  const feeCreditClaim = jest.fn().mockResolvedValue({ count: 1 });
  // E2E audit F4: the cash portion is drawn down on the source receipt with a
  // conditional decrement, after the payer's receipts are row-locked.
  const paymentClaim = jest.fn().mockResolvedValue({ count: 1 });
  const lockReceipts = jest.fn().mockResolvedValue([]);
  const tx = {
    $queryRawUnsafe: lockReceipts,
    studentProfile: {
      findFirst: jest.fn().mockResolvedValue({ id: 'stu_1', partnerId: 'p_1' }),
    },
    payment: {
      findFirst: jest.fn().mockResolvedValue(null), // no replay
      findMany: jest.fn().mockResolvedValue(
        opts.unallocated ? [{ id: 'pay_1', unallocatedAmount: new Prisma.Decimal(opts.unallocated) }] : [],
      ),
      updateMany: paymentClaim,
      aggregate: jest.fn().mockResolvedValue({
        _sum: { unallocatedAmount: new Prisma.Decimal(opts.unallocated) },
      }),
    },
    feeCredit: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: { remaining: new Prisma.Decimal(opts.creditRemaining) },
      }),
      // P0-C: the drawdown the refund performs on a credit it spends.
      //
      // It is a CONDITIONAL DECREMENT, not a computed write: two simultaneous
      // refunds of one credit both used to read the same `remaining`, both
      // write the same zero, and both pay out. `updateMany` with
      // `remaining >= take` makes Postgres re-evaluate against the committed
      // value so the loser matches no rows. `count` is what the service checks.
      updateMany: feeCreditClaim,
      // Re-read after the decrement to set the terminal status.
      findFirst: jest.fn().mockResolvedValue({ remaining: new Prisma.Decimal(0) }),
      update: feeCreditUpdate,
    },
  };
  const prisma = { client: { $transaction: jest.fn(async (cb: any) => cb(tx)) } };
  const payments = { createCustomerRefund };
  // A2.1: the canonical entitlement now lives in the query service, which
  // returns it BROKEN DOWN by funding source (P0-C) so the refund knows which
  // credits it is actually spending. `total` mirrors the MAX-of-the-two-pots
  // floor these tests were written against: the two pots can describe the same
  // money, so summing them would authorise double the real entitlement (P1-3).
  const finance = {
    refundableAmount: jest.fn().mockResolvedValue(Math.max(opts.unallocated, opts.creditRemaining)),
    refundableBreakdown: jest.fn().mockResolvedValue({
      fromPayments: opts.unallocated,
      fromCredits: opts.creditRemaining,
      total: Math.max(opts.unallocated, opts.creditRemaining),
      credits: opts.creditRemaining
        ? [{ id: 'cr_1', code: 'CR-000001', source: 'approved_adjustment', remaining: opts.creditRemaining }]
        : [],
    }),
  };
  const posting = { post: jest.fn().mockResolvedValue({ id: 'je_1' }) };
  const accounts = { receivableAccount: jest.fn().mockResolvedValue('acc_ar') };
  const resolver = { ensureByCode: jest.fn().mockResolvedValue('acc_feecr') };
  // P1-B: period control. Open by default; a closed-term test overrides it.
  const controls = { assertDocumentsPeriodOpen: jest.fn().mockResolvedValue(undefined) };
  // P1-C: only reached by the allocatedPaymentId refund mode.
  const reversals = { reverseAllocation: jest.fn().mockResolvedValue({ alreadyReversed: false }) };
  // B1: only reached when a tender exceeds what is owed.
  const advanced = { createCredit: jest.fn().mockResolvedValue({ id: 'cr_1', code: 'CR-000001' }) };
  const service = new SchoolPaymentService(
    prisma as any,
    tenant as any,
    events as any,
    payments as any,
    finance as any,
    posting as any,
    accounts as any,
    resolver as any,
    controls as any,
    reversals as any,
    advanced as any,
  );
  return { service, createCustomerRefund, feeCreditUpdate, feeCreditClaim, posting, paymentClaim, lockReceipts, finance, tx };
}

describe('SchoolPaymentService.refundFee — entitlement cap (P0-6)', () => {
  const dto = { studentProfileId: 'stu_1', amount: 500_000, paymentMethod: 'cash' } as any;

  it('refuses to pay out to a student with no entitlement at all', async () => {
    // The core defect: createCustomerRefund's overpayment guard only fires for
    // payables, so a customer refund was completely unguarded. Real cash could
    // leave the drawer against nothing.
    const { service, createCustomerRefund } = makeRefundService({ unallocated: 0, creditRemaining: 0 });
    await expect(service.refundFee(dto)).rejects.toThrow(/refundable entitlement/);
    expect(createCustomerRefund).not.toHaveBeenCalled();
  });

  it('refuses a refund larger than the entitlement', async () => {
    const { service, createCustomerRefund } = makeRefundService({ unallocated: 300_000, creditRemaining: 0 });
    await expect(service.refundFee(dto)).rejects.toThrow(/refundable entitlement/);
    expect(createCustomerRefund).not.toHaveBeenCalled();
  });

  it('allows a plain overpayment refund with no FeeCredit row', async () => {
    // Guards the MIN-vs-MAX trap: an overpayment normally leaves unallocated
    // funds and NO credit row, so taking the minimum of the two would reject
    // every legitimate refund.
    const { service, createCustomerRefund } = makeRefundService({ unallocated: 500_000, creditRemaining: 0 });
    await expect(service.refundFee(dto)).resolves.toMatchObject({ replayed: false });
    expect(createCustomerRefund).toHaveBeenCalled();
  });

  it('allows an adjustment-funded credit refund with nothing unallocated', async () => {
    const { service, createCustomerRefund } = makeRefundService({ unallocated: 0, creditRemaining: 500_000 });
    await expect(service.refundFee(dto)).resolves.toMatchObject({ replayed: false });
    expect(createCustomerRefund).toHaveBeenCalled();
  });

  it('draws down the fee credit it pays out, and retires the liability (P0-C)', async () => {
    // The defect: refundFee paid out against a refundable credit and touched
    // the credit in NO way — remaining unchanged, status still 'active', the
    // Fee-Credit Liability never debited. The same 500k could then be refunded
    // again, and applyCredits would still spend it on the next invoice.
    const { service, feeCreditUpdate, feeCreditClaim, posting } = makeRefundService({ unallocated: 0, creditRemaining: 500_000 });
    await service.refundFee(dto);

    // Fully consumed -> terminal 'refunded', and no longer drawable.
    // The claim must be conditional — this is what makes it safe under
    // concurrency (proven end to end by prisma/audit-fees-concurrency.ts).
    expect(feeCreditClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'cr_1', remaining: { gte: expect.anything() } }),
        data: { remaining: { decrement: expect.anything() } },
      }),
    );
    expect(feeCreditUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cr_1' },
        data: expect.objectContaining({ status: 'refunded', isActive: false }),
      }),
    );

    // The credit's creation posted Dr AR / Cr Fee-Credit Liability, so paying
    // it out must retire that liability rather than debit AR a second time.
    expect(posting.post).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: 'school_fee_credit_refund',
        lines: [
          expect.objectContaining({ accountId: 'acc_feecr', debit: '500000' }),
          expect.objectContaining({ accountId: 'acc_ar', credit: '500000' }),
        ],
      }),
      expect.anything(),
    );
  });

  it('leaves fee credits alone when the refund is funded by unallocated cash', async () => {
    // A plain overpayment refund reverses its own receipt (Dr AR / Cr Cash).
    // There is no liability to retire, so neither a drawdown nor a
    // compensating entry belongs here.
    const { service, feeCreditUpdate, feeCreditClaim, posting } = makeRefundService({ unallocated: 500_000, creditRemaining: 0 });
    await service.refundFee(dto);
    expect(feeCreditClaim).not.toHaveBeenCalled();
    expect(feeCreditUpdate).not.toHaveBeenCalled();
    expect(posting.post).not.toHaveBeenCalled();
  });

  it('draws the refunded cash down on the source receipt, so it cannot be refunded twice (F4)', async () => {
    // The defect: nothing reduced a receipt's unallocated value when it was
    // paid back, so the entitlement never shrank and the same overpayment
    // could be refunded again and again.
    const { service, paymentClaim, lockReceipts, finance, tx } = makeRefundService({ unallocated: 500_000, creditRemaining: 0 });
    await service.refundFee(dto);
    expect(lockReceipts).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE'), 'org_test', 'p_1');
    // The entitlement is read on the refund's own transaction, after the lock.
    expect(finance.refundableBreakdown).toHaveBeenCalledWith('p_1', 'stu_1', tx);
    expect(paymentClaim).toHaveBeenCalledWith({
      where: { id: 'pay_1', unallocatedAmount: { gte: new Prisma.Decimal(500_000) } },
      data: { unallocatedAmount: { decrement: new Prisma.Decimal(500_000) } },
    });
  });

  it('aborts, paying nothing, when a racing refund already drew the receipt down (F4)', async () => {
    const { service, paymentClaim, createCustomerRefund } = makeRefundService({ unallocated: 500_000, creditRemaining: 0 });
    paymentClaim.mockResolvedValueOnce({ count: 0 });
    await expect(service.refundFee(dto)).rejects.toThrow(/changed while it was being prepared/);
    expect(createCustomerRefund).not.toHaveBeenCalled();
  });

  it('never treats an overpayment and the credit it funded as two pots (P1-3)', async () => {
    // 300k overpaid, converted to a 300k credit. createCredit does not draw
    // down Payment.unallocatedAmount, so both rows describe the SAME 300k.
    // Summing them would authorise 600k against 300k of real entitlement.
    const over = makeRefundService({ unallocated: 300_000, creditRemaining: 300_000 });
    await expect(over.service.refundFee({ ...dto, amount: 600_000 })).rejects.toThrow(
      /refundable entitlement/,
    );
    expect(over.createCustomerRefund).not.toHaveBeenCalled();

    // ...but the real 300k is still refundable.
    const ok = makeRefundService({ unallocated: 300_000, creditRemaining: 300_000 });
    await expect(ok.service.refundFee({ ...dto, amount: 300_000 })).resolves.toMatchObject({
      replayed: false,
    });
  });
});
