/**
 * DTOs for the Promotion / academic-year rollover endpoints (P5).
 *
 * class-validator classes (imported as values) so the global ValidationPipe
 * enforces them. Promotion never mutates a historical enrollment: it closes the
 * current one and creates the next, so academic history stays immutable.
 */
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * The outcome of a promotion decision for one student.
 * - `promoted`   → new enrollment in the next grade's class.
 * - `repeated`   → new enrollment in the SAME grade for the new term (repeater).
 * - `graduated`  → no new enrollment; student status → alumni (final grade).
 * A caller may omit it: an explicit `toClassId` implies `promoted`.
 */
export const PROMOTION_OUTCOMES = ['promoted', 'repeated', 'graduated'] as const;
export type PromotionOutcome = (typeof PROMOTION_OUTCOMES)[number];

export class PromoteStudentDto {
  @IsString() @IsNotEmpty() studentProfileId!: string;

  /** Academic term the student is being promoted INTO. */
  @IsString() @IsNotEmpty() toTermId!: string;

  /** Target class. Required for `promoted`/`repeated`; ignored for `graduated`. */
  @IsOptional() @IsString() toClassId?: string;

  @IsOptional() @IsString() toSectionId?: string;

  /** Defaults to the student's admission number when omitted. */
  @IsOptional() @IsString() rollNumber?: string;

  @IsOptional() @IsIn([...PROMOTION_OUTCOMES]) outcome?: PromotionOutcome;

  @IsOptional() @IsString() reason?: string;
}

export class RolloverDto {
  /** Term being closed (its `enrolled` rows are marked `completed`). */
  @IsString() @IsNotEmpty() fromTermId!: string;

  /** Term new enrollments are created in. */
  @IsString() @IsNotEmpty() toTermId!: string;

  /**
   * When true (the default), compute and return the plan WITHOUT writing.
   * Run a dry-run first: rollover for hundreds of students should be reviewed
   * before it commits. Pass `false` to execute.
   */
  @IsOptional() @IsBoolean() dryRun?: boolean;
}
