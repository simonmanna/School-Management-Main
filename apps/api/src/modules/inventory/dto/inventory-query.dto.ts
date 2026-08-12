import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../../kernel/common/pagination.dto';

export class InventoryQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  lowStock?: string;

  @IsOptional()
  @IsString()
  outOfStock?: string;
}
