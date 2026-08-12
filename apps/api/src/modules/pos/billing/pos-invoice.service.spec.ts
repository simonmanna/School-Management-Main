/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PosInvoiceService } from './pos-invoice.service';

function mockPrisma(): any {
  // One shared `client` object doubles as the interactive-tx handle: $transaction
  // passes the same object back, so a test that stubs `client.invoice.findFirst`
  // also stubs what the code reads via `tx.invoice.findFirst`. $queryRawUnsafe is
  // the FOR UPDATE row lock used by the atomic receivePayment (P0-2).
  const client: any = {
    $queryRawUnsafe: jest.fn(),
    order: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn(), updateMany: jest.fn(), count: jest.fn().mockResolvedValue(0) },
    orderItem: { findMany: jest.fn().mockResolvedValue([]) },
    invoice: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
    invoiceItem: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
    invoiceItemModifier: { createMany: jest.fn() },
    receipt: { create: jest.fn().mockResolvedValue({ id: 'rcpt-1' }) },
    receiptItem: { createMany: jest.fn() },
    accountMapping: { findFirst: jest.fn() },
    posTable: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
    cashSession: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  client.$transaction = jest.fn((cb: any) => cb(client));
  return { client };
}

describe('PosInvoiceService', () => {
  const orgId = 'test-org';
  const userId = 'test-user';
  let prisma: any;
  let tenant: any;
  let svc: PosInvoiceService;
  let mockPosting: any;
  let mockDetermination: any;
  let mockBuilder: any;
  let mockSequence: any;
  let mockPayments: any;
  let mockStock: any;
  /** ADR-007 state machine. The definition itself is covered by pos.workflows.spec.ts. */
  let mockWorkflows: any;

  beforeEach(() => {
    prisma = mockPrisma();
    tenant = { organizationId: orgId, userId };
    mockBuilder = { prepareLines: jest.fn(), groupForPosting: jest.fn() };
    mockSequence = { next: jest.fn().mockResolvedValue('INV-2026-0001') };
    mockPayments = { createReceipt: jest.fn() };
    mockPosting = { post: jest.fn() };
    mockDetermination = { mapped: jest.fn() };
    mockStock = { issue: jest.fn(), receive: jest.fn() };
    mockWorkflows = { transition: jest.fn().mockResolvedValue({ fromState: 'confirmed', toState: 'completed' }) };
    svc = new PosInvoiceService(
      prisma as any,
      tenant as any,
      {} as any, // audit
      {} as any, // events
      mockBuilder as any,
      mockSequence as any,
      mockPayments as any,
      mockPosting as any,
      mockDetermination as any,
      mockStock as any,
      // reservations — ATP holds are advisory; mode() returning 'none' keeps
      // every reservation call a no-op in these unit tests.
      { mode: jest.fn().mockResolvedValue('none'), reserve: jest.fn(), release: jest.fn(), consume: jest.fn() } as any,
      {} as any, // receipts
      { assertCanOverride: jest.fn() } as any, // overrides
      { recordSynchronousOverride: jest.fn() } as any, // approvals
      mockWorkflows as any,
      // settings resolver — default posting policy is at_invoice.
      { resolveEnum: jest.fn().mockResolvedValue('at_invoice') } as any,
    );
  });

  describe('storeCreditAccountId', () => {
    it('returns the mapped account when mapping exists', async () => {
      prisma.client.accountMapping.findFirst.mockResolvedValue({ key: 'store_credit', accountId: 'sc-acc-1' });
      const result = await (svc as any).storeCreditAccountId();
      expect(result).toBe('sc-acc-1');
    });

    it('throws BadRequestException when mapping is missing', async () => {
      prisma.client.accountMapping.findFirst.mockResolvedValue(null);
      await expect((svc as any).storeCreditAccountId()).rejects.toThrow(BadRequestException);
    });
  });

  describe('postInvoiceGl', () => {
    const mockInvoice = {
      id: 'inv-1', invoiceNumber: 'INV-001', partnerId: 'p-1',
      totalAmount: '100', issueDate: new Date(), paymentMode: 'cash',
    };
    const mockItems = [{ id: 'li-1', accountId: 'rev-acc', total: 80 }];

    beforeEach(() => {
      mockBuilder.groupForPosting.mockResolvedValue({
        counterAccount: 'ar-acc',
        itemByAccount: [['rev-acc', 80]],
        taxByAccount: [['tax-acc', 20]],
      });
      mockPosting.post.mockResolvedValue({ id: 'je-1' });
    });

    it('uses AR counter-account when paymentMode is credit', async () => {
      const inv = { ...mockInvoice, paymentMode: 'credit' };
      await (svc as any).postInvoiceGl(prisma.client, inv, mockItems);
      const lines = mockPosting.post.mock.calls[0][0].lines;
      expect(lines[0].accountId).toBe('ar-acc'); // AR
    });

    it('uses cash counter-account when paymentMode is cash', async () => {
      mockDetermination.mapped.mockResolvedValue('cash-acc');
      await (svc as any).postInvoiceGl(prisma.client, mockInvoice, mockItems);
      const lines = mockPosting.post.mock.calls[0][0].lines;
      expect(lines[0].accountId).toBe('cash-acc');
      expect(mockDetermination.mapped).toHaveBeenCalledWith('default_cash', expect.anything());
    });

    it('uses AR counter-account when paymentMode is null (default)', async () => {
      const inv = { ...mockInvoice, paymentMode: null };
      mockDetermination.mapped.mockResolvedValue('cash-acc');
      await (svc as any).postInvoiceGl(prisma.client, inv, mockItems);
      const lines = mockPosting.post.mock.calls[0][0].lines;
      expect(lines[0].accountId).toBe('ar-acc');
      expect(mockDetermination.mapped).not.toHaveBeenCalled();
    });

    it('posts with SALES journal code', async () => {
      await (svc as any).postInvoiceGl(prisma.client, mockInvoice, mockItems);
      expect(mockPosting.post.mock.calls[0][0].journalCode).toBe('SALES');
    });
  });

  describe('receivePayment', () => {
    const mockInvoice = {
      id: 'inv-1', invoiceNumber: 'INV-001', partnerId: 'p-1',
      totalAmount: '100', amountResidual: 100, status: 'posted',
      paymentMode: 'cash', settlementStatus: 'unsettled',
    };

    beforeEach(() => {
      prisma.client.invoice.findFirst.mockResolvedValue(mockInvoice);
      prisma.client.accountMapping.findFirst.mockResolvedValue({ key: 'store_credit', accountId: 'sc-acc' });
      mockPayments.createReceipt.mockResolvedValue({ id: 'pay-1' });
    });

    it('records a payment with skipGlPosting for cash mode', async () => {
      await svc.receivePayment('inv-1', { paymentMethod: 'cash', amountTendered: 100 });
      expect(mockPayments.createReceipt).toHaveBeenCalledWith(
        expect.objectContaining({ skipGlPosting: true, paymentMethod: 'cash' }),
        expect.anything(), // tx — payment joins the settlement transaction (P0-2)
        expect.anything(), // opts (allowSessionOwnerMismatch)
      );
    });

    it('does not skip GL posting for credit mode', async () => {
      prisma.client.invoice.findFirst.mockResolvedValue({ ...mockInvoice, paymentMode: 'credit' });
      await svc.receivePayment('inv-1', { paymentMethod: 'cash', amountTendered: 100 });
      expect(mockPayments.createReceipt).toHaveBeenCalledWith(
        expect.objectContaining({ skipGlPosting: false }),
        expect.anything(),
        expect.anything(), // opts (allowSessionOwnerMismatch)
      );
    });

    it('uses store_credit account for store credit tender', async () => {
      await svc.receivePayment('inv-1', {
        tenders: [{ method: 'store_credit', amount: 100 }],
      });
      expect(mockPayments.createReceipt).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: 'sc-acc' }),
        expect.anything(),
        expect.anything(), // opts (allowSessionOwnerMismatch)
      );
    });

    it('returns the cash change when the customer over-tenders', async () => {
      // Bill 100, cash handed over 150 → tender leg 100 (covers the bill), change 50.
      const res = await svc.receivePayment('inv-1', {
        tenders: [{ method: 'cash', amount: 100 }],
        amountTendered: 150,
      });
      expect(res.change).toBe(50);
    });

    it('rejects a second settlement once the invoice is fully paid (P0-2 lock)', async () => {
      prisma.client.invoice.findFirst.mockResolvedValue({ ...mockInvoice, amountResidual: 0 });
      await expect(
        svc.receivePayment('inv-1', { paymentMethod: 'cash', amountTendered: 100 }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPayments.createReceipt).not.toHaveBeenCalled();
    });
  });

  describe('generateInvoice — order↔invoice binding', () => {
    /**
     * P1 regression. The binding (`Order.invoiceId` + status → `completed`) used
     * to run POST-COMMIT and only when `externalTx` was absent. Rental checkout
     * (rental-posting.service.ts) supplies a tx, so its orders never had
     * `invoiceId` written by this service — which silently broke
     * `closeOrderForInvoice`, because that looks orders up BY `invoiceId`.
     * Both paths must now bind inside the invoice transaction.
     */
    beforeEach(() => {
      // The no-externalTx path runs post-commit side effects (audit + domain
      // event); the outer suite stubs both collaborators as `{}`.
      (svc as any).events = { publish: jest.fn() };
      (svc as any).audit = { record: jest.fn(), recordInTx: jest.fn() };
      prisma.client.order.findFirst.mockResolvedValue({
        id: 'ord-1', organizationId: orgId, orderNumber: 'ORD-1', status: 'confirmed',
        invoiceId: null, partnerId: 'p-1', transactionDiscountPercent: 0,
        transactionDiscountType: 'percentage', transactionDiscountAmount: 0,
      });
      prisma.client.orderItem.findMany.mockResolvedValue([
        { id: 'oi-1', description: 'Latte', quantity: 1, unitPrice: 100, discountPercent: 0, modifiers: [] },
      ]);
      prisma.client.stockPostingJob = { create: jest.fn() };
      mockBuilder.prepareLines.mockResolvedValue({
        prepared: [{ description: 'Latte', quantity: 1, unitPrice: 100, total: 100 }],
        subtotal: 100, discountTotal: 0, taxAmount: 0, total: 100,
      });
      mockBuilder.groupForPosting.mockResolvedValue({
        counterAccount: 'ar-acc', itemByAccount: [['rev-acc', 100]], taxByAccount: [],
      });
      mockPosting.post.mockResolvedValue({ id: 'je-1' });
      prisma.client.invoice.create.mockResolvedValue({
        id: 'inv-9', invoiceNumber: 'INV-2026-0001', partnerId: 'p-1',
        totalAmount: '100', issueDate: new Date(), paymentMode: null,
      });
      prisma.client.invoice.findFirst.mockResolvedValue({
        id: 'inv-9', invoiceNumber: 'INV-2026-0001', totalAmount: '100', partnerId: 'p-1', items: [],
      });
      prisma.client.invoiceItem.create.mockResolvedValue({ id: 'ii-1' });
    });

    /** `invoiceId` is written directly; the status half goes through the engine. */
    const expectBound = () => {
      expect(prisma.client.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ord-1' },
          data: expect.objectContaining({ invoiceId: 'inv-9' }),
        }),
      );
      expect(mockWorkflows.transition).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: 'order', entityId: 'ord-1', action: 'complete' }),
      );
    };

    it('binds the order to the invoice when the caller owns the transaction', async () => {
      await svc.generateInvoice('ord-1');
      expectBound();
    });

    it('binds the order to the invoice when a caller supplies externalTx (rental path)', async () => {
      // The mock client doubles as the interactive-tx handle, so passing it is
      // exactly what rental checkout does.
      await svc.generateInvoice('ord-1', {}, prisma.client);
      expectBound();
    });

    it('runs the completion transition inside the caller transaction, not a nested one', async () => {
      await svc.generateInvoice('ord-1', {}, prisma.client);
      expect(mockWorkflows.transition).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'complete', externalTx: prisma.client }),
      );
    });

    it('does not open its own transaction when externalTx is supplied', async () => {
      await svc.generateInvoice('ord-1', {}, prisma.client);
      expect(prisma.client.$transaction).not.toHaveBeenCalled();
    });
  });
});
