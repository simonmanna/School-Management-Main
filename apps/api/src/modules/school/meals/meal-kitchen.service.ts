/**
 * Meals V3 — kitchen: recipes → production plan → issue to kitchen (consumes
 * inventory via StockService) → variance + waste + cost per meal.
 *
 * Inventory moves ONLY on actual issue/consumption (never on expected counts or
 * attendance). Reuses the platform Inventory engine — no second stock system.
 */
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { StockService } from '../../inventory/stock.service';
import { EVENTS } from '@erp/shared';
import type {
  CreateMealRecipeDto,
  PlanProductionDto,
  IssueProductionDto,
  RecordWasteDto,
  SetProductionStatusDto,
} from './dto.types';

@Injectable()
export class MealKitchenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly stock: StockService,
  ) {}

  // ── Recipes ──────────────────────────────────────────────────────────────
  async createRecipe(dto: CreateMealRecipeDto) {
    const organizationId = this.tenant.organizationId;
    const userId = this.tenant.userId ?? null;
    return this.prisma.client.$transaction(async (tx: any) => {
      const recipe = await tx.mealRecipe.create({
        data: {
          organizationId,
          name: dto.name,
          description: dto.description ?? null,
          portionYield: dto.portionYield ?? 1,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      for (const ing of dto.ingredients ?? []) {
        await tx.mealRecipeIngredient.create({
          data: {
            organizationId,
            mealRecipeId: recipe.id,
            productId: ing.productId,
            quantityPerPortion: ing.quantityPerPortion,
            uomId: ing.uomId ?? null,
          },
        });
      }
      return tx.mealRecipe.findFirst({ where: { id: recipe.id }, include: { ingredients: true } });
    });
  }

  listRecipes() {
    return this.prisma.client.mealRecipe.findMany({ include: { ingredients: true }, orderBy: { name: 'asc' } });
  }

  // ── Production plan (recipe explosion) ─────────────────────────────────────
  /** Explode recipes into aggregated ingredient requirements for N portions. */
  async planProduction(dto: PlanProductionDto) {
    const organizationId = this.tenant.organizationId;
    const userId = this.tenant.userId ?? null;
    const date = new Date(dto.date);

    // Derive expected portions from the session if not supplied.
    let expectedPortions = dto.expectedPortions ?? 0;
    if (!dto.expectedPortions && dto.mealSessionId) {
      const session = await this.prisma.client.mealSession.findFirst({ where: { id: dto.mealSessionId }, select: { expectedCount: true } });
      expectedPortions = session?.expectedCount ?? 0;
    }

    const recipes = await this.prisma.client.mealRecipe.findMany({
      where: { id: { in: dto.mealRecipeIds } },
      include: { ingredients: true },
    });
    if (recipes.length === 0) throw new BadRequestException('No recipes found to plan production');

    // Aggregate required quantity per product across all recipes.
    const required = new Map<string, { qty: number; uomId: string | null }>();
    for (const r of recipes) {
      for (const ing of r.ingredients) {
        const add = Number(ing.quantityPerPortion) * expectedPortions;
        const cur = required.get(ing.productId) ?? { qty: 0, uomId: ing.uomId };
        cur.qty += add;
        required.set(ing.productId, cur);
      }
    }

    const plan = await this.prisma.client.$transaction(async (tx: any) => {
      const p = await tx.mealProductionPlan.create({
        data: {
          organizationId,
          mealTypeId: dto.mealTypeId,
          date,
          mealSessionId: dto.mealSessionId ?? null,
          expectedPortions,
          status: 'preparing',
          createdBy: userId,
          updatedBy: userId,
        },
      });
      for (const [productId, { qty, uomId }] of required) {
        await tx.mealProductionItem.create({
          data: { organizationId, mealProductionPlanId: p.id, productId, uomId, plannedQuantity: qty },
        });
      }
      return tx.mealProductionPlan.findFirst({ where: { id: p.id }, include: { items: true } });
    });

    this.events.publish(EVENTS.SchoolMealProductionPlanned, {
      organizationId,
      mealProductionPlanId: plan.id,
      mealTypeId: dto.mealTypeId,
      date: date.toISOString(),
      expectedPortions,
    });
    return plan;
  }

  // ── Issue to kitchen (the ONLY stock mover) ────────────────────────────────
  async issueProduction(planId: string, dto: IssueProductionDto) {
    const organizationId = this.tenant.organizationId;
    const plan = await this.prisma.client.mealProductionPlan.findFirst({
      where: { id: planId },
      include: { items: true },
    });
    if (!plan) throw new NotFoundException(`MealProductionPlan ${planId} not found`);

    const locationId = dto.stockLocationId ?? (await this.defaultLocationId());
    if (!locationId) throw new BadRequestException('No stock location available to issue from');

    for (const item of plan.items) {
      const qty = Number(item.plannedQuantity);
      if (qty <= 0) continue;

      // Decrement inventory through the platform engine (writes InventoryLedger).
      await this.stock.issue({
        productId: item.productId,
        locationId,
        quantity: qty,
        uomId: item.uomId ?? undefined,
        sourceType: 'meal_production',
        sourceId: planId,
      });

      // Read back the ledger to capture accurate unit cost.
      const ledgers = await this.prisma.client.inventoryLedger.findMany({
        where: { productId: item.productId, referenceType: 'meal_production', referenceId: planId },
      });
      let totalQty = 0;
      let totalCost = 0;
      for (const l of ledgers) {
        const q = Math.abs(Number(l.quantityChange));
        totalQty += q;
        totalCost += q * Number(l.unitCost ?? 0);
      }
      const unitCost = totalQty > 0 ? totalCost / totalQty : 0;

      await this.prisma.client.mealConsumption.create({
        data: {
          organizationId,
          mealProductionPlanId: planId,
          productId: item.productId,
          quantity: qty,
          unitCost,
          inventoryLedgerId: ledgers[0]?.id ?? null,
          stockLocationId: locationId,
          recordedById: this.tenant.userId ?? null,
        },
      });
      await this.prisma.client.mealProductionItem.updateMany({
        where: { id: item.id },
        data: { issuedQuantity: qty, consumedQuantity: qty, unitCost },
      });
    }

    await this.prisma.client.mealProductionPlan.updateMany({ where: { id: planId }, data: { status: 'ready' } });
    return this.getPlan(planId);
  }

  async recordWaste(planId: string, dto: RecordWasteDto) {
    const organizationId = this.tenant.organizationId;
    const plan = await this.prisma.client.mealProductionPlan.findFirst({ where: { id: planId }, select: { id: true } });
    if (!plan) throw new NotFoundException(`MealProductionPlan ${planId} not found`);

    // Cost from inventory costing: the production item's unit cost for the product.
    let unitCost = 0;
    if (dto.productId) {
      const item = await this.prisma.client.mealProductionItem.findFirst({ where: { mealProductionPlanId: planId, productId: dto.productId } });
      unitCost = Number(item?.unitCost ?? 0);
    }
    const cost = unitCost * dto.quantity;

    const waste = await this.prisma.client.mealWaste.create({
      data: {
        organizationId,
        mealProductionPlanId: planId,
        mealSessionId: dto.mealSessionId ?? null,
        productId: dto.productId ?? null,
        quantity: dto.quantity,
        uomId: dto.uomId ?? null,
        cost,
        reason: dto.reason,
        notes: dto.notes ?? null,
        recordedById: this.tenant.userId ?? null,
      },
    });
    if (dto.productId) {
      await this.prisma.client.mealProductionItem.updateMany({
        where: { mealProductionPlanId: planId, productId: dto.productId },
        data: { wastedQuantity: { increment: dto.quantity } },
      });
    }
    return waste;
  }

  setStatus(planId: string, dto: SetProductionStatusDto) {
    return this.prisma.client.mealProductionPlan.updateMany({
      where: { id: planId },
      data: { status: dto.status, updatedBy: this.tenant.userId ?? null },
    });
  }

  async getPlan(planId: string) {
    const plan = await this.prisma.client.mealProductionPlan.findFirst({
      where: { id: planId },
      include: { items: true, consumptions: true, wastes: true, mealType: true },
    });
    if (!plan) throw new NotFoundException(`MealProductionPlan ${planId} not found`);
    return { ...plan, cost: this.summariseCost(plan) };
  }

  listPlans(from?: string, to?: string) {
    const where: any = {};
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }
    return this.prisma.client.mealProductionPlan.findMany({ where, include: { mealType: true }, orderBy: { date: 'desc' } });
  }

  /** Total ingredient cost, waste cost, and cost per expected portion. */
  private summariseCost(plan: any) {
    const foodCost = (plan.items ?? []).reduce((s: number, i: any) => s + Number(i.consumedQuantity) * Number(i.unitCost), 0);
    const wasteCost = (plan.wastes ?? []).reduce((s: number, w: any) => s + Number(w.cost), 0);
    const portions = plan.expectedPortions || 0;
    return {
      foodCost,
      wasteCost,
      costPerPortion: portions > 0 ? foodCost / portions : 0,
    };
  }

  private async defaultLocationId(): Promise<string | null> {
    const loc = await this.prisma.client.inventoryLocation.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
    return loc?.id ?? null;
  }
}
