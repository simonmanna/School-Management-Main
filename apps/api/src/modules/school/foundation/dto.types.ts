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
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}
export class UpdateCampusDto {
  @IsOptional() @IsString() @IsNotEmpty() code?: string;
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() addressId?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
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
}
export class UpdateGradeLevelDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsInt() @Min(0) order?: number;
}

// ── SchoolClass + Section ───────────────────────────────────────────────────
export class CreateSchoolClassDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsNotEmpty() gradeLevelId!: string;
  @IsOptional() @IsString() campusId?: string;
  @IsOptional() @IsString() homeroomTeacherId?: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}
export class UpdateSchoolClassDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() @IsNotEmpty() gradeLevelId?: string;
  @IsOptional() @IsString() campusId?: string;
  @IsOptional() @IsString() homeroomTeacherId?: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}

export class CreateSectionDto {
  @IsString() @IsNotEmpty() classId!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
}
export class UpdateSectionDto {
  @IsOptional() @IsString() @IsNotEmpty() classId?: string;
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
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
