import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

/** Identifies one exam paper: exam × class × subject. */
export class PaperRefDto {
  @IsString() examId!: string;
  @IsString() classId!: string;
  @IsString() subjectId!: string;
}

export class ApplyClassesDto {
  @IsString() examId!: string;

  @IsArray() @ArrayNotEmpty() @IsString({ each: true })
  classIds!: string[];

  /** Restrict the fan-out to these subjects; omitted = every subject the class takes. */
  @IsOptional() @IsArray() @IsString({ each: true })
  subjectIds?: string[];

  @IsOptional() @IsNumber() @Min(1)
  maxMarks?: number;
}

export class RemoveClassDto {
  @IsString() examId!: string;
  @IsString() classId!: string;
}

/**
 * One autosaved cell. `marks: null` clears the mark; `participation` records a
 * non-scoring outcome (absent/exempt/…) so a blank cell is never ambiguous.
 */
export class SaveMarkDto {
  @IsString() examId!: string;
  @IsString() classId!: string;
  @IsString() subjectId!: string;
  @IsString() studentProfileId!: string;

  @IsOptional() @IsNumber() marks?: number | null;

  @IsOptional() @IsIn(['present', 'absent', 'exempt', 'excused', 'malpractice'])
  participation?: string;

  @IsOptional() @IsNumber() @Min(1) maxMarks?: number;

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

export class LockMarksDto {
  @IsString() examId!: string;
  @IsString() classId!: string;

  /** Omit to lock/unlock every subject of the class for this exam. */
  @IsOptional() @IsString() subjectId?: string;

  @IsBoolean() locked!: boolean;
}
