import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';

/**
 * Beverage Control — read-only variance / yield / shrinkage reporting.
 *
 * Pours sold come from real POS sales × recipes (no separate mapping): a sale of
 * a beverage product deducts ml directly; a menu item (e.g. "Whiskey Shot")
 * expands through its recipe (MenuProduct) to the underlying bottle product. The
 * weighed truth comes from the latest submitted bottle counts.
 */
@Injectable()
export class BeverageReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  private get org(): string {
    return this.tenant.organizationId;
  }

  /** All digital-weight (bar alcohol) products with their conversion + cost meta. */
  private async beverageProducts() {
    const rows = await this.prisma.client.product.findMany({
      where: { measurementMethod: 'digital_weight' },
      select: {
        id: true, name: true, containerVolumeMl: true, standardPourMl: true,
        costPrice: true, conversionFactorMlPerG: true, isActive: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      containerVolumeMl: Number(r.containerVolumeMl ?? 0),
      standardPourMl: Number(r.standardPourMl ?? 0),
      costPerMl: Number(r.costPrice ?? 0),
      isActive: r.isActive,
    }));
  }

  /**
   * Sum ml sold per beverage product in [from,to). Expands menu-item recipes to
   * the underlying bottle products; direct beverage-product lines count as ml.
   * Optionally also groups by waiter (bartender attribution).
   */
  private async soldMl(
    from: Date,
    to: Date,
    bevIds: Set<string>,
    opts: { byWaiter?: boolean } = {},
  ): Promise<{ byProduct: Map<string, number>; byWaiter: Map<string, { ml: number; value: number }>; alcoholSalesValue: number }> {
    const invoices = await this.prisma.client.invoice.findMany({
      where: {
        issueDate: { gte: from, lt: to },
        status: { notIn: ['draft', 'cancelled'] as any },
      },
      select: {
        waiterId: true,
        items: { select: { productId: true, menuItemId: true, quantity: true, total: true } },
      },
    });

    // Preload recipes for any menu items referencing beverage products.
    const menuItemIds = new Set<string>();
    for (const inv of invoices) for (const it of inv.items) if (it.menuItemId) menuItemIds.add(it.menuItemId);
    const recipes = menuItemIds.size
      ? await this.prisma.client.menuProduct.findMany({
          where: { menuItemId: { in: [...menuItemIds] }, productId: { in: [...bevIds] } },
          select: { menuItemId: true, productId: true, quantity: true },
        })
      : [];
    const recipeByMenuItem = new Map<string, { productId: string; qty: number }[]>();
    for (const r of recipes) {
      const list = recipeByMenuItem.get(r.menuItemId) ?? [];
      list.push({ productId: r.productId, qty: Number(r.quantity) });
      recipeByMenuItem.set(r.menuItemId, list);
    }

    const byProduct = new Map<string, number>();
    const byWaiter = new Map<string, { ml: number; value: number }>();
    let alcoholSalesValue = 0;
    const addProduct = (pid: string, ml: number) => byProduct.set(pid, (byProduct.get(pid) ?? 0) + ml);

    for (const inv of invoices) {
      const waiter = inv.waiterId ?? 'unassigned';
      for (const it of inv.items) {
        const qty = Number(it.quantity);
        let lineMl = 0;
        let isAlcohol = false;
        if (it.productId && bevIds.has(it.productId)) {
          lineMl = qty;
          addProduct(it.productId, qty);
          isAlcohol = true;
        } else if (it.menuItemId && recipeByMenuItem.has(it.menuItemId)) {
          for (const ing of recipeByMenuItem.get(it.menuItemId)!) {
            const ml = ing.qty * qty;
            lineMl += ml;
            addProduct(ing.productId, ml);
          }
          isAlcohol = lineMl > 0;
        }
        if (isAlcohol) {
          const value = Number(it.total);
          alcoholSalesValue += value;
          if (opts.byWaiter) {
            const w = byWaiter.get(waiter) ?? { ml: 0, value: 0 };
            w.ml += lineMl;
            w.value += value;
            byWaiter.set(waiter, w);
          }
        }
      }
    }
    return { byProduct, byWaiter, alcoholSalesValue };
  }

  /** Latest submitted bottle-count line per product (optionally by location). */
  private async latestCountLines(locationId?: string) {
    const sessions = await this.prisma.client.bottleCountSession.findMany({
      where: { status: 'submitted', ...(locationId ? { locationId } : {}) },
      orderBy: { submittedAt: 'desc' },
      take: 50,
      include: { lines: true },
    });
    // Keep the most recent line per product.
    const byProduct = new Map<string, any>();
    for (const s of sessions) {
      for (const l of s.lines) {
        if (!byProduct.has(l.productId)) byProduct.set(l.productId, { ...l, submittedAt: s.submittedAt, locationId: s.locationId });
      }
    }
    return byProduct;
  }

  // ── reports ──────────────────────────────────────────────────────────────

  /** Bottle variance — weighed vs system, per product, from the latest counts. */
  async variance(locationId?: string) {
    const [products, latest] = await Promise.all([this.beverageProducts(), this.latestCountLines(locationId)]);
    const rows = products.map((p) => {
      const l = latest.get(p.id);
      const systemMl = l ? Number(l.systemMl) : 0;
      const countedMl = l && l.countedMl != null ? Number(l.countedMl) : null;
      const varianceMl = l ? Number(l.varianceMl) : 0;
      const varianceG = l ? Number(l.varianceG) : 0;
      const lossValue = varianceMl < 0 ? Math.abs(varianceMl) * p.costPerMl : 0;
      const variancePct = systemMl > 0 ? (varianceMl / systemMl) * 100 : 0;
      return {
        productId: p.id, product: p.name,
        systemMl, countedMl, varianceMl, varianceG,
        variancePct: round(variancePct, 2), lossValue: round(lossValue, 2),
        confidence: l?.confidence ?? null, countedAt: l?.submittedAt ?? null,
      };
    });
    return rows.filter((r) => r.countedMl !== null);
  }

  /** Yield — expected shots per bottle vs actual shots sold in the window. */
  async yieldReport(from: Date, to: Date, locationId?: string) {
    const products = await this.beverageProducts();
    const bevIds = new Set(products.map((p) => p.id));
    const { byProduct } = await this.soldMl(from, to, bevIds);
    return products.map((p) => {
      const soldMl = byProduct.get(p.id) ?? 0;
      const soldShots = p.standardPourMl > 0 ? soldMl / p.standardPourMl : 0;
      const shotsPerBottle = p.standardPourMl > 0 ? p.containerVolumeMl / p.standardPourMl : 0;
      const bottlesSold = p.containerVolumeMl > 0 ? soldMl / p.containerVolumeMl : 0;
      return {
        productId: p.id, product: p.name,
        shotsPerBottle: round(shotsPerBottle, 1),
        soldMl: round(soldMl, 1),
        soldShots: round(soldShots, 1),
        bottlesSold: round(bottlesSold, 2),
      };
    });
  }

  /** Bartender variance — alcohol pours + value grouped by waiter. */
  async bartender(from: Date, to: Date) {
    const products = await this.beverageProducts();
    const bevIds = new Set(products.map((p) => p.id));
    const { byWaiter } = await this.soldMl(from, to, bevIds, { byWaiter: true });
    const waiterIds = [...byWaiter.keys()].filter((w) => w !== 'unassigned');
    const users = waiterIds.length
      ? await this.prisma.client.user.findMany({ where: { id: { in: waiterIds } }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const nameById = new Map(users.map((u) => [u.id, `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.id]));
    return [...byWaiter.entries()]
      .map(([waiterId, v]) => ({
        waiterId,
        bartender: waiterId === 'unassigned' ? 'Unassigned' : nameById.get(waiterId) ?? waiterId,
        soldMl: round(v.ml, 1),
        salesValue: round(v.value, 2),
      }))
      .sort((a, b) => b.salesValue - a.salesValue);
  }

  /** KPI dashboard — open bottles, sales, variance %, yield %, shrinkage trend. */
  async dashboard(locationId?: string) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(now.getTime() - 7 * 864e5);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const products = await this.beverageProducts();
    const bevIds = new Set(products.map((p) => p.id));
    const variance = await this.variance(locationId);

    const [today, week, month, lastMonth] = await Promise.all([
      this.soldMl(startOfToday, now, bevIds),
      this.soldMl(weekAgo, now, bevIds),
      this.soldMl(startOfMonth, now, bevIds),
      this.soldMl(startOfLastMonth, startOfMonth, bevIds),
    ]);

    const openVariances = variance.filter((v) => v.confidence && v.confidence !== 'GOOD').length;
    const totalLoss = variance.reduce((s, v) => s + v.lossValue, 0);
    const totalSystemMl = variance.reduce((s, v) => s + v.systemMl, 0);

    const shrink = (loss: number, sales: number) => (sales > 0 ? round((loss / sales) * 100, 2) : 0);

    return {
      openBottles: variance.filter((v) => (v.countedMl ?? 0) > 0).length,
      todaysAlcoholSales: round(today.alcoholSalesValue, 2),
      todaysVariancePct: totalSystemMl > 0 ? round((totalLoss / (totalSystemMl || 1)) * 100, 2) : 0,
      openVariances,
      countsPending: 0,
      shrinkage: {
        thisWeek: shrink(totalLoss, week.alcoholSalesValue),
        thisMonth: shrink(totalLoss, month.alcoholSalesValue),
        lastMonth: shrink(totalLoss, lastMonth.alcoholSalesValue),
      },
      totalLossValue: round(totalLoss, 2),
    };
  }
}

function round(n: number, dp: number): number {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}
