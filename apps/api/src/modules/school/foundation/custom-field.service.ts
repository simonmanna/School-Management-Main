import { Injectable } from '@nestjs/common';
import type { CustomField } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import type { CreateCustomFieldDto, UpdateCustomFieldDto } from './config.dto';

@Injectable()
export class CustomFieldService extends BaseCrudService<
  CustomField,
  CreateCustomFieldDto,
  UpdateCustomFieldDto
> {
  protected readonly entityName = 'CustomField';
  protected readonly searchFields = ['name', 'label', 'entityType'];
  protected readonly defaultOrderBy = { entityType: 'asc' as const, order: 'asc' as const };

  constructor(prisma: PrismaService) {
    super(prisma.client.customField as unknown as CrudDelegate);
  }
}
