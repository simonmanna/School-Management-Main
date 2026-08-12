import { Type } from 'class-transformer';
import {
  ArrayMinSize,
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

// ---- Work centre ----
export class CreateWorkCenterDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ---- Resource ----
export class CreateResourceDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() code?: string;
  @IsIn(['machine', 'labour', 'space']) kind!: 'machine' | 'labour' | 'space';
  @IsOptional() @IsString() workCenterId?: string;
  @IsOptional() @IsString() fixedAssetId?: string;
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsNumber() @Min(0) costPerHour?: number;
  @IsOptional() @IsInt() @Min(0) capacityMinsPerDay?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ---- Routing ----
export class RoutingOperationInputDto {
  @IsInt() @Min(0) sequence!: number;
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() workCenterId?: string;
  @IsOptional() @IsInt() @Min(0) durationMins?: number;
  @IsOptional() @IsInt() @Min(0) setupMins?: number;
  @IsOptional() @IsString() instructions?: string;
}

export class CreateRoutingDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() bomId?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RoutingOperationInputDto)
  operations!: RoutingOperationInputDto[];
}

// ---- Work order ----
export class AssignWorkOrderDto {
  @IsOptional() @IsString() resourceId?: string;
  @IsOptional() @IsString() assignedToId?: string;
  @IsOptional() @IsString() workCenterId?: string;
}

export class CompleteWorkOrderDto {
  @IsOptional() @IsNumber() @Min(0) qtyGood?: number;
  @IsOptional() @IsNumber() @Min(0) qtyScrap?: number;
  /** Override the timer-accumulated labour minutes. */
  @IsOptional() @IsInt() @Min(0) labourMins?: number;
  @IsOptional() @IsString() notes?: string;
}
