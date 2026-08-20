/**
 * DTOs for the School Meals module (Meals V1–V3). class-validator classes —
 * import as values. Mirrors the attendance/library DTO conventions.
 */
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const ASSIGNMENT_END_STATUS = ['suspended', 'ended', 'cancelled'] as const;
const MEAL_ATT_STATUS = ['served', 'absent', 'excused', 'not_eligible'] as const;
const WASTE_REASON = ['overproduction', 'spoilage', 'burnt', 'damaged', 'returned', 'other'] as const;
const PRODUCTION_STATUS = ['preparing', 'ready', 'served', 'cancelled'] as const;
const TXN_KIND = ['top_up', 'refund', 'adjustment'] as const;

/* ── Programs ── */
export class CreateMealProgramDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsIn(['day', 'day_boarding', 'custom']) kind?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateMealProgramDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsIn(['day', 'day_boarding', 'custom']) kind?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

/* ── Meal types ── */
export class CreateMealTypeDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsInt() @Min(0) order?: number;
  @IsOptional() @IsString() startTime?: string;
  @IsOptional() @IsString() endTime?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateMealTypeDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsInt() @Min(0) order?: number;
  @IsOptional() @IsString() startTime?: string;
  @IsOptional() @IsString() endTime?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

/* ── Entitlements (which meal types a plan includes) ── */
export class SetPlanEntitlementsDto {
  @IsString() @IsNotEmpty() mealPlanId!: string;
  @IsArray() @IsString({ each: true }) mealTypeIds!: string[];
}

/* ── Plan assignment (student ⇄ plan per term) ── */
export class AssignMealPlanDto {
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsString() @IsNotEmpty() mealPlanId!: string;
  @IsString() @IsNotEmpty() termId!: string;
  @IsString() @IsNotEmpty() startDate!: string;
  @IsOptional() @IsString() endDate?: string;
  @IsOptional() @IsString() reason?: string;
}
export class ChangeAssignmentDto {
  @IsIn([...ASSIGNMENT_END_STATUS]) status!: (typeof ASSIGNMENT_END_STATUS)[number];
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() endDate?: string;
}

/* ── Sessions + attendance ── */
export class OpenMealSessionDto {
  @IsString() @IsNotEmpty() mealTypeId!: string;
  @IsString() @IsNotEmpty() date!: string;
  @IsOptional() @IsString() classId?: string;
  @IsOptional() @IsString() sectionId?: string;
  @IsOptional() @IsString() mealPlanId?: string;
}

export class MealAttendanceEntry {
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsIn([...MEAL_ATT_STATUS]) status!: (typeof MEAL_ATT_STATUS)[number];
  @IsOptional() @IsString() reason?: string;
}
export class BulkMarkMealAttendanceDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MealAttendanceEntry)
  entries!: MealAttendanceEntry[];
}

/* ── Menus ── */
export class MealMenuItemInput {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsString() mealRecipeId?: string;
  /// Link to an imported POS `MenuItem` (reuse cafe catalog instead of duplicating).
  @IsOptional() @IsString() posMenuItemId?: string;
}
export class CreateMealMenuDto {
  @IsString() @IsNotEmpty() mealTypeId!: string;
  @IsOptional() @IsString() date?: string;
  @IsOptional() @IsInt() @Min(0) dayOfWeek?: number;
  @IsOptional() @IsString() mealPlanId?: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MealMenuItemInput)
  items?: MealMenuItemInput[];
  /// Build the menu from imported POS `MenuItem` ids in one shot.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  posMenuItemIds?: string[];
}
export class UpdateMealMenuDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() date?: string;
  @IsOptional() @IsInt() @Min(0) dayOfWeek?: number;
}

/* ── V1.5 wallet ── */
export class WalletTopUpDto {
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsString() @IsNotEmpty() mealPlanId!: string;
  @IsNumber() @Min(0) amount!: number;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() paymentId?: string;
  @IsOptional() @IsIn([...TXN_KIND]) type?: (typeof TXN_KIND)[number];
}
export class WalletPurchaseDto {
  @IsString() @IsNotEmpty() mealAccountId!: string;
  @IsNumber() @Min(0) amount!: number;
  @IsString() @IsNotEmpty() description!: string;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() paymentId?: string;
}
export class WalletAdjustDto {
  @IsString() @IsNotEmpty() mealAccountId!: string;
  /** Signed delta: positive credits, negative debits. */
  @IsNumber() amount!: number;
  @IsString() @IsNotEmpty() reason!: string;
  @IsOptional() @IsString() reference?: string;
}

/* ── V2 billing ── */
export class GenerateMealChargesDto {
  @IsString() @IsNotEmpty() termId!: string;
  @IsOptional() @IsString() classId?: string;
}

/* ── V3 kitchen ── */
export class RecipeIngredientInput {
  @IsString() @IsNotEmpty() productId!: string;
  @IsNumber() @Min(0) quantityPerPortion!: number;
  @IsOptional() @IsString() uomId?: string;
}
export class CreateMealRecipeDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() @Min(1) portionYield?: number;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipeIngredientInput)
  ingredients?: RecipeIngredientInput[];
}
export class PlanProductionDto {
  @IsString() @IsNotEmpty() mealTypeId!: string;
  @IsString() @IsNotEmpty() date!: string;
  @IsOptional() @IsString() mealSessionId?: string;
  @IsOptional() @IsInt() @Min(0) expectedPortions?: number;
  /** Recipes to explode into ingredient requirements. */
  @IsArray() @IsString({ each: true }) mealRecipeIds!: string[];
}
export class IssueProductionDto {
  @IsOptional() @IsString() stockLocationId?: string;
}
export class RecordWasteDto {
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() mealSessionId?: string;
  @IsNumber() @Min(0) quantity!: number;
  @IsOptional() @IsString() uomId?: string;
  @IsIn([...WASTE_REASON]) reason!: (typeof WASTE_REASON)[number];
  @IsOptional() @IsString() notes?: string;
}
export class SetProductionStatusDto {
  @IsIn([...PRODUCTION_STATUS]) status!: (typeof PRODUCTION_STATUS)[number];
}

/* ── Plan → menus link + per-student consumption ── */
/// Records consumption for one student being served a plan's menu on a session.
/// Decrements each menu dish's recipe products (once per student) and writes a
/// per-student MealConsumption row — only when the plan has trackInventory=true.
export class RecordMealConsumptionDto {
  @IsString() @IsNotEmpty() mealSessionId!: string;
  @IsString() @IsNotEmpty() studentProfileId!: string;
  /// The menu actually served (defaults to the plan's first menu for the session's meal type).
  @IsOptional() @IsString() mealMenuId?: string;
  /// Optional stock location to issue from; falls back to the org default location.
  @IsOptional() @IsString() stockLocationId?: string;
}

/// Query params for listing per-student consumption (audit / per-lunch view).
export class MealConsumptionQueryDto {
  @IsOptional() @IsString() mealSessionId?: string;
  @IsOptional() @IsString() studentProfileId?: string;
  @IsOptional() @IsString() mealMenuId?: string;
  @IsOptional() @IsString() mealPlanId?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}
