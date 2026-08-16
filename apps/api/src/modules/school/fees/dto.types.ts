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

export class FeeComponent {
  @IsString()
  @IsNotEmpty()
  code!: string; // 'TUITION', 'TRANSPORT', 'MEAL', 'LAB', 'EXAM', 'LIBRARY', 'ACTIVITY'

  @IsString()
  @IsNotEmpty()
  productId!: string; // FK to Product (type=service)

  @IsNumber()
  @Min(0)
  amount!: number;

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

  /** Optional document IDs to allocate against. If empty, allocates oldest-first. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  documentIds?: string[];

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
