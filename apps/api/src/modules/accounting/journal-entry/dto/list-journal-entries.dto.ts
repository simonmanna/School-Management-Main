import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../../../kernel/common/pagination.dto';

/** Journal-entry register filters. Every filter is optional and they combine with AND. */
export class ListJournalEntriesDto extends PaginationDto {
  @IsOptional()
  @IsIn(['draft', 'posted', 'reversed'])
  status?: 'draft' | 'posted' | 'reversed';

  @IsOptional()
  @IsString()
  journalId?: string;

  /** `manual` = entries people made (manual + opening balances); `system` = document postings. */
  @IsOptional()
  @IsIn(['manual', 'system'])
  origin?: 'manual' | 'system';

  @IsOptional()
  @IsString()
  sourceType?: string;

  /** Entries with at least one line on this account. */
  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
