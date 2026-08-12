import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { LifecycleService } from '../../kernel/lifecycle/lifecycle.service';
import { RentalConditionGrade, RentalUnitStatus } from '@prisma/client';

/**
 * RentalUnitService — the physical rentable items.
 *
 * One row per physical item; status lives HERE, never on InventorySerial.
 * Units are soft-deleted masters. Bulk-generate creates N units from a
 * template with sequential unit codes; a `retire` moves the unit to `retired`
 * (terminal — guarded by the lifecycle registry).
 */
@Injectable()
export class RentalUnitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly lifecycle: LifecycleService,
  ) {}

  async list(query: { productId?: string; status?: RentalUnitStatus; search?: string; page?: number; pageSize?: number }) {
    const orgId = this.tenant.organizationId;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where: any = {
      organizationId: orgId,
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { unitCode: { contains: query.search, mode: 'insensitive' } },
              { barcode: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.client.rentalUnit.count({ where }),
      this.prisma.client.rentalUnit.findMany({
        where,
        include: { product: { select: { id: true, code: true, name: true } } },
        orderBy: { unitCode: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, items };
  }

  async get(id: string) {
    const orgId = this.tenant.organizationId;
    const unit = await this.prisma.client.rentalUnit.findFirst({
      where: { id, organizationId: orgId },
      include: { product: { select: { id: true, code: true, name: true } } },
    });
    if (!unit) throw new NotFoundException('Rental unit not found');
    return unit;
  }

  async findByBarcode(barcode: string) {
    const orgId = this.tenant.organizationId;
    const unit = await this.prisma.client.rentalUnit.findFirst({
      where: { barcode, organizationId: orgId },
      include: { product: { select: { id: true, code: true, name: true } } },
    });
    if (!unit) throw new NotFoundException('Rental unit not found for barcode');
    return unit;
  }

  async create(dto: {
    unitCode: string;
    barcode?: string;
    productId: string;
    variantId?: string;
    inventorySerialId?: string;
    conditionGrade?: RentalConditionGrade;
    attributes?: Record<string, unknown>;
    acquisitionCost?: number;
    notes?: string;
  }) {
    const orgId = this.tenant.organizationId;
    const product = await this.prisma.client.product.findFirst({
      where: { id: dto.productId, organizationId: orgId },
    });
    if (!product) throw new NotFoundException('Product not found');
    if (product.rentalIsPooled) {
      throw new BadRequestException('Pooled products have no individual units');
    }

    const existing = await this.prisma.client.rentalUnit.findUnique({
      where: { organizationId_unitCode: { organizationId: orgId, unitCode: dto.unitCode } },
    });
    if (existing) throw new BadRequestException(`Unit code '${dto.unitCode}' already exists`);

    const unit = await this.prisma.client.rentalUnit.create({
      data: {
        organizationId: orgId,
        unitCode: dto.unitCode,
        barcode: dto.barcode ?? null,
        productId: dto.productId,
        variantId: dto.variantId ?? null,
        inventorySerialId: dto.inventorySerialId ?? null,
        conditionGrade: dto.conditionGrade ?? 'good',
        attributes: (dto.attributes ?? {}) as any,
        acquisitionCost: dto.acquisitionCost ?? null,
        notes: dto.notes ?? null,
        createdBy: this.tenant.userId ?? null,
      },
    });
    await this.lifecycle.transition({
      defKey: 'custody.rental_unit',
      entityType: 'rental_unit',
      entityId: unit.id,
      from: null,
      to: 'available',
      action: 'acquire',
      refType: 'rental_unit',
      refId: unit.id,
    });
    return unit;
  }

  /**
   * Bulk-generate N units for a product from a code template. The template
   * supports `{n}` (sequential) — e.g. `CAM-{n}` → CAM-001, CAM-002, …
   * Numbers are zero-padded to the width of the first number.
   */
  async bulkGenerate(dto: {
    productId: string;
    count: number;
    codeTemplate: string;
    barcodePrefix?: string;
    conditionGrade?: RentalConditionGrade;
    attributes?: Record<string, unknown>;
    acquisitionCost?: number;
  }) {
    const orgId = this.tenant.organizationId;
    const count = Math.floor(dto.count);
    if (!(count > 0 && count <= 500)) {
      throw new BadRequestException('Count must be between 1 and 500');
    }
    const product = await this.prisma.client.product.findFirst({
      where: { id: dto.productId, organizationId: orgId },
    });
    if (!product) throw new NotFoundException('Product not found');
    if (product.rentalIsPooled) {
      throw new BadRequestException('Pooled products have no individual units');
    }
    if (!dto.codeTemplate || !dto.codeTemplate.includes('{n}')) {
      throw new BadRequestException("codeTemplate must contain '{n}' (e.g. CAM-{n})");
    }

    // Find the current max sequence for the template to continue numbering.
    const pattern = dto.codeTemplate.replace('{n}', '');
    const existing = await this.prisma.client.rentalUnit.findMany({
      where: { organizationId: orgId, productId: dto.productId },
      select: { unitCode: true },
    });
    let maxSeq = 0;
    for (const u of existing) {
      if (u.unitCode.startsWith(pattern)) {
        const rest = u.unitCode.slice(pattern.length);
        const n = parseInt(rest, 10);
        if (!Number.isNaN(n) && n > maxSeq) maxSeq = n;
      }
    }

    const created: Array<{ unitCode: string; id: string }> = [];
    await this.prisma.client.$transaction(async (tx: any) => {
      for (let i = 1; i <= count; i++) {
        const seq = maxSeq + i;
        const unitCode = dto.codeTemplate.replace('{n}', String(seq).padStart(3, '0'));
        const unit = await tx.rentalUnit.create({
          data: {
            organizationId: orgId,
            unitCode,
            barcode: dto.barcodePrefix ? `${dto.barcodePrefix}${String(seq).padStart(4, '0')}` : null,
            productId: dto.productId,
            conditionGrade: dto.conditionGrade ?? 'good',
            attributes: (dto.attributes ?? {}) as any,
            acquisitionCost: dto.acquisitionCost ?? null,
            createdBy: this.tenant.userId ?? null,
          },
        });
        created.push({ unitCode, id: unit.id });
      }
    });
    return { createdCount: created.length, units: created };
  }

  async update(
    id: string,
    dto: {
      unitCode?: string;
      barcode?: string;
      conditionGrade?: RentalConditionGrade;
      attributes?: Record<string, unknown>;
      acquisitionCost?: number;
      notes?: string;
    },
  ) {
    const orgId = this.tenant.organizationId;
    const unit = await this.prisma.client.rentalUnit.findFirst({ where: { id, organizationId: orgId } });
    if (!unit) throw new NotFoundException('Rental unit not found');

    return this.prisma.client.rentalUnit.update({
      where: { id },
      data: {
        ...(dto.unitCode !== undefined ? { unitCode: dto.unitCode } : {}),
        ...(dto.barcode !== undefined ? { barcode: dto.barcode } : {}),
        ...(dto.conditionGrade !== undefined ? { conditionGrade: dto.conditionGrade } : {}),
        ...(dto.attributes !== undefined ? { attributes: dto.attributes as any } : {}),
        ...(dto.acquisitionCost !== undefined ? { acquisitionCost: dto.acquisitionCost } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        updatedBy: this.tenant.userId ?? null,
      },
    });
  }

  /** Retire a unit (terminal state). Guarded by the lifecycle registry. */
  async retire(id: string, notes?: string) {
    const orgId = this.tenant.organizationId;
    const unit = await this.prisma.client.rentalUnit.findFirst({ where: { id, organizationId: orgId } });
    if (!unit) throw new NotFoundException('Rental unit not found');
    if (unit.status === 'retired') return unit;

    await this.lifecycle.assertTransition('custody.rental_unit', unit.status, 'retired', 'retire');
    return this.prisma.client.rentalUnit.update({
      where: { id },
      data: {
        status: 'retired',
        retiredAt: new Date(),
        notes: notes ?? unit.notes,
        updatedBy: this.tenant.userId ?? null,
      },
    });
  }

  async delete(id: string) {
    const orgId = this.tenant.organizationId;
    const unit = await this.prisma.client.rentalUnit.findFirst({ where: { id, organizationId: orgId } });
    if (!unit) throw new NotFoundException('Rental unit not found');
    if (unit.status === 'checked_out') {
      throw new BadRequestException('Cannot delete a checked-out unit');
    }
    return this.prisma.client.rentalUnit.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: this.tenant.userId ?? null },
    });
  }
}
