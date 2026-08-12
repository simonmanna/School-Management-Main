import { IsString, IsOptional, IsNumber, IsIn, IsDateString } from 'class-validator';
import { DISPOSAL_METHODS } from '@erp/shared';

export class CreateDisposalDto {
  @IsIn(DISPOSAL_METHODS) disposalMethod!: string;
  @IsOptional() @IsDateString() disposalDate?: string;
  @IsOptional() @IsNumber() disposalValue?: number;
  @IsOptional() @IsString() approvedBy?: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() notes?: string;
}
