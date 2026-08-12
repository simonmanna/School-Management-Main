import { Injectable } from '@nestjs/common';
import type { Department } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import type { CreateDepartmentDto, UpdateDepartmentDto } from './dto.types';

@Injectable()
export class DepartmentService extends BaseCrudService<Department, CreateDepartmentDto, UpdateDepartmentDto> {
  protected readonly entityName = 'Department';
  protected readonly searchFields = ['name'];
  protected readonly defaultInclude = { subjects: true, staffProfiles: true };

  constructor(prisma: PrismaService) {
    super(prisma.client.department as unknown as CrudDelegate);
  }
}