import { Injectable } from '@nestjs/common';
import type { Branch } from '@prisma/client';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { BaseCrudService, type CrudDelegate } from '../../kernel/common/base-crud.service';

@Injectable()
export class BranchService extends BaseCrudService<Branch> {
  protected readonly entityName = 'Branch';
  protected readonly searchFields = ['code', 'name'];

  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.branch as unknown as CrudDelegate);
  }
}