import { IsString, IsOptional, IsBoolean, IsInt, IsUUID, IsArray, ValidateNested, IsDateString, IsNumber, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateTaskDto {
  @ApiProperty() @IsString() title!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;

  @ApiPropertyOptional({ enum: ['ONE_TIME','RECURRING','SHIFT','OPENING','CLOSING','CLEANING','MAINTENANCE','INVENTORY','AUDIT','PURCHASE','INCIDENT','COMPLIANCE','FOOD_SAFETY','EQUIPMENT_INSPECTION','CUSTOM'] })
  @IsOptional() @IsString() taskType?: string;

  @ApiPropertyOptional({ enum: ['CRITICAL','HIGH','MEDIUM','LOW','OPTIONAL'] })
  @IsOptional() @IsString() priority?: string;

  @ApiPropertyOptional({ enum: ['DRAFT','PENDING','ASSIGNED','IN_PROGRESS','WAITING','REVIEW','VERIFIED','COMPLETED','CANCELLED','SKIPPED','OVERDUE'] })
  @IsOptional() @IsString() status?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() category?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() area?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() assignedToId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() supervisorId?: string;

  @ApiPropertyOptional() @IsOptional() @IsDateString() dueDate?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() dueTime?: string;

  @ApiPropertyOptional() @IsOptional() @IsInt() estimatedMinutes?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isRecurring?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() requiresVerification?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString() verificationMethod?: string;
}

export class UpdateTaskDto {
  @ApiPropertyOptional() @IsOptional() @IsString() title?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() taskType?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() priority?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() category?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() area?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() assignedToId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() supervisorId?: string;

  @ApiPropertyOptional() @IsOptional() @IsDateString() dueDate?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() dueTime?: string;

  @ApiPropertyOptional() @IsOptional() @IsInt() estimatedMinutes?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isRecurring?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() requiresVerification?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString() verificationMethod?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() generatedByEvent?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() sourceReferenceId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() sourceReferenceType?: string;
}

export class ReorderTaskDto {
  @ApiProperty() @IsString() status!: string;
}

export class TaskQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() priority?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() category?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() area?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() branchId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() assignedToId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() search?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() dateFrom?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() dateTo?: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number = 50;
}

export class CreateCommentDto {
  @ApiProperty() @IsString() content!: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() parentId?: string;

  @ApiPropertyOptional() @IsOptional() @IsArray() @IsString({ each: true }) mentions?: string[];

  @ApiPropertyOptional() @IsOptional() @IsArray() @IsString({ each: true }) attachmentUrls?: string[];
}

export class CreateLabelDto {
  @ApiProperty() @IsString() name!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() color?: string;
}

export class CreateTaskRuleDto {
  @ApiProperty() @IsString() name!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;

  @ApiProperty() @IsString() triggerEvent!: string;

  @ApiPropertyOptional() @IsOptional() triggerConfig?: Record<string, unknown>;

  @ApiProperty() @IsString() taskTitle!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() taskDescription?: string;

  @ApiProperty() @IsString() taskType!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() taskCategory?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() taskArea?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() taskPriority?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() assignToRole?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() assignToUserId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() requiresVerification?: boolean;
}

export class CreateTemplateDto {
  @ApiProperty() @IsString() title!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() taskType?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() taskCategory?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() taskArea?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() priority?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() recurrenceType?: string;

  @ApiPropertyOptional() @IsOptional() recurrenceConfig?: Record<string, unknown>;

  @ApiPropertyOptional() @IsOptional() @IsInt() estimatedMinutes?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() requiresVerification?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString() verificationMethod?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() assignToRole?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() assignToUserId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() supervisorId?: string;

  @ApiPropertyOptional() @IsOptional() checklistTemplate?: Array<{ description: string; sortOrder: number }>;
}
