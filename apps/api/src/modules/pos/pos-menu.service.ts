/**
 * POS — Menu management service.
 *
 * Customers never order Products directly — they order MenuItems. This service
 * owns the CRUD for `MenuItem`, `MenuProduct` (ingredient links), and
 * `MenuCategory`. The POS terminal's "menu" panel calls `listAvailable()`;
 * the digital-menu public catalog re-uses the same data.
 *
 * Per spec section #1:
 *   - MenuItems are built from one or more Products via MenuProduct.
 *   - Each MenuItem has a basePrice, image, preparationTime, availability flag.
 *   - Categories form a self-referencing tree (parentId).
 *
 * Image handling (P11):
 *   - File IDs are stored permanently in `MenuItem.image` / `MenuCategory.image`.
 *   - Fresh signed download URLs are minted on every read so images never
 *     expire in the UI even though the underlying signed URL TTL is 15 min.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { FilesService } from '../../kernel/files/files.service';
import type { PaginatedResult, PaginationQuery } from '@erp/shared';

export interface MenuItemBundle {
  product: {
    id: string;
    name: string;
    unitPrice: number;
    sku: string | null;
    productType: string;
  };
  variants: Array<{
    id: string;
    name: string;
    price: number;
    sortOrder: number;
  }>;
  accompanimentGroups: Array<{
    id: string;
    name: string;
    isRequired: boolean;
    minSelect: number;
    maxSelect: number;
    sortOrder: number;
    options: Array<{
      id: string;
      name: string;
      priceImpact: number;
      isDefault: boolean;
      sortOrder: number;
    }>;
  }>;
  groups: Array<{
    id: string;
    name: string;
    groupType: 'ADD_ON' | 'MODIFIER';
    minSelect: number;
    maxSelect: number;
    sortOrder: number;
    modifiers: Array<{
      id: string;
      name: string;
      priceDelta: number;
      isDefault: boolean;
      sortOrder: number;
    }>;
  }>;
}

@Injectable()
export class PosMenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly files: FilesService,
  ) {}

  /** Convert a stored value to a fresh signed download URL.
   *
   *  Accepted formats in `image` column:
   *   - A file ID (UUID) → mint a new signed URL via FilesService.
   *   - A full signed URL `/api/v1/files/{id}/download?token=…&expires=…` →
   *     extract the ID and mint a fresh URL (expired tokens no longer block
   *     the image in the UI).
   *   - An absolute URL (http/https) → return as-is.
   *   - null/empty → null.
   */
  private resolveImage(image: string | null | undefined): string | null {
    if (!image) return null;
    if (image.startsWith('http')) return image;
    // Extract file ID from a stored URL, or accept a bare UUID directly
    const idMatch = image.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (!idMatch) return image; // not a recognised format — pass through
    try {
      return this.files.signDownload(idMatch[1]).url;
    } catch {
      return null;
    }
  }

  // ───────────────────────── Categories ─────────────────────────

  listCategories() {
    return this.prisma.client.menuCategory.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async createCategory(input: {
    name: string;
    parentId?: string;
    image?: string;
    icon?: string;
    displayOrder?: number;
  }) {
    return this.prisma.client.menuCategory.create({
      data: {
        organizationId: this.tenant.organizationId,
        name: input.name,
        parentId: input.parentId,
        image: input.image,
        icon: input.icon,
        displayOrder: input.displayOrder ?? 0,
      },
    });
  }

  async updateCategory(id: string, data: { name?: string; displayOrder?: number; image?: string; icon?: string }) {
    const existing = await this.prisma.client.menuCategory.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException(`MenuCategory ${id} not found`);
    return this.prisma.client.menuCategory.update({ where: { id }, data });
  }

  async deleteCategory(id: string) {
    const existing = await this.prisma.client.menuCategory.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException(`MenuCategory ${id} not found`);
    return this.prisma.client.menuCategory.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  }

  async restoreCategory(id: string) {
    const existing = await this.prisma.client.menuCategory.findFirst({ where: { id, deletedAt: { not: null } } });
    if (!existing) throw new NotFoundException(`Deleted MenuCategory ${id} not found`);
    return this.prisma.client.menuCategory.update({ where: { id }, data: { deletedAt: null, isActive: true } });
  }

  listDeletedCategories() {
    return this.prisma.client.menuCategory.findMany({
      where: { deletedAt: { not: null } },
      orderBy: [{ deletedAt: 'desc' }],
    });
  }

  // ─────────────────────────── Items ────────────────────────────

  /** The POS terminal calls this on load. Returns the menu grouped by category,
     *  filtered to available items only. Ingredient links are included so the
     *  KDS can show "uses: Espresso, Milk" and the cashier can show stock hint. */
    async listAvailable() {
      const cats = await this.prisma.client.menuCategory.findMany({
        where: { isActive: true, deletedAt: null },
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      });
      const items = await this.prisma.client.menuItem.findMany({
        where: { isAvailable: true, deletedAt: null },
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      });
      return {
        categories: cats.map((c) => ({ ...c, image: this.resolveImage(c.image) })),
        items: items.map((it) => ({ ...it, image: this.resolveImage(it.image) })),
      };
    }

    async listAll(query: PaginationQuery): Promise<PaginatedResult<any>> {
        const page = Math.max(1, Number(query.page ?? 1));
        const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20)));
        const where: any = { deletedAt: null };
        if (query.search) {
          where.OR = [
            { name: { contains: query.search, mode: 'insensitive' } },
            { code: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
          ];
        }
        const orderBy = query.sortBy
          ? { [query.sortBy]: query.sortOrder ?? 'asc' as const }
          : [{ displayOrder: 'asc' as const }, { name: 'asc' as const }];
        const [data, total] = await Promise.all([
          this.prisma.client.menuItem.findMany({
            where, orderBy, skip: (page - 1) * pageSize, take: pageSize,
            include: {
              category: true,
              ingredients: { include: { product: { select: { id: true, code: true, name: true, station: true } } } },
            },
          }),
          this.prisma.client.menuItem.count({ where }),
        ]);
        return {
          data: data.map((it) => ({ ...it, image: this.resolveImage(it.image) })),
          meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
        };
      }

      async getOne(id: string) {
        const item = await this.prisma.client.menuItem.findFirst({
          where: { id, deletedAt: null },
          include: { ingredients: { include: { product: true } }, category: true },
        });
        if (!item) throw new NotFoundException(`MenuItem ${id} not found`);
        return { ...item, image: this.resolveImage(item.image) };
      }

  async create(input: {
    code?: string;
    name: string;
    description?: string;
    categoryId?: string;
    basePrice?: number;
    isInventoryTracked?: boolean;
    image?: string;
    preparationTime?: number;
    isAvailable?: boolean;
    displayOrder?: number;
    ingredients?: { productId: string; quantity?: number }[];
  }) {
    const tracked = input.isInventoryTracked === true;
    return this.prisma.client.$transaction(async (tx) => {
      const item = await tx.menuItem.create({
        data: {
          organizationId: this.tenant.organizationId,
          code: input.code,
          name: input.name,
          description: input.description,
          categoryId: input.categoryId,
          basePrice: input.basePrice ?? null,
          isInventoryTracked: tracked,
          image: input.image,
          preparationTime: input.preparationTime ?? null,
          isAvailable: input.isAvailable ?? true,
          displayOrder: input.displayOrder ?? 0,
        },
      });
      for (const ing of input.ingredients ?? []) {
        await tx.menuProduct.create({
          data: {
            organizationId: this.tenant.organizationId,
            menuItemId: item.id,
            productId: ing.productId,
            quantity: ing.quantity ?? 1,
          },
        });
      }
      return tx.menuItem.findUniqueOrThrow({
        where: { id: item.id },
        include: { ingredients: { include: { product: true } }, category: true },
      });
    });
  }

  async update(id: string, patch: Partial<{
    code: string;
    name: string;
    description: string;
    categoryId: string | null;
    basePrice: number | null;
    isInventoryTracked: boolean;
    image: string | null;
    preparationTime: number | null;
    isAvailable: boolean;
    displayOrder: number;
    ingredients: { productId: string; quantity?: number }[];
  }>) {
    await this.getOne(id);
    const { ingredients, isInventoryTracked, ...data } = patch;
    const tracked = isInventoryTracked === true;
    return this.prisma.client.$transaction(async (tx) => {
      if (data && Object.keys(data).length > 0) {
        await tx.menuItem.update({ where: { id }, data: { ...data, ...(isInventoryTracked !== undefined ? { isInventoryTracked: tracked } : {}) } });
      }
      if (ingredients) {
        await tx.menuProduct.deleteMany({ where: { menuItemId: id } });
        for (const ing of ingredients) {
          await tx.menuProduct.create({
            data: {
              organizationId: this.tenant.organizationId,
              menuItemId: id,
              productId: ing.productId,
              quantity: ing.quantity ?? 1,
            },
          });
        }
      }
      return tx.menuItem.findUniqueOrThrow({
        where: { id },
        include: { ingredients: { include: { product: true } }, category: true },
      });
    });
  }

  async setAvailability(id: string, isAvailable: boolean) {
    return this.prisma.client.menuItem.update({ where: { id }, data: { isAvailable } });
  }
  /** Soft disable — just sets isAvailable=false (keeps history intact). */
    async disable(id: string) {
      await this.getOne(id);
      return this.prisma.client.menuItem.update({
        where: { id },
        data: { isAvailable: false },
      });
    }

    /** Soft delete — sets deletedAt and isAvailable=false. */
    async deleteItem(id: string) {
      const existing = await this.prisma.client.menuItem.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException(`MenuItem ${id} not found`);
      return this.prisma.client.menuItem.update({ where: { id }, data: { deletedAt: new Date(), isAvailable: false } });
    }

    /** Restore a soft-deleted menu item. */
    async restoreItem(id: string) {
      const existing = await this.prisma.client.menuItem.findFirst({ where: { id, deletedAt: { not: null } } });
      if (!existing) throw new NotFoundException(`Deleted MenuItem ${id} not found`);
      return this.prisma.client.menuItem.update({ where: { id }, data: { deletedAt: null, isAvailable: true } });
    }

    /** List all soft-deleted menu items. */
    listDeletedItems() {
      return this.prisma.client.menuItem.findMany({
        where: { deletedAt: { not: null } },
        orderBy: [{ deletedAt: 'desc' }],
      });
    }

    /* ====================== Full bundle (POS terminal) ====================== */

  /**
   * Returns the complete configuration for a menu item: variants, accompaniment
   * groups, and modifier groups (add-ons + modifiers). The POS terminal uses
   * this single response to drive the full 4-step order flow.
   */
  async getFullBundle(menuItemId: string): Promise<MenuItemBundle | null> {
    const orgId = this.tenant.organizationId;
    const item = await this.prisma.client.menuItem.findFirst({
      where: { id: menuItemId, organizationId: orgId },
    });
    if (!item) return null;

    // Variants
    const variants = await this.prisma.client.menuItemVariant.findMany({
      where: { organizationId: orgId, menuItemId, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    // Accompaniment groups + options (via join table)
    const accLinks = await this.prisma.client.menuItemAccompanimentGroup.findMany({
      where: { menuItemId, menuItem: { organizationId: orgId } },
      orderBy: { sortOrder: 'asc' },
      include: {
        accompanimentGroup: {
          include: { options: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
        },
      },
    });
    const accGroups = (accLinks as any[])
      .filter((l: any) => l.accompanimentGroup && l.accompanimentGroup.isActive)
      .map((l: any) => l.accompanimentGroup);

    // Modifier groups + modifiers
    const links = await this.prisma.client.menuItemModifierGroup.findMany({
      where: { menuItemId, organizationId: orgId },
      orderBy: { sortOrder: 'asc' },
      include: {
        modifierGroup: {
          include: { modifiers: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
        },
      },
    });

    const groups = (links as any[])
      .filter((l: any) => l.modifierGroup && l.modifierGroup.isActive)
      .map((l: any) => ({
        id: l.modifierGroup.id,
        name: l.modifierGroup.name,
        groupType: (l.modifierGroup.groupType ?? 'ADD_ON') as 'ADD_ON' | 'MODIFIER',
        minSelect: l.modifierGroup.minSelect,
        maxSelect: l.modifierGroup.maxSelect,
        sortOrder: l.sortOrder,
        modifiers: l.modifierGroup.modifiers.map((m: any) => ({
          id: m.id,
          name: m.name,
          priceDelta: Number(m.priceDelta),
          isDefault: m.isDefault,
          sortOrder: m.sortOrder,
        })),
      }));

    return {
      product: {
        id: (item as any).id,
        name: (item as any).name,
        unitPrice: Number((item as any).basePrice ?? 0),
        sku: (item as any).code ?? null,
        productType: 'menu',
      },
      variants: (variants as any[]).map((v) => ({
        id: v.id,
        name: v.name,
        price: Number(v.price),
        sortOrder: v.sortOrder,
      })),
      accompanimentGroups: (accGroups as any[]).map((g) => ({
        id: g.id,
        name: g.name,
        isRequired: g.isRequired,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        sortOrder: g.sortOrder,
        options: g.options.map((o: any) => ({
          id: o.id,
          name: o.name,
          priceImpact: Number(o.priceImpact),
          isDefault: o.isDefault,
          sortOrder: o.sortOrder,
        })),
      })),
      groups,
    };
  }
}