import {
  IsArray,
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Every kind an assessment can be. Exam and homework are kinds, not systems. */
export const ASSESSMENT_KINDS = [
  'exam',
  'cat',
  'homework',
  'assignment',
  'quiz',
  'classwork',
  'practical',
  'project',
  'oral',
  'observation',
  'activity_of_integration',
  'attendance',
] as const;

/** The five words a teacher uses, not the two enums underneath them. */
export const BOARD_STAGES = ['draft', 'open', 'marking', 'submitted', 'approved', 'returned'] as const;

export class AssessmentBoardQuery {
  @IsString() termId!: string;
  @IsOptional() @IsString() classId?: string;
  @IsOptional() @IsString() subjectId?: string;
  @IsOptional() @IsIn(ASSESSMENT_KINDS as unknown as string[]) kind?: string;
  @IsOptional() @IsIn(BOARD_STAGES as unknown as string[]) status?: string;
  @IsOptional() @IsString() teacherPartnerId?: string;
  @IsOptional() @IsString() courseOfferingId?: string;
  @IsOptional() @IsString() sectionId?: string;
}

export class ReconcileAssessmentContextDto {
  @IsString() courseOfferingId!: string;
  @IsString() rosterId!: string;
  @IsInt() @Min(0) expectedVersion!: number;
  @IsString() @MaxLength(2000) reason!: string;
}

export class ReconcileHomeworkDto {
  @IsString() assessmentId!: string;
  @IsString() @MaxLength(2000) reason!: string;
}

export class CreateUnifiedAssessmentDto {
  @IsIn(ASSESSMENT_KINDS as unknown as string[]) kind!: string;
  @IsOptional() @IsString() classId?: string;
  @IsOptional() @IsString() subjectId?: string;
  @IsString() termId!: string;
  @IsString() @MaxLength(200) title!: string;
  @IsString() courseOfferingId!: string;
  @IsString() rosterId!: string;

  @IsOptional() @IsString() sectionId?: string;
  @IsOptional() @IsNumber() @Min(1) maxScore?: number;
  @IsOptional() @IsNumber() @Min(1) sequence?: number;
  @IsOptional() @IsString() componentId?: string;
  @IsOptional() @IsString() teacherPartnerId?: string;
  @IsOptional() @IsString() description?: string;

  /** Sat-on date for an exam, due date for homework. */
  @IsOptional() @IsDateString() dueAt?: string;
  @IsOptional() @IsDateString() openAt?: string;
  @IsOptional() @IsDateString() closeAt?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) learningOutcomeIds?: string[];
  @IsOptional() @IsIn(['points', 'rubric', 'complete_incomplete']) gradingMode?: 'points' | 'rubric' | 'complete_incomplete';
  @IsOptional() @IsString() rubricId?: string;
  @IsOptional() @IsBoolean() allowLate?: boolean;
  @IsOptional() @IsNumber() @Min(0) @Max(100) latePenaltyPercent?: number;
  @IsOptional() @IsInt() @Min(1) @Max(20) maxAttempts?: number;

  /** kind='exam': the exam this paper belongs to. */
  @IsOptional() @IsString() examId?: string;

  /**
   * kind='exam': fan the paper out across these classes in one go. This is what
   * the old wizard's separate "choose classes" step did.
   */
  @IsOptional() @IsArray() @IsString({ each: true }) classIds?: string[];
}

export class MarkTransitionDto {
  @IsIn(['submit', 'resubmit', 'approve', 'reject'])
  action!: 'submit' | 'resubmit' | 'approve' | 'reject';
  @IsOptional() @IsString() reason?: string;
}

export class SaveBoardMarkDto {
  @IsString() studentProfileId!: string;

  /** null clears the cell. */
  @IsOptional() @IsNumber() marks?: number | null;

  @IsOptional() @IsIn(['present', 'absent', 'exempt', 'missing', 'withdrawn', 'not_enrolled', 'excused', 'malpractice', 'special_consideration'])
  participation?: string;
  @IsOptional() @IsString() @MaxLength(4000) comment?: string;

  /**
   * The version of the row the marker had on screen.
   *
   * `MarkingService.postMark` has always refused a stale write, but only when a
   * caller passed this — and none of the mark-entry screens did, so two teachers
   * on the same paper silently overwrote each other and the guard never once
   * fired in production. Optional so an older client is not broken; every screen
   * in this repo now sends it.
   */
  @IsOptional() @IsInt() @Min(0) expectedVersion?: number;
}

export class BulkBoardMarkRowDto {
  @IsString() studentProfileId!: string;
  @IsOptional() @IsNumber() marks?: number | null;
  @IsIn(['present', 'absent', 'exempt', 'missing', 'withdrawn', 'not_enrolled', 'excused', 'malpractice', 'special_consideration']) participation!: string;
  @IsOptional() @IsString() @MaxLength(4000) comment?: string;
  @IsInt() @Min(0) expectedVersion!: number;
}

export class BulkBoardMarksDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500)
  @ValidateNested({ each: true }) @Type(() => BulkBoardMarkRowDto)
  rows!: BulkBoardMarkRowDto[];
}

export class AssessmentLifecycleDto {
  @IsIn(['publish', 'open', 'close', 'grade', 'archive', 'release_feedback', 'release_marks'])
  action!: 'publish' | 'open' | 'close' | 'grade' | 'archive' | 'release_feedback' | 'release_marks';
  @IsInt() @Min(0) expectedVersion!: number;
}
