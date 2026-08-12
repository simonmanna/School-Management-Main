import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';
import { ensureAccountCategories, makeAccountFactory } from './_accounts';
import { KernelModule } from '../../src/kernel/kernel.module';
import { CoreModule } from '../../src/modules/core/core.module';
import { InventoryModule } from '../../src/modules/inventory/inventory.module';
import { ManufacturingModule } from '../../src/modules/manufacturing/manufacturing.module';
import { StockService } from '../../src/modules/inventory/stock.service';
import { BomService } from '../../src/modules/manufacturing/bom.service';
import { ProductionService } from '../../src/modules/manufacturing/production.service';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';

/**
 * The manufacturing engine end-to-end against real Postgres. The anchor is the
 * WIP-flat invariant: a completed production order leaves Work In Progress at
 * exactly zero, because with overheadCost = 0 the material cost debited on start
 * equals the finished-goods value credited on complete.
 *
 * Also asserts the consume leg does NOT leak to COGS (the seeded PRODUCTION_
 * CONSUME rule must win over postIssue's COGS fallback), that the finished-good
 * AVCO equals materialCost / producedQty, and that the idempotency guards hold.
 */
describeDb('integration: manufacturing flow', () => {
  const prisma = new PrismaClient();
  let moduleRef: TestingModule;
  let stock: StockService;
  let boms: BomService;
  let production: ProductionService;
  let tenant: TenantContextService;

  let organizationId: string;
  let bakeryId: string;
  let warehouseId: string;
  let wipAccountId: string;
  let stockValAccountId: string;
  let cogsAccountId: string;
  let scrapAccountId: string;
  let overheadAbsorbedAccountId: string;

  const asOrg = <T>(fn: () => Promise<T>): Promise<T> => tenant.run({ organizationId }, fn);

  const makeProduct = (code: string, overrides: Record<string, unknown> = {}) =>
    prisma.product.create({
      data: {
        organizationId,
        code,
        name: code,
        productType: 'stockable',
        trackInventory: true,
        costingMethod: 'AVCO',
        costPrice: 0,
        salesPrice: 0,
        ...overrides,
      } as any,
    });

  const onHand = async (productId: string, locationId: string) => {
    const si = await prisma.stockItem.findFirst({ where: { organizationId, productId, locationId } });
    return Number(si?.quantity ?? 0);
  };

  const avco = async (productId: string, locationId: string) => {
    const si = await prisma.stockItem.findFirst({ where: { organizationId, productId, locationId } });
    return Number(si?.runningAverageCost ?? 0);
  };

  const accountBalance = async (accountId: string) => {
    const agg = await prisma.journalLine.aggregate({
      where: { organizationId, accountId },
      _sum: { debit: true, credit: true },
    });
    return Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0);
  };

  beforeAll(async () => {
    await prisma.$connect();
    const org = await prisma.organization.create({
      data: { code: `INT-MFG-${Date.now()}`, name: 'Manufacturing Org', currencyCode: 'UGX' },
    });
    organizationId = org.id;

    const mk = makeAccountFactory(prisma, await ensureAccountCategories(prisma));
    const stockVal = await mk(organizationId, 'MFG-1400', 'Stock Valuation', 'inventory');
    const wip = await mk(organizationId, 'MFG-1420', 'Work In Progress', 'work_in_progress');
    const cogs = await mk(organizationId, 'MFG-5100', 'COGS', 'cost_of_goods_sold');
    const grni = await mk(organizationId, 'MFG-2150', 'GRNI', 'current_liability');
    const scrapExpense = await mk(organizationId, 'MFG-5300', 'Stock Adj Expense', 'operating_expense');
    const overheadAbsorbed = await mk(organizationId, 'MFG-5350', 'Overhead Absorbed', 'operating_expense');
    stockValAccountId = stockVal.id;
    wipAccountId = wip.id;
    cogsAccountId = cogs.id;
    scrapAccountId = scrapExpense.id;
    overheadAbsorbedAccountId = overheadAbsorbed.id;

    await prisma.journal.create({ data: { organizationId, code: 'INV', name: 'Inventory', journalType: 'general' } });

    for (const [key, accountId] of [
      ['stock_valuation', stockVal.id],
      ['wip', wip.id],
      ['cogs', cogs.id],
      ['grni_accrued', grni.id],
      ['stock_adjustment_expense', scrapExpense.id],
      ['overhead_absorbed', overheadAbsorbed.id],
      ['default_expense', cogs.id],
    ] as const) {
      await prisma.accountMapping.create({ data: { organizationId, key, accountId } });
    }

    // The consume leg travels through postIssue, whose fallback for an unknown
    // movement type is COGS. Seed the production rules so PRODUCTION_CONSUME
    // resolves to Dr WIP / Cr Stock Valuation instead — exactly what
    // organizations.service seeds for a real org.
    const rules = [
      { movementType: 'PRODUCTION_CONSUME', lineIndex: 0, debitOrCredit: 'debit', accountMappingKey: 'wip' },
      { movementType: 'PRODUCTION_CONSUME', lineIndex: 1, debitOrCredit: 'credit', accountMappingKey: 'stock_valuation' },
      { movementType: 'PRODUCTION_OUTPUT', lineIndex: 0, debitOrCredit: 'debit', accountMappingKey: 'stock_valuation' },
      { movementType: 'PRODUCTION_OUTPUT', lineIndex: 1, debitOrCredit: 'credit', accountMappingKey: 'wip' },
    ] as const;
    for (const r of rules) {
      await prisma.inventoryPostingRule.create({
        data: { organizationId, accountSource: 'account_mapping', isActive: true, ...r } as any,
      });
    }

    bakeryId = (
      await prisma.inventoryLocation.create({
        data: { organizationId, code: 'BAKERY', name: 'Bakery', type: 'production' },
      })
    ).id;
    warehouseId = (
      await prisma.inventoryLocation.create({
        data: { organizationId, code: 'MAIN', name: 'Main Store', type: 'warehouse' },
      })
    ).id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, CoreModule, InventoryModule, ManufacturingModule],
    }).compile();
    await moduleRef.init();
    stock = moduleRef.get(StockService);
    boms = moduleRef.get(BomService);
    production = moduleRef.get(ProductionService);
    tenant = moduleRef.get(TenantContextService);
  }, 120_000);

  afterAll(async () => {
    if (organizationId) {
      await prisma.productionCostComponent.deleteMany({ where: { organizationId } });
      await prisma.workOrder.deleteMany({ where: { organizationId } });
      await prisma.routingOperation.deleteMany({ where: { organizationId } });
      await prisma.routing.deleteMany({ where: { organizationId } });
      await prisma.resource.deleteMany({ where: { organizationId } });
      await prisma.workCenter.deleteMany({ where: { organizationId } });
      await prisma.productionQcCheck.deleteMany({ where: { organizationId } });
      await prisma.productionMaterial.deleteMany({ where: { organizationId } });
      await prisma.productionOutput.deleteMany({ where: { organizationId } });
      await prisma.productionOrder.deleteMany({ where: { organizationId } });
      await prisma.bomLine.deleteMany({ where: { organizationId } });
      await prisma.bom.deleteMany({ where: { organizationId } });
      await prisma.inventoryLedger.deleteMany({ where: { organizationId } });
      await prisma.inventoryBatch.deleteMany({ where: { organizationId } });
      await prisma.stockItem.deleteMany({ where: { organizationId } });
      await prisma.stockReservation.deleteMany({ where: { organizationId } });
      await prisma.inventoryPostingRule.deleteMany({ where: { organizationId } });
      await prisma.journalLine.deleteMany({ where: { organizationId } });
      await prisma.journalEntry.deleteMany({ where: { organizationId } });
      await prisma.auditLog.deleteMany({ where: { organizationId } });
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

  it('bakes a batch: consume flour → WIP, output cakes ← WIP, WIP nets to zero', async () => {
    const flour = await makeProduct('FLOUR');
    const cake = await makeProduct('CAKE', { manufacturingRole: 'finished' });

    const wipBefore = await accountBalance(wipAccountId);
    const cogsBefore = await accountBalance(cogsAccountId);

    await asOrg(async () => {
      // 10 kg flour @ 5,000 (Dr Stock Valuation / Cr GRNI).
      await stock.receiveForDocument(
        { productId: flour.id, locationId: bakeryId, quantity: 10, unitCost: 5000 } as any,
        { sourceType: 'test_receipt', sourceId: 'r1', date: new Date() },
      );

      // BOM: 1 run makes 20 cakes from 4 kg flour.
      const draft = await boms.create({
        name: 'Chocolate Cake',
        outputProductId: cake.id,
        outputQuantity: 20,
        lines: [{ componentProductId: flour.id, quantity: 4 }],
      } as any);
      await boms.activate(draft.id);

      const order = await production.createOrder({ bomId: draft.id, runs: 1, locationId: bakeryId } as any);
      await production.confirmOrder(order.id);
      const started = await production.startOrder(order.id);
      expect(Number(started.materialCost)).toBe(20_000); // 4 kg × 5,000

      const done = await production.completeOrder(order.id, { qtyProduced: 20 } as any);
      expect(Number(done.outputUnitCost)).toBe(1000); // 20,000 / 20
    });

    // Flour: 10 − 4 = 6 kg left in the bakery.
    expect(await onHand(flour.id, bakeryId)).toBe(6);
    // Cakes: 20 in the warehouse (output default), AVCO = 1,000.
    expect(await onHand(cake.id, warehouseId)).toBe(20);
    expect(await avco(cake.id, warehouseId)).toBe(1000);

    // THE INVARIANT: WIP is back to exactly where it started.
    expect(await accountBalance(wipAccountId)).toBeCloseTo(wipBefore, 6);
    // The consume leg did NOT leak to COGS (postIssue's fallback would have).
    expect(await accountBalance(cogsAccountId)).toBeCloseTo(cogsBefore, 6);
  }, 60_000);

  it('rejects starting or completing twice (idempotency guards)', async () => {
    const flour = await makeProduct('FLOUR2');
    const cake = await makeProduct('CAKE2');

    await asOrg(async () => {
      await stock.receiveForDocument(
        { productId: flour.id, locationId: bakeryId, quantity: 10, unitCost: 5000 } as any,
        { sourceType: 'test_receipt', sourceId: 'r2', date: new Date() },
      );
      const draft = await boms.create({
        name: 'Cake2',
        outputProductId: cake.id,
        outputQuantity: 10,
        lines: [{ componentProductId: flour.id, quantity: 2 }],
      } as any);
      await boms.activate(draft.id);
      const order = await production.createOrder({ bomId: draft.id, runs: 1, locationId: bakeryId } as any);
      await production.confirmOrder(order.id);
      await production.startOrder(order.id);

      await expect(production.startOrder(order.id)).rejects.toThrow(); // consumedAt guard
      await production.completeOrder(order.id, { qtyProduced: 10 } as any);
      await expect(production.completeOrder(order.id, { qtyProduced: 10 } as any)).rejects.toThrow(); // postedAt guard
    });
  }, 60_000);

  it('cancel after start returns the material to stock and clears WIP', async () => {
    const flour = await makeProduct('FLOUR3');
    const cake = await makeProduct('CAKE3');

    const wipBefore = await accountBalance(wipAccountId);
    await asOrg(async () => {
      await stock.receiveForDocument(
        { productId: flour.id, locationId: bakeryId, quantity: 10, unitCost: 5000 } as any,
        { sourceType: 'test_receipt', sourceId: 'r3', date: new Date() },
      );
      const draft = await boms.create({
        name: 'Cake3',
        outputProductId: cake.id,
        outputQuantity: 10,
        lines: [{ componentProductId: flour.id, quantity: 3 }],
      } as any);
      await boms.activate(draft.id);
      const order = await production.createOrder({ bomId: draft.id, runs: 1, locationId: bakeryId } as any);
      await production.confirmOrder(order.id);
      await production.startOrder(order.id); // consumes 3 kg into WIP
      await production.cancelOrder(order.id, { reason: 'burnt oven' } as any);
    });

    // Flour fully back on the shelf (10), WIP flat again.
    expect(await onHand(flour.id, bakeryId)).toBe(10);
    expect(await accountBalance(wipAccountId)).toBeCloseTo(wipBefore, 6);
  }, 60_000);

  it('under-yield raises unit cost yet still zeroes WIP', async () => {
    const flour = await makeProduct('FLOUR4');
    const cake = await makeProduct('CAKE4');

    const wipBefore = await accountBalance(wipAccountId);
    let unitCost = 0;
    await asOrg(async () => {
      await stock.receiveForDocument(
        { productId: flour.id, locationId: bakeryId, quantity: 10, unitCost: 5000 } as any,
        { sourceType: 'test_receipt', sourceId: 'r4', date: new Date() },
      );
      const draft = await boms.create({
        name: 'Cake4',
        outputProductId: cake.id,
        outputQuantity: 20,
        lines: [{ componentProductId: flour.id, quantity: 4 }],
      } as any);
      await boms.activate(draft.id);
      const order = await production.createOrder({ bomId: draft.id, runs: 1, locationId: bakeryId } as any);
      await production.confirmOrder(order.id);
      await production.startOrder(order.id); // 20,000 into WIP
      const done = await production.completeOrder(order.id, { qtyProduced: 18 } as any); // 2 short
      unitCost = Number(done.outputUnitCost);
    });

    // 20,000 / 18 ≈ 1,111.11 — higher than the 1,000 a full yield would give.
    expect(unitCost).toBeCloseTo(20_000 / 18, 2);
    expect(await accountBalance(wipAccountId)).toBeCloseTo(wipBefore, 6);
  }, 60_000);

  it('zero-yield batch writes WIP off to scrap expense and still zeroes WIP', async () => {
    const flour = await makeProduct('FLOUR5');
    const cake = await makeProduct('CAKE5');

    const wipBefore = await accountBalance(wipAccountId);
    const scrapBefore = await accountBalance(scrapAccountId);
    await asOrg(async () => {
      await stock.receiveForDocument(
        { productId: flour.id, locationId: bakeryId, quantity: 10, unitCost: 5000 } as any,
        { sourceType: 'test_receipt', sourceId: 'r5', date: new Date() },
      );
      const draft = await boms.create({
        name: 'Cake5',
        outputProductId: cake.id,
        outputQuantity: 20,
        lines: [{ componentProductId: flour.id, quantity: 4 }],
      } as any);
      await boms.activate(draft.id);
      const order = await production.createOrder({ bomId: draft.id, runs: 1, locationId: bakeryId } as any);
      await production.confirmOrder(order.id);
      await production.startOrder(order.id); // 20,000 into WIP
      await production.completeOrder(order.id, { qtyProduced: 0 } as any); // burnt tray
    });

    // WIP flat again; the 20,000 landed in scrap expense, not on any cake.
    expect(await accountBalance(wipAccountId)).toBeCloseTo(wipBefore, 6);
    expect(await accountBalance(scrapAccountId)).toBeCloseTo(scrapBefore + 20_000, 6);
    expect(await onHand(cake.id, warehouseId)).toBe(0);
  }, 60_000);

  it('QC-required order holds output in quarantine, then passes it to the sale location', async () => {
    const flour = await makeProduct('FLOUR6');
    const cake = await makeProduct('CAKE6');

    let orderId = '';
    await asOrg(async () => {
      await stock.receiveForDocument(
        { productId: flour.id, locationId: bakeryId, quantity: 10, unitCost: 5000 } as any,
        { sourceType: 'test_receipt', sourceId: 'r6', date: new Date() },
      );
      const draft = await boms.create({
        name: 'Cake6',
        outputProductId: cake.id,
        outputQuantity: 20,
        qcRequired: true,
        lines: [{ componentProductId: flour.id, quantity: 4 }],
      } as any);
      await boms.activate(draft.id);
      const order = await production.createOrder({ bomId: draft.id, runs: 1, locationId: bakeryId } as any);
      orderId = order.id;
      await production.confirmOrder(order.id);
      await production.startOrder(order.id);
      const held = await production.completeOrder(order.id, { qtyProduced: 20 } as any);
      expect(held.status).toBe('qc_hold');
    });

    // Nothing sellable yet — cakes sit in quarantine, not the warehouse.
    expect(await onHand(cake.id, warehouseId)).toBe(0);
    const quarantine = await prisma.inventoryLocation.findFirst({ where: { organizationId, code: 'QC-QUARANTINE' } });
    expect(quarantine).toBeTruthy();
    expect(await onHand(cake.id, quarantine!.id)).toBe(20);

    // Pass 18, fail 2 → 18 move to the warehouse, 2 are scrapped.
    await asOrg(async () => {
      const done = await production.recordQc(orderId, { passedQty: 18, failedQty: 2, wasteCategory: 'qc_rejection' } as any);
      expect(done.status).toBe('completed');
    });
    expect(await onHand(cake.id, warehouseId)).toBe(18);
    expect(await onHand(cake.id, quarantine!.id)).toBe(0);
  }, 60_000);

  it('reverses a completed order: finished goods removed, materials returned, WIP flat', async () => {
    const flour = await makeProduct('FLOUR7');
    const cake = await makeProduct('CAKE7');

    const wipBefore = await accountBalance(wipAccountId);
    await asOrg(async () => {
      await stock.receiveForDocument(
        { productId: flour.id, locationId: bakeryId, quantity: 10, unitCost: 5000 } as any,
        { sourceType: 'test_receipt', sourceId: 'r7', date: new Date() },
      );
      const draft = await boms.create({
        name: 'Cake7',
        outputProductId: cake.id,
        outputQuantity: 20,
        lines: [{ componentProductId: flour.id, quantity: 4 }],
      } as any);
      await boms.activate(draft.id);
      const order = await production.createOrder({ bomId: draft.id, runs: 1, locationId: bakeryId } as any);
      await production.confirmOrder(order.id);
      await production.startOrder(order.id);
      await production.completeOrder(order.id, { qtyProduced: 20 } as any);
      // 20 cakes in the warehouse, 6 kg flour left. Now reverse.
      const reversed = await production.reverseOrder(order.id, { reason: 'wrong recipe' } as any);
      expect(reversed.status).toBe('cancelled');
      expect(reversed.reversedAt).toBeTruthy();
    });

    // Cakes gone, flour fully back (10 kg), WIP flat.
    expect(await onHand(cake.id, warehouseId)).toBe(0);
    expect(await onHand(flour.id, bakeryId)).toBe(10);
    expect(await accountBalance(wipAccountId)).toBeCloseTo(wipBefore, 6);
  }, 60_000);

  it('absorbs BOM overhead into WIP (3rd JE) and still zeroes WIP; unit cost includes it', async () => {
    const flour = await makeProduct('FLOUR8');
    const cake = await makeProduct('CAKE8');

    const wipBefore = await accountBalance(wipAccountId);
    const absorbedBefore = await accountBalance(overheadAbsorbedAccountId);
    let unitCost = 0;
    await asOrg(async () => {
      await stock.receiveForDocument(
        { productId: flour.id, locationId: bakeryId, quantity: 10, unitCost: 5000 } as any,
        { sourceType: 'test_receipt', sourceId: 'r8', date: new Date() },
      );
      const draft = await boms.create({
        name: 'Cake8',
        outputProductId: cake.id,
        outputQuantity: 20,
        overheadCost: 4000, // per 20-cake run
        lines: [{ componentProductId: flour.id, quantity: 4 }],
      } as any);
      await boms.activate(draft.id);
      const order = await production.createOrder({ bomId: draft.id, runs: 1, locationId: bakeryId } as any);
      await production.confirmOrder(order.id);
      await production.startOrder(order.id); // 20,000 material into WIP
      const done = await production.completeOrder(order.id, { qtyProduced: 20 } as any);
      unitCost = Number(done.outputUnitCost);
    });

    // Unit cost = (20,000 material + 4,000 overhead) / 20 = 1,200.
    expect(unitCost).toBe(1200);
    // Overhead was absorbed (credited) and WIP nets to zero across all three legs.
    expect(await accountBalance(overheadAbsorbedAccountId)).toBeCloseTo(absorbedBefore - 4000, 6);
    expect(await accountBalance(wipAccountId)).toBeCloseTo(wipBefore, 6);
  }, 60_000);
});
