import {
  IsArray, IsBoolean, IsIn, IsISO8601, IsNumber, IsOptional, IsPositive, IsString, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** A modifier add-on selected on a line (price already known by the client). */
export class OrderLineModifierDto {
  @IsString() modifierId!: string;
  @IsString() name!: string;
  @IsNumber() priceDelta!: number;
  // Display echo for the kitchen ticket; server re-resolves from modifierId.
  @IsOptional() @IsString() kitchenPrintName?: string;
}

/** One cart line. Mirrors PosService.CheckoutLine but as a validated DTO. */
export class OrderLineDto {
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() menuItemId?: string;
  @IsOptional() @IsString() sku?: string;
  @IsString() description!: string;
  @IsNumber() @Min(0) quantity!: number;
  @IsNumber() @Min(0) unitPrice!: number;
  @IsOptional() @IsString() taxId?: string;
  @IsOptional() @IsNumber() discountPercent?: number;
  @IsOptional() @IsIn(['percentage', 'fixed_amount']) discountType?: 'percentage' | 'fixed_amount';
  @IsOptional() @IsNumber() @Min(0) discountAmount?: number;
  @IsOptional() @IsString() discountReason?: string;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => OrderLineModifierDto)
  modifiers?: OrderLineModifierDto[];
  @IsOptional() @IsString() variantId?: string;
  // Display-only echoes from the terminal cart; server re-resolves names/prices
  // from the DB. Whitelisted so forbidNonWhitelisted doesn't 400 the save.
  @IsOptional() @IsString() variantName?: string;
  @IsOptional() @IsNumber() variantPrice?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) accompanimentOptionIds?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) accompanimentNames?: string[];
  @IsOptional() @IsNumber() accompanimentPriceImpact?: number;
  @IsOptional() @IsString() comboId?: string;
  @IsOptional() @IsBoolean() taxInclusive?: boolean;
  /** P5 course grouping for fire/hold (1=starter, 2=main, 3=dessert, …). */
  @IsOptional() @IsNumber() course?: number;
}

export class CreateOrderDto {
  @IsOptional() @IsIn(['dine_in', 'takeaway', 'delivery']) orderType?: 'dine_in' | 'takeaway' | 'delivery';
  @IsOptional() @IsString() tableId?: string;
  @IsOptional() @IsString() partnerId?: string;
  @IsOptional() @IsString() waiterId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() cashSessionId?: string;
  @IsNumber() @Min(1) guestCount!: number;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() overrideById?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => OrderLineDto) lines?: OrderLineDto[];
}

/** Auto-save: replace the order's whole item set with exactly these lines. */
export class SaveOrderItemsDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => OrderLineDto) lines!: OrderLineDto[];
  @IsOptional() @IsNumber() expectedVersion?: number;
  @IsOptional() @IsNumber() guestCount?: number;
  @IsOptional() @IsString() partnerId?: string;
  @IsOptional() @IsString() overrideById?: string;
  @IsOptional() @IsNumber() transactionDiscountPercent?: number;
}

/** Add a round of items (append) — optionally fire the new items to the kitchen. */
export class AddOrderItemsDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => OrderLineDto) lines!: OrderLineDto[];
  @IsOptional() @IsBoolean() sendToKitchen?: boolean;
  @IsOptional() @IsNumber() guestCount?: number;
  @IsOptional() @IsString() overrideById?: string;
  @IsOptional() @IsNumber() transactionDiscountPercent?: number;
}

export class CancelOrderDto {
  @IsOptional() @IsString() reason?: string;
}

export class MoveTableDto {
  @IsString() targetTableId!: string;
}

/** Merge another open order's items into this one. */
export class MergeOrderDto {
  @IsString() sourceOrderId!: string;
}

/** Generate the bill/invoice from an order. paymentMode is optional intent. */
export class GenerateInvoiceDto {
  @IsOptional() @IsIn(['cash', 'card', 'mobile_money', 'mixed', 'credit'])
  paymentMode?: 'cash' | 'card' | 'mobile_money' | 'mixed' | 'credit';
  @IsOptional() @IsString() paymentTermId?: string;
  @IsOptional() @IsNumber() transactionDiscountPercent?: number;
  @IsOptional() @IsIn(['percentage', 'fixed_amount']) transactionDiscountType?: 'percentage' | 'fixed_amount';
  @IsOptional() @IsNumber() @Min(0) transactionDiscountAmount?: number;
  @IsOptional() @IsString() discountReason?: string;
  @IsOptional() @IsString() overrideById?: string;
  @IsOptional() @IsString() branchId?: string;
  /** Offline-first: when the sale was actually rung up. Sets Invoice.issueDate
   *  (and therefore the GL/journal date) instead of now(). */
  @IsOptional() @IsISO8601() occurredAt?: string;
}

export class TenderDto {
  @IsIn(['cash', 'bank', 'card', 'mobile_money', 'store_credit'])
  method!: 'cash' | 'bank' | 'card' | 'mobile_money' | 'store_credit';
  // D2: tender must be a positive, finite amount. A negative leg in a split
  // (e.g. [150 cash, -50 card]) would otherwise sum to the residual, pass the
  // total check, and write a reversing Payment that corrupts the drawer/GL.
  @IsNumber({ allowNaN: false, allowInfinity: false }) @IsPositive() amount!: number;
  @IsOptional() @IsString() reference?: string;
}

/** Receive one or more payments against an invoice. */
export class ReceivePaymentDto {
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TenderDto) tenders?: TenderDto[];
  @IsOptional() @IsIn(['cash', 'bank', 'card', 'mobile_money']) paymentMethod?: 'cash' | 'bank' | 'card' | 'mobile_money';
  @IsOptional() @IsNumber() amountTendered?: number;
  @IsOptional() @IsString() cashSessionId?: string;
  // D1: opt-in partial settlement. When true, tenders may sum to LESS than the
  // amount due — the invoice stays partially_settled and the table stays held.
  // Composite flows (checkout / split / tab settle) never set it, so their
  // strict "tenders must equal the balance" contract is preserved.
  @IsOptional() @IsBoolean() allowPartial?: boolean;
  /** Offline-first: when the payment was actually taken. Sets the Payment date
   *  instead of now(). */
  @IsOptional() @IsISO8601() occurredAt?: string;
}

/** Settle an invoice on credit (postpaid house account). */
export class SettleCreditDto {
  @IsOptional() @IsString() partnerId?: string;
  @IsOptional() @IsString() notes?: string;
}

export class WriteOffDto {
  @IsString() reason!: string;
}
