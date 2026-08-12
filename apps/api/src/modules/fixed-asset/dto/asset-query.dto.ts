import { IsOptional, IsString, IsIn } from 'class-validator';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { ASSET_STATUSES } from '@erp/shared';

export class AssetQueryDto extends PaginationDto {
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsIn(ASSET_STATUSES) status?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() department?: string;
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsString() location?: string;
}
