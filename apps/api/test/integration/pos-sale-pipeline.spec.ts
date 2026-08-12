// Stub the MFA/OTP chain — otplib pulls in @scure/base (ESM) which jest's
// CommonJS transform can't parse. Checkout doesn't use auth, so a stub is safe.
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
import { PosModule } from '../../src/modules/pos/pos.module';
import { PosService } from '../../src/modules/pos/pos.service';
import { PosOrdersService } from '../../src/modules/pos/order/pos-orders.service';
import { PosReceiptsService } from '../../src/modules/pos/pos-receipts.service';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';

/**
 * R2 proof: a counter sale must persist through the Order → Invoice → Receipt
 * pipeline (NOT Document). Runs the real PosService.checkout() against a fresh
 * org and asserts every table is populated and the GL is balanced.
 */
describeDb('integration: POS sale → Order → Invoice → Receipt', () => {
  const prisma = new PrismaClient();
  let moduleRef: TestingModule;
  let pos: PosService;
  let tenant: TenantContextService;
  let organizationId: string;
  let customerId: string;
  let productId: string;
  let cashRegisterId: string;
  let cashSessionId: string;

  beforeAll(async () => {
    await prisma.$connect();
    const org = await prisma.organization.create({ data: { code: `INT-POS-${Date.now()}`, name: 'POS Pipeline Org', currencyCode: 'UGX' } });
    organizationId = org.id;
    customerId = (await prisma.partner.create({ data: { organizationId, code: 'POS-CUST', name: 'Pipeline Cust', isCustomer: true } })).id;
    productId = (await prisma.product.create({ data: { organizationId, code: 'POS-SVC', name: 'Coffee', productType: 'service', salesPrice: 100, costPrice: 0 } })).id;

    const mk = makeAccountFactory(prisma, await ensureAccountCategories(prisma));
    const ar = await mk(organizationId, 'POS-1300', 'AR', 'receivable');
    const rev = await mk(organizationId, 'POS-4100', 'Revenue', 'revenue');
    const cash = await mk(organizationId, 'POS-1100', 'Cash', 'cash');
    await prisma.journal.create({ data: { organizationId, code: 'SALES', name: 'Sales', journalType: 'sales' } });
    await prisma.journal.create({ data: { organizationId, code: 'CASH', name: 'Cash', journalType: 'cash' } });
    for (const [key, accountId] of [
      ['accounts_receivable', ar.id], ['sales_revenue', rev.id], ['default_cash', cash.id], ['default_bank', cash.id],
    ] as const) {
      await prisma.accountMapping.create({ data: { organizationId, key, accountId } });
    }

    // Cash and mobile-money tenders now require an open shift (PosService
    // .requireCashSession). This spec predates that control, so it checked out
    // against no session at all and failed before reaching a single assertion.
    const register = await prisma.cashRegister.create({
      data: { organizationId, code: 'POS-REG', name: 'Till 1', defaultAccountId: cash.id },
    });
    cashRegisterId = register.id;
    cashSessionId = (
      await prisma.cashSession.create({
        data: {
          organizationId,
          cashRegisterId: register.id,
          userId: 'integration-test-cashier',
          status: 'open',
          openingFloat: 0,
        },
      })
    ).id;

    moduleRef = await Test.createTestingModule({ imports: [KernelModule, PosModule] }).compile();
    await moduleRef.init();
    pos = moduleRef.get(PosService);
    tenant = moduleRef.get(TenantContextService);
  });

  afterAll(async () => {
    if (organizationId) {
      await prisma.documentPrintLog.deleteMany({ where: { organizationId } });
      await prisma.receiptItem.deleteMany({ where: { organizationId } });
      await prisma.receipt.deleteMany({ where: { organizationId } });
      await prisma.paymentAllocation.deleteMany({ where: { organizationId } });
      await prisma.invoiceItemModifier.deleteMany({ where: { organizationId } });
      await prisma.invoiceItem.deleteMany({ where: { organizationId } });
      await prisma.orderItemModifier.deleteMany({ where: { organizationId } });
      await prisma.orderItem.deleteMany({ where: { organizationId } });
      await prisma.order.deleteMany({ where: { organizationId } });
      await prisma.invoice.deleteMany({ where: { organizationId } });
      await prisma.cashMovement.deleteMany({ where: { organizationId } });
      // Sessions reference the register, and the register references an Account,
      // so both must go before the accounts are deleted below.
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
      await prisma.product.deleteMany({ where: { organizationId } });
      await prisma.partner.deleteMany({ where: { organizationId } });
      await prisma.journal.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } });
    }
    if (moduleRef) await moduleRef.close();
    await prisma.$disconnect();
  });

  it('checkout writes Order + Invoice + InvoiceItem + Receipt + ReceiptItem and posts balanced GL (no Document)', async () => {
    const result: any = await tenant.run({ organizationId }, async () =>
      pos.checkout({
        partnerId: customerId,
        lines: [{ productId, description: 'Coffee', quantity: 2, unitPrice: 100 }],
        tenders: [{ method: 'cash', amount: 200 }],
      }),
    );

    expect(result.invoiceId).toBeTruthy();
    expect(result.invoiceNumber).toMatch(/^INV-/);
    expect(result.orderNumber).toMatch(/^ORD-/);

    // Invoice + items.
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { id: result.invoiceId }, include: { items: true } });
    expect(invoice.items.length).toBe(1);
    expect(Number(invoice.totalAmount)).toBe(200);
    expect(Number(invoice.amountResidual)).toBe(0);
    expect(invoice.status).toBe('paid');
    expect(invoice.settlementStatus).toBe('settled');

    // Receipt + receipt items.
    const receipts = await prisma.receipt.findMany({ where: { invoiceId: invoice.id }, include: { items: true } });
    expect(receipts.length).toBeGreaterThanOrEqual(1);
    expect(receipts[0].items.length).toBe(1);
    expect(receipts.some((r) => r.type === 'payment_receipt')).toBe(true);

    // Order closed.
    const order = await prisma.order.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    expect(order.status).toBe('closed');

    // No Document sales_invoice for this sale.
    const docCount = await prisma.document.count({ where: { organizationId, documentType: 'sales_invoice' } });
    expect(docCount).toBe(0);

    // GL: balanced pos_invoice entry + payment allocation against the invoice.
    const je = await prisma.journalEntry.findFirstOrThrow({ where: { organizationId, sourceType: 'pos_invoice', sourceId: invoice.id }, include: { lines: true } });
    const dr = je.lines.reduce((s, l) => s + Number(l.baseDebit), 0);
    const cr = je.lines.reduce((s, l) => s + Number(l.baseCredit), 0);
    expect(Math.abs(dr - cr)).toBeLessThan(0.001);
    const alloc = await prisma.paymentAllocation.findFirst({ where: { invoiceId: invoice.id } });
    expect(alloc).toBeTruthy();

    // Receipt printing fired (counter incremented + a print-log row keyed to the Invoice).
    const printedInvoice = await prisma.invoice.findFirstOrThrow({ where: { id: invoice.id } });
    expect(printedInvoice.receiptPrintCount).toBeGreaterThanOrEqual(1);
    const printLog = await prisma.documentPrintLog.findFirst({ where: { invoiceId: invoice.id, type: 'RECEIPT' } });
    expect(printLog).toBeTruthy();
    expect(printLog!.documentId).toBeNull();

    // Thermal/PDF printout actually renders from the Invoice.
    const receiptsSvc = moduleRef.get(PosReceiptsService);
    const text = await tenant.run({ organizationId }, () => receiptsSvc.buildTextReceipt(invoice.id));
    expect(text).toContain('TOTAL');
    expect(text).toContain(invoice.invoiceNumber);
    const pdf = await tenant.run({ organizationId }, () => receiptsSvc.buildPdfReceipt(invoice.id));
    expect(pdf.length).toBeGreaterThan(500);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');

    // Two papers: a cashier/settlement copy is recorded and renders with a signature line.
    const merchantReceipt = await prisma.receipt.findFirst({ where: { invoiceId: invoice.id, type: 'merchant_copy' } });
    expect(merchantReceipt).toBeTruthy();
    const cashierText = await tenant.run({ organizationId }, () => receiptsSvc.buildTextReceipt(invoice.id, false, 'CASHIER COPY'));
    expect(cashierText).toContain('CASHIER COPY');
    expect(cashierText).toContain('Signature');
    // The PDF carries both copies (2 thermal pages).
    expect(pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g)?.length).toBe(2);
  }, 60_000);

  it('cash over-tender: returns change, persists amountTendered, prints Cash tendered + Change', async () => {
    // Bill 200 (2 × 100), customer hands over 500 → change 300. The cash tender
    // leg still equals the bill; the extra is carried only by amountTendered.
    const result: any = await tenant.run({ organizationId }, async () =>
      pos.checkout({
        partnerId: customerId,
        lines: [{ productId, description: 'Coffee', quantity: 2, unitPrice: 100 }],
        tenders: [{ method: 'cash', amount: 200 }],
        amountTendered: 500,
      }),
    );

    // Change surfaced to the cashier UI.
    expect(result.change).toBe(300);

    // Persisted on the Invoice so reprints/receipt reflect the real tendered/change.
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { id: result.invoiceId } });
    expect(Number(invoice.totalAmount)).toBe(200);
    expect(Number(invoice.amountResidual)).toBe(0);
    expect(Number(invoice.amountPaid)).toBe(200);
    expect(Number(invoice.amountTendered)).toBe(500);

    // The printed receipt now carries the tendered + change lines (only present
    // because amountTendered > amountPaid, i.e. the value flowed end-to-end).
    const receiptsSvc = moduleRef.get(PosReceiptsService);
    const text = await tenant.run({ organizationId }, () => receiptsSvc.buildTextReceipt(invoice.id));
    expect(text).toContain('Cash tendered:');
    expect(text).toContain('Change:');
  }, 60_000);

  it('multi-order: a tableless order lists open, resumes, settles with GL parity, then leaves the feed', async () => {
    const ordersSvc = moduleRef.get(PosOrdersService);

    // 1. Open a tableless takeaway order (the Odoo auto-create equivalent — no table).
    const created: any = await tenant.run({ organizationId }, () =>
      ordersSvc.createOrder({
        orderType: 'takeaway',
        guestCount: 1,
        cashSessionId,
        lines: [{ productId, description: 'Coffee', quantity: 2, unitPrice: 100 }],
      } as any),
    );
    expect(created.id).toBeTruthy();
    expect(created.tableId).toBeNull();

    // 2. It shows in the live open-orders feed with a resolved projection.
    const open: any = await tenant.run({ organizationId }, () => ordersSvc.listOpenOrders({}));
    const row = open.rows.find((r: any) => r.id === created.id);
    expect(row).toBeTruthy();
    expect(row.orderType).toBe('takeaway');
    expect(row.tableName).toBeNull();
    expect(Number(row.totalAmount)).toBe(200);
    expect(open.count).toBe(open.rows.length);

    // 3. Resume returns un-baked rehydrate lines + cart context to continue selling.
    const resumed: any = await tenant.run({ organizationId }, () => pos.resumeOrder(created.id));
    expect(resumed.lines.length).toBe(1);
    expect(resumed.orderType).toBe('takeaway');
    expect(resumed.tableId).toBeNull();

    // 4. Settle by orderId — identical sale path as checkout/settleTab.
    const settled: any = await tenant.run({ organizationId }, () =>
      pos.settleOrder({ orderId: created.id, tenders: [{ method: 'cash', amount: 200 }], cashSessionId }),
    );
    expect(settled.invoiceId).toBeTruthy();
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { id: settled.invoiceId } });
    expect(Number(invoice.totalAmount)).toBe(200);
    expect(Number(invoice.amountResidual)).toBe(0);
    expect(invoice.status).toBe('paid');

    // GL balanced (same posting as a counter checkout).
    const je = await prisma.journalEntry.findFirstOrThrow({ where: { organizationId, sourceType: 'pos_invoice', sourceId: invoice.id }, include: { lines: true } });
    const dr = je.lines.reduce((s, l) => s + Number(l.baseDebit), 0);
    const cr = je.lines.reduce((s, l) => s + Number(l.baseCredit), 0);
    expect(Math.abs(dr - cr)).toBeLessThan(0.001);

    // Order closed + gone from the open feed.
    const order = await prisma.order.findFirstOrThrow({ where: { id: created.id } });
    expect(order.status).toBe('closed');
    const openAfter: any = await tenant.run({ organizationId }, () => ordersSvc.listOpenOrders({}));
    expect(openAfter.rows.find((r: any) => r.id === created.id)).toBeUndefined();
  }, 60_000);
});
