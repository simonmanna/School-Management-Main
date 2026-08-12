/**
 * Reusable DTOs for the school foundation sprint.
 * Each entity uses the BaseCrudService pattern (list/findOne/create/update/remove),
 * so DTOs are minimal — just the create/update shapes.
 */

// ── Campus ──────────────────────────────────────────────────────────────────
export interface CreateCampusDto {
  code: string;
  name: string;
  addressId?: string;
  phone?: string;
  email?: string;
  isActive?: boolean;
  customFields?: Record<string, unknown>;
}
export type UpdateCampusDto = Partial<CreateCampusDto>;

// ── AcademicYear + Term ────────────────────────────────────────────────────
export interface CreateAcademicYearDto {
  name: string;
  startDate: Date | string;
  endDate: Date | string;
  isCurrent?: boolean;
}
export type UpdateAcademicYearDto = Partial<CreateAcademicYearDto>;

export interface CreateTermDto {
  academicYearId: string;
  name: string;
  startDate: Date | string;
  endDate: Date | string;
  isCurrent?: boolean;
}
export type UpdateTermDto = Partial<CreateTermDto>;

// ── Department ──────────────────────────────────────────────────────────────
export interface CreateDepartmentDto {
  name: string;
  headId?: string;
  description?: string;
  customFields?: Record<string, unknown>;
}
export type UpdateDepartmentDto = Partial<CreateDepartmentDto>;

// ── GradeLevel ──────────────────────────────────────────────────────────────
export interface CreateGradeLevelDto {
  name: string;
  order: number;
}
export type UpdateGradeLevelDto = Partial<CreateGradeLevelDto>;

// ── SchoolClass + Section ───────────────────────────────────────────────────
export interface CreateSchoolClassDto {
  name: string;
  gradeLevelId: string;
  campusId?: string;
  homeroomTeacherId?: string;
  capacity?: number;
  customFields?: Record<string, unknown>;
}
export type UpdateSchoolClassDto = Partial<CreateSchoolClassDto>;

export interface CreateSectionDto {
  classId: string;
  name: string;
  capacity?: number;
}
export type UpdateSectionDto = Partial<CreateSectionDto>;

// ── Subject ─────────────────────────────────────────────────────────────────
export interface CreateSubjectDto {
  code: string;
  name: string;
  departmentId?: string;
  isCore?: boolean;
  customFields?: Record<string, unknown>;
}
export type UpdateSubjectDto = Partial<CreateSubjectDto>;

// ── Period ──────────────────────────────────────────────────────────────────
export interface CreatePeriodDto {
  name: string;
  startTime: string; // 'HH:mm'
  endTime: string;
  order: number;
  campusId?: string;
}
export type UpdatePeriodDto = Partial<CreatePeriodDto>;

// ── CalendarEvent ───────────────────────────────────────────────────────────
export interface CreateCalendarEventDto {
  title: string;
  type: 'holiday' | 'exam' | 'event' | 'meeting' | 'trip' | 'sports' | 'ceremony';
  startDate: Date | string;
  endDate: Date | string;
  termId?: string;
  description?: string;
  customFields?: Record<string, unknown>;
}
export type UpdateCalendarEventDto = Partial<CreateCalendarEventDto>;

// ── Bulk term activation ────────────────────────────────────────────────────
export interface SetCurrentYearDto {
  academicYearId: string;
}
export interface SetCurrentTermDto {
  termId: string;
}