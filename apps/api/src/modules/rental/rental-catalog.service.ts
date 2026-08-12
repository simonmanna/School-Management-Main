import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { LifecycleService } from '../../kernel/lifecycle/lifecycle.service';
import { RentalRatePeriod } from '@prisma/client';

/**
 * RentalCatalogService — rate cards and rental packages.
 *
 * Rate card: tiered bands per product+period (1 day 50k · 3+ days 40k/day ·
 * weekly 250k). `resolveRate` picks the highest-priority band containing the
 * requested unit count. Bands are soft-deleted masters like products.
 *
 * Package: Wedding Package = Suit + Shoes + Tie + Belt. Mirrors the
 * Combo/ComboItem expansion semantics — checkout expands components into lines.
 */
@Injectable()
export class RentalCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly lifecycle: LifecycleService,
  ) {}

  // ---------------------------------------------------------------- rates ---

  async listRates(productId?: string) {
    const orgId = this.tenant.organizationId;
    return this.prisma.client.rentalRate.findMany({
      where: { organizationId: orgId, ...(productId ? { productId } : {}) },
      orderBy: [{ productId: 'asc' }, { period: 'asc' }, { minUnits: 'asc' }],
    });
  }

  async upsertRate(dto: {
    productId: string;
    period: RentalRatePeriod;
    minUnits: number;
    maxUnits?: number;
    price: number;
    priority?: number;
    isActive?: boolean;
  }) {
    const orgId = this.tenant.organizationId;
    const product = await this.prisma.client.product.findFirst({
      where: { id: dto.productId, organizationId: orgId },
    });
    if (!product) throw new NotFoundException('Product not found');

    const price = Number(dto.price);
    if (!(price > 0)) throw new BadRequestException('Rate price must be positive');

    return this.prisma.client.rentalRate.upsert({
      where: {
        organizationId_productId_period_minUnits: {
          organizationId: orgId,
          productId: dto.productId,
          period: dto.period,
          minUnits: dto.minUnits,
        },
      },
      update: {
        maxUnits: dto.maxUnits ?? null,
        price,
        priority: dto.priority ?? 100,
        isActive: dto.isActive ?? true,
        updatedBy: this.tenant.userId ?? null,
      },
      create: {
        organizationId: orgId,
        productId: dto.productId,
        period: dto.period,
        minUnits: dto.minUnits,
        maxUnits: dto.maxUnits ?? null,
        price,
        priority: dto.priority ?? 100,
        isActive: dto.isActive ?? true,
        createdBy: this.tenant.userId ?? null,
      },
    });
  }

  async updateRate(id: string, dto: any) {
    const orgId = this.tenant.organizationId;
    const rate = await this.prisma.client.rentalRate.findFirst({ where: { id, organizationId: orgId } });
    if (!rate) throw new NotFoundException('Rate not found');
    return this.upsertRate({
      productId: rate.productId,
      period: rate.period,
      minUnits: dto.minUnits ?? Number(rate.minUnits),
      maxUnits: dto.maxUnits ?? (rate.maxUnits == null ? undefined : Number(rate.maxUnits)),
      price: dto.price ?? Number(rate.price),
      priority: dto.priority ?? rate.priority,
      isActive: dto.isActive ?? rate.isActive,
    });
  }

  async deleteRate(id: string) {
    const orgId = this.tenant.organizationId;
    const rate = await this.prisma.client.rentalRate.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!rate) throw new NotFoundException('Rate not found');
    return this.prisma.client.rentalRate.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: this.tenant.userId ?? null },
    });
  }

  /**
   * Resolve the applicable unit rate for a product/period/unit-count.
   * Bands: minUnits <= units <= (maxUnits ?? ∞), highest priority wins, ties
   * broken by the largest minUnits (most specific). Returns null when no band
   * matches (caller falls back to product default price or rejects).
   */
  async resolveRate(
    productId: string,
    period: RentalRatePeriod,
    units: number,
  ): Promise<{ rateId: string; unitRate: number } | null> {
    const orgId = this.tenant.organizationId;
    const bands = await this.prisma.client.rentalRate.findMany({
      where: { organizationId: orgId, productId, period, isActive: true, deletedAt: null },
      orderBy: [{ priority: 'asc' }, { minUnits: 'desc' }],
    });
    for (const b of bands) {
      if (units >= b.minUnits && (b.maxUnits === null || units <= b.maxUnits)) {
        return { rateId: b.id, unitRate: Number(b.price) };
      }
    }
    return null;
  }

  // ------------------------------------------------------------- packages ---

  async listPackages(includeInactive = false) {
    const orgId = this.tenant.organizationId;
    return this.prisma.client.rentalPackage.findMany({
      where: { organizationId: orgId, ...(includeInactive ? {} : { isActive: true }) },
      include: { items: { include: { product: { select: { id: true, code: true, name: true } } } } },
      orderBy: { name: 'asc' },
    });
  }

  async getPackage(id: string) {
    const orgId = this.tenant.organizationId;
    const pkg = await this.prisma.client.rentalPackage.findFirst({
      where: { id, organizationId: orgId },
      include: { items: { include: { product: { select: { id: true, code: true, name: true } } } } },
    });
    if (!pkg) throw new NotFoundException('Package not found');
    return pkg;
  }

  async createPackage(dto: {
    code: string;
    name: string;
    description?: string;
    productId: string;
    items: Array<{
      productId: string;
      quantity?: number;
      role?: 'primary' | 'accessory' | 'consumable';
      isRequired?: boolean;
      priceMode?: 'included' | 'add_on';
    }>;
  }) {
    const orgId = this.tenant.organizationId;
    const product = await this.prisma.client.product.findFirst({
      where: { id: dto.productId, organizationId: orgId },
    });
    if (!product) throw new NotFoundException('Package product not found');

    return this.prisma.client.$transaction(async (tx: any) => {
      const pkg = await tx.rentalPackage.create({
        data: {
          organizationId: orgId,
          code: dto.code,
          name: dto.name,
          description: dto.description ?? null,
          productId: dto.productId,
          createdBy: this.tenant.userId ?? null,
          items: {
            create: dto.items.map((it) => ({
              organizationId: orgId,
              productId: it.productId,
              quantity: it.quantity ?? 1,
              role: (it.role ?? 'accessory') as any,
              isRequired: it.isRequired ?? true,
              priceMode: (it.priceMode ?? 'included') as any,
            })),
          },
        },
        include: { items: true },
      });
      return pkg;
    });
  }

  async updatePackage(
    id: string,
    dto: {
      name?: string;
      description?: string;
      isActive?: boolean;
      items?: Array<{
        productId: string;
        quantity?: number;
        role?: 'primary' | 'accessory' | 'consumable';
        isRequired?: boolean;
        priceMode?: 'included' | 'add_on';
      }>;
    },
  ) {
    const orgId = this.tenant.organizationId;
    const pkg = await this.prisma.client.rentalPackage.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!pkg) throw new NotFoundException('Package not found');

    return this.prisma.client.$transaction(async (tx: any) => {
      if (dto.items) {
        await tx.rentalPackageItem.deleteMany({ where: { packageId: id } });
      }
      return tx.rentalPackage.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          updatedBy: this.tenant.userId ?? null,
          ...(dto.items
            ? {
                items: {
                  create: dto.items.map((it) => ({
                    organizationId: orgId,
                    productId: it.productId,
                    quantity: it.quantity ?? 1,
                    role: (it.role ?? 'accessory') as any,
                    isRequired: it.isRequired ?? true,
                    priceMode: (it.priceMode ?? 'included') as any,
                  })),
                },
              }
            : {}),
        },
        include: { items: true },
      });
    });
  }

  async deletePackage(id: string) {
    const orgId = this.tenant.organizationId;
    const pkg = await this.prisma.client.rentalPackage.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!pkg) throw new NotFoundException('Package not found');
    return this.prisma.client.rentalPackage.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, updatedBy: this.tenant.userId ?? null },
    });
  }
}
