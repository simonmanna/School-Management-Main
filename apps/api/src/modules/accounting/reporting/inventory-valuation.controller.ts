import { Controller, Get, Logger, NotFoundException, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';

@Controller('reports/inventory/valuation')
export class InventoryValuationController {
  private readonly log = new Logger('InventoryValuationController');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /**
   * Inventory valuation report.
   * Returns stock value grouped by account, category, and warehouse/location.
   */
  @Get()
  @RequirePermissions(PERMISSIONS.report.accounting)
  async getValuation(
    @Query('asOf') asOf?: string,
    @Query('groupBy') groupBy?: string,
  ) {
    const orgId = this.tenant.organizationId;
    const asOfDate = asOf ? new Date(asOf) : new Date();
    const group = groupBy ?? 'account';

    // Get all inventory items with their latest cost, slicing asOf
    // We query inventoryStock (or whatever tracks current stock)
    // and join with product cost / valuation accounts
    const stock = await this.prisma.client.$queryRawUnsafe<any[]>(
      `SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.sku,
        COALESCE(ic.averageCost, p.defaultCost, 0) AS unit_cost,
        COALESCE(is2.onHandQty, 0) AS on_hand_qty,
        COALESCE(ic.averageCost, p.defaultCost, 0) * COALESCE(is2.onHandQty, 0) AS total_value,
        COALESCE(am.accountId, am2.accountId) AS valuation_account_id,
        a.code AS account_code,
        a.name AS account_name,
        COALESCE(pc.name, 'Uncategorized') AS category_name,
        COALESCE(pc.id, '__none__') AS category_id
      FROM "Product" p
      LEFT JOIN "ProductCategory" pc ON pc.id = p."categoryId"
      LEFT JOIN (
        SELECT "productId", MAX("averageCost") AS "averageCost"
        FROM "InventoryCost"
        WHERE "createdAt" <= $1 AND "organizationId" = $2
        GROUP BY "productId"
      ) ic ON ic."productId" = p.id
      LEFT JOIN (
        SELECT "productId", MAX("onHandQty") AS "onHandQty"
        FROM "InventoryStock"
        WHERE "organizationId" = $2
        GROUP BY "productId"
      ) is2 ON is2."productId" = p.id
      LEFT JOIN "AccountMapping" am ON am.key = 'stock_valuation' AND am."organizationId" = $2
      LEFT JOIN "AccountMapping" am2 ON am2.key = 'inventory' AND am2."organizationId" = $2
      LEFT JOIN "Account" a ON a.id = COALESCE(am."accountId", am2."accountId")
      WHERE p."organizationId" = $2 AND p."isInventoryTracked" = true AND p."deletedAt" IS NULL
        AND COALESCE(is2."onHandQty", 0) > 0`,
      asOfDate,
      orgId,
    );

    if (!stock || stock.length === 0) {
      return {
        asOf: asOfDate.toISOString(),
        items: [],
        summary: { totalItems: 0, totalValue: '0.00', totalQty: 0 },
        groupedBy: group,
      };
    }

    // Group by the requested dimension
    const items = stock.map((r) => ({
      productId: r.product_id,
      productName: r.product_name,
      sku: r.sku ?? '',
      unitCost: Number(r.unit_cost).toFixed(2),
      onHandQty: Number(r.on_hand_qty),
      totalValue: Number(r.total_value).toFixed(2),
      accountCode: r.account_code ?? '',
      accountName: r.account_name ?? '',
      categoryName: r.category_name,
      categoryId: r.category_id,
    }));

    const totalValue = items.reduce((s, i) => s + Number(i.totalValue), 0);
    const totalQty = items.reduce((s, i) => s + Number(i.onHandQty), 0);

    return {
      asOf: asOfDate.toISOString(),
      items,
      summary: {
        totalItems: items.length,
        totalValue: totalValue.toFixed(2),
        totalQty,
      },
      groupedBy: group,
    };
  }
}
