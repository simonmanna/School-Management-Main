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
  // A4 session detail.
  @IsOptional() @IsInt() @Min(1) paperNumber?: number;
  @IsOptional() @IsString() sitting?: string;
  @IsOptional() @IsBoolean() isResit?: boolean;
  @IsOptional() @IsString() venueId?: string;
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
  @IsOptional() @IsInt() @Min(1) paperNumber?: number;
  @IsOptional() @IsString() sitting?: string;
  @IsOptional() @IsBoolean() isResit?: boolean;
  @IsOptional() @IsString() venueId?: string;
}

export class GradeEntryInput {
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsNumber() @Min(0) marksObtained!: number;
  @IsOptional() @IsNumber() @Min(0) maxMarks?: number;
  @IsOptional() @IsString() remarks?: string;
  /**
   * A0: optimistic-concurrency guard. When present, the upsert only overwrites
   * an existing row whose `version` still matches — a stale editor gets a 409
   * instead of silently clobbering a concurrent edit. Omitted on first entry.
   */
  @IsOptional() @IsInt() @Min(0) version?: number;
}

export class RejectGradesDto {
  @IsString() @IsNotEmpty() reason!: string;
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

/**
 * Generate every card for a class in one action.
 *
 * A Ugandan primary class is 50–80 pupils and a term ends with all of them at
 * once. One-at-a-time generation meant an administrator clicking through the
 * whole register three times a year, so this is the shape the work actually has.
 */
export class GenerateClassReportCardsDto {
  @IsString() @IsNotEmpty() classId!: string;
  @IsString() @IsNotEmpty() termId!: string;
  /** Optional stream filter, so one stream can be done at a time. */
  @IsOptional() @IsString() sectionId?: string;
}

export class ClassReportCardPdfDto {
  @IsString() @IsNotEmpty() classId!: string;
  @IsString() @IsNotEmpty() termId!: string;
  @IsOptional() @IsString() sectionId?: string;
}

export class UpdateReportCardCommentDto {
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsString() @IsNotEmpty() termId!: string;
  /// Class teacher's narrative for this student's report card.
  @IsOptional() @IsString() classTeacherComment?: string;
  /// Head teacher / principal's narrative.
  @IsOptional() @IsString() principalComment?: string;
  /// Competency levels keyed by competencyId (CBC strand outcomes), e.g.
  /// { "comp_1": "proficient", "comp_2": "emerging" }.
  @IsOptional() competencyLevels?: Record<string, string>;
}
