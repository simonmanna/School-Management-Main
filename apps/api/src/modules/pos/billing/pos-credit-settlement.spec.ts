/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Credit settlement — the "pay later" invariant.
 *
 * A credit sale must collect NOTHING: no Payment row, no cash movement, no
 * second GL entry. The bill was already booked `Dr AR / Cr Revenue+Tax` when
 * the invoice was generated, so settling on credit only flags the invoice and
 * leaves it unpaid until somebody actually pays.
 *
 * Also covers credit control: `Partner.creditHold` blocks, and the limit is
 * read from `Partner.creditLimit` first (falling back to the older
 * `CustomerTab.creditLimit`) so a limit set in the back office is honoured.
 */
import { BadRequestException } from '@nestjs/common';
import { PosInvoiceService } from './pos-invoice.service';
import { resolveCreditStatus } from './credit-status';

const CREDIT_INVOICE = {
  id: 'inv-1',
  invoiceNumber: 'INV-2026-0001',
  partnerId: 'p-1',
  status: 'posted',
  paymentStatus: 'not_paid',
  paymentMode: null,
  settlementStatus: 'unsettled',
  totalAmount: '150',
  amountPaid: '0',
  amountResidual: 150,
};

function mockPrisma(overrides: { partner?: any; tab?: any; outstanding?: number } = {}): any {
  const client: any = {
    $queryRawUnsafe: jest.fn(),
    order: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn(), updateMany: jest.fn() },
    posTableOrder: { updateMany: jest.fn() },
    invoice: {
      findFirst: jest.fn().mockResolvedValue({ ...CREDIT_INVOICE }),
      update: jest.fn().mockResolvedValue({}),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amountResidual: overrides.outstanding ?? 0 } }),
    },
    invoiceItem: { findMany: jest.fn().mockResolvedValue([]) },
    receipt: { create: jest.fn().mockResolvedValue({ id: 'rcpt-1' }) },
    receiptItem: { createMany: jest.fn() },
    partner: {
      findFirst: jest.fn().mockResolvedValue(
        overrides.partner === undefined ? { creditLimit: 0, creditHold: false } : overrides.partner,
      ),
    },
    customerTab: { findFirst: jest.fn().mockResolvedValue(overrides.tab ?? null) },
    payment: { create: jest.fn() },
    cashMovement: { create: jest.fn() },
  };
  client.$transaction = jest.fn((cb: any) => cb(client));
  return { client };
}

function makeService(prisma: any) {
  const payments = { createReceipt: jest.fn() };
  const posting = { post: jest.fn() };
  const events = { publish: jest.fn() };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const svc = new PosInvoiceService(
    prisma as any,
    { organizationId: 'org-1', userId: 'u-1' } as any,
    audit as any,
    events as any,
    { prepareLines: jest.fn(), groupForPosting: jest.fn() } as any,
    { next: jest.fn().mockResolvedValue('RCT-000001') } as any,
    payments as any,
    posting as any,
    { mapped: jest.fn() } as any,
    { issue: jest.fn(), receive: jest.fn() } as any,
    { mode: jest.fn().mockResolvedValue('none'), reserve: jest.fn(), release: jest.fn(), consume: jest.fn() } as any,
    {} as any, // receipts
    { assertCanOverride: jest.fn() } as any,
    { recordSynchronousOverride: jest.fn() } as any,
    { transition: jest.fn().mockResolvedValue({}) } as any,
    { resolveEnum: jest.fn().mockResolvedValue('at_invoice') } as any,
  );
  return { svc, payments, posting, events, audit };
}

describe('settleCredit — nothing is collected', () => {
  it('leaves the invoice unpaid, on account, with the full balance outstanding', async () => {
    const prisma = mockPrisma();
    const { svc } = makeService(prisma);

    const result = await svc.settleCredit('inv-1', { partnerId: 'p-1' });

    expect(prisma.client.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv-1' },
        data: expect.objectContaining({ paymentMode: 'credit', settlementStatus: 'unsettled' }),
      }),
    );
    // The invoice is NOT marked paid and its balance is untouched: `status`,
    // `paymentStatus`, `amountPaid` and `amountResidual` are all absent from the
    // update, so they keep their posted / not_paid / 0 / total values.
    const data = prisma.client.invoice.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('status');
    expect(data).not.toHaveProperty('paymentStatus');
    expect(data).not.toHaveProperty('amountPaid');
    expect(data).not.toHaveProperty('amountResidual');
    expect(result).toMatchObject({ settlementStatus: 'unsettled', paymentMode: 'credit' });
  });

  it('writes no Payment and posts no journal entry', async () => {
    const prisma = mockPrisma();
    const { svc, payments, posting } = makeService(prisma);

    await svc.settleCredit('inv-1');

    // AR was booked at invoice generation; settling on credit adds nothing.
    expect(payments.createReceipt).not.toHaveBeenCalled();
    expect(posting.post).not.toHaveBeenCalled();
    expect(prisma.client.payment.create).not.toHaveBeenCalled();
    expect(prisma.client.cashMovement.create).not.toHaveBeenCalled();
  });

  it('issues a credit-issue receipt, not a payment receipt', async () => {
    const prisma = mockPrisma();
    const { svc } = makeService(prisma);

    await svc.settleCredit('inv-1');

    expect(prisma.client.receipt.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'credit_issue_receipt', paymentId: null }) }),
    );
  });

  it('refuses an invoice that is already on account', async () => {
    const prisma = mockPrisma();
    prisma.client.invoice.findFirst.mockResolvedValue({ ...CREDIT_INVOICE, paymentMode: 'credit' });
    const { svc } = makeService(prisma);

    await expect(svc.settleCredit('inv-1')).rejects.toThrow(BadRequestException);
  });

  it('refuses an invoice with nothing left to owe', async () => {
    const prisma = mockPrisma();
    prisma.client.invoice.findFirst.mockResolvedValue({ ...CREDIT_INVOICE, amountResidual: 0 });
    const { svc } = makeService(prisma);

    await expect(svc.settleCredit('inv-1')).rejects.toThrow(BadRequestException);
  });
});

describe('credit control', () => {
  it('blocks a customer on credit hold', async () => {
    const prisma = mockPrisma({ partner: { creditLimit: 0, creditHold: true } });
    const { svc } = makeService(prisma);

    await expect(svc.settleCredit('inv-1')).rejects.toThrow(/credit hold/i);
    expect(prisma.client.invoice.update).not.toHaveBeenCalled();
  });

  it('prefers Partner.creditLimit over the legacy CustomerTab limit', async () => {
    // Partner allows 1,000 while the old tab row says 100. The 150 sale must be
    // allowed: the back-office field is the one that counts.
    const prisma = mockPrisma({
      partner: { creditLimit: 1000, creditHold: false },
      tab: { creditLimit: 100 },
    });
    const { svc } = makeService(prisma);

    await expect(svc.settleCredit('inv-1')).resolves.toMatchObject({ paymentMode: 'credit' });
  });

  it('falls back to the CustomerTab limit when the partner has none', async () => {
    const prisma = mockPrisma({
      partner: { creditLimit: 0, creditHold: false },
      tab: { creditLimit: 100 },
    });
    const { svc } = makeService(prisma);

    await expect(svc.settleCredit('inv-1')).rejects.toThrow(/credit limit exceeded/i);
  });

  it('rejects a sale that would push the customer past their limit', async () => {
    const prisma = mockPrisma({
      partner: { creditLimit: 200, creditHold: false },
      outstanding: 100, // 100 already owed + 150 now = 250 > 200
    });
    const { svc } = makeService(prisma);

    await expect(svc.settleCredit('inv-1')).rejects.toThrow(/credit limit exceeded/i);
  });

  it('allows a sale that exactly reaches the limit', async () => {
    const prisma = mockPrisma({
      partner: { creditLimit: 250, creditHold: false },
      outstanding: 100, // 100 + 150 = 250, exactly the limit
    });
    const { svc } = makeService(prisma);

    await expect(svc.settleCredit('inv-1')).resolves.toMatchObject({ paymentMode: 'credit' });
  });

  it('treats a zero limit as unlimited', async () => {
    const prisma = mockPrisma({ partner: { creditLimit: 0, creditHold: false }, outstanding: 999_999 });
    const { svc } = makeService(prisma);

    await expect(svc.settleCredit('inv-1')).resolves.toMatchObject({ paymentMode: 'credit' });
  });
});

describe('resolveCreditStatus', () => {
  it('reports headroom against the effective limit', async () => {
    const prisma = mockPrisma({ partner: { creditLimit: 500, creditHold: false }, outstanding: 120 });

    const status = await resolveCreditStatus(prisma.client, 'org-1', 'p-1');

    expect(status).toEqual({ creditLimit: 500, outstanding: 120, available: 380, creditHold: false });
  });

  it('reports null availability when there is no limit', async () => {
    const prisma = mockPrisma({ partner: { creditLimit: 0, creditHold: false }, outstanding: 120 });

    const status = await resolveCreditStatus(prisma.client, 'org-1', 'p-1');

    expect(status).toMatchObject({ creditLimit: 0, outstanding: 120, available: null });
  });

  it('never reports negative headroom', async () => {
    const prisma = mockPrisma({ partner: { creditLimit: 100, creditHold: false }, outstanding: 250 });

    const status = await resolveCreditStatus(prisma.client, 'org-1', 'p-1');

    expect(status.available).toBe(0);
  });
});
