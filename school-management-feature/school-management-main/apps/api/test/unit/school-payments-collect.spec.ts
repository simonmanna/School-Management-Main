/**
 * Unit tests for SchoolPaymentService.collect (P0-1).
 *
 * Bug: the auto-allocation filter at billing.service.ts:397 was
 *   paymentStatus: { in: ['partial', 'paid'] }
 * which excludes freshly-posted invoices (paymentStatus='not_paid').
 * Result: a parent paying school fees without `documentIds` had their
 * payment post to the GL, but the invoice stayed unpaid and the
 * `unallocated` field carried the full amount.
 *
 * Fix: include 'not_paid' in the filter so fresh invoices are matched
 * and reduced to 'partial' or 'paid' as appropriate.
 */
import { SchoolPaymentService } from '../../src/modules/school/fees/billing.service';

interface Mocks {
  documentFindMany: jest.Mock;
  paymentCreate: jest.Mock;
  paymentUpdateMany: jest.Mock;
  paymentAllocationCreate: jest.Mock;
  documentUpdateMany: jest.Mock;
  events: { publish: jest.Mock };
  sequence: { next: jest.Mock };
  posting: { post: jest.Mock };
  determination: { mapped: jest.Mock; receivableAccount: jest.Mock };
  tx: any;
}

function makeService() {
  const tenant = { organizationId: 'org_test' };
  const events = { publish: jest.fn() };
  const sequence = { next: jest.fn().mockResolvedValue('PAY-2026-000001') };
  const posting = { post: jest.fn().mockResolvedValue({ id: 'je_1' }) };
  const determination = {
    mapped: jest.fn().mockResolvedValue('acc_cash'),
    receivableAccount: jest.fn().mockResolvedValue('acc_ar'),
  };

  const documentFindMany = jest.fn();
  const documentUpdateMany = jest.fn();
  const paymentCreate = jest.fn().mockImplementation((args: any) => ({
    id: 'pay_1',
    ...args.data,
  }));
  const paymentUpdateMany = jest.fn();
  const paymentAllocationCreate = jest.fn();
  const paymentFindFirst = jest.fn().mockResolvedValue({
    id: 'pay_1',
    allocations: [],
  });

  const tx = {
    studentProfile: { findFirst: jest.fn().mockResolvedValue({ id: 'stu_1', partnerId: 'p_1' }) },
    partner: { findFirst: jest.fn().mockResolvedValue({ id: 'p_1' }) },
    document: { findMany: documentFindMany, updateMany: documentUpdateMany },
    payment: { create: paymentCreate, updateMany: paymentUpdateMany, findFirst: paymentFindFirst },
    paymentAllocation: { create: paymentAllocationCreate },
  };

  const prisma = {
    client: {
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    },
  };

  const service = new SchoolPaymentService(
    prisma as any,
    tenant as any,
    events as any,
    sequence as any,
    posting as any,
    determination as any,
  );

  const mocks: Mocks = {
    documentFindMany,
    paymentCreate,
    paymentUpdateMany,
    paymentAllocationCreate,
    documentUpdateMany,
    events,
    sequence,
    posting,
    determination,
    tx,
  };

  return { service, mocks };
}

describe('SchoolPaymentService.collect — auto-allocation filter (P0-1)', () => {
  it('queries open invoices with paymentStatus in [not_paid, partial] (excludes paid)', async () => {
    const { service, mocks } = makeService();
    mocks.documentFindMany.mockResolvedValue([]);

    await service.collect({
      studentProfileId: 'stu_1',
      amount: 50_000,
      paymentMethod: 'cash',
    });

    expect(mocks.documentFindMany).toHaveBeenCalledTimes(1);
    const callArgs = mocks.documentFindMany.mock.calls[0][0];
    expect(callArgs.where.paymentStatus).toEqual({ in: ['not_paid', 'partial'] });
    // A 'paid' invoice should not be re-matched.
    expect(callArgs.where.paymentStatus.in).not.toContain('paid');
  });

  it('still includes sourceType filter for school invoices', async () => {
    const { service, mocks } = makeService();
    mocks.documentFindMany.mockResolvedValue([]);

    await service.collect({
      studentProfileId: 'stu_1',
      amount: 50_000,
      paymentMethod: 'cash',
    });

    const callArgs = mocks.documentFindMany.mock.calls[0][0];
    expect(callArgs.where.sourceType).toEqual({
      in: ['school_fee', 'school_penalty', 'library_fine'],
    });
    expect(callArgs.where.amountResidual).toEqual({ gt: 0 });
  });

  it('allocates a not_paid invoice and reduces its residual', async () => {
    const { service, mocks } = makeService();
    mocks.documentFindMany.mockResolvedValue([
      {
        id: 'doc_1',
        organizationId: 'org_test',
        partnerId: 'p_1',
        documentType: 'sales_invoice',
        paymentStatus: 'not_paid',
        sourceType: 'school_fee',
        amountResidual: 100_000,
        amountPaid: 0,
        issueDate: new Date('2026-01-15'),
      },
    ]);

    const result = await service.collect({
      studentProfileId: 'stu_1',
      amount: 40_000,
      paymentMethod: 'cash',
    });

    // Allocation row written for 40,000.
    expect(mocks.paymentAllocationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          documentId: 'doc_1',
          amount: 40_000,
        }),
      }),
    );

    // Document updated to amountPaid=40_000, amountResidual=60_000, paymentStatus=partial.
    expect(mocks.documentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'doc_1' },
        data: expect.objectContaining({
          amountPaid: 40_000,
          amountResidual: 60_000,
          paymentStatus: 'partial',
        }),
      }),
    );

    // Payment fully allocated.
    expect(result.unallocated).toBe(0);
    expect(result.allocations).toEqual([{ documentId: 'doc_1', amount: 40_000 }]);
  });

  it('partially pays multiple not_paid invoices oldest-first', async () => {
    const { service, mocks } = makeService();
    mocks.documentFindMany.mockResolvedValue([
      {
        id: 'doc_old',
        paymentStatus: 'not_paid',
        sourceType: 'school_fee',
        amountResidual: 30_000,
        amountPaid: 0,
        issueDate: new Date('2026-01-01'),
      },
      {
        id: 'doc_new',
        paymentStatus: 'not_paid',
        sourceType: 'school_fee',
        amountResidual: 80_000,
        amountPaid: 0,
        issueDate: new Date('2026-02-01'),
      },
    ]);

    const result = await service.collect({
      studentProfileId: 'stu_1',
      amount: 50_000,
      paymentMethod: 'cash',
    });

    // 30,000 to doc_old, 20,000 to doc_new.
    const amounts = mocks.paymentAllocationCreate.mock.calls.map(
      (c) => c[0]?.data?.amount,
    );
    expect(amounts).toEqual([30_000, 20_000]);
    expect(result.unallocated).toBe(0);
  });

  it('skips allocation entirely when no open invoices match', async () => {
    const { service, mocks } = makeService();
    mocks.documentFindMany.mockResolvedValue([]);

    const result = await service.collect({
      studentProfileId: 'stu_1',
      amount: 10_000,
      paymentMethod: 'cash',
    });

    expect(mocks.paymentAllocationCreate).not.toHaveBeenCalled();
    expect(result.allocations).toEqual([]);
    // The payment still posts, with the full amount unallocated (the family has credit).
    expect(result.unallocated).toBe(10_000);
  });
});
