import { Injectable, NotFoundException } from '@nestjs/common';
import type { Product } from '@prisma/client';
import type { PaginatedResult, PaginationQuery } from '@erp/shared';
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@erp/shared';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { FilesService } from '../../../kernel/files/files.service';
import { computeBottleConfig } from '../../../kernel/common/beverage-math';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { PackagingDto } from './dto/packaging.dto';

/** Fields that, when touched, require the beverage config to be (re)validated. */
const BEVERAGE_FIELDS = [
  'measurementMethod',
  'containerVolumeMl',
  'emptyBottleWeightG',
  'actualEmptyWeightG',
  'fullBottleWeightG',
] as const;

/** Fields that, when touched, require the inventory-tracking config to be re-normalized. */
const INVENTORY_CONFIG_FIELDS = [
  'batchTracking',
  'expiryTracking',
  'serialTracking',
  'pickingStrategy',
  'costingMethod',
] as const;

@Injectable()
export class ProductService extends BaseCrudService<Product, CreateProductDto, UpdateProductDto> {
  protected readonly entityName = 'Product';
  protected readonly searchFields = ['code', 'sku', 'name'];
  protected readonly defaultInclude = {
    category: true,
    uom: true,
    purchaseUom: true,
    salesUom: true,
    packagings: true,
    tax: true,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
  ) {
    super(prisma.client.product as unknown as CrudDelegate);
  }

  /** Resolve a stored image value to a fresh signed download URL.
   *  Accepts bare UUID, signed URL path, or absolute URL. */
  private resolveImage(image: string | null | undefined): string | null {
    if (!image) return null;
    if (image.startsWith('http')) return image;
    const idMatch = image.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (!idMatch) return image;
    try {
      return this.files.signDownload(idMatch[1]).url;
    } catch {
      return null;
    }
  }

  async list(query: PaginationQuery & { categoryId?: string; productType?: string }): Promise<PaginatedResult<Product>> {
    const page = Math.max(1, Number(query.page) || DEFAULT_PAGE);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(query.pageSize) || DEFAULT_PAGE_SIZE));

    const where: Record<string, unknown> = { isActive: true };
    if (query.search && this.searchFields.length > 0) {
      where.OR = this.searchFields.map((field) => ({
        [field]: { contains: query.search, mode: 'insensitive' },
      }));
    }
    if (query.categoryId) (where as any).categoryId = query.categoryId;
    if (query.productType) (where as any).productType = query.productType;

    const orderBy = query.sortBy
      ? { [query.sortBy]: query.sortOrder ?? 'asc' }
      : this.defaultOrderBy;

    const [data, total] = await Promise.all([
      this.delegate.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: this.defaultInclude,
      }),
      this.delegate.count({ where }),
    ]);

    return {
      data: (data as Product[]).map((p) => ({ ...p, image: this.resolveImage(p.image) })),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  async findOne(id: string): Promise<Product> {
    const product = await super.findOne(id);
    return { ...product, image: this.resolveImage(product.image) };
  }

  /**
   * Compute + validate the beverage (digital-weight) config. Derives
   * liquidWeightG + conversionFactorMlPerG and stores them on the row; clears
   * them when a product is switched away from digital_weight. On update, values
   * are merged with the existing row so a partial edit still validates the whole
   * bottle. Throws BadRequestException on an invalid weight/volume relationship.
   */
  private applyBeverageComputation(
    data: Record<string, any>,
    existing?: Product | null,
  ): Record<string, any> {
    const method = (data.measurementMethod ?? (existing as any)?.measurementMethod ?? 'count') as string;
    if (method !== 'digital_weight') {
      if (data.measurementMethod && data.measurementMethod !== 'digital_weight') {
        data.liquidWeightG = null;
        data.conversionFactorMlPerG = null;
      }
      return data;
    }
    const pick = (a: unknown, b: unknown) => (a !== undefined ? a : b);
    const cfg = computeBottleConfig({
      containerVolumeMl: pick(data.containerVolumeMl, (existing as any)?.containerVolumeMl) as any,
      emptyBottleWeightG: pick(data.emptyBottleWeightG, (existing as any)?.emptyBottleWeightG) as any,
      actualEmptyWeightG: pick(data.actualEmptyWeightG, (existing as any)?.actualEmptyWeightG) as any,
      fullBottleWeightG: pick(data.fullBottleWeightG, (existing as any)?.fullBottleWeightG) as any,
    });
    data.liquidWeightG = cfg.liquidWeightG;
    data.conversionFactorMlPerG = cfg.conversionFactorMlPerG;
    return data;
  }

  /**
   * Enforce the inventory-tracking dependency rules and normalize the toggles so
   * an impossible combination can never be persisted. Auto-corrects (rather than
   * rejecting) where a dependent flag is implied:
   *   - expiryTracking ⇒ batchTracking (expiry is stored on InventoryBatch)
   *   - costingMethod FIFO ⇒ batchTracking (FIFO consumes batch cost-layers)
   *   - costingMethod SPECIFIC ⇒ serialTracking (or batchTracking) to identify the layer
   *   - pickingStrategy SERIAL ⇒ serialTracking
   * On update, incoming values are merged with the existing row so a partial edit
   * still validates the whole combination.
   */
  private applyInventoryConfig(
    data: Record<string, any>,
    existing?: Product | null,
  ): Record<string, any> {
    const eff = (k: string) => (data[k] !== undefined ? data[k] : (existing as any)?.[k]);
    let batch = eff('batchTracking') as boolean | undefined;
    const expiry = eff('expiryTracking') as boolean | undefined;
    let serial = eff('serialTracking') as boolean | undefined;
    const costing = eff('costingMethod') as string | undefined;
    const picking = eff('pickingStrategy') as string | undefined;

    if (expiry) batch = true;
    if (costing === 'FIFO') batch = true;
    if (costing === 'SPECIFIC' && !serial && !batch) serial = true;
    if (picking === 'SERIAL') serial = true;

    if (batch !== undefined) data.batchTracking = batch;
    if (serial !== undefined) data.serialTracking = serial;
    return data;
  }

  /**
   * Fill any omitted inventory-config field from the org-level defaults stored in
   * the Setting table (scope 'organization', key `inventory.default*`). Mirrors the
   * beverage org-default pattern. Only applied on create; an explicit value always wins.
   */
  private async applyOrgInventoryDefaults(data: Record<string, any>): Promise<void> {
    const fieldKeys: Array<[string, string]> = [
      ['costingMethod', 'inventory.defaultCostingMethod'],
      ['pickingStrategy', 'inventory.defaultPickingStrategy'],
      ['batchTracking', 'inventory.defaultBatchTracking'],
      ['expiryTracking', 'inventory.defaultExpiryTracking'],
      ['serialTracking', 'inventory.defaultSerialTracking'],
    ];
    const missing = fieldKeys.filter(([field]) => data[field] === undefined);
    if (missing.length === 0) return;
    const rows = await this.prisma.raw.setting.findMany({
      where: {
        organizationId: this.tenant.organizationId,
        scope: 'organization',
        key: { in: missing.map(([, key]) => key) },
      },
    });
    const byKey = new Map(rows.map((r) => [r.key, r.value as unknown]));
    for (const [field, key] of missing) {
      const v = byKey.get(key);
      if (v !== undefined && v !== null) data[field] = v;
    }
  }

  /** Replace a product's packaging rows with the supplied set (delete-all + create). */
  private async syncPackagings(productId: string, rows: PackagingDto[]): Promise<void> {
    const organizationId = this.tenant.organizationId;
    await this.prisma.client.productPackaging.deleteMany({ where: { productId } });
    if (rows.length > 0) {
      await this.prisma.client.productPackaging.createMany({
        data: rows.map((r) => ({
          organizationId,
          productId,
          name: r.name,
          quantity: r.quantity,
          barcode: r.barcode || null,
          isActive: r.isActive ?? true,
        })),
      });
    }
  }

  async create(dto: CreateProductDto): Promise<Product> {
    let data = this.applyBeverageComputation({ ...dto });
    const packagings = (data as any).packagings as PackagingDto[] | undefined;
    delete (data as any).packagings;
    await this.applyOrgInventoryDefaults(data);
    data = this.applyInventoryConfig(data, null);
    const product = await super.create(data as unknown as CreateProductDto);
    if (packagings) await this.syncPackagings(product.id, packagings);
    this.events.publish('product.created', {
      id: product.id,
      organizationId: this.tenant.organizationId,
    });
    await this.audit.record({
      entity: 'Product',
      entityId: product.id,
      action: 'create',
      newValues: product,
    });
    return product;
  }

  async update(id: string, dto: UpdateProductDto): Promise<Product> {
    let data: Record<string, any> = { ...dto };
    const packagings = (data as any).packagings as PackagingDto[] | undefined;
    delete (data as any).packagings;
    const beverageTouched = BEVERAGE_FIELDS.some((k) => (dto as any)[k] !== undefined);
    const inventoryTouched = INVENTORY_CONFIG_FIELDS.some((k) => (dto as any)[k] !== undefined);
    if (beverageTouched || inventoryTouched) {
      const existing = (await this.delegate.findFirst({ where: { id } })) as Product | null;
      if (beverageTouched) data = this.applyBeverageComputation(data, existing);
      if (inventoryTouched) data = this.applyInventoryConfig(data, existing);
    }
    const product = await super.update(id, data as unknown as UpdateProductDto);
    if (packagings) await this.syncPackagings(id, packagings);
    this.events.publish('product.updated', {
      id: product.id,
      organizationId: this.tenant.organizationId,
    });
    await this.audit.record({
      entity: 'Product',
      entityId: id,
      action: 'update',
      newValues: product,
    });
    return product;
  }

  async remove(id: string): Promise<void> {
    const existing = await this.delegate.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException(`Product ${id} not found`);
    await this.delegate.updateMany({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    this.events.publish('product.deleted', {
      id,
      organizationId: this.tenant.organizationId,
    });
    await this.audit.record({ entity: 'Product', entityId: id, action: 'delete' });
  }

  async restore(id: string): Promise<Product> {
    const existing = await this.prisma.client.product.findFirst({ where: { id, deletedAt: { not: null } } });
    if (!existing) throw new NotFoundException(`Deleted Product ${id} not found`);
    const updated = await this.prisma.client.product.update({ where: { id }, data: { deletedAt: null, isActive: true } });
    this.events.publish('product.restored', {
      id,
      organizationId: this.tenant.organizationId,
    });
    await this.audit.record({ entity: 'Product', entityId: id, action: 'restore' });
    return updated;
  }

  listDeleted() {
    return this.delegate.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      include: this.defaultInclude,
    });
  }

  /**
   * Resolve a scanned barcode to a product and the base-unit quantity one scan
   * represents. Matches the product's own barcode (qty 1) first, then a packaging
   * barcode (qty = pack size, e.g. a case of 24). Returns null when not found.
   */
  async resolveBarcode(code: string) {
    if (!code) return null;
    const product = await this.prisma.client.product.findFirst({
      where: { barcode: code, isActive: true },
      include: { uom: true },
    });
    if (product) {
      return { productId: product.id, product, quantity: 1, packaging: null };
    }
    const pack = await this.prisma.client.productPackaging.findFirst({
      where: { barcode: code, isActive: true },
      include: { product: { include: { uom: true } } },
    });
    if (pack) {
      return {
        productId: pack.productId,
        product: pack.product,
        quantity: Number(pack.quantity),
        packaging: { id: pack.id, name: pack.name, quantity: Number(pack.quantity) },
      };
    }
    return null;
  }

  async search(q: string, pageSize = 20) {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId, isActive: true };
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } },
        { sku: { contains: q, mode: 'insensitive' } },
      ];
    }
    return this.prisma.client.product.findMany({
      where,
      take: pageSize,
      orderBy: { name: 'asc' },
      select: { id: true, code: true, name: true, salesPrice: true, productType: true, station: true, categoryId: true },
    });
  }
}
