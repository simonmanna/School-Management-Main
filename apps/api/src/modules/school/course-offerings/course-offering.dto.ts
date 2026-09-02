import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export const OFFERING_TYPES = ['SUBJECT', 'LEARNING_AREA', 'COMPETENCY', 'SCHOOL_WIDE', 'CO_CURRICULAR', 'REMEDIAL', 'CLUB_OR_HOUSE'] as const;
export const AUDIENCE_SCOPES = ['COHORT', 'SECTION', 'STREAM', 'CUSTOM', 'SCHOOL'] as const;
export const OFFERING_STATUSES = ['DRAFT', 'STAFFED', 'ROSTER_READY', 'PUBLISHED', 'ACTIVE', 'CLOSED', 'ARCHIVED'] as const;
export const TEACHER_ROLES = ['LEAD', 'CO_TEACHER', 'ASSISTANT', 'SUBSTITUTE'] as const;
export const ENROLLMENT_SOURCES = ['COMPULSORY', 'ELECTIVE', 'REMEDIAL', 'MANUAL', 'OPT_OUT'] as const;
export const ENROLLMENT_STATUSES = ['ENROLLED', 'OPTED_OUT', 'WITHDRAWN'] as const;

export type OfferingTypeValue = (typeof OFFERING_TYPES)[number];
export type AudienceScopeValue = (typeof AUDIENCE_SCOPES)[number];
export type OfferingStatusValue = (typeof OFFERING_STATUSES)[number];
export type TeacherRoleValue = (typeof TEACHER_ROLES)[number];

export class TeacherAllocationDto {
  @IsString() @IsNotEmpty() teacherPartnerId!: string;
  @IsOptional() @IsIn([...TEACHER_ROLES]) role?: TeacherRoleValue;
  @IsOptional() @IsBoolean() isResponsible?: boolean;
  @IsOptional() @IsISO8601() effectiveFrom?: string;
  @IsOptional() @IsISO8601() effectiveTo?: string;
  @IsOptional() @IsString() replacedTeacherId?: string;
}

export class CreateCourseOfferingDto {
  @IsOptional() @IsString() code?: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsNotEmpty() academicYearId!: string;
  @IsString() @IsNotEmpty() termId!: string;
  @IsString() @IsNotEmpty() programmeId!: string;
  @IsIn([...OFFERING_TYPES]) offeringType!: OfferingTypeValue;
  @IsIn([...AUDIENCE_SCOPES]) audienceScope!: AudienceScopeValue;
  @IsOptional() @IsString() classCohortId?: string;
  @IsOptional() @IsString() subjectId?: string;
  @IsOptional() @IsString() sectionId?: string;
  @IsOptional() @IsString() streamId?: string;
  @IsOptional() @IsString() curriculumId?: string;
  @IsOptional() @IsString() competencyId?: string;
  @IsOptional() @IsString() activityDefinitionId?: string;
  @IsISO8601() effectiveFrom!: string;
  @IsOptional() @IsISO8601() effectiveTo?: string;
  @IsOptional() @IsString() summary?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => TeacherAllocationDto)
  teachers?: TeacherAllocationDto[];
}

export class UpdateCourseOfferingDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() summary?: string;
  @IsOptional() @IsISO8601() effectiveFrom?: string;
  @IsOptional() @IsISO8601() effectiveTo?: string;
}

export class TransitionCourseOfferingDto {
  @IsIn([...OFFERING_STATUSES]) toStatus!: OfferingStatusValue;
}

export class SetCourseEnrollmentDto {
  @IsString() @IsNotEmpty() studentEnrollmentId!: string;
  @IsIn([...ENROLLMENT_SOURCES]) source!: (typeof ENROLLMENT_SOURCES)[number];
  @IsOptional() @IsIn([...ENROLLMENT_STATUSES]) status?: (typeof ENROLLMENT_STATUSES)[number];
  @IsOptional() @IsISO8601() startDate?: string;
  @IsOptional() @IsISO8601() endDate?: string;
  @IsOptional() @IsString() withdrawalReason?: string;
}

export class SyncCourseRosterDto {
  @IsOptional() @IsBoolean() includeElectives?: boolean;
}

export class BulkGenerateOfferingsDto {
  @IsString() @IsNotEmpty() academicYearId!: string;
  @IsString() @IsNotEmpty() termId!: string;
  @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) classCohortIds!: string[];
  @IsOptional() @IsBoolean() includeElectives?: boolean;
}

export class MigrateTeacherAssignmentsDto {
  @IsOptional() @IsString() termId?: string;
  @IsOptional() @IsBoolean() dryRun?: boolean;
}

export class RolloverOfferingDto {
  @IsString() @IsNotEmpty() academicYearId!: string;
  @IsString() @IsNotEmpty() termId!: string;
  @IsOptional() @IsString() classCohortId?: string;
  @IsOptional() @IsString() curriculumId?: string;
  @IsOptional() @IsISO8601() effectiveFrom?: string;
  @IsOptional() @IsISO8601() effectiveTo?: string;
  @IsOptional() @IsBoolean() copyTeachers?: boolean;
  @IsOptional() @IsBoolean() syncRoster?: boolean;
}

export class CreateActivityDefinitionDto {
  @IsString() @IsNotEmpty() title!: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() description?: string;
}
