import { IsBoolean, IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { CASH_FLOW_CLASSES, CONTROL_ACCOUNT_TYPES, type ControlAccountType } from '@erp/shared';

/**
 * `normalBalance` is deliberately absent — it is always mirrored from the
 * account's category by AccountService, because every report signs balances by
 * it.
 */
export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  parentAccountId?: string | null;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsString()
  currencyId?: string;

  @IsOptional()
  @IsBoolean()
  isPostable?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn([...CASH_FLOW_CLASSES])
  cashFlowCategory?: string;

  /** Behavior overrides. Omit (or null) to inherit the category default. */
  @IsOptional()
  @IsBoolean()
  allowReconciliation?: boolean;

  @IsOptional()
  @IsBoolean()
  allowManualPosting?: boolean;

  @IsOptional()
  @IsBoolean()
  allowBudgeting?: boolean;

  @IsOptional()
  @IsIn([...CONTROL_ACCOUNT_TYPES])
  controlAccountType?: ControlAccountType;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  accountNumber?: string;
}
