/**
 * DTOs for the Fees module (the money endpoints).
 *
 * P2A/B6: these were bare TypeScript interfaces. The global ValidationPipe
 * (whitelist + forbidNonWhitelisted + transform, see main.ts) only validates
 * @Body() params whose type is a class with class-validator metadata — an
 * interface has no runtime metatype, so every fee/billing/payment body reached
 * Prisma completely unvalidated. These are now classes so the pipe enforces
 * types, required fields and strips unknown properties before any handler runs.
 */
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * One priced line inside a FeeStructure.
 *
 * `code` is the FeeCategory code — that is the join between the reusable
 * Fee Categories catalog and a structure. `feeCategoryId` carries the hard
 * reference so a category rename does not orphan the component, and
 * `isOptional` is denormalised off the category's `type` at save time so the
 * billing engine can decide "bill everyone" vs "bill only opted-in students"
 * without a second query per component.
 *
 * `productId` is optional: with no product the invoice line falls back to
 * AccountDeterminationService's default revenue account, which is what a
 * school that has not modelled fee products in the catalog wants. Requiring it
 * was why a bursar could not save a structure at all.
 */
export class FeeComponent {
  @IsString()
  @IsNotEmpty()
  code!: string; // FeeCategory.code — 'TUITION', 'TRANSPORT', 'SWIMMING', …

  /** Human label shown on the invoice line (defaults to `code`). */
  @IsOptional()
  @IsString()
  name?: string;

  /** FK to FeeCategory. */
  @IsOptional()
  @IsString()
  feeCategoryId?: string;

  /** FK to Product (type=service). Optional — see class doc. */
  @IsOptional()
  @IsString()
  productId?: string;

  @IsNumber()
  @Min(0)
  amount!: number;

  /**
   * True when the component comes from an *optional* FeeCategory. Optional
   * components are billed ONLY to students with a matching StudentOptionalFee
   * opt-in for the term.
   */
  @IsOptional()
  @IsBoolean()
  isOptional?: boolean;
}

export class CreateFeeStructureDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  academicYearId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FeeComponent)
  components!: FeeComponent[];

  /** {gradeLevelIds?:string[], classIds?:string[]} */
  @IsOptional()
  @IsObject()
  applicableTo?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateFeeStructureDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() @IsNotEmpty() academicYearId?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => FeeComponent) components?: FeeComponent[];
  @IsOptional() @IsObject() applicableTo?: Record<string, unknown>;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class LateFeePolicy {
  @IsIn(['percent', 'fixed'])
  type!: 'percent' | 'fixed';

  @IsNumber()
  @Min(0)
  value!: number;

  @IsInt()
  @Min(0)
  graceDays!: number;
}

export class CreateFeeScheduleDto {
  @IsString() @IsNotEmpty() feeStructureId!: string;
  @IsString() @IsNotEmpty() termId!: string;
  @IsString() @IsNotEmpty() dueDate!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LateFeePolicy)
  lateFeePolicy?: LateFeePolicy;
}

export class UpdateFeeScheduleDto {
  @IsOptional() @IsString() @IsNotEmpty() feeStructureId?: string;
  @IsOptional() @IsString() @IsNotEmpty() termId?: string;
  @IsOptional() @IsString() @IsNotEmpty() dueDate?: string;
  @IsOptional() @ValidateNested() @Type(() => LateFeePolicy) lateFeePolicy?: LateFeePolicy;
}

export class ExtraDiscount {
  @IsString() @IsNotEmpty() code!: string;
  @IsIn(['percent', 'fixed']) type!: 'percent' | 'fixed';
  @IsNumber() @Min(0) value!: number;
}

export class CreateStudentFeeAssignmentDto {
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsString() @IsNotEmpty() feeStructureId!: string;
  @IsString() @IsNotEmpty() termId!: string;

  /** Per-student override of components: {code: amount}. */
  @IsOptional()
  @IsObject()
  customDiscount?: Record<string, number>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExtraDiscount)
  extraDiscounts?: ExtraDiscount[];
}

export class UpdateStudentFeeAssignmentDto {
  @IsOptional() @IsString() @IsNotEmpty() studentProfileId?: string;
  @IsOptional() @IsString() @IsNotEmpty() feeStructureId?: string;
  @IsOptional() @IsString() @IsNotEmpty() termId?: string;
  @IsOptional() @IsObject() customDiscount?: Record<string, number>;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ExtraDiscount) extraDiscounts?: ExtraDiscount[];
}

export class CreateDiscountDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() name!: string;

  // Writes the `Discount.type` enum column. The port adopted the platform's
  // generic DiscountType (percentage | fixed_amount) over the fork's
  // percent | fixed — see P0/B-DiscountType. Scholarship and PenaltyRule keep
  // their own free-string 'percent' | 'fixed' policy values (String columns).
  @IsIn(['percentage', 'fixed_amount'])
  type!: 'percentage' | 'fixed_amount';

  @IsNumber() @Min(0) value!: number;

  @IsOptional() @IsObject() appliesTo?: Record<string, unknown>;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateDiscountDto {
  @IsOptional() @IsString() @IsNotEmpty() code?: string;
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsIn(['percentage', 'fixed_amount']) type?: 'percentage' | 'fixed_amount';
  @IsOptional() @IsNumber() @Min(0) value?: number;
  @IsOptional() @IsObject() appliesTo?: Record<string, unknown>;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateScholarshipDto {
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsIn(['percent', 'fixed']) type!: 'percent' | 'fixed';
  @IsNumber() @Min(0) value!: number;
  @IsString() @IsNotEmpty() validFrom!: string;
  @IsOptional() @IsString() validTo?: string;
  @IsOptional() @IsString() awardedBy?: string;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateScholarshipDto {
  @IsOptional() @IsString() @IsNotEmpty() studentProfileId?: string;
  @IsOptional() @IsString() @IsNotEmpty() code?: string;
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsIn(['percent', 'fixed']) type?: 'percent' | 'fixed';
  @IsOptional() @IsNumber() @Min(0) value?: number;
  @IsOptional() @IsString() validFrom?: string;
  @IsOptional() @IsString() validTo?: string;
  @IsOptional() @IsString() awardedBy?: string;
  @IsOptional() @IsString() notes?: string;
}

export class InstallmentItem {
  @IsInt() @Min(1) number!: number;
  @IsString() @IsNotEmpty() dueDate!: string;
  @IsNumber() @Min(0) amount!: number;
}

export class CreateInstallmentPlanDto {
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsString() @IsNotEmpty() termId!: string;
  @IsNumber() @IsPositive() totalAmount!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InstallmentItem)
  installments!: InstallmentItem[];
}

export class UpdateInstallmentPlanDto {
  @IsOptional() @IsString() @IsNotEmpty() studentProfileId?: string;
  @IsOptional() @IsString() @IsNotEmpty() termId?: string;
  @IsOptional() @IsNumber() @IsPositive() totalAmount?: number;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => InstallmentItem) installments?: InstallmentItem[];
}

export class CreatePenaltyRuleDto {
  @IsString() @IsNotEmpty() feeScheduleId!: string;
  @IsIn(['percent', 'fixed']) type!: 'percent' | 'fixed';
  @IsNumber() @Min(0) value!: number;
  @IsOptional() @IsInt() @Min(0) graceDays?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdatePenaltyRuleDto {
  @IsOptional() @IsString() @IsNotEmpty() feeScheduleId?: string;
  @IsOptional() @IsIn(['percent', 'fixed']) type?: 'percent' | 'fixed';
  @IsOptional() @IsNumber() @Min(0) value?: number;
  @IsOptional() @IsInt() @Min(0) graceDays?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class GenerateBillingDto {
  @IsString() @IsNotEmpty() termId!: string;

  /** Generate for one class; otherwise all active students. */
  @IsOptional()
  @IsString()
  classId?: string;
}

export class CollectFeePaymentDto {
  @IsString() @IsNotEmpty() studentProfileId!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsIn(['cash', 'bank', 'mobile_money', 'card'])
  paymentMethod!: 'cash' | 'bank' | 'mobile_money' | 'card';

  @IsOptional() @IsString() paymentDate?: string;
  @IsOptional() @IsString() cashSessionId?: string;
  @IsOptional() @IsString() bankAccountId?: string;

  /** Optional document IDs to allocate against (full residual each). If empty, allocates oldest-first. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  documentIds?: string[];

  /**
   * Optional explicit per-invoice allocation. When present, each entry's
   * `amount` is applied to that invoice (capped at its residual) and ONLY
   * these invoices are touched — no oldest-first auto-fill that could
   * silently spend the tender elsewhere. `documentIds` is ignored when this
   * is set. Used by the Record Fee Payments wizard's Allocation step.
   */
  @IsOptional()
  @IsArray()
  allocations?: Array<{ documentId: string; amount: number }>;

  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() notes?: string;
}

export class RefundFeeDto {
  @IsString() @IsNotEmpty() studentProfileId!: string;

  @IsNumber() @IsPositive() amount!: number;

  @IsIn(['cash', 'bank', 'mobile_money', 'card'])
  paymentMethod!: 'cash' | 'bank' | 'mobile_money' | 'card';

  /**
   * Tender the refund from, e.g. the cash drawer the original payment landed
   * in, or the bank account to draw down. Optional — when omitted the payment
   * engine resolves the default cash/bank account per method.
   */
  @IsOptional() @IsString() cashSessionId?: string;
  @IsOptional() @IsString() bankAccountId?: string;

  /**
   * Optional idempotency/replay key. A mobile-money reversal retry with the
   * same reference returns the original refund rather than paying out twice.
   */
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() notes?: string;
}

/* ── Fee Categories (standalone catalog master) ── */

export class CreateFeeCategoryDto {
  @IsString() @IsNotEmpty() code!: string; // e.g. 'TUITION', 'REGISTRATION', 'SWIMMING'
  @IsString() @IsNotEmpty() name!: string; // e.g. 'School Fees'

  /** 'mandatory' | 'optional' — mirrors the competitor Mandatory/Optional flag. */
  @IsIn(['mandatory', 'optional'])
  type!: 'mandatory' | 'optional';

  @IsOptional() @IsString() description?: string;

  @IsOptional() @IsInt() @Min(0) paymentOrder?: number;

  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateFeeCategoryDto {
  @IsOptional() @IsString() @IsNotEmpty() code?: string;
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsIn(['mandatory', 'optional']) type?: 'mandatory' | 'optional';
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() @Min(0) paymentOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

/* ── Student optional fees (P3) ── */

export class UpsertStudentOptionalFeeDto {
  @IsString() @IsNotEmpty() studentProfileId!: string;

  /** Null/omitted amount means "use the fee structure component amount". */
  @IsOptional() @IsNumber() @Min(0) amount?: number | null;

  @IsOptional() @IsBoolean() isActive?: boolean;

  @IsOptional() @IsString() notes?: string;
}

/**
 * Bulk save from the Optional Fees roster screen: one term + one category,
 * many students. Rows with `amount == null` and `isActive === false` are
 * removed rather than stored, so unticking a student cleanly un-bills them.
 */
export class BulkStudentOptionalFeeDto {
  @IsString() @IsNotEmpty() termId!: string;
  @IsString() @IsNotEmpty() feeCategoryId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpsertStudentOptionalFeeDto)
  rows!: UpsertStudentOptionalFeeDto[];
}

/* ── Budgeting ── */
export class CreateBudgetDto {
  @IsString() @IsNotEmpty() category!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsNumber() @Min(0) amount!: number;
  @IsOptional() @IsString() academicYearId?: string;
  @IsOptional() @IsString() termId?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() periodFrom?: string;
  @IsOptional() @IsString() periodTo?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsIn(['draft', 'approved', 'closed']) status?: string;
}

export class UpdateBudgetDto {
  @IsOptional() @IsString() @IsNotEmpty() category?: string;
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsNumber() @Min(0) amount?: number;
  @IsOptional() @IsString() academicYearId?: string;
  @IsOptional() @IsString() termId?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() periodFrom?: string;
  @IsOptional() @IsString() periodTo?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsIn(['draft', 'approved', 'closed']) status?: string;
}
