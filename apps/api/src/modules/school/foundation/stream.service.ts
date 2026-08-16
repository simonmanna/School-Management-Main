import { Injectable } from '@nestjs/common';
import type { Stream } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import type { CreateStreamDto, UpdateStreamDto } from './dto.types';

@Injectable()
export class StreamService extends BaseCrudService<Stream, CreateStreamDto, UpdateStreamDto> {
  protected readonly entityName = 'Stream';
  protected readonly searchFields = ['name'];
  protected readonly defaultInclude = { schoolClass: true };

  constructor(prisma: PrismaService) {
    super(prisma.client.stream as unknown as CrudDelegate);
  }

  async byClass(classId: string) {
    return this.delegate.findMany({ where: { classId }, include: this.defaultInclude, orderBy: { name: 'asc' } });
  }
}
