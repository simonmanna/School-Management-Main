import { Injectable } from '@nestjs/common';
import { dec, ZERO } from '../../kernel/common/money';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { BomService } from './bom.service';

/**
 * Read-only manufacturing analytics: the WIP reconciliation control, batch
 * genealogy (recall), KPIs, and multi-level shortage. Never mutates.
 */
@Injectable()
export class ProductionReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly boms: BomService,
  ) {}

  private get org(): string {
    return this.tenant.organizationId;
  }

  /**
   * WIP balance reconciliation — the control that catches a stuck order. GL 1420
   * should equal the material+overhead cost of every order currently in progress
   * (or on QC hold). A non-zero drift means an order posted a consume without its
   * matching output, or vice versa.
   */
  async wipReconciliation() {
    const mapping = await this.prisma.client.accountMapping.findFirst({
      where: { organizationId: this.org, key: 'wip' },
      select: { accountId: true },
    });
    let glBalance = ZERO;
    if (mapping) {
      const agg = await this.prisma.client.journalLine.aggregate({
        where: { organizationId: this.org, accountId: mapping.accountId },
        _sum: { debit: true, credit: true },
      });
      glBalance = dec(agg._sum.debit ?? 0).minus(dec(agg._sum.credit ?? 0));
    }
    const open = await this.prisma.client.productionOrder.findMany({
      where: { status: { in: ['in_progress', 'qc_hold'] } },
      select: { id: true, orderCode: true, status: true, materialCost: true, overheadCost: true },
    });
    const openWip = open.reduce((s, o) => s.plus(dec(o.materialCost)).plus(dec(o.overheadCost)), ZERO);
    const drift = glBalance.minus(openWip);
    return {
      glBalance: glBalance.toString(),
      openOrdersWip: openWip.toString(),
      drift: drift.toString(),
      balanced: drift.abs().lte(dec('0.01')),
      openOrders: open.map((o) => ({ ...o, wip: dec(o.materialCost).plus(dec(o.overheadCost)).toString() })),
    };
  }

  /**
   * Backward genealogy — from a finished batch to the material lots that made it.
   * Each material's InventoryLedger row (via ledgerCode) carries the batch it was
   * drawn from and the reference of the document that received that lot.
   */
  async genealogyBackward(orderId: string) {
    const order = await this.prisma.client.productionOrder.findFirst({
      where: { id: orderId },
      include: { materials: true, outputs: true },
    });
    if (!order) return null;

    const materials = await Promise.all(
      order.materials.map(async (m) => {
        let sourceRef: { referenceType: string | null; referenceId: string | null; batchId: string | null } | null = null;
        if (m.ledgerCode) {
          const ledger = await this.prisma.client.inventoryLedger.findFirst({
            where: { organizationId: this.org, ledgerCode: m.ledgerCode },
            select: { batchId: true, referenceType: true, referenceId: true },
          });
          sourceRef = ledger ?? null;
        }
        return {
          productId: m.productId,
          productName: m.productName,
          qtyConsumed: m.qtyConsumed.toString(),
          unitCost: m.unitCost.toString(),
          ledgerCode: m.ledgerCode,
          consumedFromBatchId: sourceRef?.batchId ?? null,
          receivedVia: sourceRef ? { type: sourceRef.referenceType, id: sourceRef.referenceId } : null,
        };
      }),
    );

    return {
      order: { id: order.id, orderCode: order.orderCode, outputUnitCost: order.outputUnitCost.toString() },
      outputs: order.outputs.map((o) => ({ productName: o.productName, qtyProduced: o.qtyProduced.toString(), batchNumber: o.batchNumber, batchId: o.batchId })),
      materials,
    };
  }

  /**
   * Forward genealogy — from a raw material to every production order that
   * consumed it and the output batches produced. The recall direction.
   */
  async genealogyForward(productId: string) {
    const materials = await this.prisma.client.productionMaterial.findMany({
      where: { productId },
      select: { orderId: true, qtyConsumed: true },
    });
    const orderIds = [...new Set(materials.map((m) => m.orderId))];
    const orders = await this.prisma.client.productionOrder.findMany({
      where: { id: { in: orderIds } },
      include: { outputs: true },
    });
    return orders.map((o) => ({
      orderId: o.id,
      orderCode: o.orderCode,
      status: o.status,
      completedAt: o.completedAt,
      outputs: o.outputs.map((out) => ({ productName: out.productName, qtyProduced: out.qtyProduced.toString(), batchNumber: out.batchNumber })),
    }));
  }

  /** Period KPIs — yield %, waste %, cost per batch, throughput. */
  async kpis(params: { from?: string; to?: string } = {}) {
    const where: Record<string, unknown> = { status: 'completed' };
    if (params.from || params.to) {
      where.completedAt = {
        ...(params.from ? { gte: new Date(params.from) } : {}),
        ...(params.to ? { lte: new Date(params.to) } : {}),
      };
    }
    const orders = await this.prisma.client.productionOrder.findMany({
      where,
      select: { plannedQty: true, producedQty: true, scrapQty: true, totalCost: true, outputUnitCost: true },
    });
    const count = orders.length;
    const planned = orders.reduce((s, o) => s.plus(dec(o.plannedQty)), ZERO);
    const produced = orders.reduce((s, o) => s.plus(dec(o.producedQty)), ZERO);
    const scrap = orders.reduce((s, o) => s.plus(dec(o.scrapQty)), ZERO);
    const totalCost = orders.reduce((s, o) => s.plus(dec(o.totalCost)), ZERO);
    const pct = (n: ReturnType<typeof dec>, d: ReturnType<typeof dec>) => (d.gt(ZERO) ? Number(n.div(d).mul(100).toFixed(2)) : 0);

    // Waste by reason (QC failures + their categories).
    const qc = await this.prisma.client.productionQcCheck.groupBy({
      by: ['wasteCategory'],
      where: { wasteCategory: { not: null }, order: { ...(where.completedAt ? { completedAt: where.completedAt } : {}) } } as any,
      _sum: { failedQty: true },
    }).catch(() => [] as any[]);

    return {
      orders: count,
      plannedQty: planned.toString(),
      producedQty: produced.toString(),
      scrapQty: scrap.toString(),
      yieldPct: pct(produced, planned),
      wastePct: pct(scrap, planned),
      totalCost: totalCost.toString(),
      avgCostPerBatch: count ? totalCost.div(count).toString() : '0',
      wasteByReason: (qc as any[]).map((r) => ({ reason: r.wasteCategory, qty: String(r._sum?.failedQty ?? 0) })),
    };
  }

  // ===========================================================================
  // Phase 2.5 — trend analytics (read models over Phase 1-2 data)
  // ===========================================================================

  /** Production throughput + cost over time, bucketed by day. */
  async trends(params: { from?: string; to?: string } = {}) {
    const orders = await this.completedInWindow(params, {
      completedAt: true,
      producedQty: true,
      scrapQty: true,
      totalCost: true,
    });
    const buckets = new Map<string, { produced: ReturnType<typeof dec>; scrap: ReturnType<typeof dec>; cost: ReturnType<typeof dec>; orders: number }>();
    for (const o of orders) {
      const day = (o.completedAt ?? new Date()).toISOString().slice(0, 10);
      const b = buckets.get(day) ?? { produced: ZERO, scrap: ZERO, cost: ZERO, orders: 0 };
      b.produced = b.produced.plus(dec(o.producedQty));
      b.scrap = b.scrap.plus(dec(o.scrapQty));
      b.cost = b.cost.plus(dec(o.totalCost));
      b.orders += 1;
      buckets.set(day, b);
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, b]) => ({ date, orders: b.orders, produced: b.produced.toString(), scrap: b.scrap.toString(), cost: b.cost.toString() }));
  }

  /** Yield % by BOM version — shows whether v3 actually beats v2. */
  async yieldByBom(params: { from?: string; to?: string } = {}) {
    const orders = await this.completedInWindow(params, {
      bomId: true,
      bomVersion: true,
      plannedQty: true,
      producedQty: true,
    });
    const groups = new Map<string, { bomId: string | null; version: number | null; planned: ReturnType<typeof dec>; produced: ReturnType<typeof dec>; runs: number }>();
    for (const o of orders) {
      const key = `${o.bomId ?? 'adhoc'}::${o.bomVersion ?? 0}`;
      const g = groups.get(key) ?? { bomId: o.bomId, version: o.bomVersion, planned: ZERO, produced: ZERO, runs: 0 };
      g.planned = g.planned.plus(dec(o.plannedQty));
      g.produced = g.produced.plus(dec(o.producedQty));
      g.runs += 1;
      groups.set(key, g);
    }
    return [...groups.values()].map((g) => ({
      bomId: g.bomId,
      version: g.version,
      runs: g.runs,
      plannedQty: g.planned.toString(),
      producedQty: g.produced.toString(),
      yieldPct: g.planned.gt(ZERO) ? Number(g.produced.div(g.planned).mul(100).toFixed(2)) : 0,
    }));
  }

  /** Ingredient consumption over the window — what the bakery is burning through. */
  async ingredientUsage(params: { from?: string; to?: string } = {}) {
    const orders = await this.completedInWindow(params, { id: true });
    const orderIds = orders.map((o) => o.id);
    if (orderIds.length === 0) return [];
    const materials = await this.prisma.client.productionMaterial.findMany({
      where: { orderId: { in: orderIds } },
      select: { productId: true, productName: true, qtyConsumed: true, totalCost: true },
    });
    const groups = new Map<string, { name: string; qty: ReturnType<typeof dec>; cost: ReturnType<typeof dec> }>();
    for (const m of materials) {
      const g = groups.get(m.productId) ?? { name: m.productName, qty: ZERO, cost: ZERO };
      g.qty = g.qty.plus(dec(m.qtyConsumed));
      g.cost = g.cost.plus(dec(m.totalCost));
      groups.set(m.productId, g);
    }
    return [...groups.entries()]
      .map(([productId, g]) => ({ productId, name: g.name, qtyConsumed: g.qty.toString(), cost: g.cost.toString() }))
      .sort((a, b) => Number(b.cost) - Number(a.cost));
  }

  /**
   * Work-centre capacity snapshot: open work-order minutes vs daily resource
   * capacity. Load > 100% means the centre is a bottleneck for the current plan.
   */
  async capacity() {
    const centres = await this.prisma.client.workCenter.findMany({
      where: { isActive: true },
      include: { resources: { where: { isActive: true }, select: { capacityMinsPerDay: true } } },
    });
    const open = await this.prisma.client.workOrder.findMany({
      where: { status: { in: ['pending', 'in_progress', 'paused'] } },
      select: { workCenterId: true, plannedDurationMins: true },
    });
    const load = new Map<string, number>();
    for (const wo of open) {
      if (!wo.workCenterId) continue;
      load.set(wo.workCenterId, (load.get(wo.workCenterId) ?? 0) + (wo.plannedDurationMins ?? 0));
    }
    return centres.map((c) => {
      const capacity = c.resources.reduce((s, r) => s + (r.capacityMinsPerDay ?? 0), 0);
      const loadMins = load.get(c.id) ?? 0;
      return {
        workCenterId: c.id,
        name: c.name,
        capacityMinsPerDay: capacity,
        loadMins,
        utilizationPct: capacity > 0 ? Number(((loadMins / capacity) * 100).toFixed(1)) : null,
      };
    });
  }

  private async completedInWindow(params: { from?: string; to?: string }, select: Record<string, boolean>): Promise<any[]> {
    const where: Record<string, unknown> = { status: 'completed' };
    if (params.from || params.to) {
      where.completedAt = {
        ...(params.from ? { gte: new Date(params.from) } : {}),
        ...(params.to ? { lte: new Date(params.to) } : {}),
      };
    }
    return this.prisma.client.productionOrder.findMany({ where, select }) as any;
  }

  /** Multi-level shortage: required raw materials for a run vs on-hand. */
  async shortage(productId: string, qty: number, locationId?: string) {
    const req = await this.boms.explodeRequirements(productId, null, qty);
    const rows = [];
    for (const [rawId, required] of req) {
      const where: Record<string, unknown> = { organizationId: this.org, productId: rawId };
      if (locationId) where.locationId = locationId;
      const agg = await this.prisma.client.stockItem.aggregate({ where, _sum: { quantity: true } });
      const onHand = dec(agg._sum.quantity ?? 0);
      const product = await this.prisma.client.product.findFirst({ where: { id: rawId }, select: { name: true, code: true } });
      const short = required.minus(onHand);
      rows.push({
        productId: rawId,
        name: product?.name ?? rawId,
        code: product?.code ?? '',
        required: required.toString(),
        onHand: onHand.toString(),
        shortage: short.gt(ZERO) ? short.toString() : '0',
      });
    }
    return { productId, qty, lines: rows, hasShortage: rows.some((r) => Number(r.shortage) > 0) };
  }
}
