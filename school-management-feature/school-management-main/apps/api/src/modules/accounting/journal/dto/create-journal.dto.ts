import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { JOURNAL_TYPES, type JournalType } from '@erp/shared';

export class CreateJournalDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsIn([...JOURNAL_TYPES])
  journalType!: JournalType;

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
