import { IsString, IsOptional, IsNumber, IsIn, IsDateString, IsArray } from 'class-validator';
import { MAINTENANCE_TYPES } from '@erp/shared';

export class CreateMaintenanceDto {
  @IsOptional() @IsIn(MAINTENANCE_TYPES) maintenanceType?: string;
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() technician?: string;
  @IsOptional() @IsString() vendor?: string;
  @IsOptional() @IsDateString() scheduledDate?: string;
  @IsOptional() @IsDateString() completedDate?: string;
  @IsOptional() @IsNumber() cost?: number;
  @IsOptional() @IsDateString() nextMaintenanceDate?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() notes?: string;
}
