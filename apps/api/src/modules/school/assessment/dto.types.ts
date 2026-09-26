/**
 * DTOs for the Assessment core module (A1). class-validator classes, imported
 * as values so the Nest ValidationPipe can enforce them.
 */
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const ASSESSMENT_KIND = ['exam', 'cat', 'homework', 'assignment', 'quiz', 'classwork', 'practical', 'project', 'oral', 'observation', 'activity_of_integration', 'attendance'] as const;
const AGGREGATION = ['mean', 'sum', 'best_n', 'last', 'weighted_mean'] as const;
const ROUNDING = ['half_up', 'half_even', 'floor', 'ceil'] as const;
const SOURCE_TYPE = ['manual', 'assignment', 'exam_session', 'quiz'] as const;
const PARTICIPATION = ['present', 'absent', 'exempt', 'missing', 'withdrawn', 'not_enrolled', 'excused', 'malpractice', 'special_consideration'] as const;
const MARK_ROUND = ['first', 'second_blind', 'reconciliation'] as const;
const ADJUSTMENT_KIND = ['moderation', 'scaling', 'late_penalty', 'special_consideration', 'correction'] as const;

// ── Policy ──
export class CreateAssessmentPolicyDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() gradeLevelId?: string;
  @IsOptional() @IsString() classId?: string;
  @IsOptional() @IsString() subjectId?: string;
  @IsOptional() @IsString() termId?: string;
  /** ADR-031 D5: a programme-wide weighting (e.g. lower primary learning areas). */
  @IsOptional() @IsString() programmeId?: string;
  @IsOptional() @IsNumber() @Min(0) passMark?: number;
  @IsOptional() @IsNumber() @Min(0) caCap?: number;
  @IsOptional() @IsIn([...ROUNDING]) roundingMode?: (typeof ROUNDING)[number];
  @IsOptional() @IsInt() @Min(0) decimalPlaces?: number;
}

export class UpdateAssessmentPolicyDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsNumber() @Min(0) passMark?: number;
  @IsOptional() @IsNumber() @Min(0) caCap?: number;
  @IsOptional() @IsIn([...ROUNDING]) roundingMode?: (typeof ROUNDING)[number];
  @IsOptional() @IsInt() @Min(0) decimalPlaces?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) version?: number;
}

// ── Component ──
export class CreateAssessmentComponentDto {
  @IsString() @IsNotEmpty() policyId!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsIn([...ASSESSMENT_KIND]) kind!: (typeof ASSESSMENT_KIND)[number];
  @IsNumber() @Min(0) weight!: number;
  @IsOptional() @IsIn([...AGGREGATION]) aggregation?: (typeof AGGREGATION)[number];
  @IsOptional() @IsInt() @Min(1) bestN?: number;
  @IsOptional() @IsBoolean() countsAbsentAsZero?: boolean;
  @IsOptional() @IsString() examTypeId?: string;
  @IsOptional() @IsInt() order?: number;
}

export class UpdateAssessmentComponentDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsIn([...ASSESSMENT_KIND]) kind?: (typeof ASSESSMENT_KIND)[number];
  @IsOptional() @IsNumber() @Min(0) weight?: number;
  @IsOptional() @IsIn([...AGGREGATION]) aggregation?: (typeof AGGREGATION)[number];
  @IsOptional() @IsInt() @Min(1) bestN?: number;
  @IsOptional() @IsBoolean() countsAbsentAsZero?: boolean;
  @IsOptional() @IsString() examTypeId?: string;
  @IsOptional() @IsInt() order?: number;
  @IsOptional() @IsInt() @Min(0) version?: number;
}

// ── Assessment ──
export class CreateAssessmentDto {
  @IsOptional() @IsString() componentId?: string;
  @IsString() @IsNotEmpty() subjectId!: string;
  @IsString() @IsNotEmpty() classId!: string;
  @IsString() @IsNotEmpty() termId!: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsOptional() @IsNumber() @Min(0) maxScore?: number;
  @IsOptional() @IsNumber() @Min(0) weightInComponent?: number;
  @IsOptional() @IsIn([...SOURCE_TYPE]) sourceType?: (typeof SOURCE_TYPE)[number];
  @IsOptional() @IsString() sourceRef?: string;
  @IsOptional() @IsString() dueAt?: string;
  /** What it IS. Defaults to the component's kind, else `cat`. */
  @IsOptional() @IsIn([...ASSESSMENT_KIND]) kind?: (typeof ASSESSMENT_KIND)[number];
  /** F03. Defaults: bound to a component or fed by an adapter → summative; else formative. */
  @IsOptional() @IsIn(['formative', 'summative']) contribution?: 'formative' | 'summative';
}

export class UpdateAssessmentDto {
  @IsOptional() @IsString() componentId?: string;
  @IsOptional() @IsIn(['formative', 'summative']) contribution?: 'formative' | 'summative';
  @IsOptional() @IsString() @IsNotEmpty() title?: string;
  @IsOptional() @IsNumber() @Min(0) maxScore?: number;
  @IsOptional() @IsNumber() @Min(0) weightInComponent?: number;
  @IsOptional() @IsIn([...ASSESSMENT_KIND]) kind?: (typeof ASSESSMENT_KIND)[number];
  @IsOptional() @IsString() dueAt?: string;
  @IsOptional() @IsInt() @Min(0) version?: number;
}

const ASSESSMENT_ACTION = ['schedule', 'publish', 'open', 'close', 'grade', 'archive'] as const;
export class AssessmentTransitionDto {
  @IsIn([...ASSESSMENT_ACTION]) action!: (typeof ASSESSMENT_ACTION)[number];
}

// ── Student assessment / participation ──
export class SetParticipationDto {
  @IsString() @IsNotEmpty() assessmentId!: string;
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsIn([...PARTICIPATION]) participation!: (typeof PARTICIPATION)[number];
  @IsOptional() @IsString() classId?: string;
  @IsOptional() @IsString() sectionId?: string;
  @IsOptional() @IsString() gradeLevelId?: string;
  @IsOptional() @IsString() termId?: string;
}

// ── Mark entry (a marker round) ──
export class RecordMarkDto {
  @IsString() @IsNotEmpty() studentAssessmentId!: string;
  @IsOptional() @IsIn([...MARK_ROUND]) round?: (typeof MARK_ROUND)[number];
  @IsNumber() @Min(0) score!: number;
  @IsOptional() @IsString() comment?: string;

  /**
   * The version the caller believes it is editing. Optional so existing clients
   * keep working, but a client that sends it gets the same protection from a
   * concurrent marker that the board and the gradebook already have.
   */
  @IsOptional() @IsNumber() expectedVersion?: number;
}

// ── Mark adjustment (append-only) ──
export class AppendAdjustmentDto {
  @IsString() @IsNotEmpty() studentAssessmentId!: string;
  @IsIn([...ADJUSTMENT_KIND]) kind!: (typeof ADJUSTMENT_KIND)[number];
  @IsOptional() @IsNumber() delta?: number;
  @IsOptional() @IsNumber() @Min(0) replacementScore?: number;
  @IsString() @IsNotEmpty() reason!: string;
}

// ── Marking-approval workflow (mirrors GradeEntry FSM at the assessment level) ──
// `resubmit` closes the reject loop: rejected → submitted, without an admin
// resetting the row by hand. GradeEntry supported it; the spine did not.
const APPROVAL_ACTION = ['submit', 'resubmit', 'approve', 'reject'] as const;
export class MarkingApprovalDto {
  @IsString() @IsNotEmpty() assessmentId!: string;
  @IsIn([...APPROVAL_ACTION]) action!: (typeof APPROVAL_ACTION)[number];
  @IsOptional() @IsString() reason?: string;
}

// ─────────────────── Rosters (A2) ───────────────────
const ROSTER_SCOPE = ['class', 'section', 'subject', 'grade'] as const;
const ROSTER_SOURCE = ['derived_current_class', 'enrollment', 'manual_import'] as const;

export class CaptureRosterDto {
  @IsString() @IsNotEmpty() termId!: string;
  @IsOptional() @IsIn([...ROSTER_SCOPE]) scopeType?: (typeof ROSTER_SCOPE)[number];
  @IsOptional() @IsString() classId?: string;
  @IsOptional() @IsString() sectionId?: string;
  @IsOptional() @IsString() subjectId?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsIn([...ROSTER_SOURCE]) source?: (typeof ROSTER_SOURCE)[number];
  /** F12: whose class list — the day it is read on. Defaults to the term's last day, or today in the current term. */
  @IsOptional() @IsDateString() asOf?: string;
}

export class RosterMemberDto {
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsOptional() @IsString() classId?: string;
  @IsOptional() @IsString() sectionId?: string;
  @IsOptional() @IsString() gradeLevelId?: string;
  @IsOptional() @IsString() joinReason?: string;
}

// ─────────────────── Rubrics (A2) ───────────────────
export class RubricLevelDto {
  @IsString() @IsNotEmpty() label!: string;
  @IsNumber() @Min(0) score!: number;
  @IsOptional() @IsString() descriptor?: string;
  @IsOptional() @IsInt() order?: number;
}

export class RubricCriterionDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsNumber() @Min(0) weight?: number;
  @IsNumber() @Min(0) maxScore!: number;
  @IsOptional() @IsInt() order?: number;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => RubricLevelDto) levels?: RubricLevelDto[];
}

export class CreateRubricDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => RubricCriterionDto) criteria?: RubricCriterionDto[];
}

// ─────────────────── Assignments (A2) ───────────────────
const GRADING_MODE = ['points', 'rubric', 'complete_incomplete'] as const;

export class CreateAssignmentDto {
  @IsString() @IsNotEmpty() subjectId!: string;
  @IsString() @IsNotEmpty() classId!: string;
  @IsString() @IsNotEmpty() termId!: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsOptional() @IsNumber() @Min(0) maxScore?: number;
  @IsOptional() @IsString() dueAt?: string;
  @IsOptional() @IsString() rosterId?: string;
  @IsOptional() @IsString() instructions?: string;
  @IsOptional() @IsBoolean() allowLate?: boolean;
  @IsOptional() @IsNumber() @Min(0) latePenaltyPercent?: number;
  @IsOptional() @IsString() lateCutoffAt?: string;
  @IsOptional() @IsInt() @Min(1) maxAttempts?: number;
  @IsOptional() @IsIn([...GRADING_MODE]) gradingMode?: (typeof GRADING_MODE)[number];
  @IsOptional() @IsString() rubricId?: string;
  @IsOptional() @IsArray() attachments?: unknown[];
}

export class SubmitAssignmentDto {
  @IsString() @IsNotEmpty() assignmentId!: string;
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsArray() attachments?: unknown[];
}

export class RubricScoreDto {
  @IsString() @IsNotEmpty() criterionId!: string;
  @IsOptional() @IsString() levelId?: string;
  @IsNumber() @Min(0) score!: number;
  @IsOptional() @IsString() comment?: string;
}

export class GradeAssignmentDto {
  @IsString() @IsNotEmpty() assignmentId!: string;
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsOptional() @IsNumber() @Min(0) rawScore?: number;
  @IsOptional() @IsBoolean() complete?: boolean;
  @IsOptional() @IsInt() @Min(0) expectedVersion?: number;
  @IsOptional() @IsString() feedback?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => RubricScoreDto) rubricScores?: RubricScoreDto[];
}

// ─────────────────── Result spine (A3) ───────────────────
const RESULT_SCOPE = ['class', 'section', 'grade', 'campus', 'school'] as const;

export class ComputeResultsDto {
  @IsString() @IsNotEmpty() termId!: string;
  @IsString() @IsNotEmpty() rosterId!: string;
  @IsOptional() @IsIn([...RESULT_SCOPE]) scopeType?: (typeof RESULT_SCOPE)[number];
  @IsOptional() @IsString() scopeId?: string;
  @IsOptional() @IsString() calculationVersion?: string;
  @IsOptional() @IsString() idempotencyKey?: string;
}

export class RequestAmendmentDto {
  @IsString() @IsNotEmpty() resultSetId!: string;
  @IsString() @IsNotEmpty() reason!: string;
  @IsOptional() detail?: unknown;
}

/** A refusal is a decision too, and it carries a reason on the record. */
export class RejectAmendmentDto {
  @IsString() @IsNotEmpty() decisionNote!: string;
}
