import { Injectable } from '@nestjs/common';
import type { UnitOfMeasure } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';

@Injectable()
export class UomService extends BaseCrudService<UnitOfMeasure> {
  protected readonly entityName = 'UnitOfMeasure';
  protected readonly searchFields = ['code', 'name'];

  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.unitOfMeasure as unknown as CrudDelegate);
  }
}