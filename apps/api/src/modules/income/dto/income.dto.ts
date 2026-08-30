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
 * DTOs for the Other Revenue / Income module. The global ValidationPipe runs
 * with `whitelist + forbidNonWhitelisted`, so every field the frontend may
 * send MUST be declared here or the request is rejected with 400.
 */

export class CreateIncomeHeadDto {
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

export class UpdateIncomeHeadDto {
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

export class CreateIncomeDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  invoiceNumber?: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsDateString()
  incomeDate!: string;

  @IsOptional()
  @IsString()
  incomeHeadId?: string;

  @IsIn(['CASH', 'BANK_TRANSFER', 'MTN_MOBILE_MONEY', 'AIRTEL_MONEY', 'CHEQUE'])
  paymentMethod!: 'CASH' | 'BANK_TRANSFER' | 'MTN_MOBILE_MONEY' | 'AIRTEL_MONEY' | 'CHEQUE';

  /** Cash/bank account the receipt debits (required on create when not CASH-handled). */
  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  attachmentId?: string;

  /** Staff member recording the receipt. */
  @IsOptional()
  @IsString()
  receivedById?: string;
}

export class UpdateIncomeDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  invoiceNumber?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;

  @IsOptional()
  @IsDateString()
  incomeDate?: string;

  @IsOptional()
  @IsString()
  incomeHeadId?: string;

  @IsOptional()
  @IsIn(['CASH', 'BANK_TRANSFER', 'MTN_MOBILE_MONEY', 'AIRTEL_MONEY', 'CHEQUE'])
  paymentMethod?: 'CASH' | 'BANK_TRANSFER' | 'MTN_MOBILE_MONEY' | 'AIRTEL_MONEY' | 'CHEQUE';

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  attachmentId?: string;
}

export class CancelIncomeDto {
  @IsString()
  cancelReason!: string;
}
