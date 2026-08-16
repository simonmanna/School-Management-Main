import { Injectable } from '@nestjs/common';
import type { SubjectCategory } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import type { CreateSubjectCategoryDto, UpdateSubjectCategoryDto } from './dto.types';

@Injectable()
export class SubjectCategoryService extends BaseCrudService<SubjectCategory, CreateSubjectCategoryDto, UpdateSubjectCategoryDto> {
  protected readonly entityName = 'SubjectCategory';
  protected readonly searchFields = ['code', 'name'];

  constructor(prisma: PrismaService) {
    super(prisma.client.subjectCategory as unknown as CrudDelegate);
  }
}
