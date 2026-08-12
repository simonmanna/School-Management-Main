import { IsString, IsOptional, IsNumber, IsDateString } from 'class-validator';

export class CreateRepairDto {
  @IsDateString() breakdownDate!: string;
  @IsOptional() @IsDateString() repairDate?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() vendor?: string;
  @IsOptional() @IsNumber() sparePartsCost?: number;
  @IsOptional() @IsNumber() laborCost?: number;
  @IsOptional() @IsNumber() totalCost?: number;
  @IsOptional() @IsNumber() downtimeHours?: number;
  @IsOptional() @IsString() vendorInvoiceRef?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() notes?: string;
}
