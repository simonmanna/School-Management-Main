import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../kernel/audit/audit.service';

export interface AccompanimentOptionWithDetails {
  id: string;
  groupId: string;
  name: string;
  priceImpact: number;
  isDefault: boolean;
  sortOrder: number;
  isActive: boolean;
  inventoryItemId: string | null;
  updatedAt?: Date;
}

export interface AccompanimentSalesReportRow {
  optionName: string;
  groupName: string;
  count: number;
  revenue: number;
}

export interface AccompanimentGroupWithOptions {
  id: string;
  name: string;
  category: string | null;
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  isActive: boolean;
  options: AccompanimentOptionWithDetails[];
}

export interface AccompanimentAssignment {
  id: string;
  menuItemId: string;
  accompanimentGroupId: string;
  sortOrder: number;
  group: AccompanimentGroupWithOptions;
}

@Injectable()
export class PosAccompanimentService {
  private readonly logger = new Logger('PosAccompanimentService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  /* ====================== Groups (standalone CRUD) ====================== */

  async listAllGroups(opts?: { search?: string; isActive?: boolean; page?: number; pageSize?: number }): Promise<{ data: AccompanimentGroupWithOptions[]; total: number; page: number; pageSize: number }> {
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
      this.prisma.client.accompanimentGroup.findMany({
        where,
        orderBy: { sortOrder: 'asc' },
        skip,
        take: pageSize,
        include: {
          options: { orderBy: { sortOrder: 'asc' } },
        },
      }),
      this.prisma.client.accompanimentGroup.count({ where }),
    ]);
    return { data: (groups as any[]).map(mapGroup), total, page, pageSize };
  }

  async listActiveGroups(): Promise<AccompanimentGroupWithOptions[]> {
    const orgId = this.tenant.organizationId;
    const groups = await this.prisma.client.accompanimentGroup.findMany({
      where: { organizationId: orgId, isActive: true, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
      include: {
        options: { where: { isActive: true, deletedAt: null }, orderBy: { sortOrder: 'asc' } },
      },
    });
    return (groups as any[]).map(mapGroup);
  }

  async getGroup(id: string): Promise<AccompanimentGroupWithOptions> {
    const orgId = this.tenant.organizationId;
    const g = await this.prisma.client.accompanimentGroup.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      include: {
        options: { where: { isActive: true, deletedAt: null }, orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!g) throw new NotFoundException(`AccompanimentGroup ${id} not found`);
    return mapGroup(g as any);
  }

  async createGroup(dto: {
    name: string;
    category?: string;
    isRequired?: boolean;
    minSelect?: number;
    maxSelect?: number;
    sortOrder?: number;
  }): Promise<AccompanimentGroupWithOptions> {
    const orgId = this.tenant.organizationId;
    if (!dto.name?.trim()) throw new BadRequestException('Accompaniment group name is required');
    const minSelect = dto.minSelect ?? 1;
    const maxSelect = dto.maxSelect ?? 1;
    if (minSelect > maxSelect) {
      throw new BadRequestException('minSelect cannot be greater than maxSelect');
    }
    const dup = await this.prisma.client.accompanimentGroup.findFirst({
      where: { organizationId: orgId, name: dto.name.trim(), deletedAt: null },
    });
    if (dup) throw new BadRequestException(`Group "${dto.name.trim()}" already exists`);

    const created = await this.prisma.client.$transaction(async (tx: any) => {
      const g = await tx.accompanimentGroup.create({
        data: {
          organizationId: orgId,
          name: dto.name.trim(),
          category: dto.category?.trim() || null,
          isRequired: dto.isRequired ?? true,
          minSelect: dto.minSelect ?? 1,
          maxSelect: dto.maxSelect ?? 1,
          sortOrder: dto.sortOrder ?? 0,
          createdBy: this.tenant.userId,
        },
        include: { options: true },
      });
      await this.audit.recordInTx(tx, {
        entity: 'AccompanimentGroup',
        entityId: g.id,
        action: 'create',
        newValues: { name: g.name, category: g.category, isRequired: g.isRequired, minSelect: g.minSelect, maxSelect: g.maxSelect },
      });
      return g;
    });

    return mapGroup(created as any);
  }

  async updateGroup(
    id: string,
    dto: {
      name?: string;
      category?: string;
      isRequired?: boolean;
      minSelect?: number;
      maxSelect?: number;
      sortOrder?: number;
      isActive?: boolean;
      expectedUpdatedAt?: string;
      ipAddress?: string;
      userAgent?: string;
    },
  ): Promise<AccompanimentGroupWithOptions> {
    const orgId = this.tenant.organizationId;
    const existing = await this.prisma.client.accompanimentGroup.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException(`AccompanimentGroup ${id} not found`);

    if (dto.name !== undefined && !dto.name.trim()) {
      throw new BadRequestException('Group name cannot be empty');
    }

    // Optimistic concurrency check
    if (dto.expectedUpdatedAt && existing.updatedAt && new Date(dto.expectedUpdatedAt).getTime() !== existing.updatedAt.getTime()) {
      throw new ConflictException('This accompaniment group was modified by another user. Please reload and try again.');
    }

    if (dto.minSelect !== undefined && dto.maxSelect !== undefined && dto.minSelect > dto.maxSelect) {
      throw new BadRequestException('minSelect cannot be greater than maxSelect');
    }

    if (dto.name !== undefined && dto.name.trim() !== existing.name) {
      const dup = await this.prisma.client.accompanimentGroup.findFirst({
        where: { organizationId: orgId, name: dto.name.trim(), deletedAt: null, id: { not: id } },
      });
      if (dup) throw new BadRequestException(`Group "${dto.name.trim()}" already exists`);
    }

    const e = existing as any;
    const oldValues = {
      name: e.name,
      category: e.category,
      isRequired: e.isRequired,
      minSelect: e.minSelect,
      maxSelect: e.maxSelect,
      sortOrder: e.sortOrder,
      isActive: e.isActive,
    };

    const updated = await this.prisma.client.$transaction(async (tx: any) => {
      const g = await tx.accompanimentGroup.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.category !== undefined ? { category: dto.category?.trim() || null } : {}),
          ...(dto.isRequired !== undefined ? { isRequired: dto.isRequired } : {}),
          ...(dto.minSelect !== undefined ? { minSelect: dto.minSelect } : {}),
          ...(dto.maxSelect !== undefined ? { maxSelect: dto.maxSelect } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          updatedBy: this.tenant.userId,
        },
      });
      const gr = g as any;
      await this.audit.recordInTx(tx, {
        entity: 'AccompanimentGroup',
        entityId: gr.id,
        action: 'update',
        oldValues,
        newValues: {
          name: gr.name,
          category: gr.category,
          isRequired: gr.isRequired,
          minSelect: gr.minSelect,
          maxSelect: gr.maxSelect,
          sortOrder: gr.sortOrder,
          isActive: gr.isActive,
        },
        ipAddress: dto.ipAddress,
        userAgent: dto.userAgent,
      });
      return g;
    });

    return this.getGroup(updated.id);
  }

  async deleteGroup(id: string): Promise<void> {
    const orgId = this.tenant.organizationId;
    const existing = await this.prisma.client.accompanimentGroup.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException(`AccompanimentGroup ${id} not found`);

    const assignmentCount = await this.prisma.client.menuItemAccompanimentGroup.count({
      where: { accompanimentGroupId: id, deletedAt: null },
    });
    if (assignmentCount > 0) {
      throw new ConflictException(
        `Cannot delete "${existing.name}" — assigned to ${assignmentCount} menu item(s). Deactivate instead.`,
      );
    }

    await this.prisma.client.$transaction(async (tx: any) => {
      await tx.accompanimentOption.updateMany({
        where: { groupId: id, deletedAt: null },
        data: { deletedAt: new Date(), isActive: false },
      });
      const g = await tx.accompanimentGroup.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      });
      await this.audit.recordInTx(tx, {
        entity: 'AccompanimentGroup',
        entityId: id,
        action: 'delete',
        oldValues: { name: existing.name },
        newValues: { name: g.name, isActive: false },
      });
    });
  }

  /* ====================== Options ====================== */

  async createOption(
    groupId: string,
    dto: {
      name: string;
      priceImpact?: number;
      isDefault?: boolean;
      sortOrder?: number;
      inventoryItemId?: string;
    },
  ): Promise<AccompanimentOptionWithDetails> {
    const orgId = this.tenant.organizationId;
    if (!dto.name?.trim()) throw new BadRequestException('Option name is required');

    const group = await this.prisma.client.accompanimentGroup.findFirst({
      where: { id: groupId, organizationId: orgId, deletedAt: null },
    });
    if (!group) throw new NotFoundException(`AccompanimentGroup ${groupId} not found`);

    const dup = await this.prisma.client.accompanimentOption.findFirst({
      where: { organizationId: orgId, groupId, name: dto.name.trim(), deletedAt: null },
    });
    if (dup) throw new BadRequestException(`Option "${dto.name.trim()}" already exists in this group`);

    const created = await this.prisma.client.$transaction(async (tx: any) => {
      const o = await tx.accompanimentOption.create({
        data: {
          organizationId: orgId,
          groupId,
          name: dto.name.trim(),
          priceImpact: dto.priceImpact ?? 0,
          isDefault: dto.isDefault ?? false,
          sortOrder: dto.sortOrder ?? 0,
          inventoryItemId: dto.inventoryItemId ?? null,
          createdBy: this.tenant.userId,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'AccompanimentOption',
        entityId: o.id,
        action: 'create',
        newValues: { groupId, name: o.name, priceImpact: Number(o.priceImpact), isDefault: o.isDefault },
      });
      return o;
    });

    return {
      id: created.id,
      groupId: created.groupId,
      name: created.name,
      priceImpact: Number(created.priceImpact),
      isDefault: created.isDefault,
      sortOrder: created.sortOrder,
      isActive: created.isActive,
      inventoryItemId: created.inventoryItemId ?? null,
    };
  }

  async updateOption(
    id: string,
    dto: {
      name?: string;
      priceImpact?: number;
      isDefault?: boolean;
      sortOrder?: number;
      isActive?: boolean;
      inventoryItemId?: string | null;
      expectedUpdatedAt?: string;
      ipAddress?: string;
      userAgent?: string;
    },
  ): Promise<AccompanimentOptionWithDetails> {
    const orgId = this.tenant.organizationId;
    const existing = await this.prisma.client.accompanimentOption.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException(`AccompanimentOption ${id} not found`);

    if (dto.name !== undefined && !dto.name.trim()) {
      throw new BadRequestException('Option name cannot be empty');
    }

    // Optimistic concurrency check
    if (dto.expectedUpdatedAt && (existing as any).updatedAt && new Date(dto.expectedUpdatedAt).getTime() !== (existing as any).updatedAt.getTime()) {
      throw new ConflictException('This accompaniment option was modified by another user. Please reload and try again.');
    }

    const oldValues = {
      name: existing.name,
      priceImpact: Number(existing.priceImpact),
      isDefault: existing.isDefault,
      sortOrder: existing.sortOrder,
      isActive: existing.isActive,
      inventoryItemId: existing.inventoryItemId,
    };

    const updated = await this.prisma.client.$transaction(async (tx: any) => {
      const o = await tx.accompanimentOption.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.priceImpact !== undefined ? { priceImpact: dto.priceImpact } : {}),
          ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.inventoryItemId !== undefined ? { inventoryItemId: dto.inventoryItemId } : {}),
          updatedBy: this.tenant.userId,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'AccompanimentOption',
        entityId: o.id,
        action: 'update',
        oldValues,
        newValues: {
          name: o.name,
          priceImpact: Number(o.priceImpact),
          isDefault: o.isDefault,
          sortOrder: o.sortOrder,
          isActive: o.isActive,
          inventoryItemId: o.inventoryItemId,
        },
        ipAddress: dto.ipAddress,
        userAgent: dto.userAgent,
      });
      return o;
    });

    return {
      id: updated.id,
      groupId: updated.groupId,
      name: updated.name,
      priceImpact: Number(updated.priceImpact),
      isDefault: updated.isDefault,
      sortOrder: updated.sortOrder,
      isActive: updated.isActive,
      inventoryItemId: updated.inventoryItemId ?? null,
    };
  }

  async deleteOption(id: string): Promise<void> {
    const orgId = this.tenant.organizationId;
    const existing = await this.prisma.client.accompanimentOption.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException(`AccompanimentOption ${id} not found`);

    await this.prisma.client.$transaction(async (tx: any) => {
      const o = await tx.accompanimentOption.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      });
      await this.audit.recordInTx(tx, {
        entity: 'AccompanimentOption',
        entityId: id,
        action: 'delete',
        oldValues: { name: existing.name },
        newValues: { name: o.name, isActive: false },
      });
    });
  }

  /* ====================== MenuItem assignment ====================== */

  async listGroupsForMenuItem(menuItemId: string): Promise<AccompanimentGroupWithOptions[]> {
    const orgId = this.tenant.organizationId;
    const assignments = await this.prisma.client.menuItemAccompanimentGroup.findMany({
      where: { menuItemId, menuItem: { organizationId: orgId }, deletedAt: null, accompanimentGroup: { isActive: true } },
      orderBy: { sortOrder: 'asc' },
      include: {
        accompanimentGroup: {
          include: {
            options: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
          },
        },
      },
    });
    return (assignments as any[]).map((a: any) => mapGroup(a.accompanimentGroup));
  }

  async assignGroupToMenuItem(menuItemId: string, accompanimentGroupId: string, sortOrder?: number): Promise<void> {
    const orgId = this.tenant.organizationId;
    const menuItem = await this.prisma.client.menuItem.findFirst({
      where: { id: menuItemId, organizationId: orgId },
    });
    if (!menuItem) throw new NotFoundException(`MenuItem ${menuItemId} not found`);

    const group = await this.prisma.client.accompanimentGroup.findFirst({
      where: { id: accompanimentGroupId, organizationId: orgId, deletedAt: null },
    });
    if (!group) throw new NotFoundException(`AccompanimentGroup ${accompanimentGroupId} not found`);

    const result = await this.prisma.client.menuItemAccompanimentGroup.upsert({
      where: { menuItemId_accompanimentGroupId: { menuItemId, accompanimentGroupId } },
      update: { sortOrder: sortOrder ?? 0 },
      create: { organizationId: orgId, menuItemId, accompanimentGroupId, sortOrder: sortOrder ?? 0 },
    });

    await this.audit.record({
      entity: 'MenuItemAccompanimentGroup',
      entityId: result.id,
      action: 'assign' as any,
      newValues: { menuItemId, accompanimentGroupId, sortOrder: sortOrder ?? 0 },
    });
  }

  async unassignGroupFromMenuItem(menuItemId: string, accompanimentGroupId: string): Promise<void> {
    const orgId = this.tenant.organizationId;
    const existing = await this.prisma.client.menuItemAccompanimentGroup.findFirst({
      where: { menuItemId, accompanimentGroupId, menuItem: { organizationId: orgId }, deletedAt: null },
    });
    if (!existing) return;

    await this.prisma.client.$transaction(async (tx: any) => {
      await tx.menuItemAccompanimentGroup.update({
        where: { id: existing.id },
        data: { deletedAt: new Date() },
      });
      await this.audit.recordInTx(tx, {
        entity: 'MenuItemAccompanimentGroup',
        entityId: existing.id,
        action: 'unassign' as any,
        oldValues: { menuItemId, accompanimentGroupId },
      });
    });
  }

  /* ====================== Validation ====================== */

  async validateSelections(
    menuItemId: string,
    selectedOptionIds: string[],
    bypassRequired = false,
  ): Promise<{ names: string[]; priceImpact: number }> {
    const orgId = this.tenant.organizationId;
    const assignments = await this.prisma.client.menuItemAccompanimentGroup.findMany({
      where: {
        menuItemId,
        menuItem: { organizationId: orgId },
        deletedAt: null,
        accompanimentGroup: { isActive: true, deletedAt: null },
      },
      include: {
        accompanimentGroup: {
          include: { options: { where: { isActive: true, deletedAt: null } } },
        },
      },
    });

    const groups = (assignments as any[]).map((a: any) => a.accompanimentGroup);
    if (groups.length === 0) return { names: [], priceImpact: 0 };

    const selected = new Set(selectedOptionIds);
    let totalPriceImpact = 0;
    const names: string[] = [];

    for (const g of groups) {
      const inGroup = g.options.filter((o: any) => selected.has(o.id));
      const count = inGroup.length;

      if (!bypassRequired && count < g.minSelect) {
        throw new BadRequestException(
          `"${g.name}" requires at least ${g.minSelect} selection(s). ${count} selected.`,
        );
      }
      if (g.maxSelect > 0 && count > g.maxSelect) {
        throw new BadRequestException(
          `"${g.name}" allows at most ${g.maxSelect} selection(s). ${count} selected.`,
        );
      }

      for (const o of inGroup) {
        const impact = Number(o.priceImpact);
        totalPriceImpact += impact;
        names.push(o.name);
      }
    }

    return { names, priceImpact: totalPriceImpact };
  }

  /* ====================== Sales report ====================== */

  async accompanimentSalesReport(from?: string, to?: string): Promise<AccompanimentSalesReportRow[]> {
    const orgId = this.tenant.organizationId;
    const dateFilter: any = {};
    if (from || to) {
      dateFilter.createdAt = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) };
    }
    const orderItems = await this.prisma.client.orderItem.findMany({
      where: {
        organizationId: orgId,
        ...dateFilter,
        order: { orderType: 'pos', reference: { document: { status: { in: ['posted', 'paid'] } } } },
      },
      select: { accompanimentNames: true, accompanimentOptionIds: true },
    });
    const map = new Map<string, { optionName: string; count: number }>();
    for (const item of orderItems as any[]) {
      const names: string[] = item.accompanimentNames ?? [];
      for (const n of names) {
        const cur = map.get(n) ?? { optionName: n, count: 0 };
        cur.count += 1;
        map.set(n, cur);
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count).map((r) => ({ ...r, revenue: 0, groupName: '' }));
  }
}

/* ====================== Shared mapper ====================== */

function mapGroup(g: any): AccompanimentGroupWithOptions {
  return {
    id: g.id,
    name: g.name,
    category: g.category ?? null,
    isRequired: g.isRequired,
    minSelect: g.minSelect,
    maxSelect: g.maxSelect,
    sortOrder: g.sortOrder,
    isActive: g.isActive,
    options: (g.options ?? []).map((o: any) => ({
      id: o.id,
      groupId: o.groupId,
      name: o.name,
      priceImpact: Number(o.priceImpact),
      isDefault: o.isDefault,
      sortOrder: o.sortOrder,
      isActive: o.isActive,
      inventoryItemId: o.inventoryItemId ?? null,
    })),
  };
}
