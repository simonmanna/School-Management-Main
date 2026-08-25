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
import {
  EXTERNAL_REFERENCE_TYPES,
  PAYMENT_METHODS,
  type ExternalReferenceType,
  type PaymentMethod,
} from '@erp/shared';

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

  /**
   * Free-text narration shown on the receipt. NEVER an idempotency key — a
   * bursar may legitimately type "CASH" on every receipt. Use
   * `externalReference` for anything that must not be processed twice.
   */
  @IsOptional()
  @IsString()
  reference?: string;

  /**
   * Machine-issued idempotency key: a MoMo/bank/card transaction id, or an
   * import row reference. Unique per (organization, type, value, direction) at
   * the database level, so a replayed provider callback can never collect
   * twice — the guarantee an application existence check cannot give under
   * READ COMMITTED (P0-B).
   */
  @IsOptional()
  @IsString()
  externalReference?: string;

  @IsOptional()
  @IsIn([...EXTERNAL_REFERENCE_TYPES])
  externalReferenceType?: ExternalReferenceType;

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
