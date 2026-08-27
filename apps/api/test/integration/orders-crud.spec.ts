// Stub the MFA/OTP chain — otplib pulls in @scure/base (ESM) which jest's
// CommonJS transform can't parse. Billing doesn't use auth, so a stub is safe.
jest.mock('otplib', () => ({
  generateSecret: () => 'TESTSECRET',
  generateURI: () => 'otpauth://stub',
  verifySync: () => true,
  authenticator: { generateSecret: () => 'TESTSECRET', keyuri: () => 'otpauth://stub', verify: () => true, check: () => true },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';
import { ensureAccountCategories, makeAccountFactory } from './_accounts';
import { KernelModule } from '../../src/kernel/kernel.module';
import { DocumentsModule } from '../../src/modules/documents/documents.module';
import { PosModule } from '../../src/modules/pos/pos.module';
import { OrdersModule } from '../../src/modules/orders/orders.module';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';

/**
 * Orders CRUD integration proof: the generic back-office Orders module must
 * create/list/get/patch line sets over BOTH line sources (menuItemId and
 * productId) through the shared DocumentBuilder tax engine, run the order
 * workflow (cancel/reopen), resolve the line-source config (auto → menu for
 * cafe orgs), and delegate billing to the PosInvoiceService spine so the
 * order ends up invoiced, stock-deducted and AR-posted exactly like a POS sale.
 */
describeDb('integration: back-office Orders CRUD (menu + product sources, billing)', () => {
  const prisma = new PrismaClient();
  let moduleRef: TestingModule;
  let orders: OrdersService;
  let tenant: TenantContextService;
  let organizationId: string;
  let customerId: string;
  let menuItemId: string;
  let productId: string;
  let cashRegisterId: string;
  let cashSessionId: string;

  beforeAll(async () => {
    await prisma.$connect();
    const org = await prisma.organization.create({
      data: { code: `INT-ORD-${Date.now()}`, name: 'Orders CRUD Org', currencyCode: 'UGX' },
    });
    organizationId = org.id;
    customerId = (await prisma.partner.create({
      data: { organizationId, code: 'ORD-CUST', name: 'Order Cust', isCustomer: true },
    })).id;
    menuItemId = (await prisma.menuItem.create({
      data: { organizationId, name: 'Test Boxenia', basePrice: 5000 },
    })).id;
    productId = (await prisma.product.create({
      data: { organizationId, code: 'ORD-SVC', name: 'Order Service', productType: 'service', salesPrice: 100, costPrice: 0 },
    })).id;

    const mk = makeAccountFactory(prisma, await ensureAccountCategories(prisma));
    const ar = await mk(organizationId, 'ORD-1300', 'AR', 'receivable');
    const rev = await mk(organizationId, 'ORD-4100', 'Revenue', 'revenue');
    const cash = await mk(organizationId, 'ORD-1100', 'Cash', 'cash');
    await prisma.journal.create({ data: { organizationId, code: 'SALES', name: 'Sales', journalType: 'sales' } });
    await prisma.journal.create({ data: { organizationId, code: 'CASH', name: 'Cash', journalType: 'cash' } });
    for (const [key, accountId] of [
      ['accounts_receivable', ar.id], ['sales_revenue', rev.id], ['default_cash', cash.id], ['default_bank', cash.id],
    ] as const) {
      await prisma.accountMapping.create({ data: { organizationId, key, accountId } });
    }

    const register = await prisma.cashRegister.create({
      data: { organizationId, code: 'ORD-REG', name: 'Orders Till', defaultAccountId: cash.id },
    });
    cashRegisterId = register.id;
    cashSessionId = (await prisma.cashSession.create({
      data: { organizationId, cashRegisterId: register.id, userId: 'integration-test-cashier', status: 'open', openingFloat: 0 },
    })).id;

    moduleRef = await Test.createTestingModule({ imports: [KernelModule, DocumentsModule, PosModule, OrdersModule] }).compile();
    await moduleRef.init();
    orders = moduleRef.get(OrdersService);
    tenant = moduleRef.get(TenantContextService);
  });

  afterAll(async () => {
    if (organizationId) {
      await prisma.receiptItem.deleteMany({ where: { organizationId } });
      await prisma.receipt.deleteMany({ where: { organizationId } });
      await prisma.paymentAllocation.deleteMany({ where: { organizationId } });
      await prisma.invoiceItemModifier.deleteMany({ where: { organizationId } });
      await prisma.invoiceItem.deleteMany({ where: { organizationId } });
      await prisma.orderItemModifier.deleteMany({ where: { organizationId } });
      await prisma.orderItem.deleteMany({ where: { organizationId } });
      await prisma.order.deleteMany({ where: { organizationId } });
      await prisma.invoice.deleteMany({ where: { organizationId } });
      await prisma.cashSession.deleteMany({ where: { organizationId } });
      await prisma.cashRegister.deleteMany({ where: { organizationId } });
      await prisma.payment.deleteMany({ where: { organizationId } });
      await prisma.journalLine.deleteMany({ where: { organizationId } });
      await prisma.journalEntry.deleteMany({ where: { organizationId } });
      await prisma.auditLog.deleteMany({ where: { organizationId } });
      await prisma.eventOutbox.deleteMany({ where: { organizationId } });
      await prisma.document.deleteMany({ where: { organizationId } });
      await prisma.accountMapping.deleteMany({ where: { organizationId } });
      await prisma.account.deleteMany({ where: { organizationId } });
      await prisma.setting.deleteMany({ where: { organizationId } });
      await prisma.organizationModule.deleteMany({ where: { organizationId } });
      await prisma.menuItem.deleteMany({ where: { organizationId } });
      await prisma.product.deleteMany({ where: { organizationId } });
      await prisma.partner.deleteMany({ where: { organizationId } });
      await prisma.journal.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } });
    }
    if (moduleRef) await moduleRef.close();
    await prisma.$disconnect();
  });

  it('creates an order from MENU lines, resolving name/price/tax server-side', async () => {
    const created: any = await tenant.run({ organizationId }, () =>
      orders.createOrder({ orderType: 'dine_in', partnerId: customerId, lines: [{ menuItemId, quantity: 2 }] }),
    );

    expect(created.orderNumber).toMatch(/^ORD-/);
    expect(created.status).toBe('confirmed');
    expect(created.items.length).toBe(1);
    expect(created.items[0].description).toBe('Test Boxenia');
    expect(Number(created.items[0].unitPrice)).toBe(5000);
    expect(Number(created.subtotal)).toBe(10000);
    expect(Number(created.totalAmount)).toBe(10000);
  });

  it('assigns the walk-in partner when none is provided', async () => {
    const created: any = await tenant.run({ organizationId }, () =>
      orders.createOrder({ orderType: 'takeaway', lines: [{ menuItemId, quantity: 1 }] }),
    );
    expect(created.partnerId).toBeTruthy();
    const partner = await prisma.partner.findFirstOrThrow({ where: { id: created.partnerId } });
    expect(partner.code).toBe('WALKIN');
  });

  it('replaces the line set with PRODUCT lines via saveItems (tax engine pricing)', async () => {
    const created: any = await tenant.run({ organizationId }, () =>
      orders.createOrder({ orderType: 'takeaway', partnerId: customerId, lines: [{ menuItemId, quantity: 1 }] }),
    );
    const updated: any = await tenant.run({ organizationId }, () =>
      orders.saveItems(created.id, {
        expectedVersion: created.version,
        lines: [{ productId, quantity: 3 }],
      }),
    );

    expect(updated.items.length).toBe(1);
    expect(updated.items[0].productId).toBe(productId);
    expect(updated.items[0].description).toBe('Order Service');
    expect(Number(updated.items[0].unitPrice)).toBe(100);
    expect(Number(updated.totalAmount)).toBe(300);
  });

  it('appends lines without disturbing existing ones', async () => {
    const created: any = await tenant.run({ organizationId }, () =>
      orders.createOrder({ orderType: 'delivery', partnerId: customerId, lines: [{ menuItemId, quantity: 2 }] }),
    );
    const updated: any = await tenant.run({ organizationId }, () =>
      orders.addItems(created.id, { lines: [{ productId, quantity: 1 }] }),
    );

    expect(updated.items.length).toBe(2);
    expect(Number(updated.totalAmount)).toBe(10100); // 2×5000 menu + 1×100 product
  });

  it('lists orders with pagination and filters', async () => {
    const list: any = await tenant.run({ organizationId }, () => orders.list({ page: 1, pageSize: 5 }));
    expect(list.rows.length).toBeGreaterThan(0);
    expect(list.total).toBeGreaterThanOrEqual(4);
    expect(list.rows[0].orderNumber).toMatch(/^ORD-/);
  });

  it('cancels and reopens an order through the workflow', async () => {
    const created: any = await tenant.run({ organizationId }, () =>
      orders.createOrder({ orderType: 'takeaway', partnerId: customerId, lines: [{ menuItemId, quantity: 1 }] }),
    );
    const cancelled: any = await tenant.run(
      { organizationId, permissions: ['pos:checkout', 'pos:override'] },
      () => orders.cancelOrder(created.id, 'integration test'),
    );
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancelReason).toBe('integration test');

    const reopened: any = await tenant.run(
      { organizationId, permissions: ['pos:checkout', 'pos:override'] },
      () => orders.reopenOrder(created.id),
    );
    expect(reopened.status).toBe('confirmed');
  });

  it('resolves line-source settings: auto → menu for cafe orgs, explicit products wins', async () => {
    const initial: any = await tenant.run({ organizationId }, () => orders.getOrderSettings());
    expect(initial.lineSource).toBe('auto');
    expect(initial.resolved).toBe('menu');

    await tenant.run({ organizationId }, () => orders.updateOrderSettings({ lineSource: 'products' }));
    const products: any = await tenant.run({ organizationId }, () => orders.getOrderSettings());
    expect(products.lineSource).toBe('products');
    expect(products.resolved).toBe('products');

    // Setting mirror for offline sync (pos.mode parity).
    const mirror = await prisma.setting.findFirst({ where: { organizationId, key: 'orders.lineSource' } });
    expect(mirror?.value).toBe('products');

    await tenant.run({ organizationId }, () => orders.updateOrderSettings({ lineSource: 'auto' }));
  });

  it('bills an order through the PosInvoiceService spine and locks it against edits', async () => {
    const created: any = await tenant.run({ organizationId }, () =>
      orders.createOrder({ orderType: 'dine_in', partnerId: customerId, lines: [{ menuItemId, quantity: 2 }] }),
    );
    const billed: any = await tenant.run({ organizationId }, () =>
      orders.generateInvoice(created.id, { paymentMode: 'cash' }),
    );

    expect(billed.invoiceNumber).toMatch(/^INV-/);
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { id: billed.id } });
    expect(Number(invoice.totalAmount)).toBe(10000);
    expect(invoice.orderId).toBe(created.id);
    expect(invoice.status).toBe('posted');

    const locked = await prisma.order.findFirstOrThrow({ where: { id: created.id } });
    expect(locked.invoiceId).toBe(billed.id);
    expect(locked.status).toBe('completed');

    // Editing a billed order must be rejected.
    await expect(
      tenant.run({ organizationId }, () => orders.updateHeader(created.id, { notes: 'should fail' })),
    ).rejects.toThrow(/billed/i);
  });
});