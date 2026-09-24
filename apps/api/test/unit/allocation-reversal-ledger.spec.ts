import { Prisma } from '@prisma/client';
import { PaymentAllocationReversalService } from '../../src/modules/school/fees/allocation-reversal.service';

/**
 * E2E audit F2 / F3 / F6 — allocation reversal is ledger-neutral.
 *
 * A receipt credits AR for its whole amount when it is taken; allocating it to
 * an invoice posts nothing. So un-allocating posts nothing either — the value
 * returns to the receipt's unallocated pot and `GL AR = residual − unallocated`
 * still holds. It used to post Dr AR / Cr Cash, which:
 *   F2  double-counted a payment reversal (per-allocation leg + receipt reversal),
 *   F3  moved cash in the GL on every reallocation although none left the drawer,
 *   F6  kept a refund of an allocated payment from seeing the freed value.
 */
const D = (n: number) => new Prisma.Decimal(n);

function makeService() {
  const alloc = {
    id: 'al_1',
    paymentId: 'pay_1',
    documentId: 'doc_1',
    amount: D(300),
    status: 'posted',
    payment: { allocatedAmount: D(300), unallocatedAmount: D(200), accountId: 'acc_cash', paymentMethod: 'cash' },
  };
  const tx: any = {
    paymentAllocation: {
      findFirst: jest.fn(async () => alloc),
      findMany: jest.fn(async () => [alloc]),
      update: jest.fn(async () => ({})),
    },
    paymentAllocationReversal: { create: jest.fn(async (a: any) => ({ id: 'rev_1', ...a.data })), findFirst: jest.fn() },
    document: {
      findFirst: jest.fn(async () => ({
        id: 'doc_1', documentNumber: 'INV-1', partnerId: 'p_1', amountResidual: D(0), amountPaid: D(300), totalAmount: D(300), status: 'paid',
      })),
      update: jest.fn(async () => ({})),
    },
    payment: {
      findFirst: jest.fn(async () => ({ id: 'pay_1', status: 'posted', paymentNumber: 'RCPT-1', journalEntryId: 'je_receipt', unallocatedAmount: D(500) })),
      update: jest.fn(async () => ({})),
    },
    cashMovement: { findMany: jest.fn(async () => []), create: jest.fn() },
  };
  const prisma = { client: { $transaction: jest.fn(async (fn: any) => fn(tx)) } };
  const tenant = { organizationId: 'org_1', userId: 'u_1' };
  const audit = { recordInTx: jest.fn(async () => undefined) };
  const events = { publish: jest.fn() };
  const posting = { post: jest.fn(async () => ({ id: 'je_x' })), reverse: jest.fn(async () => ({ id: 'je_rev' })) };
  const accounts = { receivableAccount: jest.fn(async () => 'acc_ar'), mapped: jest.fn(async () => 'acc_cash') };
  const payments = { allocateExisting: jest.fn(async () => []) };
  const controls = { assertDocumentsPeriodOpen: jest.fn(async () => undefined) };
  const svc = new PaymentAllocationReversalService(
    prisma as any, tenant as any, audit as any, events as any, posting as any, accounts as any, payments as any, controls as any,
  );
  return { svc, tx, posting, payments };
}

describe('PaymentAllocationReversalService — ledger', () => {
  it('reverseAllocation posts no journal and returns the value to the unallocated pot', async () => {
    const { svc, tx, posting } = makeService();
    await svc.reverseAllocation('al_1', 'wrong invoice');
    expect(posting.post).not.toHaveBeenCalled();
    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay_1' },
      data: { allocatedAmount: D(0), unallocatedAmount: D(500) },
    });
    expect(tx.document.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amountResidual: D(300), amountPaid: D(0) }) }),
    );
  });

  it('reallocate moves value between invoices without touching the GL (F3)', async () => {
    const { svc, posting, payments, tx } = makeService();
    tx.payment.findFirst.mockResolvedValue({ id: 'pay_1', unallocatedAmount: D(500) });
    await svc.reallocate('pay_1', [{ documentId: 'doc_2', amount: 300 }], 'keyed to the wrong sibling');
    expect(posting.post).not.toHaveBeenCalled();
    expect(posting.reverse).not.toHaveBeenCalled();
    expect(payments.allocateExisting).toHaveBeenCalled();
  });

  it('reversePayment reverses the receipt journal exactly once and posts nothing else (F2)', async () => {
    const { svc, posting } = makeService();
    await svc.reversePayment('pay_1', 'cheque bounced');
    expect(posting.reverse).toHaveBeenCalledTimes(1);
    expect(posting.reverse).toHaveBeenCalledWith('je_receipt', expect.anything(), expect.anything());
    expect(posting.post).not.toHaveBeenCalled();
  });
});
