import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';

/**
 * DTOs for the standalone expense module. The global ValidationPipe runs with
 * `whitelist + forbidNonWhitelisted`, so every field the frontend may send MUST
 * be declared here or the request is rejected with 400.
 */

export class CreateExpenseDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsDateString()
  expenseDate!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsIn(['CASH', 'CREDIT'])
  paymentType!: 'CASH' | 'CREDIT';

  /** Required on create — the staff member raising the expense. */
  @IsOptional()
  @IsString()
  createdBy?: string;

  // Cash (pay-now) fields — only present when paymentType === 'CASH'.
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  paymentReference?: string;
}

export class UpdateExpenseDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsDateString()
  expenseDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsIn(['CASH', 'CREDIT'])
  paymentType?: 'CASH' | 'CREDIT';
}

export class PayExpenseDto {
  @IsString()
  paidBy!: string;

  @IsString()
  paymentMethod!: string;

  @IsString()
  accountId!: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  paymentNotes?: string;
}

export class ApproveExpenseDto {
  @IsString()
  approvedBy!: string;

  @IsOptional()
  @IsString()
  approvalNotes?: string;
}

export class RejectExpenseDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class VoidExpenseDto {
  @IsString()
  voidReason!: string;
}

export class CreateExpenseCategoryDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  ledgerAccountId?: string;
}

export class UpdateExpenseCategoryDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  ledgerAccountId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
