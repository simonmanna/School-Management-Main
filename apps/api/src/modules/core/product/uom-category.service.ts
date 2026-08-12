import { Injectable } from '@nestjs/common';
import type { UomCategory } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';

@Injectable()
export class UomCategoryService extends BaseCrudService<UomCategory> {
  protected readonly entityName = 'UomCategory';
  protected readonly searchFields = ['name'];

  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.uomCategory as unknown as CrudDelegate);
  }
}
