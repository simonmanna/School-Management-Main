import { IsBoolean, IsOptional, IsString } from 'class-validator';
import type { AddressType } from '@erp/shared';

export class CreateAddressDto {
  @IsString() partnerId!: string;
  @IsOptional() @IsString() type?: AddressType;
  @IsString() line1!: string;
  @IsOptional() @IsString() line2?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() postalCode?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}

export class UpdateAddressDto {
  @IsOptional() @IsString() type?: AddressType;
  @IsOptional() @IsString() line1?: string;
  @IsOptional() @IsString() line2?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() postalCode?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}