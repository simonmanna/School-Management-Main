import { Injectable } from '@nestjs/common';
import type { Product } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductService extends BaseCrudService<Product, CreateProductDto, UpdateProductDto> {
  protected readonly entityName = 'Product';
  protected readonly searchFields = ['code', 'sku', 'name'];
  protected readonly defaultInclude = { category: true, uom: true, tax: true };

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {
    super(prisma.client.product as unknown as CrudDelegate);
  }

  async create(dto: CreateProductDto): Promise<Product> {
    const product = await super.create(dto);
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
    const product = await super.update(id, dto);
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
    await super.remove(id);
    this.events.publish('product.deleted', {
      id,
      organizationId: this.tenant.organizationId,
    });
    await this.audit.record({ entity: 'Product', entityId: id, action: 'delete' });
  }
}
