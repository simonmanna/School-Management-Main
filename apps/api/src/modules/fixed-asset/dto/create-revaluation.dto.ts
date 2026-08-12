import { IsString, IsOptional, IsNumber, IsDateString } from 'class-validator';

export class CreateRevaluationDto {
  @IsNumber() previousValue!: number;
  @IsNumber() newValue!: number;
  @IsOptional() @IsDateString() revaluationDate?: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() approvedBy?: string;
  @IsOptional() @IsString() notes?: string;
}
