import { Injectable } from '@nestjs/common';
import type { ProductCategory } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';

@Injectable()
export class ProductCategoryService extends BaseCrudService<ProductCategory> {
  protected readonly entityName = 'ProductCategory';
  protected readonly searchFields = ['name'];
  protected readonly defaultInclude = { parent: true, _count: { select: { products: true, children: true } } };

  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.productCategory as unknown as CrudDelegate);
  }
}