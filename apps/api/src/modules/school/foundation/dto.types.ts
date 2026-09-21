/**
 * Reusable DTOs for the school foundation module.
 *
 * H2/B6: class-validator classes (were bare interfaces) so the global
 * ValidationPipe enforces them. Controllers import these as values.
 */
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Min } from 'class-validator';

// ── Campus ──────────────────────────────────────────────────────────────────
export class CreateCampusDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() addressId?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() isMain?: boolean;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}
export class UpdateCampusDto {
  @IsOptional() @IsString() @IsNotEmpty() code?: string;
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() addressId?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() isMain?: boolean;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}

// ── AcademicYear + Term ────────────────────────────────────────────────────
export class CreateAcademicYearDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsNotEmpty() startDate!: string;
  @IsString() @IsNotEmpty() endDate!: string;
  @IsOptional() @IsBoolean() isCurrent?: boolean;
}
export class UpdateAcademicYearDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() endDate?: string;
  @IsOptional() @IsBoolean() isCurrent?: boolean;
}

export class CreateTermDto {
  @IsString() @IsNotEmpty() academicYearId!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsNotEmpty() startDate!: string;
  @IsString() @IsNotEmpty() endDate!: string;
  @IsOptional() @IsBoolean() isCurrent?: boolean;
}
export class UpdateTermDto {
  @IsOptional() @IsString() @IsNotEmpty() academicYearId?: string;
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() endDate?: string;
  @IsOptional() @IsBoolean() isCurrent?: boolean;
}

// ── Department ──────────────────────────────────────────────────────────────
export class CreateDepartmentDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() headId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}
export class UpdateDepartmentDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() headId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}

// ── GradeLevel ──────────────────────────────────────────────────────────────
export class CreateGradeLevelDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsInt() @Min(0) order!: number;
  /// Stable identifier for imports. Derived from the name when omitted.
  @IsOptional() @IsString() @IsNotEmpty() code?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  /// The grade a learner is promoted INTO. Null/omitted leaves it unset.
  @IsOptional() @IsString() nextGradeLevelId?: string | null;
  @IsOptional() @IsBoolean() isTerminal?: boolean;
  /// The band this grade sits in.
  @IsOptional() @IsString() academicLevelId?: string | null;
}
export class UpdateGradeLevelDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsInt() @Min(0) order?: number;
  @IsOptional() @IsString() @IsNotEmpty() code?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() nextGradeLevelId?: string | null;
  @IsOptional() @IsBoolean() isTerminal?: boolean;
  @IsOptional() @IsString() academicLevelId?: string | null;
}

// ── AcademicLevel ───────────────────────────────────────────────────────────
export class CreateAcademicLevelDto {
  @IsString() @IsNotEmpty() name!: string;
  /// Stable identifier. Derived from the name when omitted.
  @IsOptional() @IsString() @IsNotEmpty() code?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() @Min(0) displayOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional()
  @IsIn(['PRE_PRIMARY', 'PRIMARY', 'PRIMARY_LOWER', 'PRIMARY_UPPER', 'LOWER_SECONDARY', 'ADVANCED_SECONDARY', 'OTHER'])
  stage?: string;
  /// The programme grades under this level enrol into by default.
  @IsOptional() @IsString() defaultProgrammeId?: string | null;
}
export class UpdateAcademicLevelDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() @IsNotEmpty() code?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() @Min(0) displayOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional()
  @IsIn(['PRE_PRIMARY', 'PRIMARY', 'PRIMARY_LOWER', 'PRIMARY_UPPER', 'LOWER_SECONDARY', 'ADVANCED_SECONDARY', 'OTHER'])
  stage?: string;
  @IsOptional() @IsString() defaultProgrammeId?: string | null;
}

// ── SchoolClass + Section ───────────────────────────────────────────────────
export class CreateSchoolClassDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsNotEmpty() gradeLevelId!: string;
  @IsOptional() @IsString() campusId?: string;
  @IsOptional() @IsString() homeroomTeacherId?: string;
  /// Stable identifier for imports. Derived from the name when omitted.
  @IsOptional() @IsString() @IsNotEmpty() code?: string;
  @IsOptional() @IsString() description?: string;
  /// NULL means unlimited, which is a real choice and not a missing value.
  @IsOptional() @IsInt() @Min(1) capacity?: number | null;
  /// False when learners enrol straight into the class with no subdivision.
  @IsOptional() @IsBoolean() allowsStreams?: boolean;
  @IsOptional() @IsInt() @Min(0) displayOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}
export class UpdateSchoolClassDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() @IsNotEmpty() gradeLevelId?: string;
  @IsOptional() @IsString() campusId?: string;
  @IsOptional() @IsString() homeroomTeacherId?: string;
  @IsOptional() @IsString() @IsNotEmpty() code?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number | null;
  @IsOptional() @IsBoolean() allowsStreams?: boolean;
  @IsOptional() @IsInt() @Min(0) displayOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}

export class CreateSectionDto {
  @IsString() @IsNotEmpty() classId!: string;
  @IsString() @IsNotEmpty() name!: string;
  /// Stable identifier, unique within the class. Derived when omitted.
  @IsOptional() @IsString() @IsNotEmpty() code?: string;
  @IsOptional() @IsString() description?: string;
  /// NULL means unlimited.
  @IsOptional() @IsInt() @Min(1) capacity?: number | null;
  @IsOptional() @IsInt() @Min(0) displayOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() classTeacherId?: string;
}
export class UpdateSectionDto {
  @IsOptional() @IsString() @IsNotEmpty() classId?: string;
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() @IsNotEmpty() code?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number | null;
  @IsOptional() @IsInt() @Min(0) displayOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() classTeacherId?: string;
}

// ── Subject ─────────────────────────────────────────────────────────────────
export class CreateSubjectDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsBoolean() isCore?: boolean;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}
export class UpdateSubjectDto {
  @IsOptional() @IsString() @IsNotEmpty() code?: string;
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsBoolean() isCore?: boolean;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}

// ── Period ──────────────────────────────────────────────────────────────────
export class CreatePeriodDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsNotEmpty() startTime!: string; // 'HH:mm'
  @IsString() @IsNotEmpty() endTime!: string;
  @IsInt() @Min(0) order!: number;
  @IsOptional() @IsString() campusId?: string;
}
export class UpdatePeriodDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() startTime?: string;
  @IsOptional() @IsString() endTime?: string;
  @IsOptional() @IsInt() @Min(0) order?: number;
  @IsOptional() @IsString() campusId?: string;
}

// ── CalendarEvent ───────────────────────────────────────────────────────────
const CAL_TYPE = ['holiday', 'exam', 'event', 'meeting', 'trip', 'sports', 'ceremony'] as const;
export class CreateCalendarEventDto {
  @IsString() @IsNotEmpty() title!: string;
  @IsIn([...CAL_TYPE]) type!: (typeof CAL_TYPE)[number];
  @IsString() @IsNotEmpty() startDate!: string;
  @IsString() @IsNotEmpty() endDate!: string;
  @IsOptional() @IsString() termId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}
export class UpdateCalendarEventDto {
  @IsOptional() @IsString() @IsNotEmpty() title?: string;
  @IsOptional() @IsIn([...CAL_TYPE]) type?: (typeof CAL_TYPE)[number];
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() endDate?: string;
  @IsOptional() @IsString() termId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}

// ── Bulk term activation ────────────────────────────────────────────────────
export class SetCurrentYearDto {
  @IsString() @IsNotEmpty() academicYearId!: string;
}

/// Lifecycle transition for an academic year (brief para 3).
export class SetAcademicYearStatusDto {
  @IsIn(['PLANNING', 'ACTIVE', 'CLOSED', 'ARCHIVED'])
  status!: 'PLANNING' | 'ACTIVE' | 'CLOSED' | 'ARCHIVED';
  /// Required when re-opening a CLOSED year, so the reason is on the record.
  @IsOptional() @IsString() @IsNotEmpty() reason?: string;
}
export class SetCurrentTermDto {
  @IsString() @IsNotEmpty() termId!: string;
}

// ── SubjectCategory ────────────────────────────────────────────────────────
export class CreateSubjectCategoryDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() description?: string;
}
export class UpdateSubjectCategoryDto {
  @IsOptional() @IsString() @IsNotEmpty() code?: string;
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() description?: string;
}

// ── Stream ─────────────────────────────────────────────────────────────────
export class CreateStreamDto {
  @IsString() @IsNotEmpty() classId!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
}
export class UpdateStreamDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
}

// ── StudentCategory ───────────────────────────────────────────────────────
export class CreateStudentCategoryDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() description?: string;
}

export class UpdateStudentCategoryDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
