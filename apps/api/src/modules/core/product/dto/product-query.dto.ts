import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../../../kernel/common/pagination.dto';

export class ProductQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  productType?: string;
}
