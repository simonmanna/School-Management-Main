import { Type } from 'class-transformer';
import { IsInt, Min, Max, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { LOCATION_TYPES, DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@erp/shared';
import { type LocationType } from '@erp/shared';

export class LocationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = DEFAULT_PAGE;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = DEFAULT_PAGE_SIZE;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @IsOptional()
  @IsIn([...LOCATION_TYPES])
  type?: LocationType;
}

export class CreateLocationDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsIn([...LOCATION_TYPES])
  type?: LocationType;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateLocationDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn([...LOCATION_TYPES])
  type?: LocationType;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
