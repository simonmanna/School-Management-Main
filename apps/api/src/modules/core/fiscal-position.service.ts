import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';

export interface FiscalPositionDto {
  code: string;
  name: string;
  isActive?: boolean;
  sortOrder?: number;
}

/**
 * Fiscal positions (Odoo-style): configurable labels applied to sales
 * invoices that adapt tax treatment. Org-scoped by the tenancy extension;
 * soft-deleted (deletedAt). Documents store a loose id + name snapshot so
 * history survives a later rename/archive.
 */
@Injectable()
export class FiscalPositionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  list() {
    return this.prisma.client.fiscalPosition.findMany({
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
  }

  /** Archived (soft-deleted) positions, for the restore UI. */
  deleted() {
    return this.prisma.client.fiscalPosition.findMany({
      where: { deletedAt: { not: null } },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
  }

  async get(id: string) {
    const position = await this.prisma.client.fiscalPosition.findFirst({ where: { id } });
    if (!position) throw new NotFoundException('Fiscal position not found');
    return position;
  }

  async create(dto: FiscalPositionDto) {
    const existing = await this.prisma.client.fiscalPosition.findFirst({
      where: { code: dto.code },
    });
    if (existing) {
      throw new BadRequestException(`Fiscal position code "${dto.code}" already exists`);
    }
    return this.prisma.client.fiscalPosition.create({
      data: {
        organizationId: this.tenant.organizationId,
        code: dto.code,
        name: dto.name,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async update(id: string, dto: Partial<FiscalPositionDto>) {
    await this.get(id);
    if (dto.code) {
      const dupe = await this.prisma.client.fiscalPosition.findFirst({
        where: { code: dto.code, id: { not: id } },
      });
      if (dupe) {
        throw new BadRequestException(`Fiscal position code "${dto.code}" already exists`);
      }
    }
    return this.prisma.client.fiscalPosition.update({ where: { id }, data: dto });
  }

  /** Soft delete — archived for the restore UI, never hard-deleted. */
  async remove(id: string) {
    await this.get(id);
    return this.prisma.client.fiscalPosition.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Restore an archived position. Uses updateMany with an explicit `deletedAt`
   * filter so the tenancy SOFT_DELETE extension's implicit `deletedAt: null`
   * scope doesn't make the row invisible to the update.
   */
  async restore(id: string) {
    const res = await this.prisma.client.fiscalPosition.updateMany({
      where: { id, organizationId: this.tenant.organizationId, deletedAt: { not: null } },
      data: { deletedAt: null },
    });
    if (res.count === 0) throw new NotFoundException('Archived fiscal position not found');
    return this.prisma.client.fiscalPosition.findFirst({ where: { id } });
  }
}