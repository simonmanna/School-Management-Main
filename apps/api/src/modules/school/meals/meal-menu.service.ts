/** Meals V1 — menu management (Menu + MenuItem dishes). */
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import type { CreateMealMenuDto, UpdateMealMenuDto, MealMenuItemInput } from './dto.types';

@Injectable()
export class MealMenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  async create(dto: CreateMealMenuDto) {
    const organizationId = this.tenant.organizationId;
    const userId = this.tenant.userId ?? null;
    return this.prisma.client.$transaction(async (tx: any) => {
      const menu = await tx.mealMenu.create({
        data: {
          organizationId,
          mealTypeId: dto.mealTypeId,
          date: dto.date ? new Date(dto.date) : null,
          dayOfWeek: dto.dayOfWeek ?? null,
          mealPlanId: dto.mealPlanId ?? null,
          title: dto.title ?? null,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      // Build items from explicit list.
      for (const item of dto.items ?? []) {
        await tx.mealMenuItem.create({
          data: {
            organizationId,
            mealMenuId: menu.id,
            name: item.name,
            notes: item.notes ?? null,
            sortOrder: item.sortOrder ?? 0,
            mealRecipeId: item.mealRecipeId ?? null,
            posMenuItemId: item.posMenuItemId ?? null,
          },
        });
      }

      // Or build items from imported POS MenuItems (reuse cafe catalog).
      if (dto.posMenuItemIds?.length) {
        const posItems = await tx.menuItem.findMany({
          where: { id: { in: dto.posMenuItemIds }, organizationId },
          orderBy: { name: 'asc' },
        });
        for (const p of posItems) {
          await tx.mealMenuItem.create({
            data: {
              organizationId,
              mealMenuId: menu.id,
              name: p.name,
              notes: p.description ?? null,
              sortOrder: 0,
              posMenuItemId: p.id,
            },
          });
        }
      }

      return tx.mealMenu.findFirst({ where: { id: menu.id }, include: { items: true, mealType: true } });
    });
  }

  async update(id: string, dto: UpdateMealMenuDto) {
    const res = await this.prisma.client.mealMenu.updateMany({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.date !== undefined ? { date: dto.date ? new Date(dto.date) : null } : {}),
        ...(dto.dayOfWeek !== undefined ? { dayOfWeek: dto.dayOfWeek } : {}),
        updatedBy: this.tenant.userId ?? null,
      },
    });
    if (res.count === 0) throw new NotFoundException(`MealMenu ${id} not found`);
    return this.prisma.client.mealMenu.findFirst({ where: { id }, include: { items: true, mealType: true } });
  }

  async addItem(menuId: string, item: MealMenuItemInput) {
    const menu = await this.prisma.client.mealMenu.findFirst({ where: { id: menuId }, select: { id: true } });
    if (!menu) throw new NotFoundException(`MealMenu ${menuId} not found`);
    return this.prisma.client.mealMenuItem.create({
      data: {
        organizationId: this.tenant.organizationId,
        mealMenuId: menuId,
        name: item.name,
        notes: item.notes ?? null,
        sortOrder: item.sortOrder ?? 0,
        mealRecipeId: item.mealRecipeId ?? null,
        posMenuItemId: item.posMenuItemId ?? null,
      },
    });
  }

  /** Catalog of imported POS MenuItems (grouped by category) for building meal menus. */
  async posCatalog() {
    const organizationId = this.tenant.organizationId;
    const items = await this.prisma.client.menuItem.findMany({
      where: { organizationId, customFields: { path: ['__posSource'], equals: 'cafe-pos' } },
      orderBy: [{ categoryId: 'asc' }, { name: 'asc' }],
      include: { category: true },
    });
    const byCategory: Record<string, any> = {};
    for (const it of items) {
      const key = it.categoryId ?? '__uncategorized';
      if (!byCategory[key]) {
        byCategory[key] = { categoryId: it.categoryId, categoryName: it.category?.name ?? 'Uncategorized', items: [] };
      }
      byCategory[key].items.push(it);
    }
    return Object.values(byCategory);
  }

  /** Catalog of school-food MenuItems (Ugandan local dishes + fruits), grouped by category. */
  async schoolCatalog() {
    const organizationId = this.tenant.organizationId;
    const items = await this.prisma.client.menuItem.findMany({
      where: { organizationId, customFields: { path: ['__schoolMenu'], equals: true } },
      orderBy: [{ categoryId: 'asc' }, { name: 'asc' }],
      include: { category: true },
    });
    const byCategory: Record<string, any> = {};
    for (const it of items) {
      const key = it.categoryId ?? '__uncategorized';
      if (!byCategory[key]) {
        byCategory[key] = { categoryId: it.categoryId, categoryName: it.category?.name ?? 'Uncategorized', items: [] };
      }
      byCategory[key].items.push(it);
    }
    return Object.values(byCategory);
  }

  /** Build a full menu from selected POS MenuItem ids (reuse cafe catalog). */
  async fromPos(dto: CreateMealMenuDto) {
    if (!dto.posMenuItemIds?.length) throw new NotFoundException('posMenuItemIds required');
    return this.create({ ...dto, items: undefined });
  }

  async removeItem(itemId: string) {
    const res = await this.prisma.client.mealMenuItem.deleteMany({ where: { id: itemId } });
    if (res.count === 0) throw new NotFoundException(`MealMenuItem ${itemId} not found`);
  }

  list(mealTypeId?: string, from?: string, to?: string) {
    const where: any = {};
    if (mealTypeId) where.mealTypeId = mealTypeId;
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }
    return this.prisma.client.mealMenu.findMany({
      where,
      include: { items: { orderBy: { sortOrder: 'asc' } }, mealType: true },
      orderBy: { date: 'desc' },
    });
  }

  async remove(id: string) {
    const res = await this.prisma.client.mealMenu.updateMany({ where: { id }, data: { deletedAt: new Date() } });
    if (res.count === 0) throw new NotFoundException(`MealMenu ${id} not found`);
  }
}
