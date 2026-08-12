/**
 * Backfill for the inventory / purchases GL + drift remediation (Phase A + B).
 *
 * Repairs data created before the following fixes went live:
 *   A1  goods receipts now post Dr Stock Valuation / Cr GRNI
 *   A3  PO payments now post Dr AP / Cr Cash|Bank
 *   B1  batch-tracked issues now decrement StockItem.quantity
 *
 * Three independent passes, per organization:
 *   1. BATCH DRIFT  — reset StockItem.quantity to Σ(active batch qty) for
 *      batch-tracked products, undoing the on-hand inflation from the old
 *      batch-issue bug. Pure quantity, no GL.
 *   2. GRN GL       — for every posted GoodsReceiptNote with no journal entry,
 *      post the receipt (Dr Stock / Cr GRNI) and, when it references a PO, the
 *      supplier voucher (Dr GRNI + Input Tax / Cr AP). Value = Σ(unitCost×qty),
 *      which is UOM-invariant, so no unit conversion is needed here.
 *   3. PAYMENT GL   — for every PurchasePayment with no journal entry, post
 *      Dr AP / Cr Cash|Bank (cash for cash POs, bank otherwise).
 *
 * SAFETY
 *   - DRY-RUN BY DEFAULT. Prints exactly what it would change. Pass --apply to
 *     write. Review the dry-run report first.
 *   - Idempotent: every pass re-checks for an existing journal entry / matching
 *     quantity before acting, so re-running never double-posts.
 *   - --before <ISO>  only touches GRNs / payments dated before this instant
 *     (default: now). Run once right after deploy so live postings — which are
 *     created going forward by the fixed code — are never re-posted.
 *   - --org <id>      restrict to a single organization.
 *
 *   npx ts-node src/scripts/backfill-inventory-gl.ts            # dry run, all orgs
 *   npx ts-node src/scripts/backfill-inventory-gl.ts --apply    # write
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../kernel/prisma/prisma.service';
import { TenantContextService } from '../kernel/tenancy/tenant-context.service';
import { StockPostingService } from '../modules/inventory/posting/stock-posting.service';
import { InventoryQueryService } from '../modules/inventory/inventory-query.service';
import { dec, ZERO } from '../kernel/common/money';

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const APPLY = process.argv.includes('--apply');
const BEFORE = argValue('--before') ? new Date(argValue('--before')!) : new Date();
const ONLY_ORG = argValue('--org');

type Totals = { batchFixes: number; batchQtyMoved: number; grnPosts: number; grnValue: number; payPosts: number; payValue: number };

async function backfillOrg(
  orgId: string,
  orgName: string,
  prisma: PrismaService,
  stockPosting: StockPostingService,
  queries: InventoryQueryService,
  totals: Totals,
) {
  console.log(`\n── ${orgName} (${orgId}) ──`);

  // ── 1. Batch drift: StockItem.quantity ← Σ active batch qty ────────────────
  const recon = await queries.getStockReconciliation({});
  const batchDrifts = recon.rows.filter((r) => r.batchDrift != null && !dec(r.batchDrift).isZero());
  for (const r of batchDrifts) {
    const target = dec(r.batches ?? 0);
    const from = dec(r.cached);
    console.log(
      `  [batch] ${r.code ?? r.productId} @ ${r.locationName ?? r.locationId}: ${from.toString()} → ${target.toString()} (drift ${r.batchDrift})`,
    );
    totals.batchFixes += 1;
    totals.batchQtyMoved += Math.abs(from.minus(target).toNumber());
    if (APPLY) {
      await prisma.client.stockItem.updateMany({
        where: { organizationId: orgId, productId: r.productId, variantKey: r.variantKey, locationId: r.locationId },
        data: { quantity: target.toString() },
      });
    }
  }

  // ── 2. GRN GL: post the receipt (+ voucher when PO-linked) if none exists ───
  const grns = await prisma.client.goodsReceiptNote.findMany({
    where: { organizationId: orgId, status: 'posted', postedAt: { lt: BEFORE } },
    include: { lines: true },
  });
  for (const grn of grns) {
    const existing = await prisma.client.journalEntry.findFirst({
      where: { organizationId: orgId, sourceType: 'goods_receipt', sourceId: grn.id },
      select: { id: true },
    });
    if (existing) continue;

    const productLines = grn.lines.filter((l: any) => l.productId);
    let net = ZERO;
    for (const l of productLines) net = net.plus(dec(l.unitCost).times(dec(l.quantity)));
    if (net.lte(ZERO)) continue;

    console.log(`  [grn] ${grn.receiptNumber}: post receipt GL, value ${net.toString()}${grn.purchaseOrderId ? ' + voucher' : ' (GRNI open, ad-hoc)'}`);
    totals.grnPosts += 1;
    totals.grnValue += net.toNumber();
    if (APPLY) {
      await prisma.client.$transaction(async (tx: any) => {
        let po: any = null;
        if (grn.purchaseOrderId) {
          po = await tx.purchaseOrder.findFirst({ where: { id: grn.purchaseOrderId, organizationId: orgId }, include: { lines: true } });
        }
        const poLineById = new Map<string, any>((po?.lines ?? []).map((l: any) => [l.id, l]));
        let tax = ZERO;
        for (const l of productLines) {
          const lineNet = dec(l.unitCost).times(dec(l.quantity));
          await stockPosting.postReceipt({
            productId: l.productId!,
            quantity: dec(l.quantity),
            unitCost: dec(l.unitCost),
            date: grn.postedAt ?? grn.receivedAt ?? new Date(),
            sourceType: 'goods_receipt',
            sourceId: grn.id,
            description: `Backfill receipt · GRN ${grn.receiptNumber}`,
            tx,
          });
          if (po) {
            const poLine = l.purchaseOrderLineId ? poLineById.get(l.purchaseOrderLineId) : undefined;
            const rate = poLine ? dec(poLine.taxRate ?? 0) : ZERO;
            tax = tax.plus(lineNet.times(rate).dividedBy(100));
          }
        }
        if (po) {
          await stockPosting.postReceiptVoucher({
            partnerId: po.partnerId,
            netTotal: net,
            taxTotal: tax,
            date: grn.postedAt ?? grn.receivedAt ?? new Date(),
            sourceType: 'goods_receipt',
            sourceId: grn.id,
            description: `Backfill voucher · GRN ${grn.receiptNumber} · PO ${po.orderNumber}`,
            tx,
          });
        }
      });
    }
  }

  // ── 3. Payment GL: Dr AP / Cr Cash|Bank if none exists ─────────────────────
  const payments = await prisma.client.purchasePayment.findMany({
    where: { organizationId: orgId, paidAt: { lt: BEFORE } },
    include: { order: true },
  });
  for (const p of payments) {
    const existing = await prisma.client.journalEntry.findFirst({
      where: { organizationId: orgId, sourceType: 'purchase_payment', sourceId: p.id },
      select: { id: true },
    });
    if (existing) continue;
    const po = p.order;
    if (!po) continue;
    const amount = dec(p.amount);
    if (amount.lte(ZERO)) continue;
    const method = po.paymentType === 'cash' ? 'cash' : 'bank';

    console.log(`  [pay] PO ${po.orderNumber}: Dr AP / Cr ${method} ${amount.toString()}`);
    totals.payPosts += 1;
    totals.payValue += amount.toNumber();
    if (APPLY) {
      await prisma.client.$transaction(async (tx: any) => {
        await stockPosting.postPurchasePayment({
          partnerId: po.partnerId,
          amount,
          method,
          date: p.paidAt ?? new Date(),
          sourceType: 'purchase_payment',
          sourceId: p.id,
          description: `Backfill payment · PO ${po.orderNumber}`,
          tx,
        });
      });
    }
  }
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  const prisma = app.get(PrismaService);
  const tenant = app.get(TenantContextService);
  const stockPosting = app.get(StockPostingService);
  const queries = app.get(InventoryQueryService);

  const totals: Totals = { batchFixes: 0, batchQtyMoved: 0, grnPosts: 0, grnValue: 0, payPosts: 0, payValue: 0 };

  console.log(`Inventory/purchases GL backfill — ${APPLY ? 'APPLY (writing)' : 'DRY RUN'} · before ${BEFORE.toISOString()}`);
  try {
    const orgs = await prisma.raw.organization.findMany({
      where: ONLY_ORG ? { id: ONLY_ORG } : {},
      select: { id: true, name: true },
    });
    for (const org of orgs) {
      await tenant.run(
        { organizationId: org.id, userId: 'system:backfill', permissions: ['*'] },
        () => backfillOrg(org.id, org.name, prisma, stockPosting, queries, totals),
      );
    }
  } finally {
    await app.close();
  }

  console.log('\n════ Summary ════');
  console.log(`  batch drift cells : ${totals.batchFixes} (Σ|Δqty| ${totals.batchQtyMoved})`);
  console.log(`  GRN GL entries    : ${totals.grnPosts} (value ${totals.grnValue.toFixed(2)})`);
  console.log(`  payment GL entries: ${totals.payPosts} (value ${totals.payValue.toFixed(2)})`);
  console.log(APPLY ? '  → written.' : '  → dry run only. Re-run with --apply to write.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
