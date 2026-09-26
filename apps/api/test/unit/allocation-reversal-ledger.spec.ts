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
      findFirst: jest.fn(async (_a?: any) => ({
        id: 'doc_1', documentNumber: 'INV-1', partnerId: 'p_1', amountResidual: D(0), amountPaid: D(300), totalAmount: D(300), status: 'paid',
      })),
      update: jest.fn(async () => ({})),
      // Reallocation targets: open fee invoices of the same payer (re-audit #7).
      findMany: jest.fn(async (a: any) => (a?.where?.id?.in ?? []).map((id: string) => ({ id }))),
    },
    payment: {
      findFirst: jest.fn(async () => ({ id: 'pay_1', status: 'posted', paymentNumber: 'RCPT-1', journalEntryId: 'je_receipt', unallocatedAmount: D(500) })),
      update: jest.fn(async () => ({})),
    },
    cashMovement: { findMany: jest.fn(async () => []), create: jest.fn() },
    feeCredit: { findMany: jest.fn(async () => [] as any[]), updateMany: jest.fn(async () => ({ count: 1 })) },
    feeCreditAllocation: { findMany: jest.fn(async () => [] as any[]), update: jest.fn(async () => ({})) },
    documentLine: { create: jest.fn(async () => ({})) },
  };
  const prisma = { client: { $transaction: jest.fn(async (fn: any) => fn(tx)) } };
  const tenant = { organizationId: 'org_1', userId: 'u_1' };
  const audit = { recordInTx: jest.fn(async () => undefined) };
  const events = { publish: jest.fn() };
  const posting = { post: jest.fn(async (_entry: any, _tx?: any) => ({ id: 'je_x' })), reverse: jest.fn(async () => ({ id: 'je_rev' })) };
  const accounts = { receivableAccount: jest.fn(async () => 'acc_ar'), mapped: jest.fn(async () => 'acc_cash') };
  const payments = { allocateExisting: jest.fn(async () => []) };
  const controls = { assertDocumentsPeriodOpen: jest.fn(async () => undefined) };
  const resolver = { ensureByCode: jest.fn(async () => 'acc_fee_credit') };
  const sequence = { next: jest.fn(async () => 'REC-000001') };
  const dmsTypes = { resolveIdByCode: jest.fn(async () => 'dt_sales_invoice') };
  const svc = new PaymentAllocationReversalService(
    prisma as any, tenant as any, audit as any, events as any, posting as any, accounts as any, payments as any, controls as any,
    resolver as any, sequence as any, dmsTypes as any,
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

  it('reallocate refuses a document that is not an open fee invoice of the same payer (re-audit #7)', async () => {
    const { svc, payments, tx } = makeService();
    tx.payment.findFirst.mockResolvedValue({ id: 'pay_1', partnerId: 'p_1', unallocatedAmount: D(500) });
    tx.document.findMany.mockResolvedValueOnce([]);
    await expect(
      svc.reallocate('pay_1', [{ documentId: 'cancelled_doc', amount: 100 }], 'wrong target'),
    ).rejects.toThrow(/Only open fee invoices of the same payer/);
    expect(payments.allocateExisting).not.toHaveBeenCalled();
  });

  it('reversePayment reverses the receipt journal exactly once and posts nothing else (F2)', async () => {
    const { svc, posting } = makeService();
    await svc.reversePayment('pay_1', 'cheque bounced');
    expect(posting.reverse).toHaveBeenCalledTimes(1);
    expect(posting.reverse).toHaveBeenCalledWith('je_receipt', expect.anything(), expect.anything());
    expect(posting.post).not.toHaveBeenCalled();
  });

  /* ── Re-audit #3 P0-2: a bounced receipt also unwinds what it funded ── */

  const bounced = { id: 'pay_1', status: 'posted', direction: 'inbound', partnerId: 'p_1', paymentNumber: 'RCPT-1', journalEntryId: 'je_receipt' };

  it('voids an unspent credit funded by the reversed receipt (Dr Liability / Cr AR)', async () => {
    const { svc, tx, posting } = makeService();
    // 500 received: 300 allocated, 200 converted to credit CR-1 (unspent).
    tx.payment.findFirst.mockResolvedValue({ ...bounced, amount: D(500), unallocatedAmount: D(0) });
    tx.feeCredit.findMany.mockResolvedValue([{ id: 'cr_1', code: 'CR-1', amount: D(200), remaining: D(200) }]);
    const res: any = await svc.reversePayment('pay_1', 'cheque bounced');
    const voidPost = (posting.post.mock.calls as any[][]).find((c) => c[0].sourceType === 'school_fee_credit_void');
    expect(voidPost).toBeDefined();
    expect(voidPost![0].lines[0]).toMatchObject({ accountId: 'acc_fee_credit', debit: '200' });
    expect(voidPost![0].lines[1]).toMatchObject({ accountId: 'acc_ar', credit: '200', partnerId: 'p_1' });
    expect(tx.feeCredit.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'reversed', remaining: D(0) }) }),
    );
    expect(tx.document.create).toBeUndefined(); // nothing was paid out, so no recovery charge
    expect(res.voidedCredits).toBe(1);
    expect(res.recoveryDocumentId).toBeNull();
  });

  it('re-opens the invoice a funded credit already settled', async () => {
    const { svc, tx, posting } = makeService();
    tx.payment.findFirst.mockResolvedValue({ ...bounced, amount: D(500), unallocatedAmount: D(0) });
    tx.feeCredit.findMany.mockResolvedValue([{ id: 'cr_1', code: 'CR-1', amount: D(200), remaining: D(50) }]);
    tx.feeCreditAllocation.findMany.mockResolvedValue([{ id: 'fca_1', documentId: 'doc_2', amount: D(150) }]);
    const original = tx.document.findFirst.getMockImplementation()!;
    tx.document.findFirst.mockImplementation(async (a: any) =>
      a?.where?.id === 'doc_2'
        ? { id: 'doc_2', documentNumber: 'INV-2', amountResidual: D(0), amountPaid: D(0), totalAmount: D(150), status: 'paid' }
        : original(a),
    );
    await svc.reversePayment('pay_1', 'cheque bounced');
    expect(tx.document.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'doc_2' }, data: expect.objectContaining({ amountResidual: D(150), status: 'posted' }) }),
    );
    expect(tx.feeCreditAllocation.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'reversed' }) }));
    const voidPost = (posting.post.mock.calls as any[][]).find((c) => c[0].sourceType === 'school_fee_credit_void');
    expect(voidPost![0].lines[0]).toMatchObject({ debit: '200' }); // remaining 50 + drawn 150
  });

  it('raises a recovery charge for cash already refunded out of the reversed receipt (D2)', async () => {
    const { svc, tx } = makeService();
    // 500 received, 300 allocated, the other 200 refunded in cash (unallocated drawn to 0, no credit).
    tx.payment.findFirst.mockResolvedValue({ ...bounced, amount: D(500), unallocatedAmount: D(0) });
    (tx.document as any).create = jest.fn(async (a: any) => ({ id: 'rec_doc', ...a.data }));
    const res: any = await svc.reversePayment('pay_1', 'cheque bounced');
    expect(tx.document.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sourceType: 'school_payment_recovery', partnerId: 'p_1', totalAmount: D(200), amountResidual: D(200) }),
      }),
    );
    expect(res.recoveryAmount).toBe('200');
  });

  it('refuses to reverse a refund payout as never received', async () => {
    const { svc, tx } = makeService();
    tx.payment.findFirst.mockResolvedValue({ ...bounced, direction: 'outbound', amount: D(200) });
    await expect(svc.reversePayment('pay_1', 'oops')).rejects.toThrow(/Only a receipt can be reversed/);
  });

  it('aborts when a funded credit changed under it', async () => {
    const { svc, tx } = makeService();
    tx.payment.findFirst.mockResolvedValue({ ...bounced, amount: D(500), unallocatedAmount: D(0) });
    tx.feeCredit.findMany.mockResolvedValue([{ id: 'cr_1', code: 'CR-1', amount: D(200), remaining: D(200) }]);
    tx.feeCredit.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.reversePayment('pay_1', 'cheque bounced')).rejects.toThrow(/changed while this payment was being reversed/);
  });
});
