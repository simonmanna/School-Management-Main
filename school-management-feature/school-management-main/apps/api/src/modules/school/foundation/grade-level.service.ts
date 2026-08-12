import { Injectable } from '@nestjs/common';
import type { GradeLevel } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import type { CreateGradeLevelDto, UpdateGradeLevelDto } from './dto.types';

@Injectable()
export class GradeLevelService extends BaseCrudService<GradeLevel, CreateGradeLevelDto, UpdateGradeLevelDto> {
  protected readonly entityName = 'GradeLevel';
  protected readonly searchFields = ['name'];
  protected readonly defaultOrderBy: Record<string, 'asc' | 'desc'> = { order: 'asc' as const };
  protected readonly defaultInclude = { classes: true };

  constructor(prisma: PrismaService) {
    super(prisma.client.gradeLevel as unknown as CrudDelegate);
  }
}