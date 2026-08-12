import { IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';

/** A named pack = a quantity of the product's base unit, with an optional barcode. */
export class PackagingDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  name!: string;

  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
