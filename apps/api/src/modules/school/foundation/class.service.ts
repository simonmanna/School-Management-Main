import { Injectable } from '@nestjs/common';
import type { SchoolClass, Section } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import type {
  CreateSchoolClassDto,
  CreateSectionDto,
  UpdateSchoolClassDto,
  UpdateSectionDto,
} from './dto.types';

@Injectable()
export class SchoolClassService extends BaseCrudService<SchoolClass, CreateSchoolClassDto, UpdateSchoolClassDto> {
  protected readonly entityName = 'SchoolClass';
  protected readonly searchFields = ['name'];
  protected readonly defaultInclude = { gradeLevel: true, campus: true, sections: true };

  constructor(prisma: PrismaService) {
    super(prisma.client.schoolClass as unknown as CrudDelegate);
  }
}

@Injectable()
export class SectionService extends BaseCrudService<Section, CreateSectionDto, UpdateSectionDto> {
  protected readonly entityName = 'Section';
  protected readonly searchFields = ['name'];
  protected readonly defaultInclude = { schoolClass: { include: { gradeLevel: true } } };

  constructor(prisma: PrismaService) {
    super(prisma.client.section as unknown as CrudDelegate);
  }
}