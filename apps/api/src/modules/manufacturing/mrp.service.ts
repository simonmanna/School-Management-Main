import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { dec, ZERO } from '../../kernel/common/money';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';
import { BomService } from './bom.service';
import { ProductionRequestService } from './production-request.service';

/**
 * MRP-lite — closes the loop from demand to procurement. Wholesale orders and
 * min-stock breaches raise production requests; exploding open production orders'
 * material needs against on-hand emits a purchase request for the shortfall. All
 * additive: it creates draft documents for humans to act on, never auto-buys.
 */
@Injectable()
export class MrpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly seq: SequenceService,
    private readonly boms: BomService,
    private readonly requests: ProductionRequestService,
  ) {}

  private get org(): string {
    return this.tenant.organizationId;
  }

  /**
   * Raise a production request from a sales document (wholesale/advance order):
   * one line per document product that has an active BOM. Products without a BOM
   * are bought, not made, so they're skipped.
   */
  async raiseFromDocument(documentId: string) {
    const doc = await this.prisma.client.document.findFirst({
      where: { id: documentId },
      select: { id: true, documentNumber: true, dueDate: true },
    });
    if (!doc) throw new NotFoundException('Document not found');
    const lines = await this.prisma.client.documentLine.findMany({
      where: { documentId },
      select: { productId: true, quantity: true },
    });

    const reqLines = [];
    for (const l of lines) {
      if (!l.productId) continue;
      const bom = await this.boms.findActive(l.productId, '');
      if (!bom) continue; // not manufactured — leave to procurement
      reqLines.push({ productId: l.productId, quantity: Number(l.quantity), bomId: bom.id, neededBy: doc.dueDate });
    }
    if (reqLines.length === 0) return { raised: false, reason: 'No manufactured products on this document.' };

    const req = await this.requests.raiseRequest({
      sourceType: 'document',
      sourceId: doc.id,
      neededBy: doc.dueDate,
      notes: `From ${doc.documentNumber}`,
      lines: reqLines,
    });
    return { raised: true, request: req };
  }

  /**
   * Scan for products that (a) have an active BOM and (b) are below their
   * minimum, and raise a production request to top each back up. The make-side
   * mirror of the purchase reorder report.
   */
  async scanMinStock() {
    const products = await this.prisma.client.product.findMany({
      where: { manufacturingRole: 'finished', minQuantity: { gt: 0 }, isActive: true },
      select: { id: true, name: true, minQuantity: true, maxQuantity: true },
    });
    const lines = [];
    for (const p of products) {
      const bom = await this.boms.findActive(p.id, '');
      if (!bom) continue;
      const agg = await this.prisma.client.stockItem.aggregate({
        where: { productId: p.id },
        _sum: { quantity: true },
      });
      const onHand = dec(agg._sum.quantity ?? 0);
      const min = dec(p.minQuantity);
      if (onHand.gte(min)) continue;
      // Top up to max (else min) — one clean batch target.
      const target = dec(p.maxQuantity ?? 0).gt(min) ? dec(p.maxQuantity) : min;
      const qty = target.minus(onHand);
      if (qty.lte(ZERO)) continue;
      lines.push({ productId: p.id, quantity: Number(qty), bomId: bom.id });
    }
    if (lines.length === 0) return { raised: false, reason: 'Nothing below minimum.' };
    const req = await this.requests.raiseRequest({ sourceType: 'min_stock', sourceId: 'scan', lines });
    return { raised: true, request: req, lineCount: lines.length };
  }

  /**
   * Explode the material requirement of open production orders (draft/confirmed —
   * not yet consumed) against on-hand and open purchase orders, and raise a
   * DRAFT purchase request for the net shortfall.
   */
  async runMrp() {
    const openOrders = await this.prisma.client.productionOrder.findMany({
      where: { status: { in: ['draft', 'confirmed'] } },
      select: { scheduledFor: true, materials: { select: { productId: true, qtyPlanned: true, qtyConsumed: true, uomId: true } } },
    });

    // Gross requirement per raw product.
    const required = new Map<string, ReturnType<typeof dec>>();
    let earliest: Date | null = null;
    for (const o of openOrders) {
      if (o.scheduledFor && (!earliest || o.scheduledFor < earliest)) earliest = o.scheduledFor;
      for (const m of o.materials) {
        const need = dec(m.qtyPlanned).minus(dec(m.qtyConsumed));
        if (need.lte(ZERO)) continue;
        required.set(m.productId, (required.get(m.productId) ?? ZERO).plus(need));
      }
    }
    if (required.size === 0) return { raised: false, reason: 'No open material requirements.' };

    // Net against on-hand + open PO quantities.
    const openPo = await this.openPurchaseQuantities([...required.keys()]);
    const shortLines = [];
    for (const [productId, req] of required) {
      const agg = await this.prisma.client.stockItem.aggregate({ where: { productId }, _sum: { quantity: true } });
      const available = dec(agg._sum.quantity ?? 0).plus(openPo.get(productId) ?? ZERO);
      const short = req.minus(available);
      if (short.lte(ZERO)) continue;
      const product = await this.prisma.client.product.findFirst({ where: { id: productId }, select: { purchaseUomId: true, uomId: true } });
      shortLines.push({
        productId,
        description: 'MRP shortfall',
        quantity: short,
        unitOfMeasureId: product?.purchaseUomId ?? product?.uomId ?? null,
      });
    }
    if (shortLines.length === 0) return { raised: false, reason: 'On-hand + open POs cover all requirements.' };

    const requestNumber = await this.seq.next('purchase_request', { prefix: 'MRPPR-', padding: 5 });
    const pr = await this.prisma.client.purchaseRequest.create({
      data: {
        organizationId: this.org,
        requestNumber,
        requestedById: this.tenant.userId ?? null,
        description: 'Auto-generated from production MRP',
        neededBy: earliest,
        status: 'draft',
        createdBy: this.tenant.userId ?? null,
        lines: {
          create: shortLines.map((l, i) => ({
            organizationId: this.org,
            productId: l.productId,
            description: l.description,
            quantity: l.quantity,
            unitOfMeasureId: l.unitOfMeasureId,
            lineNumber: i,
          })),
        },
      },
      include: { lines: true },
    });
    return { raised: true, purchaseRequest: pr, lineCount: shortLines.length };
  }

  /** Best-effort sum of not-yet-received purchase-order quantities per product. */
  private async openPurchaseQuantities(productIds: string[]): Promise<Map<string, ReturnType<typeof dec>>> {
    const out = new Map<string, ReturnType<typeof dec>>();
    try {
      const lines = await this.prisma.client.purchaseOrderLine.findMany({
        where: {
          productId: { in: productIds },
          order: { status: { in: ['draft', 'approved', 'sent', 'partially_received'] as any } },
        },
        select: { productId: true, quantity: true },
      });
      for (const l of lines) {
        if (!l.productId) continue;
        out.set(l.productId, (out.get(l.productId) ?? ZERO).plus(dec(l.quantity)));
      }
    } catch {
      // PO schema differs — netting against on-hand only is still correct, just
      // more conservative (may suggest a bit more than strictly needed).
    }
    return out;
  }
}
