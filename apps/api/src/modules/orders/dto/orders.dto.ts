import {
  ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, Min, ValidateNested,
  ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments, registerDecorator,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Generic back-office Orders DTOs. Line contracts are reused from the POS
 * module (`OrderLineDto`) — it already whitelists BOTH line-source shapes
 * (productId for retail, menuItemId+sku for menus), so `forbidNonWhitelisted`
 * never 400s a valid save from either source.
 */

export type OrderLineSource = 'auto' | 'menu' | 'products' | 'both';

export const ORDER_LINE_SOURCES: readonly OrderLineSource[] = ['auto', 'menu', 'products', 'both'];

/** A back-office line must reference at least one catalog source (menu or product). */
@ValidatorConstraint({ name: 'customOrderLineRef', async: false })
export class OrderLineRefConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const line = args.object as OrderLineInputDto;
    return !!(line?.productId || line?.menuItemId);
  }
  defaultMessage(_args: ValidationArguments): string {
    return 'line must reference a menuItemId or a productId';
  }
}

export function IsOrderLineRef(): PropertyDecorator {
  return (target: object, key: string | symbol) => {
    registerDecorator({
      target: target.constructor, propertyName: String(key), options: {},
      constraints: [], validator: OrderLineRefConstraint,
    });
  };
}

/**
 * Back-office line input. Loose refs carry the source (productId | menuItemId);
 * description/unitPrice are OPTIONAL here (unlike the POS cart DTO) — the
 * service resolves names/prices from the DB via DocumentBuilderService when
 * omitted, so a pure menu-item or product pick works without manual pricing.
 */
export class OrderLineInputDto {
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() menuItemId?: string;
  @IsOptional() @IsString() sku?: string;
  @IsOptional() @IsString() description?: string;
  @IsOrderLineRef()
  @IsNumber()
  @Min(1)
  quantity!: number;
  @IsOptional() @IsNumber() @Min(0) unitPrice?: number;
  @IsOptional() @IsString() taxId?: string;
  @IsOptional() @IsNumber() discountPercent?: number;
  @IsOptional() @IsIn(['percentage', 'fixed_amount']) discountType?: 'percentage' | 'fixed_amount';
  @IsOptional() @IsNumber() @Min(0) discountAmount?: number;
  @IsOptional() @IsString() discountReason?: string;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsString() variantId?: string;
  @IsOptional() @IsString() variantName?: string;
  @IsOptional() @IsNumber() variantPrice?: number;
  @IsOptional() @IsBoolean() taxInclusive?: boolean;
}

export class CreateOrderDto {
  @IsOptional() @IsIn(['dine_in', 'takeaway', 'delivery'])
  orderType?: 'dine_in' | 'takeaway' | 'delivery';

  @IsOptional() @IsString()
  partnerId?: string;

  /** Module code for the transaction-kind axis. Defaults to `sale` (core). */
  @IsOptional() @IsString()
  transactionKind?: string;

  @IsOptional() @IsInt() @Min(1)
  guestCount?: number;

  @IsOptional() @IsString()
  notes?: string;

  @IsOptional() @IsString()
  branchId?: string;

  /** Loose ref (no FK) to the org's PaymentTerm master. Drives the invoice
   *  due-date derivation when this order is billed. */
  @IsOptional() @IsString()
  paymentTermId?: string;

  /** Pre-selected settlement method (cash/card/mobile_money/mixed/credit).
   *  The authoritative paymentMode is re-derived from tenders at settlement. */
  @IsOptional() @IsIn(['cash', 'card', 'mobile_money', 'mixed', 'credit'])
  paymentMethod?: 'cash' | 'card' | 'mobile_money' | 'mixed' | 'credit';

  /** Order date (ISO-8601). Defaults to now() when omitted. */
  @IsOptional() @IsISO8601()
  openedAt?: string;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => OrderLineInputDto)
  lines?: OrderLineInputDto[];
}

export class UpdateOrderHeaderDto {
  @IsOptional() @IsIn(['dine_in', 'takeaway', 'delivery'])
  orderType?: 'dine_in' | 'takeaway' | 'delivery';

  @IsOptional() @IsString()
  partnerId?: string;

  @IsOptional() @IsInt() @Min(1)
  guestCount?: number;

  @IsOptional() @IsString()
  notes?: string;

  @IsOptional() @IsString()
  paymentTermId?: string;

  @IsOptional() @IsIn(['cash', 'card', 'mobile_money', 'mixed', 'credit'])
  paymentMethod?: 'cash' | 'card' | 'mobile_money' | 'mixed' | 'credit';

  /** Order date (ISO-8601). */
  @IsOptional() @IsISO8601()
  openedAt?: string;
}

/** Auto-save: replace the order's whole item set with exactly these lines. */
export class SaveOrderItemsDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => OrderLineInputDto)
  lines!: OrderLineInputDto[];

  @IsOptional() @IsNumber()
  expectedVersion?: number;
}

/** Append lines to the existing (non-cancelled) item set. */
export class AddOrderItemsDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => OrderLineInputDto)
  lines!: OrderLineInputDto[];
}

export class CancelOrderDto {
  @IsOptional() @IsString()
  reason?: string;
}

export class UpdateOrderSettingsDto {
  @IsOptional() @IsIn(ORDER_LINE_SOURCES)
  lineSource?: OrderLineSource;
}

/** Forwarded to PosInvoiceService.generateInvoice — bill the order (stock + AR). */
export class BillOrderDto {
  @IsOptional() @IsIn(['cash', 'card', 'mobile_money', 'mixed', 'credit'])
  paymentMode?: 'cash' | 'card' | 'mobile_money' | 'mixed' | 'credit';

  @IsOptional() @IsNumber()
  transactionDiscountPercent?: number;

  @IsOptional() @IsIn(['percentage', 'fixed_amount'])
  transactionDiscountType?: 'percentage' | 'fixed_amount';

  @IsOptional() @IsNumber() @Min(0)
  transactionDiscountAmount?: number;

  @IsOptional() @IsString()
  discountReason?: string;

  @IsOptional() @IsString()
  overrideById?: string;

  @IsOptional() @IsString()
  branchId?: string;
}