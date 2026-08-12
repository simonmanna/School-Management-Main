import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PaginationQuery } from '@erp/shared';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';

@Injectable()
export class InventoryQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
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

  async getItemDetail(productId: string, locationId?: string) {
    const organizationId = this.tenant.organizationId;
    const product = await this.prisma.client.product.findFirst({
      where: { id: productId },
      select: { id: true, code: true, name: true, sku: true, minQuantity: true, batchTracking: true, trackInventory: true, uom: true, productType: true },
    });
    if (!product) throw new NotFoundException('Product not found');

    const where: any = { organizationId, productId };
    if (locationId) where.locationId = locationId;

    const items = await this.prisma.client.stockItem.findMany({
      where,
      include: {
        location: { select: { id: true, code: true, name: true } },
      },
    });

    const totalOnHand = items.reduce((sum, i) => sum.plus(i.quantity), new Prisma.Decimal(0));

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
      take: 50,
      include: { location: { select: { code: true, name: true } }, batch: { select: { batchNumber: true } } },
    });

    return { product, items, totalOnHand: Number(totalOnHand), batches, recentLedger };
  }

  async getStockStats() {
    const organizationId = this.tenant.organizationId;

    const [totalItems, lowStockItems, totalLocations, totalProducts] = await Promise.all([
      this.prisma.client.stockItem.count({ where: { organizationId, quantity: { gt: 0 } } }),
      this.prisma.client.stockItem.findMany({
        where: {
          organizationId,
          quantity: { gt: 0 },
        },
        include: { product: { select: { minQuantity: true } } },
      }),
      this.prisma.client.inventoryLocation.count({ where: { organizationId, isActive: true } }),
      this.prisma.client.product.count({ where: { organizationId, trackInventory: true } }),
    ]);

    const lowStockCount = lowStockItems.filter((i) => {
      const minQty = i.product?.minQuantity;
      return minQty && minQty.gt(0) && i.quantity.lte(minQty);
    }).length;

    return { totalItems, lowStockCount, totalLocations, totalProducts };
  }

  async getLedger(query: PaginationQuery & { productId?: string; locationId?: string; type?: string }) {
    const organizationId = this.tenant.organizationId;
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 25));

    const where: any = { organizationId };
    if (query.productId) where.productId = query.productId;
    if (query.locationId) where.locationId = query.locationId;
    if (query.type) where.type = query.type;

    const [data, total] = await Promise.all([
      this.prisma.client.inventoryLedger.findMany({
        where,
        include: {
          product: { select: { code: true, name: true } },
          location: { select: { code: true, name: true } },
          batch: { select: { batchNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.inventoryLedger.count({ where }),
    ]);

    return { data, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }
}
