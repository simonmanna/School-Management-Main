import { IsEnum, IsOptional, IsString, IsNotEmpty } from 'class-validator';
import { ComplaintCategory, ComplaintStatus, ComplaintPriority } from '@prisma/client';

export class CreateComplaintDto {
  @IsOptional() @IsString() partnerId?: string;
  @IsEnum(ComplaintCategory) category!: ComplaintCategory;
  @IsString() @IsNotEmpty() subject!: string;
  @IsString() @IsNotEmpty() description!: string;
  @IsOptional() @IsEnum(ComplaintStatus) status?: ComplaintStatus;
  @IsOptional() @IsEnum(ComplaintPriority) priority?: ComplaintPriority;
  @IsOptional() @IsString() assignedToId?: string;
  @IsOptional() @IsString() resolution?: string;
  @IsOptional() @IsString() receivedAt?: string;
}

export class UpdateComplaintDto {
  @IsOptional() @IsEnum(ComplaintCategory) category?: ComplaintCategory;
  @IsOptional() @IsString() @IsNotEmpty() subject?: string;
  @IsOptional() @IsString() @IsNotEmpty() description?: string;
  @IsOptional() @IsEnum(ComplaintStatus) status?: ComplaintStatus;
  @IsOptional() @IsEnum(ComplaintPriority) priority?: ComplaintPriority;
  @IsOptional() @IsString() assignedToId?: string;
  @IsOptional() @IsString() resolution?: string;
  @IsOptional() @IsString() receivedAt?: string;
}