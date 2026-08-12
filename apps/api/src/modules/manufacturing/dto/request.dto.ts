import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  ValidateNested,
} from 'class-validator';

export class ProductionRequestLineInputDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsNumber()
  @IsPositive()
  quantity!: number;

  @IsOptional()
  @IsString()
  uomId?: string;

  @IsOptional()
  @IsString()
  bomId?: string;

  @IsOptional()
  @IsDateString()
  neededBy?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateProductionRequestDto {
  @IsOptional()
  @IsDateString()
  neededBy?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ProductionRequestLineInputDto)
  lines!: ProductionRequestLineInputDto[];
}

export class RejectProductionRequestDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

// ---- Plans ----

export class CreateProductionPlanDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /** When true, consolidate all open (submitted/approved) request lines into
   *  plan lines automatically. */
  @IsOptional()
  fromOpenRequests?: boolean;
}

export class ProductionPlanLineInputDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsOptional()
  @IsString()
  bomId?: string;

  @IsNumber()
  @IsPositive()
  targetQty!: number;

  @IsOptional()
  @IsDateString()
  scheduledDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class AddPlanLinesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ProductionPlanLineInputDto)
  lines!: ProductionPlanLineInputDto[];
}
