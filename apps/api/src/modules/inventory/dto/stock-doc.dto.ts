import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import {
  STOCK_OUT_CATEGORIES,
  WASTE_CATEGORIES,
  STOCK_ADJUSTMENT_REASONS,
  STOCK_DISTRIBUTION_STRATEGIES,
  type StockOutCategory,
  type WasteCategory,
  type StockAdjustmentReason,
  type StockDistributionStrategy,
} from '@erp/shared';

// ---------------------------------------------------------------------------
// Shared line bits
// ---------------------------------------------------------------------------

class BaseStockLineDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  batchNumber?: string;
}

// ---------------------------------------------------------------------------
// StockOut (internal use / testing / sample / comp)
// ---------------------------------------------------------------------------

export class StockOutItemDto extends BaseStockLineDto {
  @IsNumber()
  qty!: number;

  @IsOptional()
  @IsIn([...STOCK_DISTRIBUTION_STRATEGIES])
  distStrategy?: StockDistributionStrategy;
}

export class CreateStockOutDto {
  @IsString()
  @IsNotEmpty()
  locationId!: string;

  @IsOptional()
  @IsIn([...STOCK_OUT_CATEGORIES])
  category?: StockOutCategory;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StockOutItemDto)
  items!: StockOutItemDto[];
}

// ---------------------------------------------------------------------------
// WasteRecord (spoilage / expiry / breakage)
// ---------------------------------------------------------------------------

export class WasteItemDto extends BaseStockLineDto {
  @IsNumber()
  qty!: number;

  /** true → post EXPIRY_WRITE_OFF instead of WASTE. */
  @IsOptional()
  @IsBoolean()
  isExpiry?: boolean;
}

export class CreateWasteDto {
  @IsString()
  @IsNotEmpty()
  locationId!: string;

  @IsOptional()
  @IsIn([...WASTE_CATEGORIES])
  category?: WasteCategory;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => WasteItemDto)
  items!: WasteItemDto[];
}

// ---------------------------------------------------------------------------
// StockAdjustment (cycle count)
// ---------------------------------------------------------------------------

export class StockAdjustmentItemDto extends BaseStockLineDto {
  /** Counted on-hand. The system qty + diff are computed server-side. */
  @IsNumber()
  qtyActual!: number;
}

export class CreateStockAdjustmentDto {
  @IsString()
  @IsNotEmpty()
  locationId!: string;

  @IsOptional()
  @IsIn([...STOCK_ADJUSTMENT_REASONS])
  reason?: StockAdjustmentReason;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StockAdjustmentItemDto)
  items!: StockAdjustmentItemDto[];
}

// ---------------------------------------------------------------------------
// StockTransfer (inter-location)
// ---------------------------------------------------------------------------

export class StockTransferItemDto extends BaseStockLineDto {
  @IsNumber()
  qtyRequested!: number;

  @IsOptional()
  @IsIn([...STOCK_DISTRIBUTION_STRATEGIES])
  distStrategy?: StockDistributionStrategy;
}

export class CreateStockTransferDto {
  @IsString()
  @IsNotEmpty()
  fromLocationId!: string;

  @IsString()
  @IsNotEmpty()
  toLocationId!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StockTransferItemDto)
  items!: StockTransferItemDto[];
}

export class ApproveStockDocDto {
  @IsOptional()
  @IsString()
  notes?: string;
}
