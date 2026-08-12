/**
 * POS P4 — Modifiers + Combos service.
 *
 * Exposes CRUD for ModifierGroup / Modifier / Combo / ComboItem, plus the
 * "get everything a product needs" helper used by the terminal AddOns
 * dialog and the menu grid (combo button).
 *
 * Modifiers are an M-N between Product and ModifierGroup. When a cashier
 * taps a product, the terminal fetches the groups + modifiers via
 * `getProductBundle(productId)` and opens the AddOns dialog if the product
 * has any required groups.
 *
 * Combos are sold as a single line item on the receipt (price fixed), but
 * at checkout time pos.service expands them into one DocumentLine per
 * ComboItem so inventory still decrements per-component.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../kernel/audit/audit.service';

export interface ModifierGroupWithModifiers {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  color: string | null;
  icon: string | null;
  groupType: 'ADD_ON' | 'MODIFIER';
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  version: number;
  modifiers: Array<{
    id: string;
    name: string;
    kitchenPrintName: string | null;
    description: string | null;
    priceDelta: number;
    isDefault: boolean;
    sortOrder: number;
  }>;
}

export interface ProductBundle {
  product: { id: string; name: string; unitPrice: number; sku: string | null; productType: string };
  groups: ModifierGroupWithModifiers[];
}

export interface ComboWithItems {
  id: string;
  name: string;
  price: number;
  description: string | null;
  imageUrl: string | null;
  items: Array<{ productId: string; productName: string; quantity: number }>;
}

@Injectable()
export class PosModifiersService {
  private readonly logger = new Logger(PosModifiersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  /* ====================== Modifier groups ====================== */

  async listGroups(opts?: { search?: string; isActive?: boolean; page?: number; pageSize?: number }): Promise<{ data: ModifierGroupWithModifiers[]; total: number; page: number; pageSize: number }> {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId, deletedAt: null };
    if (opts?.isActive !== undefined) where.isActive = opts.isActive;
    if (opts?.search) {
      where.name = { contains: opts.search, mode: 'insensitive' };
    }
    const page = opts?.page ?? 1;
    const pageSize = opts?.pageSize ?? 50;
    const skip = (page - 1) * pageSize;

    const [groups, total] = await Promise.all([
      this.prisma.client.modifierGroup.findMany({
        where,
        orderBy: { sortOrder: 'asc' },
        skip,
        take: pageSize,
        include: {
          modifiers: {
            where: { isActive: true, deletedAt: null },
            orderBy: { sortOrder: 'asc' },
          },
        },
      }),
      this.prisma.client.modifierGroup.count({ where }),
    ]);
    return {
      data: (groups as any[]).map((g) => ({
        id: g.id,
        name: g.name,
        category: g.category ?? null,
        description: g.description ?? null,
        color: g.color ?? null,
        icon: g.icon ?? null,
        groupType: g.groupType ?? 'ADD_ON',
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        sortOrder: g.sortOrder,
        version: g.version,
        modifiers: g.modifiers.map((m: any) => ({
          id: m.id, name: m.name, kitchenPrintName: m.kitchenPrintName ?? null, description: m.description ?? null,
          priceDelta: Number(m.priceDelta), isDefault: m.isDefault, sortOrder: m.sortOrder,
        })),
      })),
      total,
      page,
      pageSize,
    };
  }

  async createGroup(dto: { name: string; category?: string; description?: string; color?: string; icon?: string; groupType?: 'ADD_ON' | 'MODIFIER'; minSelect?: number; maxSelect?: number; sortOrder?: number }): Promise<any> {
    const orgId = this.tenant.organizationId;
    if (!dto.name?.trim()) throw new BadRequestException('Group name is required');
    if (dto.groupType && !['ADD_ON', 'MODIFIER'].includes(dto.groupType)) {
      throw new BadRequestException('groupType must be ADD_ON or MODIFIER');
    }
    const minSelect = dto.minSelect ?? 0;
    const maxSelect = dto.maxSelect ?? 1;
    if (minSelect > maxSelect) {
      throw new BadRequestException('minSelect cannot be greater than maxSelect');
    }
    const dup = await this.prisma.client.modifierGroup.findFirst({
      where: { organizationId: orgId, name: dto.name.trim(), deletedAt: null },
    });
    if (dup) throw new BadRequestException(`Group "${dto.name.trim()}" already exists`);

    const created = await this.prisma.client.$transaction(async (tx: any) => {
      const g = await tx.modifierGroup.create({
        data: {
          organizationId: orgId,
          name: dto.name.trim(),
          category: dto.category?.trim() || null,
          description: dto.description?.trim() || null,
          color: dto.color?.trim() || null,
          icon: dto.icon?.trim() || null,
          groupType: dto.groupType ?? 'ADD_ON',
          minSelect: dto.minSelect ?? 0,
          maxSelect: dto.maxSelect ?? 1,
          sortOrder: dto.sortOrder ?? 0,
          createdBy: this.tenant.userId,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'ModifierGroup',
        entityId: g.id,
        action: 'create',
        newValues: { name: g.name, category: g.category, groupType: g.groupType, minSelect: g.minSelect, maxSelect: g.maxSelect },
      });
      return g;
    });

    return created;
  }

  async createModifier(dto: { groupId: string; name: string; kitchenPrintName?: string; description?: string; priceDelta?: number; isDefault?: boolean; sortOrder?: number }): Promise<any> {
    if (!dto.name?.trim()) throw new BadRequestException('Modifier name is required');
    const orgId = this.tenant.organizationId;
    const group = await this.prisma.client.modifierGroup.findFirst({ where: { id: dto.groupId, organizationId: orgId, deletedAt: null } });
    if (!group) throw new NotFoundException('Modifier group not found');

    const created = await this.prisma.client.$transaction(async (tx: any) => {
      const m = await tx.modifier.create({
        data: {
          organizationId: orgId,
          groupId: dto.groupId,
          name: dto.name.trim(),
          kitchenPrintName: dto.kitchenPrintName?.trim() || null,
          description: dto.description?.trim() || null,
          priceDelta: dto.priceDelta ?? 0,
          isDefault: dto.isDefault ?? false,
          sortOrder: dto.sortOrder ?? 0,
          createdBy: this.tenant.userId,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'Modifier',
        entityId: m.id,
        action: 'create',
        newValues: { groupId: dto.groupId, name: m.name, priceDelta: Number(m.priceDelta) },
      });
      return m;
    });

    return created;
  }

  /* ====================== Product ↔ groups ====================== */

  async getProductBundle(productId: string): Promise<ProductBundle | null> {
    const orgId = this.tenant.organizationId;
    const product = await this.prisma.client.product.findFirst({
      where: { id: productId, organizationId: orgId, isActive: true },
    });
    if (!product) return null;
    const links = await this.prisma.client.productModifierGroup.findMany({
      where: { productId, organizationId: orgId, deletedAt: null, modifierGroup: { isActive: true } },
      orderBy: { sortOrder: 'asc' },
      include: {
        modifierGroup: {
          include: {
            modifiers: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
          },
        },
      },
    });
    const groups: ModifierGroupWithModifiers[] = (links as any[])
      .filter((l) => l.modifierGroup && l.modifierGroup.isActive)
      .map((l) => ({
        id: l.modifierGroup.id,
        name: l.modifierGroup.name,
        category: l.modifierGroup.category ?? null,
        description: l.modifierGroup.description ?? null,
        color: l.modifierGroup.color ?? null,
        icon: l.modifierGroup.icon ?? null,
        groupType: l.modifierGroup.groupType ?? 'ADD_ON',
        minSelect: l.modifierGroup.minSelect,
        maxSelect: l.modifierGroup.maxSelect,
        sortOrder: l.sortOrder,
        version: l.modifierGroup.version,
        modifiers: l.modifierGroup.modifiers.map((m: any) => ({
          id: m.id, name: m.name, kitchenPrintName: m.kitchenPrintName ?? null, description: m.description ?? null,
          priceDelta: Number(m.priceDelta), isDefault: m.isDefault, sortOrder: m.sortOrder,
        })),
      }));
    return {
      product: {
        id: (product as any).id,
        name: (product as any).name,
        unitPrice: Number((product as any).salesPrice ?? 0),
        sku: (product as any).sku ?? null,
        productType: (product as any).productType,
      },
      groups,
    };
  }

  /* ====================== Menu-item modifiers (MENU) ====================== */

  async getMenuItemBundle(menuItemId: string): Promise<ProductBundle | null> {
    const orgId = this.tenant.organizationId;
    const item = await this.prisma.client.menuItem.findFirst({ where: { id: menuItemId, organizationId: orgId } });
    if (!item) return null;
    const links = await this.prisma.client.menuItemModifierGroup.findMany({
      where: { menuItemId, organizationId: orgId, deletedAt: null, modifierGroup: { isActive: true } },
      orderBy: { sortOrder: 'asc' },
      include: {
        modifierGroup: {
          include: { modifiers: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
        },
      },
    });
    const groups: ModifierGroupWithModifiers[] = (links as any[])
      .filter((l) => l.modifierGroup && l.modifierGroup.isActive)
      .map((l) => ({
        id: l.modifierGroup.id,
        name: l.modifierGroup.name,
        category: l.modifierGroup.category ?? null,
        description: l.modifierGroup.description ?? null,
        color: l.modifierGroup.color ?? null,
        icon: l.modifierGroup.icon ?? null,
        groupType: l.modifierGroup.groupType ?? 'ADD_ON',
        minSelect: l.modifierGroup.minSelect,
        maxSelect: l.modifierGroup.maxSelect,
        sortOrder: l.sortOrder,
        version: l.modifierGroup.version,
        modifiers: l.modifierGroup.modifiers.map((m: any) => ({
          id: m.id, name: m.name, kitchenPrintName: m.kitchenPrintName ?? null, description: m.description ?? null,
          priceDelta: Number(m.priceDelta), isDefault: m.isDefault, sortOrder: m.sortOrder,
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
      groups,
    };
  }

  async assignGroupToMenuItem(menuItemId: string, modifierGroupId: string, sortOrder = 0): Promise<void> {
    const orgId = this.tenant.organizationId;
    const [m, g] = await Promise.all([
      this.prisma.client.menuItem.findFirst({ where: { id: menuItemId, organizationId: orgId } as any }),
      this.prisma.client.modifierGroup.findFirst({ where: { id: modifierGroupId, organizationId: orgId } as any }),
    ]);
    if (!m || !g) throw new NotFoundException('Menu item or modifier group not found');
    const result = await this.prisma.client.menuItemModifierGroup.upsert({
      where: { menuItemId_modifierGroupId: { menuItemId, modifierGroupId } },
      update: { sortOrder },
      create: { organizationId: orgId, menuItemId, modifierGroupId, sortOrder },
    });
    await this.audit.record({
      entity: 'MenuItemModifierGroup',
      entityId: result.id,
      action: 'assign' as any,
      newValues: { menuItemId, modifierGroupId, sortOrder },
    });
  }

  async unassignGroupFromMenuItem(menuItemId: string, modifierGroupId: string): Promise<void> {
    const orgId = this.tenant.organizationId;
    const existing = await this.prisma.client.menuItemModifierGroup.findFirst({
      where: { menuItemId, modifierGroupId, organizationId: orgId, deletedAt: null },
    });
    if (!existing) return;
    await this.prisma.client.$transaction(async (tx: any) => {
      await tx.menuItemModifierGroup.update({
        where: { id: existing.id },
        data: { deletedAt: new Date() },
      });
      await this.audit.recordInTx(tx, {
        entity: 'MenuItemModifierGroup',
        entityId: existing.id,
        action: 'unassign' as any,
        oldValues: { menuItemId, modifierGroupId },
      });
    });
  }

  async validateMenuItemModifiers(menuItemId: string, selectedModifierIds: string[], bypassRequired = false): Promise<void> {
    const bundle = await this.getMenuItemBundle(menuItemId);
    if (!bundle || bundle.groups.length === 0) return;
    this.enforceModifierRules(bundle, selectedModifierIds, bypassRequired);
  }

  /**
   * Server-side check of a product's modifier rules. BLOCKING: an unmet
   * required group or an over-max pick throws BadRequestException so the
   * sale cannot proceed with invalid selections. Price/anti-tamper is still
   * enforced separately in `resolveSelectedModifiers`.
   */
  async validateProductModifiers(productId: string, selectedModifierIds: string[], bypassRequired = false): Promise<void> {
    const bundle = await this.getProductBundle(productId);
    if (!bundle || bundle.groups.length === 0) return;
    this.enforceModifierRules(bundle, selectedModifierIds, bypassRequired);
  }

  private enforceModifierRules(bundle: any, selectedModifierIds: string[], bypassRequired = false): void {
    const selected = new Set(selectedModifierIds);
    for (const g of bundle.groups) {
      const inGroup = g.modifiers.reduce((n: number, m: any) => (selected.has(m.id) ? n + 1 : n), 0);
      if (!bypassRequired && inGroup < g.minSelect) {
        throw new BadRequestException(
          `"${g.name}" requires at least ${g.minSelect} modifier(s). ${inGroup} selected.`,
        );
      }
      if (g.maxSelect > 0 && inGroup > g.maxSelect) {
        throw new BadRequestException(
          `"${g.name}" allows at most ${g.maxSelect} modifier(s). ${inGroup} selected.`,
        );
      }
    }
  }

  /** Validate every line's modifier selection against its menu item / product rules. */
  async validateSelections(
    lines: Array<{ productId?: string | null; menuItemId?: string | null; modifiers?: Array<{ modifierId: string }> }>,
    bypassRequired = false,
  ): Promise<void> {
    for (const l of lines) {
      const ids = (l.modifiers ?? []).map((m) => m.modifierId);
      if (l.menuItemId) await this.validateMenuItemModifiers(l.menuItemId, ids, bypassRequired);
      else if (l.productId) await this.validateProductModifiers(l.productId, ids, bypassRequired);
    }
  }

  /**
   * Resolve a line's selected modifiers to DB-authoritative {name, priceDelta},
   * rejecting any id that isn't an active modifier on this item's groups. The
   * sell path MUST use this instead of trusting the client-sent priceDelta —
   * otherwise a crafted request could book an arbitrary add-on price to the GL,
   * and an admin price change wouldn't apply to a stale cart. Input order +
   * duplicates (one entry per add-on unit) are preserved so qty math holds.
   */
  async resolveSelectedModifiers(opts: {
    menuItemId?: string | null;
    productId?: string | null;
    modifierIds: string[];
  }): Promise<Array<{ modifierId: string; name: string; kitchenPrintName: string | null; priceDelta: number }>> {
    if (!opts.modifierIds?.length) return [];
    const bundle = opts.menuItemId
      ? await this.getMenuItemBundle(opts.menuItemId)
      : opts.productId
        ? await this.getProductBundle(opts.productId)
        : null;
    if (!bundle) {
      // No modifier config (e.g. item changed since the cart was built) — drop
      // the add-ons rather than block the sale. Prices are never client-trusted.
      this.logger.warn(`[modifier] no config for item; ignoring ${opts.modifierIds.length} selected modifier(s).`);
      return [];
    }
    const allowed = new Map<string, { name: string; kitchenPrintName: string | null; priceDelta: number }>();
    for (const g of bundle.groups) {
      for (const m of g.modifiers) {
        allowed.set(m.id, { name: m.name, kitchenPrintName: m.kitchenPrintName ?? null, priceDelta: Number(m.priceDelta) });
      }
    }
    // Anti-tamper: prices come from the DB, never the client. Unknown / deleted
    // / deactivated ids are dropped (logged) instead of rejected so a stale cart
    // still rings up — they simply aren't charged.
    return opts.modifierIds
      .map((id) => {
        const m = allowed.get(id);
        if (!m) { this.logger.warn(`[modifier] "${id}" not available for "${bundle.product.name}" — ignored.`); return null; }
        return { modifierId: id, name: m.name, kitchenPrintName: m.kitchenPrintName, priceDelta: m.priceDelta };
      })
      .filter((m): m is { modifierId: string; name: string; kitchenPrintName: string | null; priceDelta: number } => m !== null);
  }

  async assignGroupToProduct(productId: string, modifierGroupId: string, sortOrder = 0): Promise<void> {
    const orgId = this.tenant.organizationId;
    const [p, g] = await Promise.all([
      this.prisma.client.product.findFirst({ where: { id: productId, organizationId: orgId, deletedAt: null } }),
      this.prisma.client.modifierGroup.findFirst({ where: { id: modifierGroupId, organizationId: orgId, deletedAt: null } }),
    ]);
    if (!p || !g) throw new NotFoundException('Product or modifier group not found');
    const result = await this.prisma.client.productModifierGroup.upsert({
      where: { productId_modifierGroupId: { productId, modifierGroupId } },
      update: { sortOrder },
      create: { organizationId: orgId, productId, modifierGroupId, sortOrder },
    });
    await this.audit.record({
      entity: 'ProductModifierGroup',
      entityId: result.id,
      action: 'assign' as any,
      newValues: { productId, modifierGroupId, sortOrder },
    });
  }

  /* ====================== Edit / delete (M-E) ====================== */

  async updateGroup(id: string, dto: { name?: string; category?: string; description?: string; color?: string; icon?: string; groupType?: 'ADD_ON' | 'MODIFIER'; minSelect?: number; maxSelect?: number; sortOrder?: number; isActive?: boolean; expectedVersion?: number; ipAddress?: string; userAgent?: string }): Promise<any> {
    const orgId = this.tenant.organizationId;
    const existing = await this.prisma.client.modifierGroup.findFirst({ where: { id, organizationId: orgId, deletedAt: null } });
    if (!existing) throw new NotFoundException('Modifier group not found');
    if (dto.groupType && !['ADD_ON', 'MODIFIER'].includes(dto.groupType)) {
      throw new BadRequestException('groupType must be ADD_ON or MODIFIER');
    }

    const minSelect = dto.minSelect ?? existing.minSelect;
    const maxSelect = dto.maxSelect ?? existing.maxSelect;
    if (minSelect > maxSelect) {
      throw new BadRequestException('minSelect cannot be greater than maxSelect');
    }

    if (dto.name !== undefined && dto.name.trim() !== existing.name) {
      const dup = await this.prisma.client.modifierGroup.findFirst({
        where: { organizationId: orgId, name: dto.name.trim(), deletedAt: null, id: { not: id } },
      });
      if (dup) throw new BadRequestException(`Group "${dto.name.trim()}" already exists`);
    }

    const e = existing as any;
    const oldValues = {
      name: e.name,
      category: e.category,
      description: e.description,
      color: e.color,
      icon: e.icon,
      groupType: e.groupType,
      minSelect: e.minSelect,
      maxSelect: e.maxSelect,
      sortOrder: e.sortOrder,
      isActive: e.isActive,
    };

    const data: any = {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.category !== undefined ? { category: dto.category?.trim() || null } : {}),
      ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
      ...(dto.color !== undefined ? { color: dto.color?.trim() || null } : {}),
      ...(dto.icon !== undefined ? { icon: dto.icon?.trim() || null } : {}),
      ...(dto.groupType !== undefined ? { groupType: dto.groupType } : {}),
      ...(dto.minSelect !== undefined ? { minSelect: dto.minSelect } : {}),
      ...(dto.maxSelect !== undefined ? { maxSelect: dto.maxSelect } : {}),
      ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      updatedBy: this.tenant.userId,
      version: { increment: 1 },
    };

    const updated = await this.prisma.client.$transaction(async (tx: any) => {
      let result: any;
      if (dto.expectedVersion !== undefined) {
        const resultRaw = await tx.modifierGroup.updateMany({
          where: { id, version: dto.expectedVersion, organizationId: orgId },
          data,
        });
        if (resultRaw.count === 0) {
          throw new ConflictException('This modifier group was modified by another user. Please reload and try again.');
        }
        result = await tx.modifierGroup.findFirst({ where: { id, organizationId: orgId } });
      } else {
        result = await tx.modifierGroup.update({ where: { id }, data });
      }
      const r = result as any;
      await this.audit.recordInTx(tx, {
        entity: 'ModifierGroup',
        entityId: id,
        action: 'update',
        oldValues,
        newValues: {
          name: r.name,
          category: r.category,
          description: r.description,
          color: r.color,
          icon: r.icon,
          groupType: r.groupType,
          minSelect: r.minSelect,
          maxSelect: r.maxSelect,
          sortOrder: r.sortOrder,
          isActive: r.isActive,
        },
        ipAddress: dto.ipAddress,
        userAgent: dto.userAgent,
      });
      return result;
    });

    return updated;
  }

  async deleteGroup(id: string): Promise<void> {
    const orgId = this.tenant.organizationId;
    const existing = await this.prisma.client.modifierGroup.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Modifier group not found');

    const assignmentCount = await this.prisma.client.productModifierGroup.count({
      where: { modifierGroupId: id, deletedAt: null },
    });
    const menuAssignmentCount = await this.prisma.client.menuItemModifierGroup.count({
      where: { modifierGroupId: id, deletedAt: null },
    });
    const totalAssignments = assignmentCount + menuAssignmentCount;
    if (totalAssignments > 0) {
      throw new ConflictException(
        `Cannot delete "${existing.name}" — assigned to ${totalAssignments} product(s)/menu item(s). Deactivate instead.`,
      );
    }

    await this.prisma.client.$transaction(async (tx: any) => {
      await tx.modifier.updateMany({
        where: { groupId: id, deletedAt: null },
        data: { deletedAt: new Date(), isActive: false },
      });
      await tx.modifierGroup.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      });
      await this.audit.recordInTx(tx, {
        entity: 'ModifierGroup',
        entityId: id,
        action: 'delete',
        oldValues: { name: existing.name },
        newValues: { name: existing.name, isActive: false },
      });
    });
  }

  async updateModifier(id: string, dto: { name?: string; kitchenPrintName?: string; description?: string; priceDelta?: number; isDefault?: boolean; sortOrder?: number; isActive?: boolean; expectedUpdatedAt?: string; ipAddress?: string; userAgent?: string }): Promise<any> {
    const orgId = this.tenant.organizationId;
    const existing = await this.prisma.client.modifier.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Modifier not found');

    // Optimistic concurrency check
    if (dto.expectedUpdatedAt && new Date(dto.expectedUpdatedAt).getTime() !== existing.updatedAt.getTime()) {
      throw new ConflictException('This modifier was modified by another user. Please reload and try again.');
    }

    if (dto.priceDelta !== undefined && dto.priceDelta < 0) {
      throw new BadRequestException('Modifier priceDelta cannot be negative');
    }

    const me = existing as any;
    const oldValues = {
      name: me.name,
      kitchenPrintName: me.kitchenPrintName,
      description: me.description,
      priceDelta: Number(me.priceDelta),
      isDefault: me.isDefault,
      sortOrder: me.sortOrder,
      isActive: me.isActive,
    };

    const updated = await this.prisma.client.$transaction(async (tx: any) => {
      const m = await tx.modifier.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.kitchenPrintName !== undefined ? { kitchenPrintName: dto.kitchenPrintName?.trim() || null } : {}),
          ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
          ...(dto.priceDelta !== undefined ? { priceDelta: dto.priceDelta } : {}),
          ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          updatedBy: this.tenant.userId,
        },
      });
      const mr = m as any;
      await this.audit.recordInTx(tx, {
        entity: 'Modifier',
        entityId: mr.id,
        action: 'update',
        oldValues,
        newValues: {
          name: mr.name,
          kitchenPrintName: mr.kitchenPrintName,
          description: mr.description,
          priceDelta: Number(mr.priceDelta),
          isDefault: mr.isDefault,
          sortOrder: mr.sortOrder,
          isActive: mr.isActive,
        },
        ipAddress: dto.ipAddress,
        userAgent: dto.userAgent,
      });
      return m;
    });

    return updated;
  }

  async deleteModifier(id: string): Promise<void> {
    const orgId = this.tenant.organizationId;
    const existing = await this.prisma.client.modifier.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Modifier not found');

    // Block deletion if used in any historical or current orders
    const [orderUsage, docUsage, invoiceUsage] = await Promise.all([
      this.prisma.client.orderItemModifier.count({ where: { modifierId: id, organizationId: orgId } }),
      this.prisma.client.documentLineModifier.count({ where: { modifierId: id, organizationId: orgId } }),
      this.prisma.client.invoiceItemModifier.count({ where: { modifierId: id, organizationId: orgId } }),
    ]);
    const totalUsage = orderUsage + docUsage + invoiceUsage;
    if (totalUsage > 0) {
      throw new ConflictException(
        `"${existing.name}" is used in ${totalUsage} historical order line(s). Deactivate instead of deleting.`,
      );
    }

    await this.prisma.client.$transaction(async (tx: any) => {
      const m = await tx.modifier.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      });
      await this.audit.recordInTx(tx, {
        entity: 'Modifier',
        entityId: id,
        action: 'delete',
        oldValues: { name: existing.name, priceDelta: Number(existing.priceDelta) },
        newValues: { name: m.name, isActive: false },
      });
    });
  }

  async unassignGroupFromProduct(productId: string, modifierGroupId: string): Promise<void> {
    const orgId = this.tenant.organizationId;
    const existing = await this.prisma.client.productModifierGroup.findFirst({
      where: { productId, modifierGroupId, organizationId: orgId, deletedAt: null },
    });
    if (!existing) return;

    await this.prisma.client.$transaction(async (tx: any) => {
      await tx.productModifierGroup.update({
        where: { id: existing.id },
        data: { deletedAt: new Date() },
      });
      await this.audit.recordInTx(tx, {
        entity: 'ProductModifierGroup',
        entityId: existing.id,
        action: 'unassign' as any,
        oldValues: { productId, modifierGroupId },
      });
    });
  }

  /**
   * M-F — modifier/add-on sales report: count + add-on revenue per modifier name
   * over a date window, for SOLD (posted/paid) sales only. Reads the M-D
   * DocumentLineModifier rows, so it's empty until that migration is applied.
   */
  async modifierSalesReport(from?: string, to?: string): Promise<Array<{ name: string; count: number; revenue: number }>> {
    const orgId = this.tenant.organizationId;
    const dateFilter = from || to
      ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
      : {};
    const rows = await this.prisma.client.documentLineModifier.findMany({
      where: {
        organizationId: orgId,
        documentLine: { document: { status: { in: ['posted', 'paid'] } } },
        ...dateFilter,
      },
      select: { name: true, priceDelta: true },
    });
    const map = new Map<string, { name: string; count: number; revenue: number }>();
    for (const r of rows as any[]) {
      const cur = map.get(r.name) ?? { name: r.name, count: 0, revenue: 0 };
      cur.count += 1;
      cur.revenue += Number(r.priceDelta);
      map.set(r.name, cur);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }

  /* ====================== Combos ====================== */

  async updateCombo(id: string, dto: {
    name?: string;
    price?: number;
    description?: string | null;
    imageUrl?: string | null;
    items?: Array<{ productId: string; quantity: number }>;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<any> {
    const orgId = this.tenant.organizationId;
    const existing = await this.prisma.client.combo.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!existing) throw new NotFoundException(`Combo ${id} not found`);

    if (dto.name !== undefined && !dto.name.trim()) {
      throw new BadRequestException('Combo name cannot be empty');
    }

    const oldValues = {
      name: existing.name,
      price: Number(existing.price),
      description: existing.description,
      imageUrl: existing.imageUrl,
    };

    return this.prisma.client.$transaction(async (tx: any) => {
      const data: any = {};
      if (dto.name !== undefined) data.name = dto.name.trim();
      if (dto.price !== undefined) data.price = dto.price;
      if (dto.description !== undefined) data.description = dto.description;
      if (dto.imageUrl !== undefined) data.imageUrl = dto.imageUrl;

      if (Object.keys(data).length > 0) {
        await tx.combo.update({ where: { id }, data });
      }

      if (dto.items !== undefined) {
        if (!dto.items.length) throw new BadRequestException('Combo must have at least one item');
        await tx.comboItem.deleteMany({ where: { comboId: id } });
        for (const it of dto.items) {
          const product = await tx.product.findFirst({
            where: { id: it.productId, organizationId: orgId, deletedAt: null },
          });
          if (!product) throw new BadRequestException(`Combo references unknown product: ${it.productId}`);
          await tx.comboItem.create({
            data: {
              organizationId: orgId, comboId: id,
              productId: it.productId, quantity: it.quantity || 1,
            },
          });
        }
      }

      const updated = await tx.combo.findUniqueOrThrow({
        where: { id },
        include: { items: { include: { product: true } } },
      });

      await this.audit.recordInTx(tx, {
        entity: 'Combo',
        entityId: id,
        action: 'update',
        oldValues,
        newValues: {
          name: updated.name,
          price: Number(updated.price),
          description: updated.description,
          imageUrl: updated.imageUrl,
          items: (updated as any).items?.length ?? 0,
        },
        ipAddress: dto.ipAddress,
        userAgent: dto.userAgent,
      });

      return updated;
    });
  }

  async deleteCombo(id: string): Promise<void> {
    const orgId = this.tenant.organizationId;
    const existing = await this.prisma.client.combo.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!existing) throw new NotFoundException(`Combo ${id} not found`);

    await this.prisma.client.$transaction(async (tx: any) => {
      await tx.comboItem.deleteMany({ where: { comboId: id } });
      await tx.combo.update({
        where: { id },
        data: { isActive: false },
      });
      await this.audit.recordInTx(tx, {
        entity: 'Combo',
        entityId: id,
        action: 'delete',
        oldValues: { name: existing.name, price: Number(existing.price) },
        newValues: { isActive: false },
      });
    });
  }

  async listCombos(): Promise<ComboWithItems[]> {
    const orgId = this.tenant.organizationId;
    const combos = await this.prisma.client.combo.findMany({
      where: { organizationId: orgId, isActive: true } as any,
      orderBy: { sortOrder: 'asc' },
      include: {
        items: {
          include: { product: true },
        },
      },
    });
    return (combos as any[]).map((c) => ({
      id: c.id,
      name: c.name,
      price: Number(c.price),
      description: c.description,
      imageUrl: c.imageUrl,
      items: c.items.map((it: any) => ({
        productId: it.productId,
        productName: it.product?.name ?? '?',
        quantity: it.quantity,
      })),
    }));
  }

  async getCombo(comboId: string): Promise<ComboWithItems | null> {
    const orgId = this.tenant.organizationId;
    const c = await this.prisma.client.combo.findFirst({
      where: { id: comboId, organizationId: orgId } as any,
      include: { items: { include: { product: true } } },
    });
    if (!c) return null;
    const combo = c as any;
    return {
      id: combo.id,
      name: combo.name,
      price: Number(combo.price),
      description: combo.description,
      imageUrl: combo.imageUrl,
      items: (combo.items ?? []).map((it: any) => ({
        productId: it.productId,
        productName: it.product?.name ?? '?',
        quantity: it.quantity,
      })),
    };
  }

  async createCombo(dto: { name: string; price: number; description?: string; imageUrl?: string; items: Array<{ productId: string; quantity: number }> }): Promise<any> {
    const orgId = this.tenant.organizationId;
    if (!dto.name?.trim()) throw new BadRequestException('Combo name is required');
    if (!dto.items?.length) throw new BadRequestException('Combo must have at least one item');
    return this.prisma.client.$transaction(async (tx: any) => {
      const combo = await tx.combo.create({
        data: {
          organizationId: orgId,
          name: dto.name.trim(),
          price: dto.price,
          description: dto.description,
          imageUrl: dto.imageUrl,
        },
      });
      for (const it of dto.items) {
        const product = await tx.product.findFirst({ where: { id: it.productId, organizationId: orgId, deletedAt: null } });
        if (!product) throw new BadRequestException(`Combo references unknown product: ${it.productId}`);
        await tx.comboItem.create({
          data: {
            organizationId: orgId,
            comboId: combo.id,
            productId: it.productId,
            quantity: it.quantity || 1,
          },
        });
      }
      return combo;
    });
  }

  /**
   * Return all active menu items with an isAssigned flag for the given group.
   * Used by the admin modifier page to render the checkbox assignment list.
   */
  async getGroupMenuItems(groupId: string): Promise<Array<{ id: string; name: string; isAssigned: boolean }>> {
    const orgId = this.tenant.organizationId;
    const group = await this.prisma.client.modifierGroup.findFirst({
      where: { id: groupId, organizationId: orgId, deletedAt: null },
    });
    if (!group) throw new NotFoundException('Modifier group not found');
    const [menuItems, assignedLinks] = await Promise.all([
      this.prisma.client.menuItem.findMany({
        where: { organizationId: orgId, isAvailable: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.client.menuItemModifierGroup.findMany({
        where: { modifierGroupId: groupId, organizationId: orgId, deletedAt: null },
        select: { menuItemId: true },
      }),
    ]);
    const assignedIds = new Set(assignedLinks.map((l: any) => l.menuItemId));
    return (menuItems as any[]).map((m) => ({ id: m.id, name: m.name, isAssigned: assignedIds.has(m.id) }));
  }

  /**
   * P4 helper used by pos.service.checkout. Given a list of (comboId, quantity)
   * pairs, expand each combo into its component products × quantity, with
   * the *combo price* (not the sum of components) attributed to the first
   * component line so the receipt still shows the right total.
   */
  async expandCombosForCheckout(items: Array<{ comboId?: string; quantity: number }>): Promise<Array<{ productId: string; quantity: number; comboPrice?: number }>> {
    const out: Array<{ productId: string; quantity: number; comboPrice?: number }> = [];
    for (const it of items) {
      if (!it.comboId) continue;
      const combo = await this.getCombo(it.comboId);
      if (!combo) throw new BadRequestException(`Unknown combo: ${it.comboId}`);
      for (let i = 0; i < combo.items.length; i++) {
        const comp = combo.items[i];
        const expandedQty = comp.quantity * it.quantity;
        out.push({
          productId: comp.productId,
          quantity: expandedQty,
          comboPrice: i === 0 ? combo.price : undefined,
        });
      }
    }
    return out;
  }
}
