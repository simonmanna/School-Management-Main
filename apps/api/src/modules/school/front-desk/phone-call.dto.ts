import { IsEnum, IsOptional, IsString, IsNotEmpty, IsInt, Min } from 'class-validator';
import { CallDirection, CallStatus } from '@prisma/client';

export class CreatePhoneCallDto {
  @IsOptional() @IsString() partnerId?: string;
  @IsEnum(CallDirection) direction!: CallDirection;
  @IsString() @IsNotEmpty() contactName!: string;
  @IsString() @IsNotEmpty() phone!: string;
  @IsOptional() @IsString() subject?: string;
  @IsOptional() @IsString() outcome?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsInt() @Min(0) durationSec?: number;
  @IsOptional() @IsEnum(CallStatus) status?: CallStatus;
  @IsOptional() @IsString() callAt?: string;
}

export class UpdatePhoneCallDto {
  @IsOptional() @IsEnum(CallDirection) direction?: CallDirection;
  @IsOptional() @IsString() @IsNotEmpty() contactName?: string;
  @IsOptional() @IsString() @IsNotEmpty() phone?: string;
  @IsOptional() @IsString() subject?: string;
  @IsOptional() @IsString() outcome?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsInt() @Min(0) durationSec?: number;
  @IsOptional() @IsEnum(CallStatus) status?: CallStatus;
  @IsOptional() @IsString() callAt?: string;
}