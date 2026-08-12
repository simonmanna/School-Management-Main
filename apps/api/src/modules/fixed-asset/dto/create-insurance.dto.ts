import { IsString, IsOptional, IsNumber, IsDateString } from 'class-validator';

export class CreateInsuranceDto {
  @IsOptional() @IsString() policyNumber?: string;
  @IsOptional() @IsString() company?: string;
  @IsOptional() @IsNumber() premium?: number;
  @IsOptional() @IsNumber() coverageAmount?: number;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() renewalDate?: string;
  @IsOptional() @IsString() contactPerson?: string;
  @IsOptional() @IsString() contactPhone?: string;
  @IsOptional() @IsString() notes?: string;
}
