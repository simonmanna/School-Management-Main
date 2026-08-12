import { Injectable } from '@nestjs/common';
import type { Journal } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { CreateJournalDto } from './dto/create-journal.dto';
import { UpdateJournalDto } from './dto/update-journal.dto';

@Injectable()
export class JournalService extends BaseCrudService<Journal, CreateJournalDto, UpdateJournalDto> {
  protected readonly entityName = 'Journal';
  protected readonly searchFields = ['code', 'name'];
  protected readonly defaultOrderBy = { code: 'asc' as const };

  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.journal as unknown as CrudDelegate);
  }
}
