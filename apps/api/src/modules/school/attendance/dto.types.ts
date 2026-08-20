/**
 * DTOs for the Attendance module.
 *
 * H2/B6: class-validator classes (were bare interfaces). Import as values.
 */
import { IsArray, IsBoolean, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

// P-att-status: status is now a free string (the AttendanceStatusConfig.code).
// The mark/correct endpoints accept any non-empty string; the UI only offers
// org-configured codes, but we keep it permissive so legacy/custom values persist.
const ATT_STATUS = ['present', 'absent', 'late', 'excused', 'early_departure', 'unexcused'] as const;

export class AttendanceEntry {
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsString() @IsNotEmpty() status!: string;
  /// Minutes the student was late (status = late).
  @IsOptional() @IsInt() @Min(0) minutesLate?: number;
  /// Minutes early the student left (status = early_departure).
  @IsOptional() @IsInt() @Min(0) earlyDepartureMinutes?: number;
  @IsOptional() @IsString() reason?: string;
}

export class BulkMarkAttendanceDto {
  @IsString() @IsNotEmpty() date!: string;
  @IsString() @IsNotEmpty() classId!: string;
  @IsOptional() @IsString() sectionId?: string;

  /**
   * P5: period-level attendance. Omit for the daily register (one row per
   * student/day); set to mark a specific class period (one row per
   * student/day/period) — for secondary schools with subject teachers.
   */
  @IsOptional() @IsString() periodId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttendanceEntry)
  entries!: AttendanceEntry[];
}

export class CorrectAttendanceDto {
  @IsString() @IsNotEmpty() status!: string;
  @IsOptional() @IsInt() @Min(0) minutesLate?: number;
  @IsOptional() @IsInt() @Min(0) earlyDepartureMinutes?: number;
  @IsOptional() @IsString() reason?: string;
  /// Why the correction is being made (audit trail).
  @IsOptional() @IsString() correctionNote?: string;
}

export class UpsertAttendanceThresholdDto {
  @IsOptional() @IsString() classId?: string | null;
  @IsOptional() @IsNumber() @Min(0) @Max(100) minAttendancePct?: number;
  @IsOptional() @IsBoolean() notifyAbsent?: boolean;
  @IsOptional() @IsBoolean() notifyLate?: boolean;
  @IsOptional() @IsBoolean() notifyEarly?: boolean;
  @IsOptional() @IsBoolean() notifyBelowThreshold?: boolean;
}
