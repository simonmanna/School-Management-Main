import { IsString, IsOptional, IsIn, IsDateString } from 'class-validator';
import { ASSIGNMENT_ENTITY_TYPES } from '@erp/shared';

export class CreateAssignmentDto {
  @IsOptional() @IsString() assignedToId?: string;
  @IsOptional() @IsIn(ASSIGNMENT_ENTITY_TYPES) assignedToType?: string;
  @IsOptional() @IsString() assignedToName?: string;
  @IsOptional() @IsDateString() assignedDate?: string;
  @IsOptional() @IsDateString() returnedDate?: string;
  @IsOptional() @IsString() conditionBefore?: string;
  @IsOptional() @IsString() conditionAfter?: string;
  @IsOptional() @IsString() responsiblePerson?: string;
  @IsOptional() @IsString() notes?: string;
}
