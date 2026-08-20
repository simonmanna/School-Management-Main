/**
 * Meals — per-student (per-lunch) consumption.
 *
 * When a meal plan has `trackInventory = true`, serving a student (attendance
 * status `served`) triggers this service: for the served menu's dishes we
 * explode each dish's recipe into inventory products and issue exactly one
 * portion per student through the platform StockService (which writes the
 * InventoryLedger), then record a per-student MealConsumption row per product.
 *
 * This keeps "served" (attendance) separate from "consumed" (stock) and is safe
 * to call multiple times — it is idempotent per (session, student) so re-saving
 * attendance does not double-decrement.
 */
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { StockService } from '../../inventory/stock.service';
import type { RecordMealConsumptionDto, MealConsumptionQueryDto } from './dto.types';

@Injectable()
export class MealConsumptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly stock: StockService,
  ) {}

  private async defaultLocationId(): Promise<string | null> {
    const loc = await this.prisma.client.inventoryLocation.findFirst({
      where: { organizationId: this.tenant.organizationId, isActive: true },
      select: { id: true },
    });
    return loc?.id ?? null;
  }

  /** Pick the menu to consume: explicit, else the plan's first menu for the session's meal type. */
  private async resolveMenu(
    session: any,
    mealPlanId: string | null,
    explicitMenuId?: string,
  ): Promise<{ id: string; items: any[] } | null> {
    const where: any = {};
    if (explicitMenuId) where.id = explicitMenuId;
    else if (mealPlanId) where.mealPlanId = mealPlanId;
    else where.mealTypeId = session.mealTypeId;
    const menu = await this.prisma.client.mealMenu.findFirst({
      where,
      orderBy: { createdAt: 'desc' },
      include: { items: { include: { mealRecipe: { include: { ingredients: true } } } } },
    });
    return menu as any;
  }

  /**
   * Record consumption for one student being served. Idempotent per
   * (mealSessionId, studentProfileId): if a row already exists, it returns the
   * existing consumption without decrementing stock again.
   */
  async record(dto: RecordMealConsumptionDto) {
    const organizationId = this.tenant.organizationId;
    const userId = this.tenant.userId ?? null;

    const session = await this.prisma.client.mealSession.findFirst({
      where: { id: dto.mealSessionId },
      include: { mealType: true },
    });
    if (!session) throw new NotFoundException(`MealSession ${dto.mealSessionId} not found`);

    // Already consumed for this student in this session?
    const prior = await this.prisma.client.mealConsumption.findFirst({
      where: { mealSessionId: dto.mealSessionId, studentProfileId: dto.studentProfileId },
      select: { id: true },
    });
    if (prior) {
      return this.prisma.client.mealConsumption.findMany({
        where: { mealSessionId: dto.mealSessionId, studentProfileId: dto.studentProfileId },
      });
    }

    // Resolve the plan (for trackInventory flag) from the session/assignment.
    const assignment = await this.prisma.client.mealPlanAssignment.findFirst({
      where: { studentProfileId: dto.studentProfileId, status: 'active', mealPlan: { entitlements: { some: { mealTypeId: session.mealTypeId } } } },
      include: { mealPlan: true },
      orderBy: { startDate: 'desc' },
    });
    const plan = assignment?.mealPlan ?? null;
    if (!plan?.trackInventory) {
      // Nothing to consume — return empty. (Caller may still mark attendance.)
      return [];
    }

    const menu = await this.resolveMenu(session, plan.id, dto.mealMenuId);
    if (!menu || !menu.items?.length) {
      // No menu/dish linked — record nothing (inventory stays untouched).
      return [];
    }

    const locationId = dto.stockLocationId ?? (await this.defaultLocationId());

    // Collect product quantities: one portion per dish that has a recipe.
    const lines: Array<{ productId: string; uomId?: string | null; qty: number }> = [];
    for (const item of menu.items) {
      const recipe = (item as any).mealRecipe;
      if (!recipe?.ingredients?.length) continue;
      for (const ing of recipe.ingredients) {
        const existing = lines.find((l) => l.productId === ing.productId);
        if (existing) existing.qty += Number(ing.quantityPerPortion);
        else lines.push({ productId: ing.productId, uomId: ing.uomId, qty: Number(ing.quantityPerPortion) });
      }
    }
    if (!lines.length) return [];
    if (!locationId) throw new BadRequestException('No stock location available to issue from');

    const rows: any[] = [];
    await this.prisma.client.$transaction(async (tx: any) => {
      for (const line of lines) {
        if (line.qty <= 0) continue;
        await this.stock.issue(
          {
            productId: line.productId,
            locationId,
            quantity: line.qty,
            uomId: line.uomId ?? undefined,
            sourceType: 'meal_consumption',
            sourceId: `${dto.mealSessionId}:${dto.studentProfileId}`,
          },
          tx,
        );
        const ledgers = await tx.inventoryLedger.findMany({
          where: {
            productId: line.productId,
            referenceType: 'meal_consumption',
            referenceId: `${dto.mealSessionId}:${dto.studentProfileId}`,
          },
        });
        let unitCost = 0;
        let totalQty = 0;
        for (const l of ledgers) {
          const q = Math.abs(Number(l.quantityChange));
          totalQty += q;
          unitCost += q * Number(l.unitCost ?? 0);
        }
        const row = await tx.mealConsumption.create({
          data: {
            organizationId,
            mealSessionId: dto.mealSessionId,
            mealMenuId: menu.id,
            studentProfileId: dto.studentProfileId,
            productId: line.productId,
            quantity: line.qty,
            unitCost: totalQty > 0 ? unitCost / totalQty : 0,
            inventoryLedgerId: ledgers[0]?.id ?? null,
            stockLocationId: locationId,
            recordedById: userId,
          },
        });
        rows.push(row);
      }
    });
    return rows;
  }

  /** List per-student consumption (audit / per-lunch view). */
  list(query: MealConsumptionQueryDto) {
    const where: any = {};
    if (query.mealSessionId) where.mealSessionId = query.mealSessionId;
    if (query.studentProfileId) where.studentProfileId = query.studentProfileId;
    if (query.mealMenuId) where.mealMenuId = query.mealMenuId;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }
    return this.prisma.client.mealConsumption.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }
}
