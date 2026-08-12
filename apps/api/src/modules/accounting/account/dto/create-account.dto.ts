import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { CASH_FLOW_CLASSES, CONTROL_ACCOUNT_TYPES, type ControlAccountType } from '@erp/shared';

export class CreateAccountDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  /**
   * Accounting behavior — how the engine treats this account and which modules
   * can auto-discover it. Required; `normalBalance` is derived from it by
   * AccountService.
   */
  @IsString()
  @IsNotEmpty()
  categoryId!: string;

  /**
   * Reporting / navigation hierarchy. Must be a postable account of the same
   * classification. Pass `null` to detach from the current parent.
   */
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

  /** Overrides `category.cashFlowClass` for this one account. */
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

  /** Subledger control account type. `null` = not a control account. */
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
