import { Injectable } from '@nestjs/common';
import type { CustomField } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import type { CreateCustomFieldDto, UpdateCustomFieldDto } from './config.dto';
import { loadCustomFieldDefinitions } from './custom-field-values';

@Injectable()
export class CustomFieldService extends BaseCrudService<
  CustomField,
  CreateCustomFieldDto,
  UpdateCustomFieldDto
> {
  protected readonly entityName = 'CustomField';
  protected readonly searchFields = ['name', 'label', 'entityType'];
  protected readonly defaultOrderBy = { entityType: 'asc' as const, order: 'asc' as const };

  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.customField as unknown as CrudDelegate);
  }

  definitionsFor(entityType: string) {
    return loadCustomFieldDefinitions(this.prisma.client, entityType);
  }
}
