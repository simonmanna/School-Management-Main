import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

/** Every kind an assessment can be. Exam and homework are kinds, not systems. */
export const ASSESSMENT_KINDS = [
  'exam',
  'cat',
  'homework',
  'classwork',
  'practical',
  'project',
  'oral',
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
}

export class CreateUnifiedAssessmentDto {
  @IsIn(ASSESSMENT_KINDS as unknown as string[]) kind!: string;
  @IsString() classId!: string;
  @IsString() subjectId!: string;
  @IsString() termId!: string;
  @IsString() title!: string;

  @IsOptional() @IsString() sectionId?: string;
  @IsOptional() @IsNumber() @Min(1) maxScore?: number;
  @IsOptional() @IsNumber() @Min(1) sequence?: number;
  @IsOptional() @IsString() componentId?: string;
  @IsOptional() @IsString() teacherPartnerId?: string;
  @IsOptional() @IsString() description?: string;

  /** Sat-on date for an exam, due date for homework. */
  @IsOptional() @IsString() dueAt?: string;

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

  @IsOptional() @IsIn(['present', 'absent', 'exempt', 'excused', 'malpractice'])
  participation?: string;

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
