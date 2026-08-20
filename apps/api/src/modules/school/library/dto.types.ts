/**
 * DTOs for the Library / Transport / Hostel / Cafeteria module.
 *
 * H3/B6: these controllers took `@Body() dto: any` (and inline object types for
 * the action endpoints), so nothing validated — including the money-moving ones
 * (transport fee, meal top-up/purchase). These class-validator classes close
 * that gap. Import as values.
 */
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/* ── Library ── */
export class CreateBookMetadataDto {
  @IsString() @IsNotEmpty() productId!: string;
  @IsOptional() @IsString() author?: string;
  @IsOptional() @IsString() isbn?: string;
  @IsOptional() @IsString() publisher?: string;
  @IsOptional() @IsString() edition?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() shelfLocation?: string;
  @IsOptional() @IsInt() @Min(0) totalCopies?: number;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}
export class UpdateBookMetadataDto {
  @IsOptional() @IsString() author?: string;
  @IsOptional() @IsString() isbn?: string;
  @IsOptional() @IsString() publisher?: string;
  @IsOptional() @IsString() edition?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() shelfLocation?: string;
  @IsOptional() @IsInt() @Min(0) totalCopies?: number;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}

export class CreateBookCopyDto {
  @IsString() @IsNotEmpty() bookMetadataId!: string;
  @IsString() @IsNotEmpty() copyNumber!: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() condition?: string;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}
export class UpdateBookCopyDto {
  @IsOptional() @IsString() @IsNotEmpty() copyNumber?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() condition?: string;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}

export class BorrowDto {
  @IsString() @IsNotEmpty() bookCopyId!: string;
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsString() @IsNotEmpty() dueAt!: string;
  @IsOptional() @IsString() notes?: string;
}

/* ── Transport ── */
export class CreateVehicleDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() plateNumber!: string;
  @IsOptional() @IsInt() @Min(0) capacity?: number;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() driverPartnerId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}
export class UpdateVehicleDto {
  @IsOptional() @IsString() @IsNotEmpty() code?: string;
  @IsOptional() @IsString() @IsNotEmpty() plateNumber?: string;
  @IsOptional() @IsInt() @Min(0) capacity?: number;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() driverPartnerId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}

export class CreateRouteDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsNumber() @Min(0) monthlyFee!: number;
  @IsOptional() @IsString() feeProductId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateRouteDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsNumber() @Min(0) monthlyFee?: number;
  @IsOptional() @IsString() feeProductId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateStopDto {
  @IsString() @IsNotEmpty() routeId!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsInt() @Min(0) order!: number;
  @IsOptional() @IsString() pickupTime?: string;
  @IsOptional() @IsString() dropoffTime?: string;
  @IsOptional() @IsNumber() @Min(0) feeOverride?: number;
  @IsOptional() @IsObject() location?: Record<string, unknown>;
}
export class UpdateStopDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsInt() @Min(0) order?: number;
  @IsOptional() @IsString() pickupTime?: string;
  @IsOptional() @IsString() dropoffTime?: string;
  @IsOptional() @IsNumber() @Min(0) feeOverride?: number;
  @IsOptional() @IsObject() location?: Record<string, unknown>;
}

export class CreateRouteAssignmentDto {
  @IsString() @IsNotEmpty() routeId!: string;
  @IsString() @IsNotEmpty() vehicleId!: string;
  @IsInt() @Min(1) @Max(7) dayOfWeek!: number;
  @IsOptional() @IsString() pickupTime?: string;
  @IsOptional() @IsString() dropoffTime?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateRouteAssignmentDto {
  @IsOptional() @IsString() @IsNotEmpty() routeId?: string;
  @IsOptional() @IsString() @IsNotEmpty() vehicleId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(7) dayOfWeek?: number;
  @IsOptional() @IsString() pickupTime?: string;
  @IsOptional() @IsString() dropoffTime?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class TransportAssignDto {
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsString() @IsNotEmpty() routeId!: string;
  @IsString() @IsNotEmpty() stopId!: string;
  @IsString() @IsNotEmpty() startDate!: string;
  @IsNumber() @Min(0) monthlyFee!: number;
}

/* ── Hostel ── */
export class CreateDormitoryDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() gender?: string;
  @IsOptional() @IsInt() @Min(0) capacity?: number;
  @IsOptional() @IsString() wardenPartnerId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateDormitoryDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() gender?: string;
  @IsOptional() @IsInt() @Min(0) capacity?: number;
  @IsOptional() @IsString() wardenPartnerId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateRoomDto {
  @IsString() @IsNotEmpty() dormitoryId!: string;
  @IsString() @IsNotEmpty() number!: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsInt() @Min(0) capacity?: number;
  @IsOptional() @IsNumber() @Min(0) monthlyFee?: number;
  @IsOptional() @IsString() feeProductId?: string;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}
export class UpdateRoomDto {
  @IsOptional() @IsString() @IsNotEmpty() number?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsInt() @Min(0) capacity?: number;
  @IsOptional() @IsNumber() @Min(0) monthlyFee?: number;
  @IsOptional() @IsString() feeProductId?: string;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}

export class CreateBedDto {
  @IsString() @IsNotEmpty() roomId!: string;
  @IsString() @IsNotEmpty() number!: string;
  @IsOptional() @IsString() status?: string;
}
export class UpdateBedDto {
  @IsOptional() @IsString() @IsNotEmpty() number?: string;
  @IsOptional() @IsString() status?: string;
}

export class HostelAllocateDto {
  @IsString() @IsNotEmpty() bedId!: string;
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsString() @IsNotEmpty() startDate!: string;
}
export class HostelCheckoutDto {
  @IsString() @IsNotEmpty() checkOutDate!: string;
}

/* ── Cafeteria ── */
export class CreateMealPlanDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() feeProductId?: string;
  @IsNumber() @Min(0) pricePerTerm!: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  // Meals V1: link to a program + charge/funding configuration.
  @IsOptional() @IsString() mealProgramId?: string;
  @IsOptional() @IsIn(['term_plan', 'wallet', 'included']) billingModel?: string;
  @IsOptional() @IsIn(['school_funded', 'parent_funded', 'parent_contribution', 'mixed']) fundingModel?: string;
}
export class UpdateMealPlanDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() feeProductId?: string;
  @IsOptional() @IsNumber() @Min(0) pricePerTerm?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() mealProgramId?: string;
  @IsOptional() @IsIn(['term_plan', 'wallet', 'included']) billingModel?: string;
  @IsOptional() @IsIn(['school_funded', 'parent_funded', 'parent_contribution', 'mixed']) fundingModel?: string;
  /// Opt-in: serving a student on this plan decrements the inventory products
  /// behind each menu dish and records per-student consumption.
  @IsOptional() @IsBoolean() trackInventory?: boolean;
  /// Replace the menus linked to this plan (MealMenu.mealPlanId). Empty array unlinks all.
  @IsOptional() @IsArray() @IsString({ each: true }) mealMenuIds?: string[];
}

export class MealTopUpDto {
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsString() @IsNotEmpty() mealPlanId!: string;
  @IsNumber() @Min(0) amount!: number;
}
export class MealPurchaseDto {
  @IsString() @IsNotEmpty() mealAccountId!: string;
  @IsNumber() @Min(0) amount!: number;
  @IsString() @IsNotEmpty() description!: string;
  @IsOptional() @IsString() paymentId?: string;
}
