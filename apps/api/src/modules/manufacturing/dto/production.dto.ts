import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { STOCK_DISTRIBUTION_STRATEGIES, type StockDistributionStrategy } from '@erp/shared';

/** Ad-hoc material line (orders created without a BOM). */
export class ProductionMaterialInputDto {
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
  batchNumber?: string;

  @IsOptional()
  @IsIn([...STOCK_DISTRIBUTION_STRATEGIES])
  distStrategy?: StockDistributionStrategy;
}

/** Ad-hoc / byproduct output line. */
export class ProductionOutputInputDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  /** 'output' (default) or 'byproduct'. */
  @IsOptional()
  @IsIn(['output', 'byproduct'])
  kind?: 'output' | 'byproduct';

  @IsNumber()
  @Min(0)
  qtyExpected!: number;

  @IsOptional()
  @IsString()
  uomId?: string;

  /** Byproducts only: % of the cost pool this line absorbs. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  costAllocationPct?: number;
}

export class CreateProductionOrderDto {
  /** Named BOM. Omit to use the output product's default BOM, or for an ad-hoc order. */
  @IsOptional()
  @IsString()
  bomId?: string;

  /** Required when there is no bomId (ad-hoc order). */
  @IsOptional()
  @IsString()
  outputProductId?: string;

  @IsOptional()
  @IsString()
  outputVariantId?: string;

  /** Where materials are consumed. Optional — falls back to the BOM's
   *  defaultLocationId; the service errors if neither resolves. */
  @IsOptional()
  @IsString()
  locationId?: string;

  /** Where finished goods land. Null → the POS warehouse (resolved in the service). */
  @IsOptional()
  @IsString()
  outputLocationId?: string;

  /** Multiples of the BOM batch size. Exactly one of runs / plannedQty is required. */
  @IsOptional()
  @IsNumber()
  @IsPositive()
  runs?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  plannedQty?: number;

  @IsOptional()
  @IsDateString()
  scheduledFor?: string;

  @IsOptional()
  @IsString()
  batchNumber?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsOptional()
  @IsDateString()
  mfgDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /** Ad-hoc material lines (only used when bomId is absent). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductionMaterialInputDto)
  materials?: ProductionMaterialInputDto[];

  /** Extra / byproduct output lines. The main output is derived from the order. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductionOutputInputDto)
  outputs?: ProductionOutputInputDto[];
}

/** Per-material actual consumption override at start. */
export class StartMaterialInputDto {
  @IsString()
  @IsNotEmpty()
  lineId!: string;

  @IsNumber()
  @Min(0)
  qtyConsumed!: number;

  @IsOptional()
  @IsString()
  batchNumber?: string;
}

export class StartProductionDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StartMaterialInputDto)
  materials?: StartMaterialInputDto[];

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

/** Per-output actual produced override at complete. */
export class CompleteOutputInputDto {
  @IsString()
  @IsNotEmpty()
  lineId!: string;

  @IsNumber()
  @Min(0)
  qtyProduced!: number;

  @IsOptional()
  @IsString()
  batchNumber?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;
}

export class CompleteProductionDto {
  /** Actual good units produced (in uomId, else the output base unit). */
  @IsNumber()
  @IsPositive()
  qtyProduced!: number;

  @IsOptional()
  @IsString()
  uomId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CompleteOutputInputDto)
  outputs?: CompleteOutputInputDto[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  scrapQty?: number;

  @IsOptional()
  @IsString()
  batchNumber?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsOptional()
  @IsDateString()
  mfgDate?: string;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CancelProductionDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

/** QC inspection of a qc_hold order: pass units to the sale location, scrap fails. */
export class RecordQcDto {
  @IsNumber()
  @Min(0)
  passedQty!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  failedQty?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  reworkQty?: number;

  /** Waste reason for the failed units (e.g. 'qc_rejection', 'burnt'). */
  @IsOptional()
  @IsString()
  wasteCategory?: string;

  @IsOptional()
  @IsArray()
  checklist?: unknown[];

  @IsOptional()
  @IsString()
  notes?: string;
}
