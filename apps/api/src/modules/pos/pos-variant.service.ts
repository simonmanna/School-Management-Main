import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../kernel/audit/audit.service';

export interface VariantWithDetails {
  id: string;
  menuItemId: string;
  name: string;
  price: number;
  sortOrder: number;
  isActive: boolean;
}

@Injectable()
export class PosVariantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  /* ====================== Read ====================== */

  async listVariants(menuItemId: string): Promise<VariantWithDetails[]> {
    const orgId = this.tenant.organizationId;
    const rows = await this.prisma.client.menuItemVariant.findMany({
      where: { organizationId: orgId, menuItemId, isActive: true, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
    return (rows as any[]).map((v) => ({
      id: v.id,
      menuItemId: v.menuItemId,
      name: v.name,
      price: Number(v.price),
      sortOrder: v.sortOrder,
      isActive: v.isActive,
    }));
  }

  async getVariant(id: string): Promise<VariantWithDetails> {
    const orgId = this.tenant.organizationId;
    const v = await this.prisma.client.menuItemVariant.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
    if (!v) throw new NotFoundException(`MenuItemVariant ${id} not found`);
    return {
      id: v.id,
      menuItemId: v.menuItemId,
      name: v.name,
      price: Number(v.price),
      sortOrder: v.sortOrder,
      isActive: v.isActive,
    };
  }

  /* ====================== Write ====================== */

  async createVariant(
    menuItemId: string,
    dto: { name: string; price: number; sortOrder?: number },
  ): Promise<VariantWithDetails> {
    const orgId = this.tenant.organizationId;
    if (!dto.name?.trim()) throw new BadRequestException('Variant name is required');
    if (dto.price == null || dto.price < 0) throw new BadRequestException('Variant price must be >= 0');

    const menuItem = await this.prisma.client.menuItem.findFirst({
      where: { id: menuItemId, organizationId: orgId } as any,
    });
    if (!menuItem) throw new NotFoundException(`MenuItem ${menuItemId} not found`);

    const existing = await this.prisma.client.menuItemVariant.findFirst({
      where: { organizationId: orgId, menuItemId, name: dto.name.trim(), deletedAt: null },
    });
    if (existing) throw new BadRequestException(`Variant "${dto.name.trim()}" already exists for this item`);

    const created = await this.prisma.client.$transaction(async (tx: any) => {
      const v = await tx.menuItemVariant.create({
        data: {
          organizationId: orgId,
          menuItemId,
          name: dto.name.trim(),
          price: dto.price,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'MenuItemVariant',
        entityId: v.id,
        action: 'create',
        newValues: { menuItemId, name: v.name, price: Number(v.price), sortOrder: v.sortOrder },
      });
      return v;
    });

    return {
      id: created.id,
      menuItemId: created.menuItemId,
      name: created.name,
      price: Number(created.price),
      sortOrder: created.sortOrder,
      isActive: created.isActive,
    };
  }

  async updateVariant(
    id: string,
    dto: { name?: string; price?: number; sortOrder?: number; isActive?: boolean; expectedUpdatedAt?: string; ipAddress?: string; userAgent?: string },
  ): Promise<VariantWithDetails> {
    const orgId = this.tenant.organizationId;
    const existing = await this.prisma.client.menuItemVariant.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException(`MenuItemVariant ${id} not found`);

    if (dto.name !== undefined && !dto.name.trim()) {
      throw new BadRequestException('Variant name cannot be empty');
    }
    if (dto.price !== undefined && dto.price < 0) {
      throw new BadRequestException('Variant price must be >= 0');
    }

    // Optimistic concurrency check
    if (dto.expectedUpdatedAt && new Date(dto.expectedUpdatedAt).getTime() !== existing.updatedAt.getTime()) {
      throw new ConflictException('This variant was modified by another user. Please reload and try again.');
    }

    const oldValues = {
      name: existing.name,
      price: Number(existing.price),
      sortOrder: existing.sortOrder,
      isActive: existing.isActive,
    };

    const updated = await this.prisma.client.$transaction(async (tx: any) => {
      const v = await tx.menuItemVariant.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.price !== undefined ? { price: dto.price } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'MenuItemVariant',
        entityId: v.id,
        action: 'update',
        oldValues,
        newValues: {
          name: v.name,
          price: Number(v.price),
          sortOrder: v.sortOrder,
          isActive: v.isActive,
        },
        ipAddress: dto.ipAddress,
        userAgent: dto.userAgent,
      });
      return v;
    });

    return {
      id: updated.id,
      menuItemId: updated.menuItemId,
      name: updated.name,
      price: Number(updated.price),
      sortOrder: updated.sortOrder,
      isActive: updated.isActive,
    };
  }

  async deleteVariant(id: string): Promise<void> {
    const orgId = this.tenant.organizationId;
    const existing = await this.prisma.client.menuItemVariant.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException(`MenuItemVariant ${id} not found`);

    await this.prisma.client.$transaction(async (tx: any) => {
      const v = await tx.menuItemVariant.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      });
      await this.audit.recordInTx(tx, {
        entity: 'MenuItemVariant',
        entityId: id,
        action: 'delete',
        oldValues: { name: existing.name, price: Number(existing.price) },
        newValues: { name: v.name, isActive: false },
      });
    });
  }

  /* ====================== Validation ====================== */

  async resolveVariantPrice(menuItemId: string, variantId: string): Promise<number> {
    const orgId = this.tenant.organizationId;
    const v = await this.prisma.client.menuItemVariant.findFirst({
      where: { id: variantId, menuItemId, organizationId: orgId, isActive: true, deletedAt: null },
    });
    if (!v) throw new BadRequestException(`Variant ${variantId} not found or inactive`);
    return Number(v.price);
  }

  async validateVariant(menuItemId: string, variantId: string): Promise<VariantWithDetails> {
    const orgId = this.tenant.organizationId;
    const v = await this.prisma.client.menuItemVariant.findFirst({
      where: { id: variantId, menuItemId, organizationId: orgId, isActive: true, deletedAt: null },
    });
    if (!v) throw new BadRequestException(`Invalid variant selection for this menu item`);
    return {
      id: v.id,
      menuItemId: v.menuItemId,
      name: v.name,
      price: Number(v.price),
      sortOrder: v.sortOrder,
      isActive: v.isActive,
    };
  }
}
