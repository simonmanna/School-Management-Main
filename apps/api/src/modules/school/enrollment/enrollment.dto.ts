/**
 * Phase 1 request contracts.
 *
 * Every `@Body()` type here carries class-validator metadata. The global
 * ValidationPipe runs with `whitelist` + `forbidNonWhitelisted`, and a class
 * with no metadata short-circuits in the ValidationExecutor — the route then
 * 400s before the service is ever reached (the exact failure that took out the
 * Phase 0 placement routes). Adding a field without a decorator silently drops
 * it, so decorate everything.
 */
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  ENROLLMENT_STATUSES,
  ENROLLMENT_TYPES,
  MOVEMENT_REASONS,
  type EnrollmentStatusValue,
  type EnrollmentTypeValue,
  type MovementReasonValue,
} from './enrollment-fsm';

const STAGES = ['PRE_PRIMARY', 'PRIMARY', 'PRIMARY_LOWER', 'PRIMARY_UPPER', 'LOWER_SECONDARY', 'ADVANCED_SECONDARY', 'OTHER'] as const;
const COHORT_STATUSES = ['PLANNED', 'ACTIVE', 'CLOSED', 'ARCHIVED'] as const;

/* ───────────────────────────── Programmes ───────────────────────────── */

export class CreateProgrammeDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsIn([...STAGES]) stage?: (typeof STAGES)[number];
  @IsOptional() @IsString() curriculumAuthority?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsISO8601() effectiveFrom?: string;
  @IsOptional() @IsISO8601() effectiveTo?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsObject() config?: Record<string, unknown>;
}

export class UpdateProgrammeDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsIn([...STAGES]) stage?: (typeof STAGES)[number];
  @IsOptional() @IsString() curriculumAuthority?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsISO8601() effectiveFrom?: string;
  @IsOptional() @IsISO8601() effectiveTo?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsObject() config?: Record<string, unknown>;
}

export class SeedUgandaProgrammesDto {
  /** Band the grade levels whose names match (P1…S6) into each template's level. */
  @IsOptional() @IsBoolean() linkGradeLevels?: boolean;
  @IsOptional() @IsISO8601() effectiveFrom?: string;
}

/* ─────────────────────────── Class cohorts ─────────────────────────── */

export class CreateClassCohortDto {
  @IsString() @IsNotEmpty() academicYearId!: string;
  @IsString() @IsNotEmpty() classId!: string;
  @IsOptional() @IsString() programmeId?: string;
  /** Per-year override of whether this class is divided into streams (ADR-029). */
  @IsOptional() @IsBoolean() allowsSubdivision?: boolean | null;
  @IsOptional() @IsInt() @Min(0) capacity?: number;
  @IsOptional() @IsIn([...COHORT_STATUSES]) status?: (typeof COHORT_STATUSES)[number];
}

export class UpdateClassCohortDto {
  @IsOptional() @IsString() programmeId?: string;
  /** Per-year override of whether this class is divided into streams (ADR-029). */
  @IsOptional() @IsBoolean() allowsSubdivision?: boolean | null;
  @IsOptional() @IsInt() @Min(0) capacity?: number;
  @IsOptional() @IsIn([...COHORT_STATUSES]) status?: (typeof COHORT_STATUSES)[number];
}

/** Create a cohort for every class in a year in one action (start-of-year setup). */
export class GenerateClassCohortsDto {
  @IsString() @IsNotEmpty() academicYearId!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) classIds?: string[];
  /** Per-year override of whether this class is divided into streams (ADR-029). */
  @IsOptional() @IsBoolean() allowsSubdivision?: boolean | null;
}

/* ───────────────────────────── Enrollment ──────────────────────────── */

export class PlacementInputDto {
  @IsString() @IsNotEmpty() termId!: string;
  /** Either the cohort directly, or the class (a cohort is created/looked up). */
  @IsOptional() @IsString() classCohortId?: string;
  @IsOptional() @IsString() classId?: string;
  @IsOptional() @IsString() sectionId?: string | null;
  @IsOptional() @IsString() rollNumber?: string;
  @IsOptional() @IsISO8601() effectiveFrom?: string;
  @IsOptional() @IsIn([...MOVEMENT_REASONS]) movementReason?: MovementReasonValue;
  @IsOptional() @IsString() notes?: string;
  /**
   * Seat the learner even though the class or stream is full (ADR-030). Needs
   * the `school:enrollment:capacity:override` permission and a reason.
   */
  @IsOptional() @IsBoolean() overrideCapacity?: boolean;
  @IsOptional() @IsString() @IsNotEmpty() overrideReason?: string;
}

export class CreateStudentEnrollmentDto {
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsString() @IsNotEmpty() academicYearId!: string;
  /** Optional — resolved from the grade level when omitted. */
  @IsOptional() @IsString() programmeId?: string;
  /** Optional — resolved from the placement cohort's class when omitted. */
  @IsOptional() @IsString() gradeLevelId?: string;
  @IsOptional() @IsISO8601() admissionDate?: string;
  @IsOptional() @IsIn([...ENROLLMENT_TYPES]) enrollmentType?: EnrollmentTypeValue;
  /** PENDING or ACTIVE only — every other status is reached through the FSM. */
  @IsOptional() @IsIn(['PENDING', 'ACTIVE']) status?: EnrollmentStatusValue;
  @IsOptional() @IsString() notes?: string;
  /**
   * Set internally by admissions — deliberately undecorated, so the validation
   * whitelist rejects it from an HTTP body. An application enrols once.
   *
   * `declare`, not a plain field: a plain class field is emitted as an own
   * property initialised to `undefined`, which the whitelist then reports as a
   * forbidden property on EVERY request — every enrollment POST answered 400.
   */
  declare admissionApplicationId?: string;

  /** Opening placement. Omit only when the learner is PENDING with no seat yet. */
  @IsOptional() @ValidateNested() @Type(() => PlacementInputDto) placement?: PlacementInputDto;
}

export class ChangeEnrollmentStatusDto {
  @IsIn([...ENROLLMENT_STATUSES]) toStatus!: EnrollmentStatusValue;
  @IsString() @IsNotEmpty() reason!: string;
  @IsOptional() @IsISO8601() effectiveAt?: string;
  /** SUSPENDED only: the day the suspension ends. The learner is reinstated automatically. */
  @IsOptional() @IsISO8601() suspendedUntil?: string;
  /** Required by the FSM for re-entry: where the learner comes back to. */
  @IsOptional() @ValidateNested() @Type(() => PlacementInputDto) placement?: PlacementInputDto;
}

export class WithdrawEnrollmentDto {
  @IsString() @IsNotEmpty() reason!: string;
  @IsOptional() @IsISO8601() effectiveAt?: string;
}

/** Suspension: a reason, and optionally the day it ends (the learner is then reinstated automatically). */
export class SuspendEnrollmentDto extends WithdrawEnrollmentDto {
  @IsOptional() @IsISO8601() suspendedUntil?: string;
}

/* ───────────────────────────── Placement ───────────────────────────── */

/** Move a learner inside the school: class, section and/or stream change. */
export class MovePlacementDto {
  @IsOptional() @IsString() termId?: string;
  @IsOptional() @IsString() classCohortId?: string;
  @IsOptional() @IsString() classId?: string;
  @IsOptional() @IsString() sectionId?: string | null;
  @IsOptional() @IsString() rollNumber?: string;
  @IsOptional() @IsISO8601() effectiveFrom?: string;
  @IsIn([...MOVEMENT_REASONS]) movementReason!: MovementReasonValue;
  @IsString() @IsNotEmpty() reason!: string;
  @IsOptional() @IsString() notes?: string;
  /**
   * Seat the learner even though the class or stream is full (ADR-030). Needs
   * the `school:enrollment:capacity:override` permission and a reason.
   */
  @IsOptional() @IsBoolean() overrideCapacity?: boolean;
  @IsOptional() @IsString() @IsNotEmpty() overrideReason?: string;
}

/** One row of a bulk placement request. */
export class BulkPlacementRowDto {
  @IsString() @IsNotEmpty() enrollmentId!: string;
  @IsOptional() @IsString() classCohortId?: string;
  @IsOptional() @IsString() classId?: string;
  @IsOptional() @IsString() sectionId?: string | null;
  @IsOptional() @IsString() rollNumber?: string;
}

export class BulkPlacementDto {
  @IsString() @IsNotEmpty() termId!: string;
  @IsIn([...MOVEMENT_REASONS]) movementReason!: MovementReasonValue;
  @IsString() @IsNotEmpty() reason!: string;
  @IsOptional() @IsISO8601() effectiveFrom?: string;
  /** true = validate only, write nothing. The UI previews before it commits. */
  @IsOptional() @IsBoolean() dryRun?: boolean;
  /**
   * The token a dry run returned. When given, the commit is refused if the
   * occupancy it was computed against has changed since — the operator is
   * shown a fresh preview instead of committing against stale numbers.
   */
  @IsOptional() @IsString() previewToken?: string;
  /**
   * Seat the whole batch even though the class or stream is full (ADR-030). Needs
   * the `school:enrollment:capacity:override` permission and a reason.
   */
  @IsOptional() @IsBoolean() overrideCapacity?: boolean;
  @IsOptional() @IsString() @IsNotEmpty() overrideReason?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => BulkPlacementRowDto)
  rows!: BulkPlacementRowDto[];
}

/** Roll a whole cohort's placements into the next term, unchanged. */
export class TermRolloverDto {
  @IsString() @IsNotEmpty() fromTermId!: string;
  @IsString() @IsNotEmpty() toTermId!: string;
  @IsOptional() @IsString() classCohortId?: string;
  @IsOptional() @IsBoolean() dryRun?: boolean;
  @IsOptional() @IsString() reason?: string;
}

/** Repeat the current grade in the next academic year. */
export class RepeatGradeDto {
  @IsString() @IsNotEmpty() toAcademicYearId!: string;
  @IsString() @IsNotEmpty() toTermId!: string;
  @IsOptional() @IsString() classId?: string;
  @IsOptional() @IsString() sectionId?: string | null;
  @IsString() @IsNotEmpty() reason!: string;
  @IsOptional() @IsISO8601() effectiveFrom?: string;
  /**
   * Seat the learner even though the class or stream is full (ADR-030). Needs
   * the `school:enrollment:capacity:override` permission and a reason.
   */
  @IsOptional() @IsBoolean() overrideCapacity?: boolean;
  @IsOptional() @IsString() @IsNotEmpty() overrideReason?: string;
}

/** Promote into the next grade in the next academic year. */
export class PromoteEnrollmentDto {
  @IsString() @IsNotEmpty() toAcademicYearId!: string;
  @IsString() @IsNotEmpty() toTermId!: string;
  /** Omit to let the grade-level ladder pick the next class. */
  @IsOptional() @IsString() toClassId?: string;
  @IsOptional() @IsString() sectionId?: string | null;
  @IsOptional() @IsString() rollNumber?: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsISO8601() effectiveFrom?: string;
  /**
   * Seat the learner even though the class or stream is full (ADR-030). Needs
   * the `school:enrollment:capacity:override` permission and a reason.
   */
  @IsOptional() @IsBoolean() overrideCapacity?: boolean;
  @IsOptional() @IsString() @IsNotEmpty() overrideReason?: string;
}

/* ───────────────────────────── Promotion ───────────────────────────── */

/**
 * `promoted` → next grade in the next year; `repeated` → same grade in the next
 * year; `graduated` → enrollment COMPLETED, no next-year enrollment.
 */
export const PROMOTION_OUTCOMES = ['promoted', 'repeated', 'graduated'] as const;
export type PromotionOutcome = (typeof PROMOTION_OUTCOMES)[number];

/** Promote one learner by student id (the promotion board works per learner). */
export class PromoteStudentDto {
  @IsString() @IsNotEmpty() studentProfileId!: string;
  /** A term of the academic year the learner moves INTO. */
  @IsString() @IsNotEmpty() toTermId!: string;
  /** Omit to let the grade ladder choose (or graduate at the top grade). */
  @IsOptional() @IsString() toClassId?: string;
  @IsOptional() @IsString() toSectionId?: string;
  @IsOptional() @IsString() rollNumber?: string;
  @IsOptional() @IsIn([...PROMOTION_OUTCOMES]) outcome?: PromotionOutcome;
  @IsOptional() @IsString() reason?: string;
}

/** Year-end rollover from a term of year N to a term of year N+1. Dry-run by default. */
export class PromotionRolloverDto {
  @IsString() @IsNotEmpty() fromTermId!: string;
  @IsString() @IsNotEmpty() toTermId!: string;
  @IsOptional() @IsBoolean() dryRun?: boolean;
  @IsOptional() @IsString() reason?: string;
}
