import { Injectable } from '@nestjs/common';
import type { InventoryLocation } from '@prisma/client';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { BaseCrudService, type CrudDelegate } from '../../kernel/common/base-crud.service';
import { CreateLocationDto, UpdateLocationDto, LocationQueryDto } from './dto/location.dto';
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@erp/shared';

@Injectable()
export class LocationService extends BaseCrudService<
  InventoryLocation,
  CreateLocationDto,
  UpdateLocationDto
> {
  protected readonly entityName = 'InventoryLocation';
  protected readonly searchFields = ['code', 'name'];
  protected readonly defaultOrderBy = { name: 'asc' as const };

  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.inventoryLocation as unknown as CrudDelegate);
  }

  async list(query: LocationQueryDto) {
    const page = Math.max(1, Number(query.page) || DEFAULT_PAGE);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(query.pageSize) || DEFAULT_PAGE_SIZE));

    const where: Record<string, unknown> = {};
    if (query.type) {
      where.type = query.type;
    }
    if (query.search && this.searchFields.length > 0) {
      where.OR = this.searchFields.map((field) => ({
        [field]: { contains: query.search, mode: 'insensitive' },
      }));
    }

    const orderBy = query.sortBy
      ? { [query.sortBy]: query.sortOrder ?? 'asc' }
      : this.defaultOrderBy;

    const [data, total] = await Promise.all([
      this.delegate.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: (this as any).defaultInclude,
      }),
      this.delegate.count({ where }),
    ]);

    return {
      data: data as InventoryLocation[],
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }
}
