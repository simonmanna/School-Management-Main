import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { ACCOUNT_TYPES, type AccountType } from '@erp/shared';

export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn([...ACCOUNT_TYPES])
  accountType?: AccountType;

  @IsOptional()
  @IsString()
  parentAccountId?: string;

  @IsOptional()
  @IsString()
  currencyId?: string;

  @IsOptional()
  @IsBoolean()
  isGroup?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  description?: string;
}
