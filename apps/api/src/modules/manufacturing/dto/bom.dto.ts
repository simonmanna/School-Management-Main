import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * A BOM line. `quantity` is per ONE RUN of the BOM (per outputQuantity), not per
 * output unit — matching how a baker writes a recipe. Note: overheadCost is
 * deliberately NOT accepted anywhere in this DTO; it must stay 0 in Phase 1 so
 * the WIP-flat invariant holds, and the global forbidNonWhitelisted pipe rejects
 * any attempt to set it.
 */
export class BomLineInputDto {
  @IsString()
  @IsNotEmpty()
  componentProductId!: string;

  @IsOptional()
  @IsString()
  componentVariantId?: string;

  @IsNumber()
  @IsPositive()
  quantity!: number;

  @IsOptional()
  @IsString()
  uomId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  scrapPct?: number;

  @IsOptional()
  @IsInt()
  sequence?: number;

  @IsOptional()
  @IsBoolean()
  isOptional?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateBomDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  outputProductId!: string;

  @IsOptional()
  @IsString()
  outputVariantId?: string;

  /** Units of the output produced by ONE run (the batch size). */
  @IsNumber()
  @IsPositive()
  outputQuantity!: number;

  @IsOptional()
  @IsString()
  outputUomId?: string;

  /** Expected good output as % of planned (95 = 5% normal loss). Reporting only. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  expectedYieldPct?: number;

  /** Fixed overhead absorbed per run (Phase 4). Absorbed into WIP on complete
   *  via Dr WIP / Cr Overhead Absorbed, keeping the WIP-flat invariant. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  overheadCost?: number;

  @IsOptional()
  @IsString()
  defaultLocationId?: string;

  @IsOptional()
  @IsString()
  defaultOutputLocationId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  shelfLifeDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  estimatedDurationMins?: number;

  @IsOptional()
  @IsBoolean()
  qcRequired?: boolean;

  /** Make this the default recipe for the output product. */
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BomLineInputDto)
  lines!: BomLineInputDto[];
}

/**
 * Edit a DRAFT BOM. An `active` BOM is immutable — the service rejects updates
 * to it and the UI forks a new version instead. All fields optional; `lines`,
 * when present, fully replaces the line set (delete-all-then-recreate).
 */
export class UpdateBomDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  outputQuantity?: number;

  @IsOptional()
  @IsString()
  outputUomId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  expectedYieldPct?: number;

  @IsOptional()
  @IsString()
  defaultLocationId?: string;

  @IsOptional()
  @IsString()
  defaultOutputLocationId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  shelfLifeDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  estimatedDurationMins?: number;

  @IsOptional()
  @IsBoolean()
  qcRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BomLineInputDto)
  lines?: BomLineInputDto[];
}
