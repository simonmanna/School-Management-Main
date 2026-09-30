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

  // Petty-cash (pay-now) fields — used when paymentType === 'CASH' and the
  // amount is within the org's petty-cash threshold. The raiser is always the
  // signed-in user; the request body never names who acted.
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
  /** Payer is the signed-in user. */
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

  /** Value date of the payment (defaults to now). Drives the journal date. */
  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  /** Drawer-mode schools: the cash session the money leaves (defaults to the payer's own open one). */
  @IsOptional()
  @IsString()
  cashSessionId?: string;
}

export class ApproveExpenseDto {
  /** Approver is the signed-in user and must not be the raiser. */
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
