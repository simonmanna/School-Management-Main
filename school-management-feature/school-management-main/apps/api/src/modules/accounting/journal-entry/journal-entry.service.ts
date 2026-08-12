import { Injectable } from '@nestjs/common';
import type { PaginationQuery } from '@erp/shared';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { PostingService } from '../posting/posting.service';
import { CreateJournalEntryDto, ReverseJournalEntryDto } from './dto/create-journal-entry.dto';

@Injectable()
export class JournalEntryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
  ) {}

  async list(query: PaginationQuery) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 25));
    const where = query.search
      ? {
          OR: [
            { entryNumber: { contains: query.search, mode: 'insensitive' as const } },
            { description: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [data, total] = await Promise.all([
      this.prisma.client.journalEntry.findMany({
        where,
        include: { journal: true, _count: { select: { lines: true } } },
        orderBy: { postingDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.journalEntry.count({ where }),
    ]);

    return {
      data,
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  findOne(id: string) {
    return this.prisma.client.journalEntry.findFirst({
      where: { id },
      include: { journal: true, lines: { include: { account: true }, orderBy: { lineNumber: 'asc' } } },
    });
  }

  createManual(dto: CreateJournalEntryDto) {
    return this.posting.post({
      journalCode: dto.journalCode,
      date: dto.date,
      description: dto.description,
      lines: dto.lines,
    });
  }

  reverse(id: string, dto: ReverseJournalEntryDto) {
    return this.posting.reverse(id, { date: dto.date, description: dto.description });
  }
}
