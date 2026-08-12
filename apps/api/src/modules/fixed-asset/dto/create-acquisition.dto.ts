import { IsString, IsOptional, IsNumber, IsDateString } from 'class-validator';

export class CreateAcquisitionDto {
  @IsOptional() @IsString() vendor?: string;
  @IsOptional() @IsString() vendorId?: string;
  @IsOptional() @IsString() purchaseOrderId?: string;
  @IsOptional() @IsString() invoiceId?: string;
  @IsOptional() @IsNumber() taxes?: number;
  @IsOptional() @IsNumber() freight?: number;
  @IsOptional() @IsNumber() installationCost?: number;
  @IsOptional() @IsNumber() otherCosts?: number;
  @IsOptional() @IsNumber() capitalizedCost?: number;
  @IsOptional() @IsDateString() acquisitionDate?: string;
  @IsOptional() @IsString() notes?: string;
}
