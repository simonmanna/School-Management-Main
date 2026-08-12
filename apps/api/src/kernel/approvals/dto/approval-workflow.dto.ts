import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class ApprovalStepDto {
  @ApiProperty({ example: 1, description: '1-based order; steps clear low→high' })
  @IsInt()
  @Min(1)
  stepOrder!: number;

  @ApiProperty({ example: 'Finance' })
  @IsString()
  name!: string;

  @ApiProperty({ example: ['finance:approve'], description: 'Any-of; who may decide this step' })
  @IsString({ each: true })
  approverPermissions!: string[];

  @ApiProperty({ example: 1, default: 1 })
  @IsInt()
  @Min(1)
  requiredCount!: number;

  @ApiPropertyOptional({ example: 5000, description: 'Step active when amount >= this' })
  @IsOptional()
  @IsNumber()
  minAmount?: number | null;

  @ApiPropertyOptional({ example: 20000, description: 'Step active when amount < this' })
  @IsOptional()
  @IsNumber()
  maxAmount?: number | null;
}

export class CreateApprovalWorkflowDto {
  @ApiProperty({ example: 'PO Approval' })
  @IsString()
  name!: string;

  @ApiProperty({ example: 'purchase_order' })
  @IsString()
  entityType!: string;

  @ApiPropertyOptional({ example: 500, description: 'Workflow applies only if amount >= this' })
  @IsOptional()
  @IsNumber()
  minAmount?: number | null;

  @ApiPropertyOptional({ default: false, description: 'Block an approver from clearing more than one step' })
  @IsOptional()
  @IsBoolean()
  enforceDistinctApprovers?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ type: [ApprovalStepDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApprovalStepDto)
  steps!: ApprovalStepDto[];
}

export class UpdateApprovalWorkflowDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  entityType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  minAmount?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enforceDistinctApprovers?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ type: [ApprovalStepDto], description: 'If provided, replaces the entire step list' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApprovalStepDto)
  steps?: ApprovalStepDto[];
}
