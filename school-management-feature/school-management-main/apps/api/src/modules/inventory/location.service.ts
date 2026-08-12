import { Injectable } from '@nestjs/common';
import type { InventoryLocation } from '@prisma/client';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { BaseCrudService, type CrudDelegate } from '../../kernel/common/base-crud.service';
import { CreateLocationDto, UpdateLocationDto } from './dto/location.dto';

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
}
