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
    expect([...SCHOOL_FEE_SOURCE_TYPES].sort()).toEqual(
      ['library_fine', 'school_fee', 'school_meal', 'school_penalty'].sort(),
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
  const events = { publish: jest.fn() };
  const documentFindMany = jest.fn().mockResolvedValue(openInvoices);
  const tx = {
    studentProfile: { findFirst: jest.fn().mockResolvedValue({ id: 'stu_1', partnerId: 'p_1' }) },
    document: { findMany: documentFindMany },
    payment: { findFirst: jest.fn().mockResolvedValue({ id: 'pay_1', allocations: [] }) },
  };
  const prisma = { client: { $transaction: jest.fn(async (cb: any) => cb(tx)) } };
  const payments = { createReceipt: jest.fn().mockResolvedValue({ id: 'pay_1' }) };
  const finance = { refundableAmount: jest.fn().mockResolvedValue(0) };
  const service = new SchoolPaymentService(prisma as any, tenant as any, events as any, payments as any, finance as any);
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
  const events = { publish: jest.fn() };
  const createCustomerRefund = jest.fn().mockResolvedValue({ id: 'refund_1' });
  const tx = {
    studentProfile: {
      findFirst: jest.fn().mockResolvedValue({ id: 'stu_1', partnerId: 'p_1' }),
    },
    payment: {
      findFirst: jest.fn().mockResolvedValue(null), // no replay
      aggregate: jest.fn().mockResolvedValue({
        _sum: { unallocatedAmount: new Prisma.Decimal(opts.unallocated) },
      }),
    },
    feeCredit: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: { remaining: new Prisma.Decimal(opts.creditRemaining) },
      }),
    },
  };
  const prisma = { client: { $transaction: jest.fn(async (cb: any) => cb(tx)) } };
  const payments = { createCustomerRefund };
  // A2.1: the canonical entitlement now lives in the query service. Mirror the
  // MAX-of-the-two-pots floor the tests were written against.
  const finance = {
    refundableAmount: jest.fn().mockResolvedValue(Math.max(opts.unallocated, opts.creditRemaining)),
  };
  const service = new SchoolPaymentService(prisma as any, tenant as any, events as any, payments as any, finance as any);
  return { service, createCustomerRefund };
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
