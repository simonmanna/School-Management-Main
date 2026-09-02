import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export const SCHEME_STATUSES = ['draft', 'active', 'archived'] as const;
export const DELIVERY_STATUSES = ['in_progress', 'delivered', 'partially_delivered', 'cancelled'] as const;
export const EVIDENCE_KINDS = ['ASSESSMENT', 'ASSIGNMENT', 'RESOURCE', 'OBSERVATION', 'NOTE', 'LINK'] as const;
export const FOLLOW_UP_STATUSES = ['open', 'in_progress', 'done', 'cancelled'] as const;

export type SchemeStatus = (typeof SCHEME_STATUSES)[number];
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

// ───────────────────────── Scheme of work ─────────────────────────

export class SchemeItemDto {
  @IsString() @IsNotEmpty() title!: string;
  @IsOptional() @IsString() topicId?: string;
  @IsOptional() @IsString() unitId?: string;
  @IsOptional() @IsString() learningOutcomeId?: string;
  @IsOptional() @IsString() learningObjectiveId?: string;
  @IsOptional() @IsInt() @Min(0) order?: number;
  @IsOptional() @IsInt() @Min(0) @Max(40) plannedPeriods?: number;
}

export class SchemeWeekDto {
  @IsInt() @Min(1) @Max(60) weekNumber!: number;
  @IsOptional() @IsISO8601() weekStart?: string;
  @IsOptional() @IsString() theme?: string;
  @IsOptional() @IsInt() @Min(0) @Max(40) plannedPeriods?: number;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => SchemeItemDto)
  items?: SchemeItemDto[];
}

export class CreateSchemeOfWorkDto {
  @IsString() @IsNotEmpty() courseOfferingId!: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() summary?: string;
  /** Lay out one empty week per teaching week of the offering's term. */
  @IsOptional() @IsBoolean() generateWeeksFromTerm?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => SchemeWeekDto)
  weeks?: SchemeWeekDto[];
}

export class UpdateSchemeOfWorkDto {
  @IsOptional() @IsString() @IsNotEmpty() title?: string;
  @IsOptional() @IsString() summary?: string;
  @IsOptional() @IsIn([...SCHEME_STATUSES]) status?: SchemeStatus;
}

export class UpsertSchemeWeekDto {
  @IsOptional() @IsInt() @Min(1) @Max(60) weekNumber?: number;
  @IsOptional() @IsISO8601() weekStart?: string;
  @IsOptional() @IsString() theme?: string;
  @IsOptional() @IsInt() @Min(0) @Max(40) plannedPeriods?: number;
  @IsOptional() @IsString() notes?: string;
}

// ───────────────────────── Delivery ─────────────────────────

export class GenerateWeekDto {
  @IsString() @IsNotEmpty() courseOfferingId!: string;
  /** Any date inside the wanted week; the service snaps to that week's Monday. */
  @IsISO8601() weekStart!: string;
}

export class AttachLessonPlanDto {
  @IsOptional() @IsString() lessonPlanId?: string;
  @IsOptional() @IsIn(['scheduled', 'cancelled', 'rescheduled']) status?: string;
  @IsOptional() @IsISO8601() plannedDate?: string;
}

export class DeliverLessonDto {
  @IsOptional() @IsIn([...DELIVERY_STATUSES]) status?: DeliveryStatus;
  @IsOptional() @IsString() coveredContent?: string;
  @IsOptional() @IsString() varianceReason?: string;
  @IsOptional() @IsString() participationNote?: string;
  /** Register this lesson is evidenced by. Attendance itself stays where it is. */
  @IsOptional() @IsISO8601() attendanceDate?: string;
  @IsOptional() @IsString() attendancePeriodId?: string;
  @IsOptional() @IsString() attendanceSessionId?: string;
}

export class ReflectLessonDto {
  @IsOptional() @IsString() whatWorked?: string;
  @IsOptional() @IsString() whatDidntWork?: string;
  @IsOptional() @IsString() studentsNeedingSupport?: string;
  @IsOptional() @IsString() followUpNote?: string;
}

export class AddEvidenceDto {
  @IsIn([...EVIDENCE_KINDS]) kind!: EvidenceKind;
  @IsOptional() @IsString() assessmentId?: string;
  @IsOptional() @IsString() learningResourceId?: string;
  @IsOptional() @IsString() learningOutcomeId?: string;
  @IsOptional() @IsString() url?: string;
  @IsOptional() @IsString() note?: string;
}

// ───────────────────────── Follow-up ─────────────────────────

export class CreateFollowUpDto {
  @IsString() @IsNotEmpty() courseOfferingId!: string;
  @IsString() @IsNotEmpty() action!: string;
  @IsOptional() @IsString() lessonDeliveryId?: string;
  @IsOptional() @IsString() studentProfileId?: string;
  @IsOptional() @IsString() learningOutcomeId?: string;
  @IsOptional() @IsISO8601() dueDate?: string;
}

export class UpdateFollowUpDto {
  @IsOptional() @IsIn([...FOLLOW_UP_STATUSES]) status?: FollowUpStatus;
  @IsOptional() @IsString() action?: string;
  @IsOptional() @IsISO8601() dueDate?: string;
  @IsOptional() @IsString() resolutionNote?: string;
}

// ───────────────────────── Offering resources ─────────────────────────

export class AttachOfferingResourceDto {
  @IsString() @IsNotEmpty() learningResourceId!: string;
  @IsOptional() @IsBoolean() visibleToLearners?: boolean;
  @IsOptional() @IsInt() @Min(0) order?: number;
}

// ───────────────────────── Lesson plan links ─────────────────────────

export class SetPlanOutcomesDto {
  @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) learningOutcomeIds!: string[];
}

export class SetPlanSchemeWeekDto {
  @IsOptional() @IsString() schemeOfWorkWeekId?: string;
}
