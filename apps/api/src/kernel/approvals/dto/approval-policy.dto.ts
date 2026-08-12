import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateApprovalPolicyDto {
  @ApiProperty({ example: 'PO Approval' })
  @IsString()
  name!: string;

  @ApiProperty({ example: 'purchase_order' })
  @IsString()
  entityType!: string;

  @ApiPropertyOptional({ example: 500, description: 'Amount threshold; null = any amount' })
  @IsOptional()
  @IsNumber()
  minAmount?: number;

  @ApiProperty({ example: ['purchase_order:approve'] })
  @IsString({ each: true })
  approverPermissions!: string[];

  @ApiProperty({ example: 1, default: 1 })
  @IsInt()
  @Min(1)
  requiredCount!: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateApprovalPolicyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  minAmount?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ each: true })
  approverPermissions?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  requiredCount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
