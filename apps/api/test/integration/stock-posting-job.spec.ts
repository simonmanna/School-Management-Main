// otplib pulls in @scure/base (ESM) which jest's CommonJS transform can't parse.
// Nothing here uses MFA, so a stub is safe (same as pos-sale-pipeline).
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
import { CoreModule } from '../../src/modules/core/core.module';
import { InventoryModule } from '../../src/modules/inventory/inventory.module';
import { PosModule } from '../../src/modules/pos/pos.module';
import { AccountingModule } from '../../src/modules/accounting/accounting.module';
import { PosInvoiceService } from '../../src/modules/pos/billing/pos-invoice.service';
import { StockService } from '../../src/modules/inventory/stock.service';
import { PeriodCloseService } from '../../src/modules/accounting/posting/period-close.service';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';

/**
 * The async stock-posting pipeline (StockPostingJob → worker →
 * processStockPostingJob) had no automated coverage at all, despite deciding
 * COGS and on-hand for every POS sale. These specs assert the correctness fixes
 * that pipeline now carries:
 *
 *   1. F-COGS — an inventory-tracked menu item with no recipe surfaces an
 *      InventoryException instead of silently posting zero COGS.
 *   2. exactly-once — a job processed by two workers at once (the stale-claim
 *      reclaim race) issues stock ONCE, not twice.
 *   3. period-close guard — a period cannot close while COGS is still queued.
 */
describeDb('integration: stock posting jobs', () => {
  const prisma = new PrismaClient();
  let moduleRef: TestingModule;
  let billing: PosInvoiceService;
  let stock: StockService;
  let periodClose: PeriodCloseService;
  let tenant: TenantContextService;

  let organizationId: string;
  let warehouseId: string;

  const asOrg = <T>(fn: () => Promise<T>): Promise<T> => tenant.run({ organizationId }, fn);

  const onHand = async (productId: string) => {
    const si = await prisma.stockItem.findFirst({ where: { organizationId, productId, locationId: warehouseId } });
    return Number(si?.quantity ?? 0);
  };

  beforeAll(async () => {
    await prisma.$connect();
    const org = await prisma.organization.create({
      data: { code: `INT-SPJ-${Date.now()}`, name: 'Stock Posting Jobs Org', currencyCode: 'UGX' },
    });
    organizationId = org.id;

    const mk = makeAccountFactory(prisma, await ensureAccountCategories(prisma));
    const stockValuation = await mk(organizationId, 'SPJ-1400', 'Stock Valuation', 'inventory');
    const cogs = await mk(organizationId, 'SPJ-5100', 'COGS', 'cost_of_goods_sold');
    const grni = await mk(organizationId, 'SPJ-2150', 'GRNI', 'current_liability');
    await prisma.journal.create({ data: { organizationId, code: 'INV', name: 'Inventory', journalType: 'general' } });
    for (const [key, accountId] of [
      ['stock_valuation', stockValuation.id],
      ['cogs', cogs.id],
      ['grni_accrued', grni.id],
      ['default_expense', cogs.id],
    ] as const) {
      await prisma.accountMapping.create({ data: { organizationId, key, accountId } });
    }

    warehouseId = (
      await prisma.inventoryLocation.create({
        data: { organizationId, code: 'SPJ-WH', name: 'Main WH', type: 'warehouse', isActive: true },
      })
    ).id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, InventoryModule, PosModule, AccountingModule],
    }).compile();
    await moduleRef.init();
    billing = moduleRef.get(PosInvoiceService);
    stock = moduleRef.get(StockService);
    periodClose = moduleRef.get(PeriodCloseService);
    tenant = moduleRef.get(TenantContextService);
  }, 120_000);

  afterAll(async () => {
    if (organizationId) {
      await prisma.inventoryLedger.deleteMany({ where: { organizationId } });
      await prisma.stockItem.deleteMany({ where: { organizationId } });
      await prisma.inventoryException.deleteMany({ where: { organizationId } });
      await prisma.stockPostingJob.deleteMany({ where: { organizationId } });
      await prisma.orderItem.deleteMany({ where: { organizationId } });
      await prisma.order.deleteMany({ where: { organizationId } });
      await prisma.fiscalPeriod.deleteMany({ where: { organizationId } });
      await prisma.menuItem.deleteMany({ where: { organizationId } });
      await prisma.journalLine.deleteMany({ where: { organizationId } });
      await prisma.journalEntry.deleteMany({ where: { organizationId } });
      await prisma.auditLog.deleteMany({ where: { organizationId } });
      await prisma.eventOutbox.deleteMany({ where: { organizationId } });
      await prisma.accountMapping.deleteMany({ where: { organizationId } });
      await prisma.account.deleteMany({ where: { organizationId } });
      await prisma.journal.deleteMany({ where: { organizationId } });
      await prisma.product.deleteMany({ where: { organizationId } });
      await prisma.inventoryLocation.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } });
    }
    await moduleRef?.close();
    await prisma.$disconnect();
  }, 60_000);

  const makeStockProduct = async (code: string) => {
    const p = await prisma.product.create({
      data: {
        organizationId, code, name: code, productType: 'stockable',
        trackInventory: true, costingMethod: 'AVCO', costPrice: 0, salesPrice: 0,
      } as any,
    });
    await asOrg(() =>
      stock.receiveForDocument(
        { productId: p.id, locationId: warehouseId, quantity: 100, unitCost: 10 } as any,
        { sourceType: 'seed', sourceId: `seed-${code}`, date: new Date() },
      ),
    );
    return p;
  };

  /** Hand-build a billed order + its (already-claimed) posting job. */
  const makeJob = async (
    line: { productId?: string; menuItemId?: string; quantity: number },
    jobStatus: 'processing' | 'pending' = 'processing',
  ) => {
    const order = await prisma.order.create({
      data: { organizationId, orderNumber: `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, status: 'closed' },
    });
    await prisma.orderItem.create({
      data: {
        organizationId, orderId: order.id, productId: line.productId ?? null, menuItemId: line.menuItemId ?? null,
        description: 'line', quantity: line.quantity, lineNumber: 1,
      },
    });
    const job = await prisma.stockPostingJob.create({
          data: {
            organizationId, orderId: order.id, invoiceId: order.id, invoiceNumber: `INV-${order.orderNumber}`,
            status: jobStatus,
            // Composite-unique idempotencyKey; the DB default is "" so every
            // hand-built job must carry a distinct one (real enqueues use
            // `<trigger>:<orderId|invoiceId>`).
            idempotencyKey: `at_invoice:${order.id}`,
            // Stale claim: as if a worker grabbed it >60s ago and never finished.
            claimToken: jobStatus === 'processing' ? 'stale-token' : null,
            claimedAt: jobStatus === 'processing' ? new Date(Date.now() - 120_000) : null,
          },
        });
        return { order, job };
      };

  it('surfaces an InventoryException for an inventory-tracked menu item with no recipe (F-COGS)', async () => {
    const menuItem = await prisma.menuItem.create({
      data: { organizationId, name: 'Recipe-less Latte', isInventoryTracked: true } as any,
    });
    const { job } = await makeJob({ menuItemId: menuItem.id, quantity: 2 });

    await asOrg(() => billing.processStockPostingJob(job.id));

    const ex = await prisma.inventoryException.findFirst({ where: { organizationId, menuItemId: menuItem.id } });
    expect(ex).toBeTruthy();
    expect(ex!.reason).toMatch(/no recipe/i);
    // The job still completes (the sale is never blocked) but flags review.
    const done = await prisma.stockPostingJob.findUnique({ where: { id: job.id } });
    expect(done!.status).toBe('done');
    expect(done!.lastError).toMatch(/need review/i);
  }, 60_000);

  it('issues stock exactly once when two workers process the same job at once (reclaim race)', async () => {
    const product = await makeStockProduct('SPJ-RECLAIM');
    const { job } = await makeJob({ productId: product.id, quantity: 5 });

    // Two concurrent workers both see the job as 'processing' (the stale-claim
    // reclaim window). The FOR UPDATE on the job row must serialise them so the
    // second sees 'done' and bails — without it both issue and on-hand is 90.
    await asOrg(() => Promise.all([billing.processStockPostingJob(job.id), billing.processStockPostingJob(job.id)]));

    expect(await onHand(product.id)).toBe(95);
    const done = await prisma.stockPostingJob.findUnique({ where: { id: job.id } });
    expect(done!.status).toBe('done');

    // And a plain sequential re-run is also a no-op (top-level done guard).
    await asOrg(() => billing.processStockPostingJob(job.id));
    expect(await onHand(product.id)).toBe(95);
  }, 60_000);

  it('refuses to close a fiscal period while stock-posting jobs are still queued', async () => {
    const period = await prisma.fiscalPeriod.create({
      data: {
        organizationId, name: 'FY-GUARD', status: 'open',
        startDate: new Date('2020-01-01'), endDate: new Date('2035-12-31'),
      } as any,
    });
    // A pending job dated inside the period = COGS not yet posted for it.
        await prisma.stockPostingJob.create({
          data: {
            organizationId, orderId: null, invoiceId: `guard-${Date.now()}`, invoiceNumber: 'INV-GUARD',
            status: 'pending', createdAt: new Date('2025-06-15'),
            idempotencyKey: `at_invoice:guard-${Date.now()}`,
          },
        });

    await expect(asOrg(() => periodClose.close(period.id))).rejects.toThrow(/stock-posting job/i);
  }, 60_000);
});
