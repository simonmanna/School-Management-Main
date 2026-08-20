/**
 * Unit tests for SchoolPaymentService.collect.
 *
 * After P2A/B1 this service no longer writes Payment / PaymentAllocation rows or
 * mutates Documents itself — it delegates to PaymentService.createReceipt, the
 * platform's single payment writer (which posts the GL leg, updates residuals,
 * and writes the CashMovement for cash-on-session). So these tests cover the two
 * things the school service still owns:
 *
 *   1. Which invoices to settle — open school-sourced invoices, oldest first,
 *      paymentStatus in [not_paid, partial] with a positive residual.
 *   2. Building the oldest-first allocation list handed to createReceipt, and
 *      the mobile-money replay guard.
 *
 * The GL / CashMovement / residual effects are proven end to end against a real
 * database in test/integration/school-happy-path.spec.ts, not re-mocked here.
 */
import { SchoolPaymentService } from '../../src/modules/school/fees/billing.service';

function makeService(openInvoices: any[] = [], existingPayment: any = null) {
  const tenant = { organizationId: 'org_test' };
  const events = { publish: jest.fn() };

  const documentFindMany = jest.fn().mockResolvedValue(openInvoices);
  const paymentFindFirst = jest
    .fn()
    // first call = idempotency lookup; later calls = re-read the created payment
    .mockResolvedValueOnce(existingPayment)
    .mockResolvedValue({ id: 'pay_1', allocations: [] });

  const tx = {
    studentProfile: { findFirst: jest.fn().mockResolvedValue({ id: 'stu_1', partnerId: 'p_1' }) },
    document: { findMany: documentFindMany },
    payment: { findFirst: paymentFindFirst },
  };

  const prisma = { client: { $transaction: jest.fn(async (cb: any) => cb(tx)) } };

  // The single payment writer — spied, returns a payment with a stable id.
  const createReceipt = jest.fn().mockResolvedValue({ id: 'pay_1' });
  const payments = { createReceipt };

  const finance = { refundableAmount: jest.fn().mockResolvedValue(0) };
  const service = new SchoolPaymentService(
    prisma as any,
    tenant as any,
    events as any,
    payments as any,
    finance as any,
  );

  return { service, documentFindMany, createReceipt, events, paymentFindFirst };
}

const inv = (over: Partial<Record<string, unknown>>) => ({
  id: 'doc',
  organizationId: 'org_test',
  partnerId: 'p_1',
  documentType: 'sales_invoice',
  paymentStatus: 'not_paid',
  sourceType: 'school_fee',
  amountResidual: 100_000,
  amountPaid: 0,
  issueDate: new Date('2026-01-15'),
  ...over,
});

describe('SchoolPaymentService.collect — invoice selection', () => {
  it('selects open school invoices (not_paid|partial, positive residual) oldest first', async () => {
    const { service, documentFindMany } = makeService([]);

    await service.collect({ studentProfileId: 'stu_1', amount: 50_000, paymentMethod: 'cash' });

    const where = documentFindMany.mock.calls[0][0].where;
    expect(where.paymentStatus).toEqual({ in: ['not_paid', 'partial'] });
    expect(where.paymentStatus.in).not.toContain('paid');
    expect(where.sourceType).toEqual({ in: ['school_fee', 'school_penalty', 'library_fine', 'school_meal'] });
    expect(where.amountResidual).toEqual({ gt: 0 });
    expect(documentFindMany.mock.calls[0][0].orderBy).toEqual({ issueDate: 'asc' });
  });

  it('honours explicit documentIds instead of the open-invoice query', async () => {
    const { service, documentFindMany } = makeService([]);

    await service.collect({
      studentProfileId: 'stu_1',
      amount: 50_000,
      paymentMethod: 'cash',
      documentIds: ['doc_a', 'doc_b'],
    });

    const where = documentFindMany.mock.calls[0][0].where;
    expect(where.id).toEqual({ in: ['doc_a', 'doc_b'] });
    expect(where.paymentStatus).toBeUndefined();
  });
});

describe('SchoolPaymentService.collect — allocation list', () => {
  it('allocates a single invoice up to the payment amount', async () => {
    const { service, createReceipt } = makeService([inv({ id: 'doc_1', amountResidual: 100_000 })]);

    const result = await service.collect({ studentProfileId: 'stu_1', amount: 40_000, paymentMethod: 'cash' });

    const dto = createReceipt.mock.calls[0][0];
    expect(dto.partnerId).toBe('p_1');
    expect(dto.amount).toBe(40_000);
    expect(dto.paymentMethod).toBe('cash');
    expect(dto.allocations).toEqual([{ documentId: 'doc_1', amount: 40_000 }]);
    expect(result.unallocated).toBe(0);
  });

  it('splits across invoices oldest-first, capping each at its residual', async () => {
    const { service, createReceipt } = makeService([
      inv({ id: 'doc_old', amountResidual: 30_000, issueDate: new Date('2026-01-01') }),
      inv({ id: 'doc_new', amountResidual: 80_000, issueDate: new Date('2026-02-01') }),
    ]);

    const result = await service.collect({ studentProfileId: 'stu_1', amount: 50_000, paymentMethod: 'cash' });

    expect(createReceipt.mock.calls[0][0].allocations).toEqual([
      { documentId: 'doc_old', amount: 30_000 },
      { documentId: 'doc_new', amount: 20_000 },
    ]);
    expect(result.unallocated).toBe(0);
  });

  it('leaves the remainder unallocated when the payment exceeds all open invoices', async () => {
    const { service, createReceipt } = makeService([inv({ id: 'doc_1', amountResidual: 10_000 })]);

    const result = await service.collect({ studentProfileId: 'stu_1', amount: 25_000, paymentMethod: 'cash' });

    expect(createReceipt.mock.calls[0][0].allocations).toEqual([{ documentId: 'doc_1', amount: 10_000 }]);
    expect(result.unallocated).toBe(15_000);
  });

  it('passes an empty allocation list when nothing is open (family carries credit)', async () => {
    const { service, createReceipt } = makeService([]);

    const result = await service.collect({ studentProfileId: 'stu_1', amount: 10_000, paymentMethod: 'cash' });

    expect(createReceipt).toHaveBeenCalledTimes(1);
    expect(createReceipt.mock.calls[0][0].allocations).toEqual([]);
    expect(result.unallocated).toBe(10_000);
  });
});

describe('SchoolPaymentService.collect — delegation details', () => {
  it('routes a bank payment to its bank GL account (no cash-drawer movement)', async () => {
    const { service, createReceipt } = makeService([inv({ id: 'doc_1', amountResidual: 50_000 })]);

    await service.collect({
      studentProfileId: 'stu_1',
      amount: 50_000,
      paymentMethod: 'bank',
      bankAccountId: 'acc_bank',
    });

    expect(createReceipt.mock.calls[0][0].accountId).toBe('acc_bank');
  });

  it('omits accountId for cash so the CashMovement path stays live', async () => {
    const { service, createReceipt } = makeService([inv({ id: 'doc_1', amountResidual: 50_000 })]);

    await service.collect({
      studentProfileId: 'stu_1',
      amount: 50_000,
      paymentMethod: 'cash',
      cashSessionId: 'sess_1',
    });

    const dto = createReceipt.mock.calls[0][0];
    expect(dto.accountId).toBeUndefined();
    expect(dto.cashSessionId).toBe('sess_1');
  });

  it('replays an existing payment for a duplicate reference instead of collecting twice', async () => {
    const prior = { id: 'pay_prior', unallocatedAmount: 0, allocations: [{ documentId: 'doc_1', amount: 50_000 }] };
    const { service, createReceipt } = makeService([], prior);

    const result = await service.collect({
      studentProfileId: 'stu_1',
      amount: 50_000,
      paymentMethod: 'mobile_money',
      reference: 'MM-TXN-123',
    });

    expect(result.replayed).toBe(true);
    expect(result.payment).toBe(prior);
    expect(createReceipt).not.toHaveBeenCalled();
  });

  it('emits a school fee-payment event per allocation', async () => {
    const { service, events } = makeService([
      inv({ id: 'doc_old', amountResidual: 30_000, issueDate: new Date('2026-01-01') }),
      inv({ id: 'doc_new', amountResidual: 80_000, issueDate: new Date('2026-02-01') }),
    ]);

    await service.collect({ studentProfileId: 'stu_1', amount: 50_000, paymentMethod: 'cash' });

    const feeEvents = events.publish.mock.calls.filter((c) => c[0] === 'school.fee.payment.recorded');
    expect(feeEvents).toHaveLength(2);
  });
});
