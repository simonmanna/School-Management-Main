import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';
import { ensureAccountCategories, makeAccountFactory } from './_accounts';
import { KernelModule } from '../../src/kernel/kernel.module';
import { CoreModule } from '../../src/modules/core/core.module';
import { InventoryModule } from '../../src/modules/inventory/inventory.module';
import { StockService } from '../../src/modules/inventory/stock.service';
import { InventoryQueryService } from '../../src/modules/inventory/inventory-query.service';
import { InventoryCountService } from '../../src/modules/inventory/inventory-count.service';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';

/**
 * The stock engine had no automated coverage at all: ~1,100 lines deciding
 * quantities, cost basis and journal entries, verified only by hand. These specs
 * exercise it against a real Postgres and assert the two invariants everything
 * else depends on:
 *
 *   1. quantity  — StockItem.quantity == Σ InventoryLedger.quantityChange
 *   2. valuation — Σ (debit − credit) on Stock Valuation == Σ quantity × cost
 *
 * Every case below is one that previously shipped a bug: negative-stock AVCO
 * poisoning, the batch path not decrementing the cached quant, variant cost
 * bleeding across siblings in the GL leg, and serials not moving on transfer.
 */
describeDb('integration: inventory engine', () => {
  const prisma = new PrismaClient();
  let moduleRef: TestingModule;
  let stock: StockService;
  let queries: InventoryQueryService;
  let counts: InventoryCountService;
  let tenant: TenantContextService;

  let organizationId: string;
  let mainLocationId: string;
  let altLocationId: string;
  let stockValuationAccountId: string;

  /** Run a callback inside the org's tenant scope. */
  const asOrg = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId }, fn);

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

  const onHand = async (productId: string, locationId: string, variantId?: string | null) => {
    const si = await prisma.stockItem.findFirst({
      where: { organizationId, productId, variantKey: variantId ?? '', locationId },
    });
    return Number(si?.quantity ?? 0);
  };

  const ledgerSum = async (productId: string, locationId: string, variantId?: string | null) => {
    const agg = await prisma.inventoryLedger.aggregate({
      where: { organizationId, productId, locationId, variantId: variantId ?? null },
      _sum: { quantityChange: true },
    });
    return Number(agg._sum.quantityChange ?? 0);
  };

  /** Net movement on the Stock Valuation control account (debits − credits). */
  const stockValuationBalance = async () => {
    const agg = await prisma.journalLine.aggregate({
      where: { organizationId, accountId: stockValuationAccountId },
      _sum: { debit: true, credit: true },
    });
    return Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0);
  };

  beforeAll(async () => {
    await prisma.$connect();
    const org = await prisma.organization.create({
      data: { code: `INT-INV-${Date.now()}`, name: 'Inventory Engine Org', currencyCode: 'UGX' },
    });
    organizationId = org.id;

    const mk = makeAccountFactory(prisma, await ensureAccountCategories(prisma));
    const stockValuation = await mk(organizationId, 'INV-1400', 'Stock Valuation', 'inventory');
    const cogs = await mk(organizationId, 'INV-5100', 'COGS', 'cost_of_goods_sold');
    const grni = await mk(organizationId, 'INV-2150', 'GRNI', 'current_liability');
    const adjExpense = await mk(organizationId, 'INV-5900', 'Stock Adj Expense', 'operating_expense');
    const adjIncome = await mk(organizationId, 'INV-4900', 'Stock Adj Income', 'other_income');
    stockValuationAccountId = stockValuation.id;

    await prisma.journal.create({
      data: { organizationId, code: 'INV', name: 'Inventory', journalType: 'general' },
    });
    await prisma.journal.create({
      data: { organizationId, code: 'ADJ', name: 'Adjustments', journalType: 'general' },
    });

    for (const [key, accountId] of [
      ['stock_valuation', stockValuation.id],
      ['cogs', cogs.id],
      ['grni_accrued', grni.id],
      ['stock_adjustment_expense', adjExpense.id],
      ['stock_adjustment_income', adjIncome.id],
      ['default_expense', adjExpense.id],
    ] as const) {
      await prisma.accountMapping.create({ data: { organizationId, key, accountId } });
    }

    mainLocationId = (
      await prisma.inventoryLocation.create({
        data: { organizationId, code: 'MAIN', name: 'Main Store', type: 'warehouse' },
      })
    ).id;
    altLocationId = (
      await prisma.inventoryLocation.create({
        data: { organizationId, code: 'ALT', name: 'Second Store', type: 'warehouse' },
      })
    ).id;

    // CoreModule must be present: InventoryModule declares 'core' as a
    // dependency and ModuleRegistry validates that at bootstrap.
    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, CoreModule, InventoryModule],
    }).compile();
    await moduleRef.init();
    stock = moduleRef.get(StockService);
    queries = moduleRef.get(InventoryQueryService);
    counts = moduleRef.get(InventoryCountService);
    tenant = moduleRef.get(TenantContextService);
  }, 120_000);

  afterAll(async () => {
    if (organizationId) {
      await prisma.inventoryLedger.deleteMany({ where: { organizationId } });
      await prisma.inventorySerial.deleteMany({ where: { organizationId } });
      await prisma.inventoryBatch.deleteMany({ where: { organizationId } });
      await prisma.stockItem.deleteMany({ where: { organizationId } });
      // Count sessions and the adjustments they post both hold a RESTRICT FK on
      // InventoryLocation, so they must go before the locations below.
      await prisma.inventoryCountLine.deleteMany({ where: { organizationId } });
      await prisma.inventoryCountSession.deleteMany({ where: { organizationId } });
      await prisma.stockAdjustmentItem.deleteMany({ where: { organizationId } });
      await prisma.stockAdjustment.deleteMany({ where: { organizationId } });
      await prisma.stockReservation.deleteMany({ where: { organizationId } });
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

  describe('receipt → issue round trip (AVCO)', () => {
    it('capitalises on receipt, expenses on issue, and ties the ledger to the quant', async () => {
      const product = await makeProduct('AVCO-BASIC');

      await asOrg(async () => {
        await stock.receiveForDocument(
          { productId: product.id, locationId: mainLocationId, quantity: 100, unitCost: 10 } as any,
          { sourceType: 'test_receipt', sourceId: 'r1', date: new Date() },
        );
        await stock.issue({ productId: product.id, locationId: mainLocationId, quantity: 30 } as any);
      });

      expect(await onHand(product.id, mainLocationId)).toBe(70);
      expect(await ledgerSum(product.id, mainLocationId)).toBe(70);

      const si = await prisma.stockItem.findFirst({
        where: { organizationId, productId: product.id, locationId: mainLocationId },
      });
      expect(Number(si!.runningAverageCost)).toBe(10);
    }, 60_000);

    it('blends the weighted average across receipts at different costs', async () => {
      const product = await makeProduct('AVCO-BLEND');

      await asOrg(async () => {
        await stock.receiveForDocument(
          { productId: product.id, locationId: mainLocationId, quantity: 10, unitCost: 100 } as any,
          { sourceType: 'test_receipt', sourceId: 'b1', date: new Date() },
        );
        await stock.receiveForDocument(
          { productId: product.id, locationId: mainLocationId, quantity: 10, unitCost: 120 } as any,
          { sourceType: 'test_receipt', sourceId: 'b2', date: new Date() },
        );
      });

      const si = await prisma.stockItem.findFirst({
        where: { organizationId, productId: product.id, locationId: mainLocationId },
      });
      expect(Number(si!.runningAverageCost)).toBe(110);
    }, 60_000);
  });

  describe('negative stock (never-block-sales)', () => {
    it('lets the sale through and drives on-hand negative rather than throwing', async () => {
      const product = await makeProduct('NEG-SELL');

      await asOrg(() =>
        stock.issue({ productId: product.id, locationId: mainLocationId, quantity: 10 } as any),
      );

      expect(await onHand(product.id, mainLocationId)).toBe(-10);
      expect(await ledgerSum(product.id, mainLocationId)).toBe(-10);
    }, 60_000);

    it('squares up COGS and valuation on the covering receipt', async () => {
      const product = await makeProduct('NEG-CORRECT');
      const before = await stockValuationBalance();

      await asOrg(async () => {
        // Sell 10 with no stock and no cost basis → nothing expensed.
        await stock.issue({ productId: product.id, locationId: mainLocationId, quantity: 10 } as any);
        // Goods finally arrive: 20 @ 100.
        await stock.receiveForDocument(
          { productId: product.id, locationId: mainLocationId, quantity: 20, unitCost: 100 } as any,
          { sourceType: 'test_receipt', sourceId: 'n1', date: new Date() },
        );
      });

      expect(await onHand(product.id, mainLocationId)).toBe(10);

      const si = await prisma.stockItem.findFirst({
        where: { organizationId, productId: product.id, locationId: mainLocationId },
      });
      // The negative quantity must NOT have been blended into the average.
      expect(Number(si!.runningAverageCost)).toBe(100);

      // Valuation moved by exactly what is on the shelf: 10 × 100.
      // Without the correction this was 2000 — a 1000 overstatement that no
      // report would ever have surfaced.
      expect(await stockValuationBalance() - before).toBeCloseTo(1000, 2);
    }, 60_000);

    it('reports the exposure while the shortfall is open', async () => {
      const product = await makeProduct('NEG-REPORT', { costPrice: 40 });

      await asOrg(() =>
        stock.issue({ productId: product.id, locationId: mainLocationId, quantity: 5 } as any),
      );

      const report = await asOrg(() => queries.getNegativeStock({ locationId: mainLocationId }));
      const row = report.rows.find((r: any) => r.productId === product.id);
      expect(row).toBeDefined();
      expect(row!.shortBy).toBe('5');
      expect(Number(row!.valuationExposure)).toBeCloseTo(200, 2);
      expect(report.summary.clean).toBe(false);
    }, 60_000);
  });

  describe('batch-tracked products', () => {
    it('decrements the cached quant in lock-step with the batch layers', async () => {
      const product = await makeProduct('BATCH-FEFO', { batchTracking: true });

      await asOrg(async () => {
        await stock.receiveForDocument(
          { productId: product.id, locationId: mainLocationId, quantity: 10, unitCost: 5, batchNumber: 'B1' } as any,
          { sourceType: 'test_receipt', sourceId: 'k1', date: new Date() },
        );
        await stock.receiveForDocument(
          { productId: product.id, locationId: mainLocationId, quantity: 10, unitCost: 7, batchNumber: 'B2' } as any,
          { sourceType: 'test_receipt', sourceId: 'k2', date: new Date() },
        );
        await stock.issue({ productId: product.id, locationId: mainLocationId, quantity: 15 } as any);
      });

      const batches = await prisma.inventoryBatch.aggregate({
        where: { organizationId, productId: product.id, locationId: mainLocationId },
        _sum: { quantity: true },
      });

      // All three views must agree — cached quant, ledger, and batch layers.
      expect(await onHand(product.id, mainLocationId)).toBe(5);
      expect(await ledgerSum(product.id, mainLocationId)).toBe(5);
      expect(Number(batches._sum.quantity ?? 0)).toBe(5);
    }, 60_000);

    it('reports no drift for a batch product in the reconciliation view', async () => {
      const product = await makeProduct('BATCH-RECON', { batchTracking: true });

      await asOrg(async () => {
        await stock.receiveForDocument(
          { productId: product.id, locationId: mainLocationId, quantity: 8, unitCost: 3, batchNumber: 'R1' } as any,
          { sourceType: 'test_receipt', sourceId: 'rr1', date: new Date() },
        );
        await stock.issue({ productId: product.id, locationId: mainLocationId, quantity: 3 } as any);
      });

      const recon = await asOrg(() =>
        queries.getStockReconciliation({ locationId: mainLocationId }),
      );
      const drifted = recon.rows.filter((r: any) => r.productId === product.id && r.drifted);
      expect(drifted).toEqual([]);
    }, 60_000);
  });

  describe('transfers', () => {
    it('moves quantity and preserves the cost basis at the destination', async () => {
      const product = await makeProduct('XFER-AVCO');

      await asOrg(async () => {
        await stock.receiveForDocument(
          { productId: product.id, locationId: mainLocationId, quantity: 20, unitCost: 15 } as any,
          { sourceType: 'test_receipt', sourceId: 't1', date: new Date() },
        );
        await stock.transfer({
          productId: product.id,
          fromLocationId: mainLocationId,
          toLocationId: altLocationId,
          quantity: 8,
        } as any);
      });

      expect(await onHand(product.id, mainLocationId)).toBe(12);
      expect(await onHand(product.id, altLocationId)).toBe(8);

      const dest = await prisma.stockItem.findFirst({
        where: { organizationId, productId: product.id, locationId: altLocationId },
      });
      expect(Number(dest!.runningAverageCost)).toBe(15);
    }, 60_000);

    it('keeps the weighted average correct under concurrent receipts', async () => {
      // The running average is a read-compute-write in app code. Two receipts on
      // the same quant landing at once used to lost-update it: quantity stayed
      // right (atomic increments) but the average took whichever writer committed
      // last. A transaction advisory lock now serialises the recompute. Without
      // it this assertion is flaky and usually wrong (10 or 20, not 15).
      const product = await makeProduct('AVCO-RACE');

      await asOrg(async () => {
        await Promise.all([
          stock.receiveForDocument(
            { productId: product.id, locationId: mainLocationId, quantity: 10, unitCost: 10 } as any,
            { sourceType: 'race', sourceId: 'r1', date: new Date() },
          ),
          stock.receiveForDocument(
            { productId: product.id, locationId: mainLocationId, quantity: 10, unitCost: 20 } as any,
            { sourceType: 'race', sourceId: 'r2', date: new Date() },
          ),
        ]);
      });

      const si = await prisma.stockItem.findFirst({
        where: { organizationId, productId: product.id, locationId: mainLocationId },
      });
      expect(Number(si!.quantity)).toBe(20);
      // (10 × 10 + 10 × 20) / 20 = 15, regardless of commit order.
      expect(Number(si!.runningAverageCost)).toBe(15);
    }, 60_000);

    it('blends the carried cost into an existing destination average', async () => {
      // Destination already holds stock at a different average. A transfer-in is
      // economically a receipt at the source's carried cost, so the destination
      // average must weight the incoming units in. Previously the dest upsert only
      // incremented quantity and kept its old average, so the destination
      // valuation silently drifted from the ledger.
      const product = await makeProduct('XFER-BLEND');

      await asOrg(async () => {
        // Seed the destination with 10 @ 20 (avg 20).
        await stock.receiveForDocument(
          { productId: product.id, locationId: altLocationId, quantity: 10, unitCost: 20 } as any,
          { sourceType: 'test_receipt', sourceId: 'b-dest', date: new Date() },
        );
        // Seed the source with 10 @ 10 (avg 10), then move all 10 across.
        await stock.receiveForDocument(
          { productId: product.id, locationId: mainLocationId, quantity: 10, unitCost: 10 } as any,
          { sourceType: 'test_receipt', sourceId: 'b-src', date: new Date() },
        );
        await stock.transfer({
          productId: product.id,
          fromLocationId: mainLocationId,
          toLocationId: altLocationId,
          quantity: 10,
        } as any);
      });

      expect(await onHand(product.id, altLocationId)).toBe(20);
      const dest = await prisma.stockItem.findFirst({
        where: { organizationId, productId: product.id, locationId: altLocationId },
      });
      // (10 × 20 + 10 × 10) / 20 = 15
      expect(Number(dest!.runningAverageCost)).toBe(15);
    }, 60_000);

    it('relocates serial numbers with the goods', async () => {
      const product = await makeProduct('XFER-SERIAL', { serialTracking: true, costingMethod: 'SPECIFIC' });

      await asOrg(async () => {
        await stock.receiveForDocument(
          {
            productId: product.id,
            locationId: mainLocationId,
            quantity: 3,
            unitCost: 50,
            serialNumbers: ['SN-1', 'SN-2', 'SN-3'],
          } as any,
          { sourceType: 'test_receipt', sourceId: 's1', date: new Date() },
        );
        await stock.transfer({
          productId: product.id,
          fromLocationId: mainLocationId,
          toLocationId: altLocationId,
          quantity: 2,
        } as any);
      });

      // Previously every serial stayed at the source: the destination could not
      // issue by serial, and the source kept phantom in-stock units.
      const atDest = await prisma.inventorySerial.count({
        where: { organizationId, productId: product.id, locationId: altLocationId, status: 'in_stock' },
      });
      const atSource = await prisma.inventorySerial.count({
        where: { organizationId, productId: product.id, locationId: mainLocationId, status: 'in_stock' },
      });
      expect(atDest).toBe(2);
      expect(atSource).toBe(1);
    }, 60_000);

    it('refuses to transfer more than the source holds', async () => {
      const product = await makeProduct('XFER-SHORT');

      await asOrg(() =>
        stock.receiveForDocument(
          { productId: product.id, locationId: mainLocationId, quantity: 2, unitCost: 1 } as any,
          { sourceType: 'test_receipt', sourceId: 'x1', date: new Date() },
        ),
      );

      await expect(
        asOrg(() =>
          stock.transfer({
            productId: product.id,
            fromLocationId: mainLocationId,
            toLocationId: altLocationId,
            quantity: 5,
          } as any),
        ),
      ).rejects.toThrow(/insufficient stock/i);

      // A rejected transfer must leave both sides untouched.
      expect(await onHand(product.id, mainLocationId)).toBe(2);
      expect(await onHand(product.id, altLocationId)).toBe(0);
    }, 60_000);
  });

  describe('adjustments', () => {
    it('counts to an absolute quantity and posts the variance', async () => {
      const product = await makeProduct('ADJ-COUNT');

      await asOrg(async () => {
        await stock.receiveForDocument(
          { productId: product.id, locationId: mainLocationId, quantity: 10, unitCost: 6 } as any,
          { sourceType: 'test_receipt', sourceId: 'a1', date: new Date() },
        );
        await stock.adjust({
          productId: product.id,
          locationId: mainLocationId,
          countedQuantity: 7,
        } as any);
      });

      expect(await onHand(product.id, mainLocationId)).toBe(7);
      expect(await ledgerSum(product.id, mainLocationId)).toBe(7);

      const shrink = await prisma.inventoryLedger.findFirst({
        where: { organizationId, productId: product.id, type: 'adjustment_out' },
      });
      expect(shrink).not.toBeNull();
      expect(Number(shrink!.quantityChange)).toBe(-3);
    }, 60_000);
  });

  describe('physical count sessions', () => {
    /** Start a count at MAIN and record a physical figure for one product. */
    const countTo = async (productId: string, countedQty: number) => {
      const session = await counts.start({ locationId: mainLocationId, countType: 'opening' } as any);
      const line = (session as any).lines.find((l: any) => l.productId === productId);
      expect(line).toBeDefined();
      await counts.saveDraft(session.id, {
        lines: [{ lineId: line.id, countedQty, reason: 'physical count' }],
      } as any);
      return session;
    };

    it('posts the variance as an adjustment when nothing moved after counting', async () => {
      const product = await makeProduct('CNT-CLEAN');
      await asOrg(() =>
        stock.receiveForDocument(
          { productId: product.id, locationId: mainLocationId, quantity: 10, unitCost: 4 } as any,
          { sourceType: 'test_receipt', sourceId: 'c1', date: new Date() },
        ),
      );

      await asOrg(async () => {
        const session = await countTo(product.id, 8);
        await counts.submit(session.id);
      });

      expect(await onHand(product.id, mainLocationId)).toBe(8);
      expect(await ledgerSum(product.id, mainLocationId)).toBe(8);
    }, 90_000);

    it('refuses to submit when stock moved after the line was counted', async () => {
      const product = await makeProduct('CNT-STALE');
      await asOrg(() =>
        stock.receiveForDocument(
          { productId: product.id, locationId: mainLocationId, quantity: 10, unitCost: 4 } as any,
          { sourceType: 'test_receipt', sourceId: 'c2', date: new Date() },
        ),
      );

      await expect(
        asOrg(async () => {
          const session = await countTo(product.id, 10);
          // A sale lands after the shelf was counted. Submitting now would write
          // 10 back over the 7 that are actually there, silently erasing it.
          await stock.issue({ productId: product.id, locationId: mainLocationId, quantity: 3 } as any);
          return counts.submit(session.id);
        }),
      ).rejects.toThrow(/moved after they were counted/i);

      // Nothing was overwritten — the sale stands.
      expect(await onHand(product.id, mainLocationId)).toBe(7);
    }, 90_000);

    it('allows the supervisor to force past the guard with a recorded reason', async () => {
      const product = await makeProduct('CNT-FORCE');
      await asOrg(() =>
        stock.receiveForDocument(
          { productId: product.id, locationId: mainLocationId, quantity: 10, unitCost: 4 } as any,
          { sourceType: 'test_receipt', sourceId: 'c3', date: new Date() },
        ),
      );

      const sessionId = await asOrg(async () => {
        // Physically found 8 against a system figure of 10 — a real -2 variance,
        // so the submit actually posts an adjustment.
        const session = await countTo(product.id, 8);
        await stock.issue({ productId: product.id, locationId: mainLocationId, quantity: 3 } as any);
        await counts.submit(session.id, { force: true, forceReason: 'till was offline' });
        return session.id;
      });

      // Forced: the counted figure wins outright, as the supervisor decided —
      // the 3 sold after counting are absorbed rather than preserved. That is
      // exactly why the guard exists and why forcing is recorded.
      expect(await onHand(product.id, mainLocationId)).toBe(8);

      const saved = await prisma.inventoryCountSession.findFirst({ where: { id: sessionId } });
      expect(saved!.notes).toContain('FORCED');
      expect(saved!.notes).toContain('till was offline');
    }, 90_000);

    it('requires a reason when forcing', async () => {
      const product = await makeProduct('CNT-NOREASON');
      await asOrg(() =>
        stock.receiveForDocument(
          { productId: product.id, locationId: mainLocationId, quantity: 5, unitCost: 4 } as any,
          { sourceType: 'test_receipt', sourceId: 'c4', date: new Date() },
        ),
      );

      await expect(
        asOrg(async () => {
          const session = await countTo(product.id, 5);
          await stock.issue({ productId: product.id, locationId: mainLocationId, quantity: 1 } as any);
          return counts.submit(session.id, { force: true });
        }),
      ).rejects.toThrow(/reason is required/i);
    }, 90_000);
  });

  describe('variant cost isolation', () => {
    it('values each variant from its own running average, in the ledger and the GL', async () => {
      const product = await makeProduct('VAR-COST', { hasVariants: true });
      const cheap = await prisma.productVariant.create({
        data: { organizationId, productId: product.id, name: 'Cheap', sku: 'VC-1' } as any,
      });
      const dear = await prisma.productVariant.create({
        data: { organizationId, productId: product.id, name: 'Dear', sku: 'VC-2' } as any,
      });

      const before = await stockValuationBalance();

      await asOrg(async () => {
        await stock.receiveForDocument(
          { productId: product.id, variantId: cheap.id, locationId: mainLocationId, quantity: 10, unitCost: 10 } as any,
          { sourceType: 'test_receipt', sourceId: 'v1', date: new Date() },
        );
        await stock.receiveForDocument(
          { productId: product.id, variantId: dear.id, locationId: mainLocationId, quantity: 10, unitCost: 200 } as any,
          { sourceType: 'test_receipt', sourceId: 'v2', date: new Date() },
        );
        // Issue the EXPENSIVE variant. The GL leg used to re-resolve cost from
        // whichever sibling quant it happened to read first, so this could be
        // expensed at 10 instead of 200.
        await stock.issue({
          productId: product.id,
          variantId: dear.id,
          locationId: mainLocationId,
          quantity: 5,
        } as any);
      });

      const issueRow = await prisma.inventoryLedger.findFirst({
        where: { organizationId, productId: product.id, variantId: dear.id, type: 'issue' },
      });
      expect(Number(issueRow!.unitCost)).toBe(200);

      // Received 100 + 2000, issued 5 × 200 → 2100 − 1000 = 1100.
      expect((await stockValuationBalance()) - before).toBeCloseTo(1100, 2);
    }, 60_000);
  });
});
