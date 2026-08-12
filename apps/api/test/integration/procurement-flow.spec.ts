import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';
import { ensureAccountCategories, makeAccountFactory } from './_accounts';
import { KernelModule } from '../../src/kernel/kernel.module';
import { ProcurementModule } from '../../src/modules/procurement/procurement.module';
import { PurchaseOrdersService } from '../../src/modules/procurement/purchase-orders.service';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';

/**
 * Purchase-to-stock had no automated coverage, despite owning the money: it
 * capitalises inventory, raises and clears the GRNI accrual, credits the
 * supplier, and blocks over-receipt. These specs assert the accounting identity
 * of a received purchase order —
 *
 *   Dr Inventory + Dr Input Tax / Cr AP, with GRNI netting to zero
 *
 * — plus the guards that stop the same delivery being received twice.
 */
describeDb('integration: purchase order → goods receipt → GL', () => {
  const prisma = new PrismaClient();
  let moduleRef: TestingModule;
  let pos: PurchaseOrdersService;
  let tenant: TenantContextService;

  let organizationId: string;
  let warehouseId: string;
  let supplierId: string;
  let productId: string;
  let acct: Record<string, string>;

  const asOrg = <T>(fn: () => Promise<T>): Promise<T> => tenant.run({ organizationId }, fn);

  /** Net movement (debits − credits) on one account. */
  const balance = async (accountId: string) => {
    const agg = await prisma.journalLine.aggregate({
      where: { organizationId, accountId },
      _sum: { debit: true, credit: true },
    });
    return Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0);
  };

  const onHand = async () => {
    const si = await prisma.stockItem.findFirst({
      where: { organizationId, productId, locationId: warehouseId },
    });
    return Number(si?.quantity ?? 0);
  };

  beforeAll(async () => {
    await prisma.$connect();
    const org = await prisma.organization.create({
      data: { code: `INT-PROC-${Date.now()}`, name: 'Procurement Org', currencyCode: 'UGX' },
    });
    organizationId = org.id;

    const mk = makeAccountFactory(prisma, await ensureAccountCategories(prisma));
    const inventory = await mk(organizationId, 'PR-1400', 'Stock Valuation', 'inventory');
    const grni = await mk(organizationId, 'PR-2150', 'GRNI', 'current_liability');
    const ap = await mk(organizationId, 'PR-2100', 'Accounts Payable', 'payable');
    const inputTax = await mk(organizationId, 'PR-1450', 'Input Tax', 'tax');
    const cash = await mk(organizationId, 'PR-1100', 'Cash', 'cash');
    const bank = await mk(organizationId, 'PR-1200', 'Bank', 'bank');
    const cogs = await mk(organizationId, 'PR-5100', 'COGS', 'cost_of_goods_sold');
    acct = {
      inventory: inventory.id,
      grni: grni.id,
      ap: ap.id,
      inputTax: inputTax.id,
      cash: cash.id,
      bank: bank.id,
    };

    for (const [code, name, journalType] of [
      ['INV', 'Inventory', 'general'],
      ['PURCH', 'Purchases', 'purchase'],
      ['CASH', 'Cash', 'cash'],
      ['BANK', 'Bank', 'bank'],
    ] as const) {
      await prisma.journal.create({ data: { organizationId, code, name, journalType: journalType as any } });
    }

    for (const [key, accountId] of [
      ['stock_valuation', inventory.id],
      ['grni_accrued', grni.id],
      ['accounts_payable', ap.id],
      ['tax_receivable', inputTax.id],
      ['default_cash', cash.id],
      ['default_bank', bank.id],
      ['cogs', cogs.id],
    ] as const) {
      await prisma.accountMapping.create({ data: { organizationId, key, accountId } });
    }

    warehouseId = (
      await prisma.inventoryLocation.create({
        data: { organizationId, code: 'PR-WH', name: 'Purchasing Store', type: 'warehouse' },
      })
    ).id;
    supplierId = (
      await prisma.partner.create({
        data: { organizationId, code: 'PR-SUP', name: 'Acme Supplies', isSupplier: true },
      })
    ).id;
    productId = (
      await prisma.product.create({
        data: {
          organizationId,
          code: 'PR-ITEM',
          name: 'Coffee Beans',
          productType: 'stockable',
          trackInventory: true,
          costingMethod: 'AVCO',
          costPrice: 0,
          salesPrice: 0,
        } as any,
      })
    ).id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, ProcurementModule],
    }).compile();
    await moduleRef.init();
    pos = moduleRef.get(PurchaseOrdersService);
    tenant = moduleRef.get(TenantContextService);
  }, 120_000);

  afterAll(async () => {
    if (organizationId) {
      await prisma.goodsReceiptLine.deleteMany({ where: { organizationId } });
      await prisma.goodsReceiptNote.deleteMany({ where: { organizationId } });
      await prisma.purchasePayment.deleteMany({ where: { organizationId } });
      await prisma.purchaseOrderLine.deleteMany({ where: { organizationId } });
      await prisma.purchaseOrder.deleteMany({ where: { organizationId } });
      await prisma.inventoryLedger.deleteMany({ where: { organizationId } });
      await prisma.stockItem.deleteMany({ where: { organizationId } });
      await prisma.journalLine.deleteMany({ where: { organizationId } });
      await prisma.journalEntry.deleteMany({ where: { organizationId } });
      await prisma.auditLog.deleteMany({ where: { organizationId } });
      await prisma.accountMapping.deleteMany({ where: { organizationId } });
      await prisma.account.deleteMany({ where: { organizationId } });
      await prisma.journal.deleteMany({ where: { organizationId } });
      await prisma.product.deleteMany({ where: { organizationId } });
      await prisma.partner.deleteMany({ where: { organizationId } });
      await prisma.inventoryLocation.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } });
    }
    await moduleRef?.close();
    await prisma.$disconnect();
  }, 60_000);

  const createPo = (paymentType: 'cash' | 'credit', quantity: number, unitPrice: number, taxRate = 0) =>
    asOrg(() =>
      pos.create({
        partnerId: supplierId,
        warehouseId,
        paymentType,
        currencyCode: 'UGX',
        lines: [{ productId, description: 'Coffee Beans', quantity, unitPrice, taxRate }],
      } as any),
    );

  it('a credit purchase leaves Dr Inventory + Dr Input Tax / Cr AP and nets GRNI to zero', async () => {
    const before = {
      inventory: await balance(acct.inventory),
      grni: await balance(acct.grni),
      ap: await balance(acct.ap),
      inputTax: await balance(acct.inputTax),
    };

    const po = await createPo('credit', 10, 100, 18);
    await asOrg(() =>
      pos.receive(po.id, {
        warehouseId,
        lines: [{ productId, description: 'Coffee Beans', quantity: 10, unitCost: 100 }],
      } as any),
    );

    expect(await onHand()).toBe(10);
    // 10 × 100 capitalised.
    expect((await balance(acct.inventory)) - before.inventory).toBeCloseTo(1000, 2);
    // GRNI raised by the receipt and cleared by the voucher in the same tx.
    expect((await balance(acct.grni)) - before.grni).toBeCloseTo(0, 2);
    // 18% input tax reclaimed.
    expect((await balance(acct.inputTax)) - before.inputTax).toBeCloseTo(180, 2);
    // Supplier owed the gross — AP is a credit balance, hence negative net.
    expect((await balance(acct.ap)) - before.ap).toBeCloseTo(-1180, 2);
  }, 90_000);

  it('a cash purchase also relieves AP against cash, leaving AP flat', async () => {
    const beforeAp = await balance(acct.ap);
    const beforeCash = await balance(acct.cash);

    const po = await createPo('cash', 5, 40);
    await asOrg(() =>
      pos.receive(po.id, {
        warehouseId,
        lines: [{ productId, description: 'Coffee Beans', quantity: 5, unitCost: 40 }],
      } as any),
    );

    // Vouchered to AP then immediately settled → net zero movement on AP.
    expect((await balance(acct.ap)) - beforeAp).toBeCloseTo(0, 2);
    // Cash is credited by the 200 paid out.
    expect((await balance(acct.cash)) - beforeCash).toBeCloseTo(-200, 2);

    const settled = await prisma.purchaseOrder.findFirst({ where: { id: po.id } });
    expect(settled!.paymentStatus).toBe('paid');
  }, 90_000);

  it('advances the PO to partially_received, then received', async () => {
    const po = await createPo('credit', 10, 10);

    await asOrg(() =>
      pos.receive(po.id, {
        warehouseId,
        lines: [{ productId, description: 'Coffee Beans', quantity: 4, unitCost: 10 }],
      } as any),
    );
    expect((await prisma.purchaseOrder.findFirst({ where: { id: po.id } }))!.status).toBe('partially_received');

    await asOrg(() =>
      pos.receive(po.id, {
        warehouseId,
        lines: [{ productId, description: 'Coffee Beans', quantity: 6, unitCost: 10 }],
      } as any),
    );
    expect((await prisma.purchaseOrder.findFirst({ where: { id: po.id } }))!.status).toBe('received');
  }, 90_000);

  it('blocks over-receipt and leaves no stock or GL behind', async () => {
    const po = await createPo('credit', 3, 25);
    const beforeQty = await onHand();
    const beforeInventory = await balance(acct.inventory);

    await expect(
      asOrg(() =>
        pos.receive(po.id, {
          warehouseId,
          lines: [{ productId, description: 'Coffee Beans', quantity: 5, unitCost: 25 }],
        } as any),
      ),
    ).rejects.toThrow(/over-receiving/i);

    // The whole receive runs in one transaction — a rejected over-receipt must
    // not leave partial stock or a dangling journal entry.
    expect(await onHand()).toBe(beforeQty);
    expect(await balance(acct.inventory)).toBeCloseTo(beforeInventory, 2);
    expect((await prisma.purchaseOrder.findFirst({ where: { id: po.id } }))!.status).toBe('active');
  }, 90_000);

  it('refuses to receive against a fully received PO', async () => {
    const po = await createPo('credit', 2, 30);
    await asOrg(() =>
      pos.receive(po.id, {
        warehouseId,
        lines: [{ productId, description: 'Coffee Beans', quantity: 2, unitCost: 30 }],
      } as any),
    );

    await expect(
      asOrg(() =>
        pos.receive(po.id, {
          warehouseId,
          lines: [{ productId, description: 'Coffee Beans', quantity: 1, unitCost: 30 }],
        } as any),
      ),
    ).rejects.toThrow(/fully received/i);
  }, 90_000);

  it('settles a credit PO on payment: Dr AP / Cr Bank', async () => {
    const po = await createPo('credit', 1, 500);
    await asOrg(() =>
      pos.receive(po.id, {
        warehouseId,
        lines: [{ productId, description: 'Coffee Beans', quantity: 1, unitCost: 500 }],
      } as any),
    );

    const beforeAp = await balance(acct.ap);
    const beforeBank = await balance(acct.bank);

    await asOrg(() => pos.pay(po.id, { amount: 500, method: 'bank' } as any));

    expect((await balance(acct.ap)) - beforeAp).toBeCloseTo(500, 2);
    expect((await balance(acct.bank)) - beforeBank).toBeCloseTo(-500, 2);
    expect((await prisma.purchaseOrder.findFirst({ where: { id: po.id } }))!.paymentStatus).toBe('paid');
  }, 90_000);

  it('rejects a payment larger than the outstanding balance', async () => {
    const po = await createPo('credit', 1, 100);
    await asOrg(() =>
      pos.receive(po.id, {
        warehouseId,
        lines: [{ productId, description: 'Coffee Beans', quantity: 1, unitCost: 100 }],
      } as any),
    );

    await expect(asOrg(() => pos.pay(po.id, { amount: 999, method: 'bank' } as any))).rejects.toThrow(
      /exceeds remaining balance/i,
    );
  }, 90_000);
});
