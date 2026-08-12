import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { JOURNAL_TYPES, type JournalType } from '@erp/shared';

export class UpdateJournalDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn([...JOURNAL_TYPES])
  journalType?: JournalType;

  @IsOptional()
  @IsString()
  defaultDebitAccountId?: string;

  @IsOptional()
  @IsString()
  defaultCreditAccountId?: string;

  @IsOptional()
  @IsString()
  sequencePrefix?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
