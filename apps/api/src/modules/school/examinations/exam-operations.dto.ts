import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsNotEmpty,
  IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested,
} from 'class-validator';

export const EXAM_LIFECYCLE_STATES = [
  'draft', 'setup', 'scheduled', 'candidates_locked', 'in_progress',
  'marking', 'moderation', 'results_ready', 'closed', 'archived',
] as const;
export const EXAM_ATTENDANCE_STATUS = ['present', 'absent', 'late', 'excused', 'malpractice', 'withdrawn'] as const;
export const EXAM_INCIDENT_TYPE = ['malpractice', 'illness', 'disruption', 'missing_script', 'late_arrival', 'material_error', 'other'] as const;
export const EXAM_INCIDENT_CLOSE = ['resolved', 'dismissed'] as const;
export const CONSIDERATION_TYPE = ['extra_time', 'separate_room', 'reader', 'scribe', 'rest_breaks', 'enlarged_print', 'alternative_format', 'aegrotat', 'exemption', 'other'] as const;
export const CONSIDERATION_DECISION = ['approved', 'rejected'] as const;
export const MARKING_MODE = ['single', 'double', 'blind_double'] as const;
export const SAMPLE_METHOD = ['random', 'stratified', 'boundary', 'manual'] as const;
export const CUSTODY_ACTION = [
  'authored', 'moderated', 'approved', 'printed', 'sealed', 'stored', 'dispatched',
  'received', 'opened', 'distributed', 'collected', 'returned', 'archived', 'destroyed', 'incident',
] as const;

// ── lifecycle ────────────────────────────────────────────────────────────────

export class ExamLifecycleActionDto {
  @IsIn([...EXAM_LIFECYCLE_STATES]) target!: (typeof EXAM_LIFECYCLE_STATES)[number];
  /** Required when stepping an examination backwards — a correction is on the record. */
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsOptional() @IsInt() expectedVersion?: number;
}

export class FreezeCandidatesDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class ConfigurePaperDto {
  @IsOptional() @IsIn([...MARKING_MODE]) markingMode?: (typeof MARKING_MODE)[number];
  @IsOptional() @IsNumber() @Min(0) markToleranceMarks?: number;
  @IsOptional() @IsBoolean() moderationRequired?: boolean;
}

// ── attendance ───────────────────────────────────────────────────────────────

export class AttendanceRowDto {
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsIn([...EXAM_ATTENDANCE_STATUS]) status!: (typeof EXAM_ATTENDANCE_STATUS)[number];
  @IsOptional() @IsISO8601() arrivedAt?: string;
  @IsOptional() @IsISO8601() leftAt?: string;
  @IsOptional() @IsString() venueId?: string;
  @IsOptional() @IsString() @MaxLength(20) seatNumber?: string;
  @IsOptional() @IsString() @MaxLength(40) scriptNumber?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class RecordAttendanceDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(500)
  @ValidateNested({ each: true }) @Type(() => AttendanceRowDto)
  rows!: AttendanceRowDto[];
}

// ── incidents ────────────────────────────────────────────────────────────────

export class RaiseIncidentDto {
  @IsString() @IsNotEmpty() examId!: string;
  @IsOptional() @IsString() examScheduleId?: string;
  @IsOptional() @IsString() studentProfileId?: string;
  @IsIn([...EXAM_INCIDENT_TYPE]) type!: (typeof EXAM_INCIDENT_TYPE)[number];
  @IsOptional() @IsIn(['low', 'medium', 'high']) severity?: 'low' | 'medium' | 'high';
  @IsString() @IsNotEmpty() @MaxLength(2000) description!: string;
  @IsOptional() @IsISO8601() occurredAt?: string;
  @IsOptional() @IsArray() evidence?: unknown[];
}

export class ResolveIncidentDto {
  @IsIn([...EXAM_INCIDENT_CLOSE]) status!: (typeof EXAM_INCIDENT_CLOSE)[number];
  @IsString() @IsNotEmpty() @MaxLength(2000) resolution!: string;
  /** Uphold a malpractice finding: the candidate's paper stops counting as a score. */
  @IsOptional() @IsBoolean() upholdMalpractice?: boolean;
}

// ── special consideration ────────────────────────────────────────────────────

export class RequestConsiderationDto {
  @IsString() @IsNotEmpty() examId!: string;
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsOptional() @IsString() examScheduleId?: string;
  @IsIn([...CONSIDERATION_TYPE]) type!: (typeof CONSIDERATION_TYPE)[number];
  @IsOptional() @IsInt() @Min(1) extraTimeMinutes?: number;
  @IsString() @IsNotEmpty() @MaxLength(2000) reason!: string;
  @IsOptional() @IsArray() evidence?: unknown[];
  @IsOptional() @IsBoolean() exemptsFromResult?: boolean;
}

export class DecideConsiderationDto {
  @IsIn([...CONSIDERATION_DECISION]) status!: (typeof CONSIDERATION_DECISION)[number];
  @IsOptional() @IsString() @MaxLength(1000) decisionNote?: string;
}

// ── custody ──────────────────────────────────────────────────────────────────

export class RecordCustodyDto {
  @IsIn([...CUSTODY_ACTION]) action!: (typeof CUSTODY_ACTION)[number];
  @IsOptional() @IsISO8601() occurredAt?: string;
  @IsOptional() @IsString() @MaxLength(160) actorName?: string;
  @IsOptional() @IsString() custodianId?: string;
  @IsOptional() @IsString() @MaxLength(160) custodianName?: string;
  @IsOptional() @IsString() @MaxLength(80) sealNumber?: string;
  @IsOptional() @IsInt() @Min(0) copies?: number;
  @IsOptional() @IsString() @MaxLength(160) location?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

// ── script marking ───────────────────────────────────────────────────────────

export class AllocateScriptsDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(50) @IsString({ each: true }) markerIds!: string[];
}

export class VoidAllocationsDto {
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

export class SubmitScriptMarkDto {
  /** null clears this marker's score and returns the script to in-progress. */
  @IsOptional() @IsNumber() @Min(0) score?: number | null;
  @IsOptional() @IsString() @MaxLength(2000) comment?: string;
  @IsOptional() @IsInt() expectedVersion?: number;
}

export class ReconcileScriptDto {
  /** Omit to agree every submitted script on the paper. */
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) studentProfileIds?: string[];
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

// ── moderation ───────────────────────────────────────────────────────────────

export class DrawModerationSampleDto {
  @IsOptional() @IsIn([...SAMPLE_METHOD]) method?: (typeof SAMPLE_METHOD)[number];
  @IsOptional() @IsInt() @Min(1) sampleSize?: number;
  @IsOptional() @IsString() @MaxLength(120) seed?: string;
  @IsOptional() @IsNumber() @Min(0) toleranceMarks?: number;
  @IsOptional() @IsString() moderatorId?: string;
}

export class ModerationItemDto {
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsNumber() @Min(0) moderatedScore!: number;
  @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}

export class RecordModerationDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(200)
  @ValidateNested({ each: true }) @Type(() => ModerationItemDto)
  items!: ModerationItemDto[];
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  /** Default true: an out-of-tolerance re-mark becomes a moderation adjustment. */
  @IsOptional() @IsBoolean() applyAdjustments?: boolean;
}
