/**
 * POS Phase A — REST controller.
 *
 * Endpoints (existing + Phase A):
 *   POST /pos/checkout       — full sale (idempotent). Supports split tender.
 *   POST /pos/refund         — credit-note + reversing payment.
 *   POST /pos/sales/:id/void — manager-gated void.
 *   GET  /pos/lookup         — barcode/SKU lookup.
 *
 * /pos/holds/*           → PosHoldsController
 * /pos/override/*        → PosOverridesController
 * /pos/reports/*         → PosReportsController
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Body, Controller, Get, Param, Patch, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { IdempotencyInterceptor } from '../../kernel/idempotency/idempotency.interceptor';
import { Idempotent } from '../../kernel/idempotency/idempotent.decorator';
import {
  PosService,
  type CheckoutInput,
  type CheckoutLine,
  type CheckoutLineModifier,
  type PaymentTender,
} from './pos.service';
import { PosInvoiceService } from './billing/pos-invoice.service';

class CheckoutLineModifierDto implements CheckoutLineModifier {
  @ApiProperty() @IsString() modifierId!: string;
  @ApiProperty() @IsString() name!: string;
  @ApiProperty() @IsNumber() priceDelta!: number;
  // Display echo for the kitchen ticket; server re-resolves from modifierId.
  // Whitelisted so forbidNonWhitelisted doesn't 400 the save.
  @ApiProperty({ required: false }) @IsOptional() @IsString() kitchenPrintName?: string;
}

class CheckoutLineDto implements CheckoutLine {
  @ApiProperty({ required: false }) @IsOptional() @IsString() productId?: string;
  @ApiProperty({ required: false, description: 'Menu-based sale: the sellable MenuItem id.' })
  @IsOptional() @IsString() menuItemId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() sku?: string;
  @ApiProperty() @IsString() description!: string;
  @ApiProperty() @IsNumber() quantity!: number;
  @ApiProperty() @IsNumber() unitPrice!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() taxId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() discountPercent?: number;
  @ApiProperty({ required: false, enum: ['percentage', 'fixed_amount'] }) @IsOptional() @IsIn(['percentage', 'fixed_amount']) discountType?: 'percentage' | 'fixed_amount';
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() @Min(0) discountAmount?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() discountReason?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() note?: string;
  @ApiProperty({ required: false, type: [CheckoutLineModifierDto], description: 'P4 add-ons; priceDeltas are folded into the line total server-side.' })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CheckoutLineModifierDto)
  modifiers?: CheckoutLineModifierDto[];
  @ApiProperty({ required: false, description: 'Selected variant id. Variant price replaces basePrice.' })
  @IsOptional() @IsString() variantId?: string;
  // Display-only echoes of the cart's variant/accompaniment state. The server
  // re-resolves names and prices from the DB (anti-tamper), so these are
  // accepted-but-ignored — whitelisted only so forbidNonWhitelisted doesn't 400
  // the save when a line carries a variant or accompaniments.
  @ApiProperty({ required: false, description: 'Display echo; server re-resolves from variantId.' })
  @IsOptional() @IsString() variantName?: string;
  @ApiProperty({ required: false, description: 'Display echo; server re-resolves from variantId.' })
  @IsOptional() @IsNumber() variantPrice?: number;
  @ApiProperty({ required: false, description: 'Selected accompaniment option ids (one per group).' })
  @IsOptional() @IsArray() @IsString({ each: true })
  accompanimentOptionIds?: string[];
  @ApiProperty({ required: false, description: 'Display echo; server re-resolves from accompanimentOptionIds.' })
  @IsOptional() @IsArray() @IsString({ each: true })
  accompanimentNames?: string[];
  @ApiProperty({ required: false, description: 'Display echo; server re-resolves from accompanimentOptionIds.' })
  @IsOptional() @IsNumber() accompanimentPriceImpact?: number;
  @ApiProperty({ required: false, description: 'P4 combo id; expanded into component lines on checkout.' })
  @IsOptional() @IsString() comboId?: string;
  @ApiProperty({ required: false, description: 'P10 per-line tax-inclusive override.' })
  @IsOptional() @IsBoolean() taxInclusive?: boolean;
}

class PaymentTenderDto implements PaymentTender {
  @ApiProperty({ enum: ['cash', 'bank', 'card', 'mobile_money', 'store_credit'] })
  @IsIn(['cash', 'bank', 'card', 'mobile_money', 'store_credit'])
  method!: PaymentTender['method'];
  // D2: reject zero/negative/non-finite tender legs (see TenderDto).
  @ApiProperty() @IsNumber({ allowNaN: false, allowInfinity: false }) @IsPositive() amount!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() reference?: string;
}

class CheckoutDto implements CheckoutInput {
  @ApiProperty({ required: false }) @IsOptional() @IsString() partnerId?: string;
  @ApiProperty({ type: [CheckoutLineDto] })
  @IsArray() @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CheckoutLineDto)
  lines!: CheckoutLineDto[];
  @ApiProperty({ required: false, description: 'Transaction-level discount percent (0–100). Default 0.' })
  @IsOptional() @IsNumber() transactionDiscountPercent?: number;
  @ApiProperty({ required: false, enum: ['percentage', 'fixed_amount'], description: 'Transaction-level discount type.' })
  @IsOptional() @IsIn(['percentage', 'fixed_amount']) transactionDiscountType?: 'percentage' | 'fixed_amount';
  @ApiProperty({ required: false, description: 'Transaction-level fixed discount amount (currency).' })
  @IsOptional() @IsNumber() @Min(0) transactionDiscountAmount?: number;
  @ApiProperty({ required: false, description: 'Reason for the discount.' })
  @IsOptional() @IsString() discountReason?: string;
  @ApiProperty({ required: false, description: 'Manager user id; required when discount exceeds tier1 threshold.' })
  @IsOptional() @IsString() overrideById?: string;
  @ApiProperty({ required: false, description: 'Manager PIN; required when overrideById is set (F-OVR).' })
  @IsOptional() @IsString() overridePin?: string;
  @ApiProperty({ required: false, type: [PaymentTenderDto], description: 'Split tender. Sum must equal total.' })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PaymentTenderDto)
  tenders?: PaymentTenderDto[];
  @ApiProperty({ required: false, enum: ['cash', 'bank', 'card', 'mobile_money'] })
  @IsOptional() @IsString() paymentMethod?: 'cash' | 'bank' | 'card' | 'mobile_money';
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() amountTendered?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() cashSessionId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() branchId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() reference?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() notes?: string;
  /** POS Tables (T1): if the sale is being rung on a table, its id. The
   *  server creates a PosTableOrder row and flips the table to OCCUPIED
   *  inside the same transaction; on payment the table is auto-marked DIRTY. */
  @ApiProperty({ required: false }) @IsOptional() @IsString() tableId?: string;
  /** POS Tables (T1): optional guest count shown on the table card. */
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() guestCount?: number;
  /** Order type: dine-in, takeaway, or delivery. When omitted, inferred from tableId. */
  @ApiProperty({ required: false, enum: ['dine_in', 'takeaway', 'delivery'] })
  @IsOptional() @IsIn(['dine_in', 'takeaway', 'delivery'])
  orderType?: 'dine_in' | 'takeaway' | 'delivery';
  /** Offline-first: when the sale was actually rung up on the device (ISO-8601).
   *  Drives Invoice.issueDate / GL date / report buckets on delayed replay.
   *  Rejected if in the future or older than 7 days. */
  @ApiProperty({ required: false })
  @IsOptional() @IsISO8601() occurredAt?: string;
  @ApiProperty({ required: false, enum: ['tender', 'credit'], description: "'credit' books the whole bill to the customer's AR — nothing is collected now." })
  @IsOptional() @IsIn(['tender', 'credit']) settleMode?: 'tender' | 'credit';
}

class VoidDto {
  @ApiProperty() @IsString() reason!: string;
  @ApiProperty({ description: 'Manager user id (override is mandatory for a void).' })
  @IsString() overrideById!: string;
}

class AddToTabDto {
  @ApiProperty({ type: [CheckoutLineDto] })
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => CheckoutLineDto)
  lines!: CheckoutLineDto[];
  @ApiProperty({ required: false }) @IsOptional() @IsString() partnerId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() guestCount?: number;
  @ApiProperty({ required: false, description: 'Fire this round to the kitchen now.' })
  @IsOptional() @IsBoolean() sendToKitchen?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsString() overrideById?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() transactionDiscountPercent?: number;
}

class SaveTabDto {
  @ApiProperty({ type: [CheckoutLineDto], description: 'The full current item set for the order. An empty array cancels the draft and frees the table.' })
  @IsArray() @ValidateNested({ each: true }) @Type(() => CheckoutLineDto)
  lines!: CheckoutLineDto[];
  @ApiProperty({ required: false }) @IsOptional() @IsString() partnerId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() guestCount?: number;
  @ApiProperty({ required: false, description: 'H2: optimistic-lock token from the last tab read; rejects a stale overwrite (409).' })
  @IsOptional() @IsNumber() expectedVersion?: number;
}

class SettleTabDto {
  @ApiProperty({ required: false, type: [PaymentTenderDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PaymentTenderDto)
  tenders?: PaymentTenderDto[];
  @ApiProperty({ required: false, enum: ['cash', 'bank', 'card', 'mobile_money'] })
  @IsOptional() @IsString() paymentMethod?: 'cash' | 'bank' | 'card' | 'mobile_money';
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() amountTendered?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() transactionDiscountPercent?: number;
  @ApiProperty({ required: false, enum: ['percentage', 'fixed_amount'] })
  @IsOptional() @IsIn(['percentage', 'fixed_amount']) transactionDiscountType?: 'percentage' | 'fixed_amount';
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() @Min(0) transactionDiscountAmount?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() discountReason?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() overrideById?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() overridePin?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() cashSessionId?: string;
  /** Offline-first: when the settle actually happened on the device (ISO-8601). */
  @ApiProperty({ required: false })
  @IsOptional() @IsISO8601() occurredAt?: string;
  @ApiProperty({ required: false, enum: ['tender', 'credit'], description: "'credit' books the whole bill to the customer's AR — nothing is collected now." })
  @IsOptional() @IsIn(['tender', 'credit']) settleMode?: 'tender' | 'credit';
  @ApiProperty({ required: false, description: 'Customer attached at charge time; moved onto the order before it is billed.' })
  @IsOptional() @IsString() partnerId?: string;
}

class UpdatePosSettingsDto {
  @ApiProperty({ required: false, enum: ['cafe', 'retail'], description: 'POS mode: cafe/restaurant or retail' })
  @IsOptional() @IsString() @IsIn(['cafe', 'retail'])
  posMode?: string;
}

@ApiTags('pos')
@ApiBearerAuth()
@Controller('pos')
export class PosController {
  constructor(
    private readonly svc: PosService,
    private readonly billing: PosInvoiceService,
  ) {}

  @Get('settings')
  @RequirePermissions('pos:read')
  getSettings() {
    return this.svc.getPosSettings();
  }

  @Patch('settings')
  @RequirePermissions('setting:update')
  updateSettings(@Body() dto: UpdatePosSettingsDto) {
    return this.svc.updatePosSettings(dto);
  }

  @Post('checkout')
  @RequirePermissions('pos:checkout')
  @UseInterceptors(IdempotencyInterceptor)
  @Idempotent()
  checkout(@Body() dto: CheckoutDto) {
    return this.svc.checkout(dto);
  }

  /**
   * Void a settled POS sale. The canonical, override-gated endpoint is
   * POST /pos/invoices/:id/refund (delegated to PosInvoiceService.refund) —
   * the legacy Document-based POST /pos/refund was deleted as part of the
   * POS Sprint 1 hardening (see audit F1) because it queried the legacy
   * Document table and bypassed the new flow's FOR UPDATE + per-line
   * over-refund guard.
   */
  @Post('sales/:id/void')
  @RequirePermissions('pos:void')
  @UseInterceptors(IdempotencyInterceptor)
  @Idempotent()
  void(@Param('id') id: string, @Body() dto: VoidDto) {
    return this.billing.refund(id, `VOID: ${dto.reason}`, {
      overrideById: dto.overrideById,
      requireOverride: true,
    });
  }

  @Get('lookup')
  @RequirePermissions('pos:read')
  lookup(@Query('sku') sku: string) {
    return this.svc.findBySku(sku);
  }

  // ─── Open-tab dine-in (M4) ───────────────────────────────────────────────

  /** The running bill for a table's open tab (or null when none is open). */
  @Get('tabs/:tableId')
  @RequirePermissions('pos:read')
  getTab(@Param('tableId') tableId: string) {
    return this.svc.getTab(tableId);
  }

  /** Add a round of items to a table's tab (creates the tab on the first round). */
  @Post('tabs/:tableId/items')
  @RequirePermissions('pos:checkout')
  addToTab(@Param('tableId') tableId: string, @Body() dto: AddToTabDto) {
    return this.svc.addToTab({ tableId, ...dto });
  }

  /** Auto-save: replace the table's open order with the current item set (empty = free the table). */
  @Post('tabs/:tableId/save')
  @RequirePermissions('pos:checkout')
  saveTab(@Param('tableId') tableId: string, @Body() dto: SaveTabDto) {
    return this.svc.saveTabItems({ tableId, ...dto });
  }

  /** Fire the table's current order to the kitchen display. */
  @Post('tabs/:tableId/fire-kitchen')
  @RequirePermissions('pos:checkout')
  fireKitchen(@Param('tableId') tableId: string) {
    return this.svc.fireTabToKitchen(tableId);
  }

  /** Settle a table's tab — posts, takes payment, issues stock, frees the table. */
  @Post('tabs/:tableId/settle')
  @RequirePermissions('pos:checkout')
  @UseInterceptors(IdempotencyInterceptor)
  @Idempotent()
  settleTab(@Param('tableId') tableId: string, @Body() dto: SettleTabDto) {
    return this.svc.settleTab({ tableId, ...dto });
  }

  // ─── Odoo-style multi-order (Orders panel) ────────────────────────────────

  /** Rehydrate any open order (table-bound or tableless) so the terminal can
   *  resume selling from it — the Orders-panel "open order" action. */
  @Get('orders/:id/resume')
  @RequirePermissions('pos:read')
  resumeOrder(@Param('id') id: string) {
    return this.svc.resumeOrder(id);
  }

  /** Settle any open order by id (tableless walk-in / retail, or a dine-in order
   *  chosen from the Orders panel). Mirrors tab settle; body reuses SettleTabDto
   *  (which carries no tableId). */
  @Post('orders/:id/settle')
  @RequirePermissions('pos:checkout')
  @UseInterceptors(IdempotencyInterceptor)
  @Idempotent()
  settleOrder(@Param('id') id: string, @Body() dto: SettleTabDto) {
    return this.svc.settleOrder({ orderId: id, ...dto });
  }
}