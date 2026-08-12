import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  COSTING_METHODS,
  MEASUREMENT_METHODS,
  PRODUCT_TYPES,
  STOCK_DISTRIBUTION_STRATEGIES,
  type CostingMethod,
  type MeasurementMethod,
  type ProductType,
  type StockDistributionStrategy,
} from '@erp/shared';
import { PackagingDto } from './packaging.dto';

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn([...PRODUCT_TYPES])
  productType?: ProductType;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  uomId?: string;

  // ---- UOM roles + purchasing/sale rules ----
  @IsOptional()
  @IsString()
  purchaseUomId?: string;

  @IsOptional()
  @IsString()
  salesUomId?: string;

  @IsOptional()
  @IsString()
  recipeUomId?: string;

  @IsOptional()
  @IsString()
  productionUomId?: string;

  @IsOptional()
  @IsNumber()
  uomConversion?: number;

  @IsOptional()
  @IsNumber()
  reorderQty?: number;

  /** KDS routing: the KitchenStation.code this product's tickets go to. */
  @IsOptional()
  @IsString()
  station?: string;

  @IsOptional()
  @IsBoolean()
  allowFractionalSale?: boolean;

  @IsOptional()
  @IsNumber()
  minSaleQty?: number;

  @IsOptional()
  @IsNumber()
  maxSaleQty?: number;

  /** Packaging rows (name + qty-of-base + optional barcode). Replaces the set on save. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PackagingDto)
  packagings?: PackagingDto[];

  @IsOptional()
  @IsString()
  taxId?: string;

  @IsOptional()
  @IsNumber()
  salesPrice?: number;

  @IsOptional()
  @IsNumber()
  costPrice?: number;

  @IsOptional()
  @IsBoolean()
  trackInventory?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsIn([...COSTING_METHODS])
  costingMethod?: CostingMethod;

  // ---- Inventory tracking configuration ----
  @IsOptional()
  @IsBoolean()
  batchTracking?: boolean;

  @IsOptional()
  @IsBoolean()
  expiryTracking?: boolean;

  @IsOptional()
  @IsBoolean()
  serialTracking?: boolean;

  @IsOptional()
  @IsIn([...STOCK_DISTRIBUTION_STRATEGIES])
  pickingStrategy?: StockDistributionStrategy;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsObject()
  customFields?: Record<string, unknown>;

  // ---- Beverage Control (bar alcohol) — digital-weight measurement ----
  @IsOptional()
  @IsIn([...MEASUREMENT_METHODS])
  measurementMethod?: MeasurementMethod;

  @IsOptional()
  @IsNumber()
  containerVolumeMl?: number;

  @IsOptional()
  @IsNumber()
  emptyBottleWeightG?: number;

  @IsOptional()
  @IsNumber()
  actualEmptyWeightG?: number;

  @IsOptional()
  @IsNumber()
  fullBottleWeightG?: number;

  @IsOptional()
  @IsNumber()
  standardPourMl?: number;

  @IsOptional()
  @IsBoolean()
  allowPartialBottle?: boolean;

  @IsOptional()
  @IsNumber()
  varianceToleranceG?: number;
}
