import { Injectable } from '@nestjs/common';
import type { SchoolPolicy } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import type { CreateSchoolPolicyDto, UpdateSchoolPolicyDto } from './config.dto';

@Injectable()
export class SchoolPolicyService extends BaseCrudService<
  SchoolPolicy,
  CreateSchoolPolicyDto,
  UpdateSchoolPolicyDto
> {
  protected readonly entityName = 'SchoolPolicy';
  protected readonly searchFields = ['key', 'name', 'category'];
  protected readonly defaultOrderBy: Array<Record<string, 'asc' | 'desc'>> = [{ category: 'asc' }, { key: 'asc' }];

  constructor(prisma: PrismaService) {
    super(prisma.client.schoolPolicy as unknown as CrudDelegate);
  }
}
