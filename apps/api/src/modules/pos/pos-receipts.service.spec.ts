/* eslint-disable @typescript-eslint/no-explicit-any */
import { PosReceiptsService } from './pos-receipts.service';

describe('PosReceiptsService', () => {
  const orgId = 'test-org';
  let prisma: any;
  let tenant: any;
  let svc: PosReceiptsService;

  beforeEach(() => {
    prisma = {
      client: {
        invoice: { findFirst: jest.fn() },
        invoiceItem: { findMany: jest.fn() },
        order: { findFirst: jest.fn() },
        document: { findFirst: jest.fn() },
        documentLine: { findMany: jest.fn() },
        partner: { findFirst: jest.fn() },
        product: { findMany: jest.fn() },
        receipt: { create: jest.fn() },
        receiptItem: { createMany: jest.fn() },
      },
    };
    tenant = { organizationId: orgId };
    svc = new PosReceiptsService(
      prisma as any,
      tenant as any,
      {} as any, // audit
      {} as any, // notifications
      {} as any, // settings
      {} as any, // printLifecycle
    );
  });

  describe('resolveInvoice', () => {
    it('returns Invoice data when record exists in Invoice table', async () => {
      prisma.client.invoice.findFirst.mockResolvedValue({
        id: 'inv-1', invoiceNumber: 'INV-001', partnerId: 'p-1',
        totalAmount: '100', items: [
          { id: 'li-1', productId: 'prod-1', description: 'Coffee', quantity: '2', unitPrice: '50', total: '100', lineNumber: 1 },
        ],
      });
      prisma.client.partner.findFirst.mockResolvedValue({ id: 'p-1', name: 'Alice' });
      prisma.client.product.findMany.mockResolvedValue([{ id: 'prod-1', name: 'Coffee', sku: 'CF-01' }]);

      const result = await svc.resolveInvoice('inv-1');
      expect(result).toBeTruthy();
      expect(result.id).toBe('inv-1');
      expect(result.partner!.name).toBe('Alice');
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0].product?.name).toBe('Coffee');
      expect(prisma.client.order.findFirst).not.toHaveBeenCalled();
    });

    it('falls back to the open tab Order when no Invoice record exists', async () => {
      prisma.client.invoice.findFirst.mockResolvedValue(null);
      prisma.client.order.findFirst.mockResolvedValue({
        id: 'ord-1', orderNumber: 'ORD-001', partnerId: 'p-2',
        totalAmount: '200', openedAt: new Date(), createdAt: new Date(),
        items: [
          { id: 'oi-1', productId: 'prod-2', description: 'Tea', quantity: '1', unitPrice: '200', discountPercent: '0', modifiers: [] },
        ],
      });
      prisma.client.partner.findFirst.mockResolvedValue({ id: 'p-2', name: 'Bob' });
      prisma.client.product.findMany.mockResolvedValue([{ id: 'prod-2', name: 'Tea', sku: 'TE-01' }]);

      const result = await svc.resolveInvoice('ord-1');
      expect(result.id).toBe('ord-1');
      expect(result.documentNumber).toBe('ORD-001');
      expect(result.partner!.name).toBe('Bob');
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0].product?.name).toBe('Tea');
    });

    it('throws NotFoundException when neither table has the record', async () => {
      prisma.client.invoice.findFirst.mockResolvedValue(null);
      prisma.client.order.findFirst.mockResolvedValue(null);
      await expect(svc.resolveInvoice('missing')).rejects.toThrow();
    });
  });
});
