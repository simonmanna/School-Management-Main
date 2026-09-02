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
import { GROUPING_MODES, type GroupingModeValue } from './grouping';
import {
  ENROLLMENT_STATUSES,
  ENROLLMENT_TYPES,
  MOVEMENT_REASONS,
  type EnrollmentStatusValue,
  type EnrollmentTypeValue,
  type MovementReasonValue,
} from './enrollment-fsm';

const STAGES = ['PRIMARY_LOWER', 'PRIMARY_UPPER', 'LOWER_SECONDARY', 'ADVANCED_SECONDARY', 'OTHER'] as const;
const COHORT_STATUSES = ['PLANNED', 'ACTIVE', 'CLOSED', 'ARCHIVED'] as const;

/* ───────────────────────────── Programmes ───────────────────────────── */

export class CreateProgrammeDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsIn([...STAGES]) stage?: (typeof STAGES)[number];
  @IsOptional() @IsString() curriculumAuthority?: string;
  @IsOptional() @IsIn([...GROUPING_MODES]) groupingMode?: GroupingModeValue;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsISO8601() effectiveFrom?: string;
  @IsOptional() @IsISO8601() effectiveTo?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsObject() config?: Record<string, unknown>;
  /** Grade levels this programme covers. Replaces the existing links wholesale. */
  @IsOptional() @IsArray() @IsString({ each: true }) gradeLevelIds?: string[];
}

export class UpdateProgrammeDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsIn([...STAGES]) stage?: (typeof STAGES)[number];
  @IsOptional() @IsString() curriculumAuthority?: string;
  @IsOptional() @IsIn([...GROUPING_MODES]) groupingMode?: GroupingModeValue;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsISO8601() effectiveFrom?: string;
  @IsOptional() @IsISO8601() effectiveTo?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsObject() config?: Record<string, unknown>;
  @IsOptional() @IsArray() @IsString({ each: true }) gradeLevelIds?: string[];
}

export class SeedUgandaProgrammesDto {
  /** Attach each template to the grade levels whose names match (P1…S6). */
  @IsOptional() @IsBoolean() linkGradeLevels?: boolean;
  @IsOptional() @IsIn([...GROUPING_MODES]) groupingMode?: GroupingModeValue;
  @IsOptional() @IsISO8601() effectiveFrom?: string;
}

/* ─────────────────────────── Class cohorts ─────────────────────────── */

export class CreateClassCohortDto {
  @IsString() @IsNotEmpty() academicYearId!: string;
  @IsString() @IsNotEmpty() classId!: string;
  @IsOptional() @IsString() programmeId?: string;
  @IsOptional() @IsIn([...GROUPING_MODES]) groupingMode?: GroupingModeValue;
  @IsOptional() @IsInt() @Min(0) capacity?: number;
  @IsOptional() @IsIn([...COHORT_STATUSES]) status?: (typeof COHORT_STATUSES)[number];
}

export class UpdateClassCohortDto {
  @IsOptional() @IsString() programmeId?: string;
  @IsOptional() @IsIn([...GROUPING_MODES]) groupingMode?: GroupingModeValue;
  @IsOptional() @IsInt() @Min(0) capacity?: number;
  @IsOptional() @IsIn([...COHORT_STATUSES]) status?: (typeof COHORT_STATUSES)[number];
}

/** Create a cohort for every class in a year in one action (start-of-year setup). */
export class GenerateClassCohortsDto {
  @IsString() @IsNotEmpty() academicYearId!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) classIds?: string[];
  @IsOptional() @IsIn([...GROUPING_MODES]) groupingMode?: GroupingModeValue;
}

/** Attach a stream to a section (ADR-019 SECTION_AND_STREAM backfill). */
export class AttachStreamToSectionDto {
  /** Null detaches the stream from its section. */
  @IsOptional() @IsString() sectionId?: string | null;
}

/* ───────────────────────────── Enrollment ──────────────────────────── */

export class PlacementInputDto {
  @IsString() @IsNotEmpty() termId!: string;
  /** Either the cohort directly, or the class (a cohort is created/looked up). */
  @IsOptional() @IsString() classCohortId?: string;
  @IsOptional() @IsString() classId?: string;
  @IsOptional() @IsString() sectionId?: string | null;
  @IsOptional() @IsString() streamId?: string | null;
  @IsOptional() @IsString() rollNumber?: string;
  @IsOptional() @IsISO8601() effectiveFrom?: string;
  @IsOptional() @IsIn([...MOVEMENT_REASONS]) movementReason?: MovementReasonValue;
  @IsOptional() @IsString() notes?: string;
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
  @IsOptional() @IsIn([...ENROLLMENT_STATUSES]) status?: EnrollmentStatusValue;
  @IsOptional() @IsString() notes?: string;

  /** Opening placement. Omit only when the learner is PENDING with no seat yet. */
  @IsOptional() @ValidateNested() @Type(() => PlacementInputDto) placement?: PlacementInputDto;
}

export class ChangeEnrollmentStatusDto {
  @IsIn([...ENROLLMENT_STATUSES]) toStatus!: EnrollmentStatusValue;
  @IsString() @IsNotEmpty() reason!: string;
  @IsOptional() @IsISO8601() effectiveAt?: string;
  /** Required by the FSM for re-entry: where the learner comes back to. */
  @IsOptional() @ValidateNested() @Type(() => PlacementInputDto) placement?: PlacementInputDto;
}

export class WithdrawEnrollmentDto {
  @IsString() @IsNotEmpty() reason!: string;
  @IsOptional() @IsISO8601() effectiveAt?: string;
}

/* ───────────────────────────── Placement ───────────────────────────── */

/** Move a learner inside the school: class, section and/or stream change. */
export class MovePlacementDto {
  @IsOptional() @IsString() termId?: string;
  @IsOptional() @IsString() classCohortId?: string;
  @IsOptional() @IsString() classId?: string;
  @IsOptional() @IsString() sectionId?: string | null;
  @IsOptional() @IsString() streamId?: string | null;
  @IsOptional() @IsString() rollNumber?: string;
  @IsOptional() @IsISO8601() effectiveFrom?: string;
  @IsIn([...MOVEMENT_REASONS]) movementReason!: MovementReasonValue;
  @IsString() @IsNotEmpty() reason!: string;
  @IsOptional() @IsString() notes?: string;
}

/** One row of a bulk placement request. */
export class BulkPlacementRowDto {
  @IsString() @IsNotEmpty() enrollmentId!: string;
  @IsOptional() @IsString() classCohortId?: string;
  @IsOptional() @IsString() classId?: string;
  @IsOptional() @IsString() sectionId?: string | null;
  @IsOptional() @IsString() streamId?: string | null;
  @IsOptional() @IsString() rollNumber?: string;
}

export class BulkPlacementDto {
  @IsString() @IsNotEmpty() termId!: string;
  @IsIn([...MOVEMENT_REASONS]) movementReason!: MovementReasonValue;
  @IsString() @IsNotEmpty() reason!: string;
  @IsOptional() @IsISO8601() effectiveFrom?: string;
  /** true = validate only, write nothing. The UI previews before it commits. */
  @IsOptional() @IsBoolean() dryRun?: boolean;
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
  @IsOptional() @IsString() streamId?: string | null;
  @IsString() @IsNotEmpty() reason!: string;
  @IsOptional() @IsISO8601() effectiveFrom?: string;
}

/** Promote into the next grade in the next academic year. */
export class PromoteEnrollmentDto {
  @IsString() @IsNotEmpty() toAcademicYearId!: string;
  @IsString() @IsNotEmpty() toTermId!: string;
  /** Omit to let the grade-level ladder pick the next class. */
  @IsOptional() @IsString() toClassId?: string;
  @IsOptional() @IsString() sectionId?: string | null;
  @IsOptional() @IsString() streamId?: string | null;
  @IsOptional() @IsString() rollNumber?: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsISO8601() effectiveFrom?: string;
}

/* ────────────────────────────── Backfill ───────────────────────────── */

export class BackfillDto {
  /** Nothing is written unless this is explicitly false. */
  @IsOptional() @IsBoolean() dryRun?: boolean;
  @IsOptional() @IsString() academicYearId?: string;
  /** Reuse a run id to make a re-run idempotent, or to roll one back. */
  @IsOptional() @IsString() migrationRunId?: string;
  @IsOptional() @IsIn([...GROUPING_MODES]) defaultGroupingMode?: GroupingModeValue;
}

export class ResolveExceptionDto {
  @IsString() @IsNotEmpty() resolutionNote!: string;
}
