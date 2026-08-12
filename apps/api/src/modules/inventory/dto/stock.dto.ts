import {
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';
import {
  STOCK_MOVE_TYPES,
  STOCK_DISTRIBUTION_STRATEGIES,
  type StockMoveType,
  type StockDistributionStrategy,
} from '@erp/shared';

export class ReceiveStockDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsString()
  @IsNotEmpty()
  locationId!: string;

  @IsNumber()
  @IsPositive()
  quantity!: number;

  @IsOptional()
  @IsNumber()
  unitCost?: number;

  /// Unit the `quantity` and `unitCost` are expressed in. When set and different
  /// from the product's base unit, both are converted to base on receipt (total
  /// value preserved). Omit for base-unit receipts.
  @IsOptional()
  @IsString()
  uomId?: string;

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
  reference?: string;

  @IsOptional()
  @IsString()
  sourceType?: string;

  @IsOptional()
  @IsString()
  sourceId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /// Ledger move type to record (default 'receipt'). Return flows pass
  /// 'return_in' so restocked units are distinguishable from purchase receipts.
  @IsOptional()
  @IsIn([...STOCK_MOVE_TYPES])
  moveType?: StockMoveType;

  /// Serial numbers captured for a serial-tracked product (one per unit; length
  /// must equal quantity). Ignored for non-serial products.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serialNumbers?: string[];
}

/** Receipt driven by a vendor bill. Posts Dr Stock / Cr GRNI inside the bill's transaction. */
export class ReceiveFromBillDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @IsString()
  @IsNotEmpty()
  locationId!: string;

  @IsNumber()
  @IsPositive()
  quantity!: number;

  @IsNumber()
  @Min(0)
  unitCost!: number;

  @IsString()
  @IsNotEmpty()
  billId!: string;

  @IsDateString()
  billDate!: string;

  @IsOptional()
  @IsString()
  batchNumber?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /// Serial numbers captured for a serial-tracked product (one per received unit).
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serialNumbers?: string[];
}

export class IssueStockDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsString()
  @IsNotEmpty()
  locationId!: string;

  @IsNumber()
  @IsPositive()
  quantity!: number;

  /// Unit the `quantity` is expressed in; converted to the product base unit on
  /// issue (e.g. a recipe line in grams for a kg-based ingredient). Omit for base.
  @IsOptional()
  @IsString()
  uomId?: string;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  sourceType?: string;

  @IsOptional()
  @IsString()
  sourceId?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /// Ledger move type to record (default 'issue'). Doc wrappers pass 'waste',
  /// 'expiry_write_off', 'return_to_supplier', etc.
  @IsOptional()
  @IsIn([...STOCK_MOVE_TYPES])
  moveType?: StockMoveType;

  /// Quantitative-only issue: decrement stock + write the ledger row but skip the
  /// Dr COGS / Cr Stock Valuation GL posting. Used by return-to-vendor, where the
  /// calling document (debit note) owns the balanced Dr AP / Cr Stock Valuation JE.
  @IsOptional()
  skipGlPosting?: boolean;

  /// Batch distribution strategy for batch-tracked products.
  @IsOptional()
  @IsIn([...STOCK_DISTRIBUTION_STRATEGIES])
  distStrategy?: StockDistributionStrategy;

  /// MANUAL strategy: consume only from this batch number.
  @IsOptional()
  @IsString()
  batchNumber?: string;

  /// SERIAL strategy / serial-tracked product: the exact serial numbers to issue
  /// (one per unit; length must equal quantity).
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serialNumbers?: string[];
}

export class AdjustStockDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsString()
  @IsNotEmpty()
  locationId!: string;

  @IsNumber()
  @Min(0)
  countedQuantity!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class TransferStockDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsString()
  @IsNotEmpty()
  fromLocationId!: string;

  @IsString()
  @IsNotEmpty()
  toLocationId!: string;

  @IsNumber()
  @IsPositive()
  quantity!: number;

  @IsOptional()
  @IsString()
  sourceType?: string;

  @IsOptional()
  @IsString()
  sourceId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}