/**
 * DTOs for the Examinations module.
 *
 * H2/B6: class-validator classes (were bare interfaces). Import as values.
 */
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateExamTypeDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsNumber() @Min(0) weight!: number;
  @IsOptional() @IsBoolean() isFinal?: boolean;
}

export class UpdateExamTypeDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsNumber() @Min(0) weight?: number;
  @IsOptional() @IsBoolean() isFinal?: boolean;
}

export class CreateExamDto {
  @IsString() @IsNotEmpty() termId!: string;
  @IsString() @IsNotEmpty() examTypeId!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsNotEmpty() startDate!: string;
  @IsString() @IsNotEmpty() endDate!: string;

  /** Class IDs the exam applies to. */
  @IsArray()
  @IsString({ each: true })
  classes!: string[];
}

export class UpdateExamDto {
  @IsOptional() @IsString() @IsNotEmpty() termId?: string;
  @IsOptional() @IsString() @IsNotEmpty() examTypeId?: string;
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() endDate?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) classes?: string[];
}

export class CreateExamScheduleDto {
  @IsString() @IsNotEmpty() examId!: string;
  @IsString() @IsNotEmpty() classId!: string;
  @IsString() @IsNotEmpty() subjectId!: string;
  @IsString() @IsNotEmpty() date!: string;
  @IsString() @IsNotEmpty() startTime!: string; // 'HH:mm'
  @IsOptional() @IsInt() @Min(1) durationMinutes?: number;
  @IsOptional() @IsString() invigilatorId?: string;
  @IsOptional() @IsNumber() @Min(0) maxMarks?: number;
}

export class UpdateExamScheduleDto {
  @IsOptional() @IsString() @IsNotEmpty() examId?: string;
  @IsOptional() @IsString() @IsNotEmpty() classId?: string;
  @IsOptional() @IsString() @IsNotEmpty() subjectId?: string;
  @IsOptional() @IsString() date?: string;
  @IsOptional() @IsString() startTime?: string;
  @IsOptional() @IsInt() @Min(1) durationMinutes?: number;
  @IsOptional() @IsString() invigilatorId?: string;
  @IsOptional() @IsNumber() @Min(0) maxMarks?: number;
}

export class GradeEntryInput {
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsNumber() @Min(0) marksObtained!: number;
  @IsOptional() @IsNumber() @Min(0) maxMarks?: number;
  @IsOptional() @IsString() remarks?: string;
}

export class BulkGradeEntryDto {
  @IsString() @IsNotEmpty() examScheduleId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GradeEntryInput)
  entries!: GradeEntryInput[];
}

export class GradeEntryUpdateDto {
  @IsOptional() @IsNumber() @Min(0) marksObtained?: number;
  @IsOptional() @IsNumber() @Min(0) maxMarks?: number;
  @IsOptional() @IsString() remarks?: string;
}

export class GradingBand {
  @IsNumber() min!: number;
  @IsNumber() max!: number;
  @IsString() @IsNotEmpty() grade!: string;
  @IsNumber() @Min(0) gpa!: number;
  @IsOptional() @IsString() remark?: string;
}

export class CreateGradingScaleDto {
  @IsString() @IsNotEmpty() name!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GradingBand)
  bands!: GradingBand[];

  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class UpdateGradingScaleDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GradingBand)
  bands?: GradingBand[];
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class GenerateReportCardDto {
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsString() @IsNotEmpty() termId!: string;
}
