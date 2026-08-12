import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { LOCATION_TYPES, type LocationType } from '@erp/shared';

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
