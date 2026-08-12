import { IsOptional, IsString } from 'class-validator';

export class ReceiptSettingsDto {
  @IsOptional() @IsString() businessName?: string;
  @IsOptional() @IsString() addressLine1?: string;
  @IsOptional() @IsString() addressLine2?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() taxId?: string;
  @IsOptional() @IsString() footerMessage?: string;
}
