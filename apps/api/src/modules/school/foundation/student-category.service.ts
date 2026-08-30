import { Injectable } from '@nestjs/common';
import type { StudentCategory } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import type { CreateStudentCategoryDto, UpdateStudentCategoryDto } from './dto.types';

@Injectable()
export class StudentCategoryService extends BaseCrudService<
  StudentCategory,
  CreateStudentCategoryDto,
  UpdateStudentCategoryDto
> {
  protected readonly entityName = 'StudentCategory';
  protected readonly searchFields = ['name'];
  protected readonly defaultOrderBy = { name: 'asc' as const };

  constructor(prisma: PrismaService) {
    super(prisma.client.studentCategory as unknown as CrudDelegate);
  }
}
