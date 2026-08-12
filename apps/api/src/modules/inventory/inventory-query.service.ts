import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PaginationQuery } from '@erp/shared';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { UomConversionService } from '../core/product/uom-conversion.service';

@Injectable()
export class InventoryQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly uomConversion: UomConversionService,
  ) {}

  async listItems(query: PaginationQuery & { locationId?: string; lowStock?: string }) {
    const organizationId = this.tenant.organizationId;
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 25));

    const where: any = { organizationId, product: { trackInventory: true } };
    if (query.locationId) where.locationId = query.locationId;
    if (query.lowStock === 'true') {
      where.AND = [
        { quantity: { gt: 0 } },
        Prisma.sql`quantity <= (SELECT "minQuantity" FROM "Product" WHERE "Product"."id" = "StockItem"."productId" AND "Product"."minQuantity" > 0)`,
      ];
    }

    const searchWhere: any = {};
    if (query.search) {
      searchWhere.OR = [
        { product: { code: { contains: query.search, mode: 'insensitive' } } },
        { product: { name: { contains: query.search, mode: 'insensitive' } } },
        { product: { sku: { contains: query.search, mode: 'insensitive' } } },
        { location: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.client.stockItem.findMany({
        where: { ...where, ...searchWhere },
        include: {
          product: { select: { id: true, code: true, name: true, sku: true, minQuantity: true, batchTracking: true, uom: true } },
          location: { select: { id: true, code: true, name: true } },
        },
        orderBy: { product: { name: 'asc' } },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.stockItem.count({ where: { ...where, ...searchWhere } }),
    ]);

    return { data, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  /**
   * Fetches ALL products (like the Products list) with aggregated stock levels.
   * One row per product. When locationId is provided, totalQuantity reflects
   * stock at that location only.
   */
  async listProductStockLevels(query: PaginationQuery & { locationId?: string; lowStock?: string; outOfStock?: string }) {
    const organizationId = this.tenant.organizationId;
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 25));

    const where: any = { organizationId };
    const searchWhere: any = {};
    if (query.search) {
      searchWhere.OR = [
        { code: { contains: query.search, mode: 'insensitive' } },
        { name: { contains: query.search, mode: 'insensitive' } },
        { sku: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const baseInclude = {
      stockItems: {
        select: {
          quantity: true,
          runningAverageCost: true,
          locationId: true,
          location: { select: { id: true, code: true, name: true } },
        },
      },
      uom: { select: { code: true } },
    } as const;

    const mapProduct = (p: any, reservedByProduct?: Map<string, number>) => {
      const locationBreakdown = p.stockItems.map((si: any) => ({
        locationId: si.location.id,
        code: si.location.code,
        name: si.location.name,
        quantity: Number(si.quantity),
      }));

      const relevantItems = query.locationId
        ? p.stockItems.filter((si: any) => si.locationId === query.locationId)
        : p.stockItems;

      const totalQuantity = relevantItems.reduce((sum: number, si: any) => sum + Number(si.quantity), 0);
      const totalCost = relevantItems.reduce((sum: number, si: any) => sum + Number(si.quantity) * Number(si.runningAverageCost), 0);
      const qtyForCost = relevantItems.reduce((sum: number, si: any) => sum + Number(si.quantity), 0);
      const averageCost = qtyForCost > 0 ? totalCost / qtyForCost : 0;
      const minQty = p.minQuantity ? Number(p.minQuantity) : 0;

      return {
        id: p.id,
        code: p.code,
        name: p.name,
        sku: p.sku,
        productType: p.productType,
        minQuantity: p.minQuantity ? Number(p.minQuantity) : null,
        batchTracking: p.batchTracking,
        uom: p.uom?.code ?? null,
        totalQuantity,
        averageCost,
        totalValue: totalCost,
        locationBreakdown,
        // Available-to-promise. Zero unless `inventory.reservationMode` is on,
        // in which case on-hand alone overstates what can actually be committed:
        // billed-but-not-yet-deducted sales are already spoken for.
        reservedQuantity: reservedByProduct?.get(p.id) ?? 0,
        availableQuantity: totalQuantity - (reservedByProduct?.get(p.id) ?? 0),
        isLow: minQty > 0 && totalQuantity > 0 && totalQuantity <= minQty,
        isOut: totalQuantity <= 0,
      };
    };

    /** Active reservation totals per product, for the page being returned. */
    const loadReserved = async (productIds: string[]): Promise<Map<string, number>> => {
      if (productIds.length === 0) return new Map();
      const groups = await this.prisma.client.stockReservation.groupBy({
        by: ['productId'],
        where: {
          organizationId,
          status: 'active',
          productId: { in: productIds },
          ...(query.locationId ? { locationId: query.locationId } : {}),
        },
        _sum: { quantity: true },
      });
      return new Map(groups.map((g) => [g.productId, Number(g._sum.quantity ?? 0)]));
    };

    const needsFilter = query.lowStock === 'true' || query.outOfStock === 'true';

    if (needsFilter) {
      const allProducts = await this.prisma.client.product.findMany({
        where: { ...where, ...searchWhere },
        include: baseInclude,
        orderBy: { name: 'asc' },
      });

      let filtered = allProducts.map((p) => mapProduct(p));
      if (query.lowStock === 'true') filtered = filtered.filter((m) => m.isLow || m.isOut);
      if (query.outOfStock === 'true') filtered = filtered.filter((m) => m.isOut);

      const total = filtered.length;
      const paged = filtered.slice((page - 1) * pageSize, page * pageSize);
      // Re-map only the page being returned, now with reservation totals — the
      // filter above needs isLow/isOut, which do not depend on reservations.
      const reserved = await loadReserved(paged.map((m) => m.id));
      const pagedProducts = allProducts.filter((p) => paged.some((m) => m.id === p.id));

      return {
        data: pagedProducts.map((p) => mapProduct(p, reserved)),
        meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.client.product.findMany({
        where: { ...where, ...searchWhere },
        include: baseInclude,
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.product.count({ where: { ...where, ...searchWhere } }),
    ]);

    const reserved = await loadReserved(data.map((p) => p.id));
    return {
      data: data.map((p) => mapProduct(p, reserved)),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  async getItemDetail(productId: string, locationId?: string) {
    const organizationId = this.tenant.organizationId;
    const product = await this.prisma.client.product.findFirst({
      where: { id: productId },
      select: {
        id: true, code: true, name: true, sku: true, barcode: true, description: true,
        productType: true, costingMethod: true, minQuantity: true, reorderQty: true,
        batchTracking: true, trackInventory: true, stockPolicy: true,
        uomId: true, purchaseUomId: true,
        salesPrice: true, costPrice: true, isActive: true,
        createdAt: true, updatedAt: true,
        category: { select: { id: true, name: true, parentId: true } },
        supplier: { select: { id: true, name: true } },
      },
    });
    if (!product) throw new NotFoundException('Product not found');

    const where: any = { organizationId, productId };
    if (locationId) where.locationId = locationId;

    const items = await this.prisma.client.stockItem.findMany({
      where,
      include: {
        location: { select: { id: true, code: true, name: true, type: true } },
      },
    });

    const totalOnHand = items.reduce((sum, i) => sum.plus(i.quantity), new Prisma.Decimal(0));
    const totalValue = items.reduce((sum, i) => sum.plus(i.quantity.times(i.runningAverageCost)), new Prisma.Decimal(0));

    let batches: any[] = [];
    if (product.batchTracking) {
      const batchWhere: any = { organizationId, productId, isActive: true };
      if (locationId) batchWhere.locationId = locationId;
      batches = await this.prisma.client.inventoryBatch.findMany({
        where: batchWhere,
        include: { location: { select: { id: true, code: true, name: true } } },
        orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { receivedAt: 'asc' }],
      });
    }

    const recentLedger = await this.prisma.client.inventoryLedger.findMany({
      where: { organizationId, productId, ...(locationId ? { locationId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { location: { select: { code: true, name: true } }, batch: { select: { batchNumber: true } } },
    });

    const menuProducts = await this.prisma.client.menuProduct.findMany({
      where: { organizationId, productId },
      include: {
        menuItem: { select: { id: true, code: true, name: true } },
      },
    });

    const purchaseOrderLines = await this.prisma.client.purchaseOrderLine.findMany({
      where: { organizationId, productId },
      include: {
        order: {
          select: {
            id: true, orderNumber: true, status: true, createdAt: true,
            partner: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { order: { createdAt: 'desc' } },
      take: 50,
    });

    return {
      product,
      items,
      totalOnHand: Number(totalOnHand),
      totalValue: Number(totalValue),
      batches,
      recentLedger,
      menuProducts,
      purchaseOrderLines,
    };
  }

  async getStockStats() {
    const organizationId = this.tenant.organizationId;

    const [allProducts, totalLocations] = await Promise.all([
      this.prisma.client.product.findMany({
        where: { organizationId },
        select: {
          id: true,
          minQuantity: true,
          stockItems: { select: { quantity: true } },
        },
      }),
      this.prisma.client.inventoryLocation.count({ where: { organizationId, isActive: true } }),
    ]);

    const totalProducts = allProducts.length;
    const totalItems = allProducts.filter((p) =>
      p.stockItems.some((si) => si.quantity.gt(0)),
    ).length;
    const lowStockCount = allProducts.filter((p) => {
      const totalQty = p.stockItems.reduce((s, si) => s.plus(si.quantity), ZERO_DEC);
      const minQty = p.minQuantity ?? ZERO_DEC;
      return minQty.gt(0) && totalQty.gt(0) && totalQty.lte(minQty);
    }).length;

    return { totalItems, lowStockCount, totalLocations, totalProducts };
  }

  async getLedger(query: PaginationQuery & {
    productId?: string; locationId?: string; type?: string;
    referenceType?: string; dateFrom?: string; dateTo?: string;
  }) {
    const organizationId = this.tenant.organizationId;
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 25));

    const where: any = { organizationId };
    if (query.productId) where.productId = query.productId;
    if (query.locationId) where.locationId = query.locationId;
    if (query.type) where.type = query.type;
    if (query.referenceType) where.referenceType = query.referenceType;
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.client.inventoryLedger.findMany({
        where,
        include: {
          product: { select: { id: true, code: true, name: true } },
          variant: { select: { id: true, name: true } },
          location: { select: { id: true, code: true, name: true } },
          batch: { select: { id: true, batchNumber: true, expiryDate: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.inventoryLedger.count({ where }),
    ]);

    return { data, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  // ===========================================================================
  // F.8 — Reports: expiry alert, par-based reorder, movement/variance summary
  // ===========================================================================

  /** Active batches expiring within `days` (default 30). FEFO order. */
  async getExpiringBatches(query: { days?: string | number; locationId?: string }) {
    const organizationId = this.tenant.organizationId;
    const days = Math.max(1, Number(query.days) || 30);
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + days);

    const where: any = {
      organizationId,
      isActive: true,
      quantity: { gt: 0 },
      expiryDate: { not: null, lte: horizon },
    };
    if (query.locationId) where.locationId = query.locationId;

    const batches = await this.prisma.client.inventoryBatch.findMany({
      where,
      include: {
        product: { select: { id: true, code: true, name: true, uom: { select: { code: true } } } },
        location: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ expiryDate: 'asc' }],
    });

    const now = Date.now();
    return batches.map((b) => ({
      ...b,
      daysToExpiry: b.expiryDate
        ? Math.ceil((new Date(b.expiryDate).getTime() - now) / 86_400_000)
        : null,
      expired: b.expiryDate ? new Date(b.expiryDate).getTime() < now : false,
    }));
  }

  /**
   * Par-based reorder suggestions. A product is below par when its total on-hand
   * (optionally at one location) is ≤ its minQuantity (par). Suggested order qty
   * is expressed in PURCHASE units: `reorderQty` when set, else the shortfall
   * converted via `uomConversion`.
   */
  async getReorderSuggestions(query: { locationId?: string }) {
    const organizationId = this.tenant.organizationId;

    const products = await this.prisma.client.product.findMany({
      where: {
        organizationId,
        trackInventory: true,
        OR: [{ minQuantity: { gt: 0 } }, { reorderQty: { gt: 0 } }],
      },
      select: {
        id: true,
        code: true,
        name: true,
        minQuantity: true,
        reorderQty: true,
        uomConversion: true,
        uomId: true,
        purchaseUomId: true,
        supplierId: true,
        supplier: { select: { id: true, name: true } },
        stockItems: {
          where: query.locationId ? { locationId: query.locationId } : {},
          select: { quantity: true },
        },
      },
    });

    const ZEROD = new Prisma.Decimal(0);
    const out = await Promise.all(
      products.map(async (p) => {
        const onHand = p.stockItems.reduce((s, si) => s.plus(si.quantity), ZERO_DEC);
        const par = p.minQuantity ?? ZEROD;
        const shortfall = par.minus(onHand);
        // Suggested order qty is expressed in PURCHASE units: prefer the per-product
        // purchase UOM (category converter); fall back to the legacy `uomConversion`
        // scalar (stock units per purchase unit) when no purchase UOM is set.
        let suggestPurchaseQty = ZEROD;
        if (p.reorderQty && p.reorderQty.gt(0)) {
          suggestPurchaseQty = p.reorderQty;
        } else if (shortfall.gt(0)) {
          if (p.purchaseUomId && p.purchaseUomId !== p.uomId) {
            suggestPurchaseQty = (
              await this.uomConversion.fromBase(shortfall, p.purchaseUomId, { id: p.id, uomId: p.uomId })
            ).toDecimalPlaces(2, Prisma.Decimal.ROUND_CEIL);
          } else {
            const conversion = p.uomConversion && p.uomConversion.gt(0) ? p.uomConversion : new Prisma.Decimal(1);
            suggestPurchaseQty = shortfall.dividedBy(conversion).toDecimalPlaces(2, Prisma.Decimal.ROUND_CEIL);
          }
        }
        return {
          productId: p.id,
          code: p.code,
          name: p.name,
          onHand: Number(onHand),
          par: Number(par),
          belowPar: onHand.lte(par),
          suggestedOrderQty: Number(suggestPurchaseQty),
          supplier: p.supplier,
        };
      }),
    );

    return out.filter((r) => r.belowPar);
  }

  /**
   * Movement summary per product over a window — the raw material for a
   * theoretical-vs-actual variance report. Groups the ledger by product and
   * move type and returns signed quantity + value totals.
   */
  async getMovementSummary(query: { start?: string; end?: string; locationId?: string }) {
    const organizationId = this.tenant.organizationId;
    const where: any = { organizationId };
    if (query.locationId) where.locationId = query.locationId;
    if (query.start || query.end) {
      where.createdAt = {};
      if (query.start) where.createdAt.gte = new Date(query.start);
      if (query.end) where.createdAt.lte = new Date(query.end);
    }

    const grouped = await this.prisma.client.inventoryLedger.groupBy({
      by: ['productId', 'type'],
      where,
      _sum: { quantityChange: true, totalValue: true },
    });

    const productIds = [...new Set(grouped.map((g) => g.productId))];
    const products = await this.prisma.client.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, code: true, name: true },
    });
    const nameById = Object.fromEntries(products.map((p) => [p.id, p]));

    const byProduct: Record<string, any> = {};
    for (const g of grouped) {
      const row = (byProduct[g.productId] ??= {
        product: nameById[g.productId] ?? { id: g.productId },
        byType: {},
        netQty: 0,
        netValue: 0,
      });
      const qty = Number(g._sum.quantityChange ?? 0);
      const val = Number(g._sum.totalValue ?? 0);
      row.byType[g.type] = { qty, value: val };
      row.netQty += qty;
      row.netValue += val;
    }

    return Object.values(byProduct);
  }

  /**
   * Stock reconciliation: for every (product, variant, location) cell, compare
   * the three sources of on-hand truth and surface any that disagree:
   *   - cached   = StockItem.quantity           (what every read path uses)
   *   - ledger   = Σ InventoryLedger.quantityChange (the immutable movement log)
   *   - batches  = Σ InventoryBatch.quantity     (batch-tracked products only)
   *
   * After the batch-path fix these must all agree (within rounding). Persistent
   * ledger drift means a movement bypassed the engine; batch drift means the
   * layer sum and the cached on-hand diverged. Used to detect legacy drift and
   * to verify the fix + the backfill.
   *
   * @param opts.tolerance absolute qty difference below which a cell is "OK"
   * @param opts.includeMatched return matched cells too (default: drift only)
   */
  async getStockReconciliation(opts: {
    locationId?: string;
    tolerance?: number;
    includeMatched?: boolean;
  } = {}) {
    const organizationId = this.tenant.organizationId;
    const tolerance = new Prisma.Decimal(opts.tolerance ?? 0.000001);
    const variantKey = (v: string | null | undefined) => v ?? '';
    const cellKey = (p: string, v: string | null | undefined, l: string) =>
      `${p}|${variantKey(v)}|${l}`;

    const stockWhere: any = { organizationId };
    if (opts.locationId) stockWhere.locationId = opts.locationId;
    const ledgerWhere: any = { organizationId };
    if (opts.locationId) ledgerWhere.locationId = opts.locationId;
    const batchWhere: any = { organizationId };
    if (opts.locationId) batchWhere.locationId = opts.locationId;

    const [items, ledgerGroups, batchGroups] = await Promise.all([
      this.prisma.client.stockItem.findMany({
        where: stockWhere,
        select: {
          productId: true,
          variantKey: true,
          locationId: true,
          quantity: true,
          product: { select: { code: true, name: true, batchTracking: true } },
          location: { select: { name: true } },
        },
      }),
      this.prisma.client.inventoryLedger.groupBy({
        by: ['productId', 'variantId', 'locationId'],
        where: ledgerWhere,
        _sum: { quantityChange: true },
      }),
      this.prisma.client.inventoryBatch.groupBy({
        by: ['productId', 'variantId', 'locationId'],
        where: batchWhere,
        _sum: { quantity: true },
      }),
    ]);

    const ledgerByCell = new Map<string, Prisma.Decimal>();
    for (const g of ledgerGroups) {
      ledgerByCell.set(cellKey(g.productId, g.variantId, g.locationId), new Prisma.Decimal(g._sum.quantityChange ?? 0));
    }
    const batchByCell = new Map<string, Prisma.Decimal>();
    for (const g of batchGroups) {
      batchByCell.set(cellKey(g.productId, g.variantId, g.locationId), new Prisma.Decimal(g._sum.quantity ?? 0));
    }

    const seen = new Set<string>();
    const rows: any[] = [];
    const pushRow = (r: {
      productId: string; variantKey: string; locationId: string;
      code?: string; name?: string; locationName?: string; batchTracking: boolean;
      cached: Prisma.Decimal; ledger: Prisma.Decimal; batches: Prisma.Decimal | null;
    }) => {
      const ledgerDrift = r.cached.minus(r.ledger);
      const batchDrift = r.batches != null ? r.cached.minus(r.batches) : null;
      const drifted =
        ledgerDrift.abs().gt(tolerance) || (batchDrift != null && batchDrift.abs().gt(tolerance));
      if (!drifted && !opts.includeMatched) return;
      rows.push({
        productId: r.productId,
        variantKey: r.variantKey,
        locationId: r.locationId,
        code: r.code ?? null,
        name: r.name ?? null,
        locationName: r.locationName ?? null,
        cached: r.cached.toString(),
        ledger: r.ledger.toString(),
        batches: r.batches != null ? r.batches.toString() : null,
        ledgerDrift: ledgerDrift.toString(),
        batchDrift: batchDrift != null ? batchDrift.toString() : null,
        drifted,
      });
    };

    for (const it of items) {
      const key = cellKey(it.productId, it.variantKey, it.locationId);
      seen.add(key);
      pushRow({
        productId: it.productId,
        variantKey: it.variantKey,
        locationId: it.locationId,
        code: it.product?.code,
        name: it.product?.name,
        locationName: it.location?.name,
        batchTracking: Boolean(it.product?.batchTracking),
        cached: new Prisma.Decimal(it.quantity),
        ledger: ledgerByCell.get(key) ?? ZERO_DEC,
        batches: it.product?.batchTracking ? (batchByCell.get(key) ?? ZERO_DEC) : null,
      });
    }

    // Ledger/batch cells with no StockItem row at all — pure orphans, always drift.
    const orphanKeys = new Set<string>();
    for (const k of ledgerByCell.keys()) if (!seen.has(k)) orphanKeys.add(k);
    for (const k of batchByCell.keys()) if (!seen.has(k)) orphanKeys.add(k);
    if (orphanKeys.size > 0) {
      const orphanProductIds = [...new Set([...orphanKeys].map((k) => k.split('|')[0]))];
      const orphanProducts = await this.prisma.client.product.findMany({
        where: { id: { in: orphanProductIds } },
        select: { id: true, code: true, name: true, batchTracking: true },
      });
      const prodById = new Map(orphanProducts.map((p) => [p.id, p]));
      for (const k of orphanKeys) {
        const [productId, vk, locationId] = k.split('|');
        const prod = prodById.get(productId);
        pushRow({
          productId,
          variantKey: vk,
          locationId,
          code: prod?.code,
          name: prod?.name,
          batchTracking: Boolean(prod?.batchTracking),
          cached: ZERO_DEC,
          ledger: ledgerByCell.get(k) ?? ZERO_DEC,
          batches: prod?.batchTracking ? (batchByCell.get(k) ?? ZERO_DEC) : null,
        });
      }
    }

    const driftedRows = rows.filter((r) => r.drifted);
    return {
      summary: {
        cellsChecked: items.length + orphanKeys.size,
        driftedCells: driftedRows.length,
        clean: driftedRows.length === 0,
        tolerance: tolerance.toString(),
      },
      rows,
    };
  }

  /**
   * Quants at negative on-hand — the operational consequence of the
   * never-block-sales rule: goods left the building before they were received.
   *
   * Each such cell means the issued units were expensed at whatever running
   * average existed at the time (frequently zero), so inventory is currently
   * OVERSTATED and COGS UNDERSTATED. StockService squares this up automatically
   * on the covering receipt (see `costCorrection` in CostResolverService), but
   * until that receipt arrives the books carry the exposure — and a cell that
   * stays negative for days usually means a delivery was never captured, not
   * that the count is wrong.
   *
   * `valuationExposure` is the best estimate of that overstatement:
   * |negative qty| × best-known unit cost (running average, else product cost).
   */
  async getNegativeStock(opts: { locationId?: string } = {}) {
    const where: any = { organizationId: this.tenant.organizationId, quantity: { lt: 0 } };
    if (opts.locationId) where.locationId = opts.locationId;

    const items = await this.prisma.client.stockItem.findMany({
      where,
      select: {
        productId: true,
        variantKey: true,
        locationId: true,
        quantity: true,
        runningAverageCost: true,
        updatedAt: true,
        product: { select: { code: true, name: true, costPrice: true, costingMethod: true } },
        location: { select: { name: true } },
      },
      orderBy: { quantity: 'asc' },
    });

    let totalExposure = ZERO_DEC;
    const rows = items.map((it) => {
      const shortQty = new Prisma.Decimal(it.quantity).abs();
      const avg = new Prisma.Decimal(it.runningAverageCost);
      const unitCost = avg.gt(0) ? avg : new Prisma.Decimal(it.product?.costPrice ?? 0);
      const exposure = shortQty.times(unitCost);
      totalExposure = totalExposure.plus(exposure);
      return {
        productId: it.productId,
        variantKey: it.variantKey,
        locationId: it.locationId,
        code: it.product?.code ?? null,
        name: it.product?.name ?? null,
        locationName: it.location?.name ?? null,
        costingMethod: it.product?.costingMethod ?? null,
        quantity: it.quantity.toString(),
        shortBy: shortQty.toString(),
        unitCost: unitCost.toString(),
        // Estimated inventory overstatement / COGS understatement for this cell.
        valuationExposure: exposure.toString(),
        // Cells with no cost basis at all expense NOTHING on sale — the worst
        // case, and invisible in a margin report until the receipt lands.
        zeroCostBasis: unitCost.lte(0),
        lastMovedAt: it.updatedAt,
      };
    });

    return {
      summary: {
        cells: rows.length,
        clean: rows.length === 0,
        totalValuationExposure: totalExposure.toString(),
        zeroCostBasisCells: rows.filter((r) => r.zeroCostBasis).length,
      },
      rows,
    };
  }
}

const ZERO_DEC = new Prisma.Decimal(0);
