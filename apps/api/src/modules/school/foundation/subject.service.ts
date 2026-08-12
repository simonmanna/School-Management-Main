import { Injectable } from '@nestjs/common';
import type { Subject } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import type { CreateSubjectDto, UpdateSubjectDto } from './dto.types';

@Injectable()
export class SubjectService extends BaseCrudService<Subject, CreateSubjectDto, UpdateSubjectDto> {
  protected readonly entityName = 'Subject';
  protected readonly searchFields = ['code', 'name'];
  protected readonly defaultInclude = { department: true };

  constructor(prisma: PrismaService) {
    super(prisma.client.subject as unknown as CrudDelegate);
  }
}