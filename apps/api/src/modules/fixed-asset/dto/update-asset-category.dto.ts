import { IsString, IsOptional, IsNumber, IsBoolean, IsIn } from 'class-validator';
import { DEPRECIATION_METHODS } from '@erp/shared';

export class UpdateAssetCategoryDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() parentId?: string;
  @IsOptional() @IsIn(DEPRECIATION_METHODS) depreciationMethod?: string;
  @IsOptional() @IsNumber() defaultUsefulLife?: number;
  @IsOptional() @IsNumber() defaultResidualValue?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
