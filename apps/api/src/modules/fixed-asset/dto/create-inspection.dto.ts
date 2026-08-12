import { IsString, IsOptional, IsBoolean, IsDateString } from 'class-validator';

export class CreateInspectionDto {
  @IsOptional() @IsString() inspector?: string;
  @IsOptional() @IsDateString() inspectionDate?: string;
  @IsOptional() @IsString() condition?: string;
  @IsOptional() @IsBoolean() isWorking?: boolean;
  @IsOptional() @IsBoolean() isDamaged?: boolean;
  @IsOptional() @IsBoolean() isMissing?: boolean;
  @IsOptional() @IsBoolean() requiresRepair?: boolean;
  @IsOptional() @IsString() notes?: string;
}
