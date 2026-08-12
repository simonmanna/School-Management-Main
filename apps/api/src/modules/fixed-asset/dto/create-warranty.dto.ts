import { IsString, IsOptional, IsDateString } from 'class-validator';

export class CreateWarrantyDto {
  @IsDateString() warrantyStart!: string;
  @IsDateString() warrantyEnd!: string;
  @IsOptional() @IsString() vendor?: string;
  @IsOptional() @IsString() contactPerson?: string;
  @IsOptional() @IsString() contactPhone?: string;
  @IsOptional() @IsString() contactEmail?: string;
  @IsOptional() @IsString() terms?: string;
  @IsOptional() @IsString() coverage?: string;
  @IsOptional() @IsString() notes?: string;
}
