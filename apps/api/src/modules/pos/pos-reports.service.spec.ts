/* eslint-disable @typescript-eslint/no-explicit-any */
import { PosReportsService } from './pos-reports.service';

function mockPrisma(): any {
  return {
    client: {
      cashSession: { findFirst: jest.fn() },
      cashMovement: { findMany: jest.fn().mockResolvedValue([]) },
      invoice: { findMany: jest.fn().mockResolvedValue([]) },
      document: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { findMany: jest.fn().mockResolvedValue([]) },
      product: { findMany: jest.fn().mockResolvedValue([]) },
      paymentAllocation: { findMany: jest.fn().mockResolvedValue([]) },
      posReportSnapshot: { upsert: jest.fn(), findFirst: jest.fn() },
      invoiceItem: { groupBy: jest.fn().mockResolvedValue([]) },
      documentLine: { groupBy: jest.fn().mockResolvedValue([]) },
    },
  };
}

describe('PosReportsService (financial accuracy)', () => {
  const orgId = 'org-1';
  let prisma: any;
  let svc: PosReportsService;

  beforeEach(() => {
    prisma = mockPrisma();
    const tenant = { organizationId: orgId, userId: 'u1' } as any;
    const audit = { record: jest.fn() } as any;
    const events = { publish: jest.fn() } as any;
    svc = new PosReportsService(prisma, tenant, audit, events);
  });

  describe('xReport', () => {
    beforeEach(() => {
      prisma.client.cashSession.findFirst.mockResolvedValue({
        id: 's1', cashRegisterId: 'r1', userId: 'u1', openedAt: new Date('2026-06-01T08:00:00Z'),
        openingFloat: '100', status: 'open',
      });
      prisma.client.cashMovement.findMany.mockResolvedValue([
        { movementType: 'sale', amount: '50' },   // cash sale into drawer
        { movementType: 'pay_in', amount: '20' },
      ]);
      prisma.client.invoice.findMany.mockResolvedValue([
        { status: 'paid', totalAmount: '118', subtotal: '100', taxAmount: '18', discountTotal: '0', paymentMode: 'cash', items: [{ productId: 'p1', quantity: '1', total: '118' }] },
        { status: 'paid', totalAmount: '59', subtotal: '50', taxAmount: '9', discountTotal: '0', paymentMode: 'card', items: [{ productId: 'p1', quantity: '1', total: '59' }] },
        { status: 'refunded', totalAmount: '10', subtotal: '8', taxAmount: '2', discountTotal: '0', paymentMode: 'cash', items: [] },
      ]);
      prisma.client.product.findMany.mockResolvedValue([
        { id: 'p1', name: 'Coffee', category: { id: 'c1', name: 'Drinks' } },
      ]);
    });

    it('counts ALL tenders as sales (card sales are not invisible)', async () => {
      const r = await svc.xReport('s1');
      const methods = r.byMethod.map((m) => m.method).sort();
      expect(methods).toEqual(['card', 'cash']); // card present → not cash-only
      expect(r.totals.saleCount).toBe(2);
    });

    it('reports net revenue ex-tax, gross, tax and discounts', async () => {
      const r = await svc.xReport('s1');
      expect(r.totals.netRevenue).toBe('150.00');  // 100 + 50
      expect(r.totals.grossSales).toBe('177.00');  // 118 + 59
      expect(r.totals.taxTotal).toBe('27.00');     // 18 + 9
    });

    it('derives expected cash from the drawer, not from card sales', async () => {
      const r = await svc.xReport('s1');
      // opening 100 + cash collected 50 − cash refunds 0 + pay-ins 20 − pay-outs 0
      expect(r.totals.cashCollected).toBe('50.00');
      expect(r.totals.expectedCash).toBe('170.00');
    });
  });

  describe('salesSummary', () => {
    beforeEach(() => {
      prisma.client.invoice.findMany.mockResolvedValue([
        { id: 'i1', subtotal: '100', totalAmount: '118', discountTotal: '5', taxAmount: '18', status: 'paid', createdAt: new Date('2026-06-01T10:00:00Z') },
        { id: 'i2', subtotal: '8', totalAmount: '10', discountTotal: '0', taxAmount: '2', status: 'refunded', createdAt: new Date('2026-06-01T11:00:00Z') },
      ]);
      prisma.client.paymentAllocation.findMany.mockResolvedValue([
        { amount: '118', invoiceId: 'i1', payment: { paymentMethod: 'cash', direction: 'inbound' } },
        { amount: '10', invoiceId: 'i2', payment: { paymentMethod: 'cash', direction: 'outbound' } }, // refund
      ]);
    });

    it('reports revenue NET of tax and nets out refunds', async () => {
      const r = await svc.salesSummary('2026-06-01', '2026-06-01', 'day');
      expect(r.totals.revenue).toBe('100.00');    // net, ex-tax, refund excluded
      expect(r.totals.grossSales).toBe('118.00');
      expect(r.totals.refunds).toBe('10.00');
      expect(r.totals.netSales).toBe('108.00');   // 118 − 10
      expect(r.totals.taxes).toBe('18.00');
      expect(r.totals.orders).toBe(1);
    });

    it('byMethod uses allocation amount and excludes refund (outbound) payments', async () => {
      const r = await svc.salesSummary('2026-06-01', '2026-06-01', 'day');
      expect(r.byMethod).toHaveLength(1);
      expect(r.byMethod[0]).toMatchObject({ method: 'cash', count: 1, total: '118.00' });
    });

    it('reads POS sales from the Invoice table (R2 migration) and scopes by tenant + date range', async () => {
      // POS Sprint 1 (F1) retired the legacy Document-based sales path — POS
      // sales now live exclusively on the Invoice table. This assertion
      // verifies the report reads from Invoice with the correct tenant scope
      // and the supplied date range, and never reaches for Document.findMany.
      await svc.salesSummary('2026-06-01', '2026-06-01', 'day');
      const invoiceCalls = prisma.client.invoice.findMany.mock.calls;
      expect(invoiceCalls.length).toBeGreaterThan(0);
      const where = invoiceCalls[0][0].where;
      expect(where.organizationId).toBe(orgId);
      expect(where.createdAt).toEqual({ gte: expect.any(Date), lte: expect.any(Date) });
      expect(prisma.client.document.findMany).not.toHaveBeenCalled();
    });
  });
});
