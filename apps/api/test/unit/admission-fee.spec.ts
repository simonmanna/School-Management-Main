/**
 * Admission fee on the canonical financial path: charge posts an invoice to the
 * GL, payment goes through PaymentService, waiver voids the invoice, and the
 * enrollment gate reads settlement from the invoice — never from a flag.
 */
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AdmissionFeeService } from '../../src/modules/school/admissions/admission-fee.service';

const D = (n: number) => new Prisma.Decimal(n);

function make(app: any, doc: any = null) {
  const tx = {
    admissionApplication: {
      findFirst: jest.fn().mockResolvedValue(app),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    admissionFee: { upsert: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    contact: { findFirst: jest.fn().mockResolvedValue({ partnerId: 'partner_guardian' }) },
    document: {
      findFirst: jest.fn(async (args: any) => {
        if (args?.include?.lines) {
          return { id: 'doc_new', documentNumber: 'INV-1', partnerId: 'partner_guardian', totalAmount: D(50_000), lines: [] };
        }
        return doc;
      }),
      update: jest.fn(async (args: any) => ({ id: args.where.id, documentNumber: 'INV-1', ...args.data })),
    },
  };
  const prisma = { client: { $transaction: jest.fn(async (fn: any) => fn(tx)), ...tx } };
  const documentBuilder = {
    createDocument: jest.fn().mockResolvedValue({ id: 'doc_new' }),
    salesPostingLines: jest.fn().mockResolvedValue([
      { accountId: 'ar', debit: '50000' },
      { accountId: 'rev', credit: '50000' },
    ]),
  };
  const payments = { createReceipt: jest.fn().mockResolvedValue({ id: 'pay_1', paymentNumber: 'PAY-1' }) };
  const posting = { post: jest.fn().mockResolvedValue({ id: 'je_1' }), reverse: jest.fn().mockResolvedValue({ id: 'je_rev' }) };
  const resolver = { ensureByCode: jest.fn().mockResolvedValue('acc_adm_rev') };
  const svc = new AdmissionFeeService(
    prisma as any,
    { recordInTx: jest.fn() } as any,
    { publish: jest.fn(), publishInTx: jest.fn(async () => undefined), subscribe: jest.fn() } as any,
    documentBuilder as any,
    payments as any,
    posting as any,
    resolver as any,
  );
  return { svc, tx, documentBuilder, payments, posting };
}

const app = {
  id: 'app_1',
  status: 'under_review',
  organizationId: 'org',
  applicationNumber: 'APP-1',
  applicantFirstName: 'A',
  applicantLastName: 'B',
  parentContactId: 'contact_1',
  feeStatus: 'unpaid',
  feeInvoiceId: null,
};

describe('AdmissionFeeService · charge', () => {
  it("posts a sales invoice to the GL, billed to the guardian's Partner", async () => {
    const { svc, documentBuilder, posting, tx } = make(app);
    const res = await svc.charge('app_1', { amount: 50_000 });
    expect(res.invoiceId).toBe('doc_new');
    expect(documentBuilder.createDocument).toHaveBeenCalledWith(
      tx,
      'sales_invoice',
      expect.objectContaining({ partnerId: 'partner_guardian', sourceType: 'school_admission_fee' }),
      [expect.objectContaining({ accountId: 'acc_adm_rev', unitPrice: 50_000 })],
    );
    expect(posting.post).toHaveBeenCalledWith(
      expect.objectContaining({ journalCode: 'SALES', sourceType: 'school_admission_fee_invoice' }),
      tx,
    );
    expect(tx.document.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'posted', journalEntryId: 'je_1' }) }),
    );
  });

  it('refuses an application with no guardian contact', async () => {
    const { svc } = make({ ...app, parentContactId: null });
    await expect(svc.charge('app_1', { amount: 50_000 })).rejects.toThrow(BadRequestException);
  });

  it.each(['rejected', 'withdrawn', 'enrolled'])('refuses a %s application', async (status) => {
    const { svc } = make({ ...app, status });
    await expect(svc.charge('app_1', { amount: 50_000 })).rejects.toThrow(BadRequestException);
  });

  it('voids an unpaid previous invoice before re-charging', async () => {
    const prior = { id: 'doc_old', documentNumber: 'INV-0', status: 'posted', amountPaid: D(0), journalEntryId: 'je_old' };
    const { svc, posting } = make({ ...app, feeInvoiceId: 'doc_old' }, prior);
    await svc.charge('app_1', { amount: 50_000 });
    expect(posting.reverse).toHaveBeenCalledWith('je_old', expect.anything(), expect.anything());
  });

  it('refuses to re-charge a fee that has money against it', async () => {
    const prior = { id: 'doc_old', documentNumber: 'INV-0', status: 'posted', amountPaid: D(10_000), journalEntryId: 'je_old' };
    const { svc } = make({ ...app, feeInvoiceId: 'doc_old' }, prior);
    await expect(svc.charge('app_1', { amount: 50_000 })).rejects.toThrow(/cannot be re-charged/);
  });
});

describe('AdmissionFeeService · pay', () => {
  const posted = { id: 'doc_1', partnerId: 'partner_guardian', status: 'posted', amountResidual: D(50_000), amountPaid: D(0) };

  it('takes payment through the payment engine, allocated to the fee invoice', async () => {
    const { svc, payments, tx } = make({ ...app, feeStatus: 'pending', feeInvoiceId: 'doc_1' }, posted);
    await svc.pay('app_1', { paymentMethod: 'cash' });
    expect(payments.createReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        partnerId: 'partner_guardian',
        amount: 50_000,
        allocations: [{ documentId: 'doc_1', amount: 50_000 }],
      }),
      tx,
    );
  });

  it('refuses more than is outstanding', async () => {
    const { svc } = make({ ...app, feeStatus: 'pending', feeInvoiceId: 'doc_1' }, posted);
    await expect(svc.pay('app_1', { amount: 60_000 })).rejects.toThrow(/exceeds the outstanding fee/);
  });

  it('refuses when no fee was charged', async () => {
    const { svc } = make(app, null);
    await expect(svc.pay('app_1', {})).rejects.toThrow(/No application fee has been charged/);
  });
});

describe('AdmissionFeeService · waive', () => {
  it('voids the unpaid invoice rather than flagging it paid', async () => {
    const doc = { id: 'doc_1', documentNumber: 'INV-1', status: 'posted', amountPaid: D(0), journalEntryId: 'je_1' };
    const { svc, posting, tx } = make({ ...app, feeStatus: 'pending', feeInvoiceId: 'doc_1' }, doc);
    const res = await svc.waive('app_1', 'Sibling');
    expect(res.feeStatus).toBe('waived');
    expect(posting.reverse).toHaveBeenCalledWith('je_1', expect.anything(), tx);
    expect(tx.document.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'cancelled' }) }),
    );
  });

  it('refuses to waive a fee money was received against', async () => {
    const doc = { id: 'doc_1', documentNumber: 'INV-1', status: 'posted', amountPaid: D(20_000), journalEntryId: 'je_1' };
    const { svc } = make({ ...app, feeStatus: 'pending', feeInvoiceId: 'doc_1' }, doc);
    await expect(svc.waive('app_1')).rejects.toThrow(/Reverse or refund the payment/);
  });
});

describe('AdmissionFeeService · isSettled (enrollment gate)', () => {
  const client = (doc: any) => ({ document: { findFirst: jest.fn().mockResolvedValue(doc) } });
  const { svc } = make(app);

  it('reads settlement from the invoice residual, not a flag', async () => {
    const appPaidFlag = { feeStatus: 'paid', feeInvoiceId: 'doc_1' };
    expect(await svc.isSettled(client({ status: 'posted', amountResidual: D(1) }), appPaidFlag)).toBe(false);
    expect(await svc.isSettled(client({ status: 'paid', amountResidual: D(0) }), appPaidFlag)).toBe(true);
  });

  it('treats a waived fee as settled and an uncharged school as unblocked', async () => {
    expect(await svc.isSettled(client(null), { feeStatus: 'waived', feeInvoiceId: 'doc_1' })).toBe(true);
    expect(await svc.isSettled(client(null), { feeStatus: 'unpaid', feeInvoiceId: null })).toBe(true);
  });
});
