import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { dec, ZERO } from '../../../kernel/common/money';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { PostingService } from '../posting/posting.service';
import { AccountResolverService } from '../posting/account-resolver.service';
import { BALANCE_AFFECTING_STATUSES } from '../posting/posting.types';

/* eslint-disable @typescript-eslint/no-explicit-any */

export class OpeningBalanceLineDto {
  @IsString()
  accountId!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  debit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  credit?: number;

  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateOpeningBalancesDto {
  /** Go-live date: balances are as at the close of business the day before. */
  @IsDateString()
  date!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OpeningBalanceLineDto)
  lines!: OpeningBalanceLineDto[];
}

const OPENING_JOURNAL = 'OPENING';
const SOURCE_TYPE = 'opening_balance';

/**
 * Go-live opening balances (wave 19).
 *
 * A school moving onto the system brings a trial balance from its old books:
 * cash, bank and mobile-money balances, fixed assets, loans, accruals, capital.
 * The bursar enters them once; any difference lands on Opening Balance Equity
 * so a partial load still balances. The entry is staged as a DRAFT and needs a
 * second person to approve it on the journal-entry screen (maker-checker), like
 * every manual entry.
 *
 * Pupil fee arrears and supplier balances are not loaded here: their control
 * accounts belong to sub-ledgers, which carry their own brought-forward
 * documents. The manual-posting rules in PostingService refuse those accounts.
 */
@Injectable()
export class OpeningBalanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly posting: PostingService,
    private readonly accounts: AccountResolverService,
  ) {}

  async summary() {
    const entries = await this.prisma.client.journalEntry.findMany({
      where: { sourceType: SOURCE_TYPE },
      orderBy: [{ postingDate: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        entryNumber: true,
        postingDate: true,
        description: true,
        status: true,
        createdBy: true,
        postedBy: true,
        postedAt: true,
        _count: { select: { lines: true } },
      },
    });
    const mapping = await this.prisma.client.accountMapping.findFirst({
      where: { key: 'opening_balance_equity', deletedAt: null },
      include: { account: { select: { id: true, code: true, name: true } } },
    });
    let obeBalance = ZERO;
    if (mapping) {
      const agg = await this.prisma.client.journalLine.aggregate({
        where: { accountId: mapping.accountId, entry: { status: { in: [...BALANCE_AFFECTING_STATUSES] } } },
        _sum: { baseDebit: true, baseCredit: true },
      });
      // Equity reads credit-positive.
      obeBalance = dec(agg._sum.baseCredit ?? 0).minus(dec(agg._sum.baseDebit ?? 0));
    }
    return {
      entries,
      openingBalanceEquity: mapping
        ? { ...mapping.account, balance: obeBalance.toString() }
        : null,
    };
  }

  async stage(dto: CreateOpeningBalancesDto) {
    const seen = new Set<string>();
    const lines: { accountId: string; debit: Prisma.Decimal; credit: Prisma.Decimal; description?: string }[] = [];
    for (const l of dto.lines) {
      const debit = dec(l.debit ?? 0);
      const credit = dec(l.credit ?? 0);
      if (debit.isZero() && credit.isZero()) continue;
      if (debit.greaterThan(0) && credit.greaterThan(0)) {
        throw new BadRequestException('An opening balance is a debit or a credit, not both');
      }
      if (seen.has(l.accountId)) {
        throw new BadRequestException('Each account appears once in an opening-balance load');
      }
      seen.add(l.accountId);
      lines.push({ accountId: l.accountId, debit, credit, description: l.description });
    }
    if (lines.length === 0) throw new BadRequestException('Enter at least one opening balance');

    return this.prisma.client.$transaction(async (tx: any) => {
      await this.ensureJournal(tx);
      const obeId = await this.openingEquityAccount(tx);
      if (seen.has(obeId)) {
        throw new BadRequestException('Opening Balance Equity is filled in automatically; leave it off the list');
      }

      const debit = lines.reduce((t, l) => t.plus(l.debit), ZERO);
      const credit = lines.reduce((t, l) => t.plus(l.credit), ZERO);
      const diff = debit.minus(credit);
      const postingLines: any[] = lines.map((l) => ({
        accountId: l.accountId,
        debit: l.debit.toString(),
        credit: l.credit.toString(),
        description: l.description ?? 'Opening balance',
      }));
      if (!diff.isZero()) {
        postingLines.push({
          accountId: obeId,
          debit: diff.lessThan(0) ? diff.abs().toString() : '0',
          credit: diff.greaterThan(0) ? diff.toString() : '0',
          description: 'Opening balance difference',
        });
      }
      if (postingLines.length < 2) {
        throw new BadRequestException('Enter at least one opening balance');
      }

      return this.posting.stageDraft(
        {
          journalCode: OPENING_JOURNAL,
          date: dto.date,
          description: dto.description?.trim() || 'Opening balances',
          sourceType: SOURCE_TYPE,
          lines: postingLines,
        },
        tx,
      );
    });
  }

  private async ensureJournal(tx: any): Promise<void> {
    const existing = await tx.journal.findFirst({ where: { code: OPENING_JOURNAL } });
    if (existing) return;
    await tx.journal.createMany({
      data: [
        {
          organizationId: this.tenant.organizationId,
          code: OPENING_JOURNAL,
          name: 'Opening Balances',
          journalType: 'opening',
        },
      ],
      skipDuplicates: true,
    });
  }

  private async openingEquityAccount(tx: any): Promise<string> {
    const id = await this.accounts.ensureByCode(
      '3900',
      { name: 'Opening Balance Equity', categoryKey: 'equity', mappingKey: 'opening_balance_equity' },
      tx,
    );
    const account = await tx.account.findFirst({ where: { id }, include: { category: true } });
    if (account?.category?.classification !== 'equity') {
      throw new BadRequestException(
        `Account ${account?.code ?? id} is not an equity account. Map 'opening_balance_equity' to an equity account ` +
          'under Accounting > Account Mapping first.',
      );
    }
    return id;
  }
}
