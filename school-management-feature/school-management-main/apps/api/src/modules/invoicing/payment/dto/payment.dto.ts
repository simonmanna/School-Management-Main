import { Type } from 'class-transformer';
import {
  IsArray,
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
  @IsString()
  documentId!: string;

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
}
