import { Injectable } from '@nestjs/common';
import type { FiscalPeriod } from '@prisma/client';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { BaseCrudService, type CrudDelegate } from '../../kernel/common/base-crud.service';

@Injectable()
export class FiscalPeriodService extends BaseCrudService<FiscalPeriod> {
  protected readonly entityName = 'FiscalPeriod';
  protected readonly searchFields = ['name'];

  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.fiscalPeriod as unknown as CrudDelegate);
  }
}