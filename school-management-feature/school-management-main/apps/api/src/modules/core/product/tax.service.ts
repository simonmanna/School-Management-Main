import { Injectable } from '@nestjs/common';
import type { Tax } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';

@Injectable()
export class TaxService extends BaseCrudService<Tax> {
  protected readonly entityName = 'Tax';
  protected readonly searchFields = ['name', 'code'];

  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.tax as unknown as CrudDelegate);
  }
}