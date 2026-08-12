import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  ValidateNested,
} from 'class-validator';
import { PAYMENT_METHODS, type PaymentMethod } from '@erp/shared';

export class PaymentAllocationDto {
  /** Generic AR/AP ledger document (manual invoice / vendor bill). */
  @IsOptional()
  @IsString()
  documentId?: string;

  /** POS sales Invoice (R2 — separate from Document). Exactly one of the two. */
  @IsOptional()
  @IsString()
  invoiceId?: string;

  @IsNumber()
  @IsPositive()
  amount!: number;
}

export class CreatePaymentDto {
  @IsString()
  partnerId!: string;

  @IsDateString()
  paymentDate!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsIn([...PAYMENT_METHODS])
  paymentMethod?: PaymentMethod;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentAllocationDto)
  allocations?: PaymentAllocationDto[];

  /**
   * Optional cash-session link (M5). When paymentMethod === 'cash' AND this
   * is provided, a CashMovement row is created inside the same transaction so
   * the session's Z-report reconciles with the ledger. When omitted, the
   * payment still posts to GL but does not appear on any session's Z-report.
   */
  @IsOptional()
  @IsString()
  cashSessionId?: string;

  /**
   * When true, the payment is recorded in the Payment and Allocation tables
   * but does NOT post a journal entry. Used when the invoice's GL was already
   * posted with a non-AR counter-account (e.g. cash sale posted directly
   * Dr Cash / Cr Revenue), making a second GL entry a duplicate.
   */
  @IsOptional()
  skipGlPosting?: boolean;

  @IsOptional()
  @IsBoolean()
  allowOverpayment?: boolean;
}
