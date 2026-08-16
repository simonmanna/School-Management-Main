import {
  IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min,
} from 'class-validator';

/* ── Teaching rooms ─────────────────────────────────────────────────────── */
export class CreateTeachingRoomDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
  @IsOptional() @IsIn(['classroom', 'lab', 'hall', 'gym']) type?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateTeachingRoomDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
  @IsOptional() @IsIn(['classroom', 'lab', 'hall', 'gym']) type?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

/* ── Teacher availability ──────────────────────────────────────────────── */
export class UpsertTeacherAvailabilityDto {
  @IsString() @IsNotEmpty() teacherPartnerId!: string;
  @IsInt() @Min(1) @Max(7) dayOfWeek!: number;
  @IsString() @IsNotEmpty() periodId!: string;
  @IsIn(['available', 'busy', 'unavailable']) status!: string;
  @IsOptional() @IsString() reason?: string;
}

/* ── Rotation ──────────────────────────────────────────────────────────── */
export class SetRotationDto {
  @IsIn(['all', 'A', 'B']) activeCycle!: string;
}

/* ── Overrides (temporary changes) ───────────────────────────────────────── */
export class CreateTimetableOverrideDto {
  @IsString() @IsNotEmpty() classId!: string;
  @IsOptional() @IsString() sectionId?: string;
  @IsInt() @Min(1) @Max(7) dayOfWeek!: number;
  @IsString() @IsNotEmpty() periodId!: string;
  @IsString() @IsNotEmpty() effectiveFrom!: string; // ISO date
  @IsString() @IsNotEmpty() effectiveTo!: string; // ISO date
  @IsOptional() @IsString() subjectId?: string;
  @IsOptional() @IsString() teacherPartnerId?: string;
  @IsOptional() @IsString() reason?: string;
}

/* ── Auto-generation request ───────────────────────────────────────────── */
export class GenerateTimetableDto {
  @IsString() @IsNotEmpty() classId!: string;
  @IsOptional() @IsString() sectionId?: string;
  /// Weekly lesson counts per subject: { subjectId: lessonsPerWeek }.
  @IsArray() @IsOptional() subjectLoads?: { subjectId: string; perWeek: number }[];
  /// Teacher assigned per subject (optional).
  @IsArray() @IsOptional() subjectTeachers?: { subjectId: string; teacherPartnerId: string }[];
  @IsOptional() @IsInt() @Min(1) maxPerDay?: number;
}
