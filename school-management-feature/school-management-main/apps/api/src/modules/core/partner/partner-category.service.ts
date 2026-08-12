import { Injectable } from '@nestjs/common';
import type { PartnerCategory } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';

@Injectable()
export class PartnerCategoryService extends BaseCrudService<PartnerCategory> {
  protected readonly entityName = 'PartnerCategory';
  protected readonly searchFields = ['name'];
  protected readonly defaultInclude = { parent: true, _count: { select: { partners: true, children: true } } };

  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.partnerCategory as unknown as CrudDelegate);
  }
}