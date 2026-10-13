import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { orgTimeZone, reportEnd, reportStart } from '../../../kernel/common/report-range';
import { PostingService } from '../posting/posting.service';
import { MANUAL_SOURCE_TYPES } from '../posting/posting.types';
import { CreateJournalEntryDto, ReverseJournalEntryDto } from './dto/create-journal-entry.dto';
import { ListJournalEntriesDto } from './dto/list-journal-entries.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */

const MANUAL_ORIGIN = {
  OR: MANUAL_SOURCE_TYPES.map((t) => ({ sourceType: t })),
};

@Injectable()
export class JournalEntryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly posting: PostingService,
  ) {}

  async list(query: ListJournalEntriesDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 25));
    const and: any[] = [];
    if (query.search) {
      and.push({
        OR: [
          { entryNumber: { contains: query.search, mode: 'insensitive' as const } },
          { description: { contains: query.search, mode: 'insensitive' as const } },
        ],
      });
    }
    if (query.status) and.push({ status: query.status });
    if (query.journalId) and.push({ journalId: query.journalId });
    if (query.sourceType) and.push({ sourceType: query.sourceType });
    if (query.origin === 'manual') and.push(MANUAL_ORIGIN);
    if (query.origin === 'system') and.push({ NOT: MANUAL_ORIGIN });
    if (query.accountId) and.push({ lines: { some: { accountId: query.accountId } } });
    if (query.from || query.to) {
      const tz = await orgTimeZone(this.prisma.client, this.tenant.optionalOrganizationId);
      const postingDate: any = {};
      if (query.from) postingDate.gte = reportStart(query.from, tz);
      if (query.to) postingDate.lte = reportEnd(query.to, tz);
      and.push({ postingDate });
    }
    const where = and.length ? { AND: and } : {};

    const [data, total] = await Promise.all([
      this.prisma.client.journalEntry.findMany({
        where,
        include: { journal: true, _count: { select: { lines: true } } },
        orderBy: [{ postingDate: 'desc' }, { createdAt: 'desc' }],
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

  /**
   * Maker step: create a manual entry as a DRAFT. It does not affect any balance
   * until a different user approves it via `post` (maker-checker, audit fix #5).
   */
  createManual(dto: CreateJournalEntryDto) {
    return this.posting.stageDraft({
      journalCode: dto.journalCode,
      date: dto.date,
      description: dto.description,
      branchId: dto.branchId,
      costCenterId: dto.costCenterId,
      lines: dto.lines,
    });
  }

  /** Checker step: approve + post a draft. Rejects if approver == creator. */
  post(id: string) {
    return this.posting.postDraft(id);
  }

  /** Discard a draft entry that was never posted. */
  discard(id: string) {
    return this.posting.discardDraft(id);
  }

  /**
   * Reverse a manual entry. An entry a document posted (fee invoice, receipt,
   * bill, payroll, period close…) is corrected from that document: reversing
   * only its journal leaves the document — and the sub-ledger built from it —
   * claiming money the ledger no longer shows (wave 19).
   */
  async reverse(id: string, dto: ReverseJournalEntryDto) {
    const entry = await this.prisma.client.journalEntry.findFirst({
      where: { id },
      select: { sourceType: true, entryNumber: true, journal: { select: { journalType: true } } },
    });
    if (!entry) throw new NotFoundException('Journal entry not found');
    // An engine-posted opening (a stock count carried in) belongs to its
    // sub-ledger document; only Opening Balances screen loads reverse here.
    const manual =
      entry.sourceType === 'opening_balance'
        ? entry.journal?.journalType === 'opening'
        : MANUAL_SOURCE_TYPES.includes(entry.sourceType ?? null);
    if (!manual) {
      throw new BadRequestException(
        `${entry.entryNumber} was posted by a ${entry.sourceType} document; ` +
          'cancel, void or reverse that document instead so its records and the ledger stay in step',
      );
    }
    return this.posting.reverse(id, { date: dto.date, description: dto.description });
  }
}
