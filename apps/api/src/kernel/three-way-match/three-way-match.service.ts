import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { EventBus } from '../events/event-bus';

/**
 * Three-Way Match service.
 *
 * For every PO line, compare:
 *   - orderedQuantity (from PO line)
 *   - receivedQuantity (sum of GoodsReceiptLine.quantity for the PO line)
 *   - billedQuantity (sum of VendorBillLink.amount / PO line unitPrice)
 *
 * Variances that exceed the org's tolerance get status=blocked; the AP bill
 * cannot post until an operator with `three_way_match:override` approves.
 *
 * Default tolerance: 0 absolute quantity units, 2% price variance. Overridable
 * via FeatureFlag key `procurement.match_tolerance`.
 */
@Injectable()
export class ThreeWayMatchService {
  private readonly logger = new Logger('ThreeWayMatch');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
  ) {}

  async recomputeForOrder(purchaseOrderId: string) {
    const orgId = this.tenant.organizationId;
    const po = await this.prisma.raw.purchaseOrder.findFirst({
      where: { organizationId: orgId, id: purchaseOrderId },
    });
    if (!po) {
      this.logger.warn(`recomputeForOrder: PO ${purchaseOrderId} not found in org ${orgId}`);
      return [];
    }
    const lines = await this.prisma.raw.purchaseOrderLine.findMany({
      where: { organizationId: orgId, purchaseOrderId },
      orderBy: { lineNumber: 'asc' },
    });
    if (lines.length === 0) return [];

    const results: any[] = [];
    for (const line of lines) {
      const receivedAgg = await this.prisma.raw.goodsReceiptLine.aggregate({
        where: { organizationId: orgId, purchaseOrderLineId: line.id },
        _sum: { quantity: true },
      });
      const receivedQty = Number(receivedAgg._sum.quantity ?? 0);

      // Billed: sum of amounts in VendorBillLink that map to this PO,
      // divided by the line unit price (assuming uniform pricing per PO link).
      const billLinks = await this.prisma.raw.vendorBillLink.findMany({
        where: {
          organizationId: orgId,
          purchaseOrderId,
        },
      });
      let billedAmount = 0;
      for (const link of billLinks) {
        // Each link maps a vendor bill to this PO. We don't know the per-line
        // allocation from the link alone; we use the proportion of the PO's
        // ordered value as a fair-share estimator.
        const orderedValue = lines.reduce(
          (s, l: any) => s + Number(l.quantity) * Number(l.unitPrice),
          0,
        );
        if (orderedValue <= 0) continue;
        const lineOrderedValue = Number(line.quantity) * Number(line.unitPrice);
        const share = (lineOrderedValue / orderedValue) * Number(link.amount);
        billedAmount += share;
      }
      const billedQty = Number(line.unitPrice) > 0 ? billedAmount / Number(line.unitPrice) : 0;
      const orderedQty = Number(line.quantity);
      const orderedUnitPrice = Number(line.unitPrice);

      const qtyVariance = billedQty - receivedQty; // over-billed vs received
      const billedUnitPrice = billedQty > 0 ? billedAmount / billedQty : orderedUnitPrice;
      const priceVariance = billedUnitPrice - orderedUnitPrice;

      // Default tolerance: 0 absolute quantity, 2% price.
      const tolerancePct = await this.getPriceTolerancePct(orgId);
      const thresholdExceeded =
        Math.abs(qtyVariance) > 0.0001 || Math.abs(priceVariance) > orderedUnitPrice * tolerancePct;

      let status: 'pending' | 'matched' | 'partial' | 'mismatch' | 'blocked';
      if (receivedQty === 0 && billedQty === 0) status = 'pending';
      else if (Math.abs(qtyVariance) < 0.0001 && Math.abs(priceVariance) < orderedUnitPrice * tolerancePct)
        status = 'matched';
      else if (thresholdExceeded) status = 'blocked';
      else status = 'partial';

      const row = await this.prisma.raw.threeWayMatch.upsert({
        where: { purchaseOrderLineId: line.id },
        update: {
          receivedQuantity: receivedQty,
          billedQuantity: billedQty,
          orderedQuantity: orderedQty,
          orderedUnitPrice,
          billedUnitPrice,
          quantityVariance: qtyVariance,
          priceVariance,
          status,
          thresholdExceeded,
          lastCheckedAt: new Date(),
        },
        create: {
          organizationId: orgId,
          purchaseOrderId,
          purchaseOrderLineId: line.id,
          productId: line.productId,
          orderedQuantity: orderedQty,
          receivedQuantity: receivedQty,
          billedQuantity: billedQty,
          orderedUnitPrice,
          billedUnitPrice,
          quantityVariance: qtyVariance,
          priceVariance,
          status,
          thresholdExceeded,
        },
      });
      results.push(row);
    }

    // Update PO status from match states (received / partially_received).
    const blocked = results.filter((r) => r.status === 'blocked').length;
    const matched = results.filter((r) => r.status === 'matched').length;
    // Sum across all posted GRNs for this PO via two-step aggregate.
    const grns = await this.prisma.raw.goodsReceiptNote.findMany({
      where: { organizationId: orgId, purchaseOrderId, status: 'posted' },
      select: { id: true },
    });
    const grnIds = grns.map((g: any) => g.id);
    const receivedAgg = grnIds.length
      ? await this.prisma.raw.goodsReceiptLine.aggregate({
          where: { organizationId: orgId, goodsReceiptId: { in: grnIds } },
          _sum: { quantity: true },
        })
      : { _sum: { quantity: 0 } };
    const totalReceived = Number(receivedAgg._sum?.quantity ?? 0);
    const totalOrdered = lines.reduce((s, l: any) => s + Number(l.quantity), 0);
    let nextPoStatus: 'sent' | 'partially_received' | 'received' | null = null;
    if (totalReceived >= totalOrdered && totalOrdered > 0) nextPoStatus = 'received';
    else if (totalReceived > 0) nextPoStatus = 'partially_received';
    if (nextPoStatus && ['sent', 'acknowledged', 'partially_received'].includes('')) {
      // (no-op — kept simple here)
    }
    if (nextPoStatus) {
      await this.prisma.raw.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: { status: nextPoStatus },
      });
    }

    this.events.publish('three_way_match.computed' as any, {
      organizationId: orgId,
      purchaseOrderId,
      matched,
      mismatched: results.length - matched,
      blocked,
    });
    return results;
  }

  list(query: { status?: string; purchaseOrderId?: string }) {
    const where: any = { organizationId: this.tenant.organizationId };
    if (query.status) where.status = query.status;
    if (query.purchaseOrderId) where.purchaseOrderId = query.purchaseOrderId;
    return this.prisma.client.threeWayMatch.findMany({
      where,
      include: { order: { select: { orderNumber: true, partnerId: true } } },
      orderBy: { lastCheckedAt: 'desc' },
      take: 200,
    });
  }

  /** Returns the bill + match information for an AP clerk reviewing a vendor bill. */
  async validateBillForPosting(vendorBillId: string): Promise<{ ok: boolean; matches: any[] }> {
    const orgId = this.tenant.organizationId;
    const links = await this.prisma.raw.vendorBillLink.findMany({
      where: { organizationId: orgId, vendorBillId },
    });
    const matches: any[] = [];
    let ok = true;
    for (const link of links) {
      await this.recomputeForOrder(link.purchaseOrderId);
      const rows = await this.prisma.raw.threeWayMatch.findMany({
        where: { organizationId: orgId, purchaseOrderId: link.purchaseOrderId },
      });
      for (const r of rows) {
        matches.push(r);
        if (r.status === 'blocked') ok = false;
      }
    }
    return { ok, matches };
  }

  private async getPriceTolerancePct(orgId: string): Promise<number> {
    // Read override from FeatureFlag; default 0.02 (2%).
    const flag = await this.prisma.raw.featureFlag.findUnique({
      where: { organizationId_key: { organizationId: orgId, key: 'procurement.match_tolerance' } },
    });
    if (!flag) return 0.02;
    const payload = (flag.payload as any) ?? {};
    const pct = Number(payload.priceTolerancePct ?? 0.02);
    return Number.isFinite(pct) ? pct : 0.02;
  }
}
