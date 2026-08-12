import { IsString, IsOptional, IsNumber, IsIn, IsBoolean, IsDateString } from 'class-validator';
import { ASSET_STATUSES, ACQUISITION_METHODS } from '@erp/shared';

export class UpdateAssetDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() assetCode?: string;
  @IsOptional() @IsString() barcode?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() serialNumber?: string;
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() manufacturer?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() department?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() assignedToId?: string;
  @IsOptional() @IsString() assignedToType?: string;
  @IsOptional() @IsDateString() assignmentDate?: string;
  @IsOptional() @IsDateString() purchaseDate?: string;
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsString() invoiceNumber?: string;
  @IsOptional() @IsNumber() purchaseCost?: number;
  @IsOptional() @IsNumber() currentValue?: number;
  @IsOptional() @IsNumber() salvageValue?: number;
  @IsOptional() @IsNumber() usefulLife?: number;
  @IsOptional() @IsString() usefulLifeUnit?: string;
  @IsOptional() @IsIn(ACQUISITION_METHODS) acquisitionMethod?: string;
  @IsOptional() @IsNumber() capitalizedCost?: number;
  @IsOptional() @IsString() image?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsIn(ASSET_STATUSES) status?: string;
}
