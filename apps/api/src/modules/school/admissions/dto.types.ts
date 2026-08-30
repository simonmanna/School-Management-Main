/**
 * DTOs for the Admissions + Academics module.
 *
 * H2/B6: class-validator classes (were bare interfaces). Import as values.
 */
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const GENDERS = ['male', 'female', 'other'] as const;
const RESIDENCE = ['day', 'boarder'] as const;

export class AdmissionGuardianDto {
  @IsString() @IsNotEmpty() firstName!: string;
  @IsOptional() @IsString() lastName?: string;
  @IsString() @IsNotEmpty() relationship!: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() altPhone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() occupation?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsBoolean() isEmergency?: boolean;
  @IsOptional() @IsBoolean() financiallyResponsible?: boolean;
}

export class CreateApplicationDto {
  @IsString() @IsNotEmpty() academicYearId!: string;
  @IsOptional() @IsString() admissionCycleId?: string;
  @IsString() @IsNotEmpty() applicantFirstName!: string;
  @IsString() @IsNotEmpty() applicantLastName!: string;
  @IsOptional() @IsString() applicantDob?: string;
  @IsOptional() @IsIn([...GENDERS]) applicantGender?: (typeof GENDERS)[number];
  @IsOptional() @IsString() applyingForClassId?: string;
  @IsOptional() @IsString() parentContactId?: string;
  /// National ID / NIN — stored AES-256-GCM encrypted, never in plaintext customFields.
  @IsOptional() @IsString() nin?: string;
  @IsOptional() @IsString() sourceOfEnquiry?: string;
  @IsOptional() @IsString() siblingOfStudentId?: string;
  /// Promoted operational fields (previously lived in customFields JSON).
  @IsOptional() @IsString() nationality?: string;
  @IsOptional() @IsIn([...RESIDENCE]) residenceType?: (typeof RESIDENCE)[number];
  @IsOptional() @IsString() entryStatus?: string;
  @IsOptional() @IsString() address?: string;
  /// FK to StudentCategory (org-scoped master data), chosen at apply time.
  @IsOptional() @IsString() studentCategoryId?: string;
  /// When true the application is created as a `draft` (portal / save-and-continue).
  @IsOptional() @IsBoolean() asDraft?: boolean;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AdmissionGuardianDto) guardians?: AdmissionGuardianDto[];
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}

export class UpdateApplicationDto {
  @IsOptional() @IsString() @IsNotEmpty() academicYearId?: string;
  @IsOptional() @IsString() admissionCycleId?: string;
  @IsOptional() @IsString() @IsNotEmpty() applicantFirstName?: string;
  @IsOptional() @IsString() @IsNotEmpty() applicantLastName?: string;
  @IsOptional() @IsString() applicantDob?: string;
  @IsOptional() @IsIn([...GENDERS]) applicantGender?: (typeof GENDERS)[number];
  @IsOptional() @IsString() applyingForClassId?: string;
  @IsOptional() @IsString() parentContactId?: string;
  @IsOptional() @IsString() nin?: string;
  @IsOptional() @IsString() sourceOfEnquiry?: string;
  @IsOptional() @IsString() siblingOfStudentId?: string;
  /// Promoted operational fields (previously lived in customFields JSON).
  @IsOptional() @IsString() nationality?: string;
  @IsOptional() @IsIn([...RESIDENCE]) residenceType?: (typeof RESIDENCE)[number];
  @IsOptional() @IsString() entryStatus?: string;
  @IsOptional() @IsString() address?: string;
  /// FK to StudentCategory (org-scoped master data), chosen at apply time.
  @IsOptional() @IsString() studentCategoryId?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AdmissionGuardianDto) guardians?: AdmissionGuardianDto[];
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}

/// Review action that must carry a decision reason (recorded in history + audit).
const REQUIRED_REASON_ACTIONS = ['accept', 'reject', 'waitlist', 'withdraw'] as const;

export class ReviewApplicationDto {
  @IsIn([...REQUIRED_REASON_ACTIONS, 'review', 'request_documents', 'screen', 'schedule_interview', 'complete_interview', 'reschedule', 'schedule_exam', 'exam_done', 'score', 'issue_offer', 'accept_offer', 'decline_offer', 'expire_offer'] as const)
  action!: string;
  /// Required (non-empty) for accept/reject/waitlist/withdraw; optional otherwise.
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() notes?: string;
}

// ── Nationalities (organization-scoped master data) ──────────────────────────
export class CreateNationalityDto {
  @IsString() @IsNotEmpty() name!: string;
}

export class UpdateNationalityDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class AddExamScoreDto {
  @IsString() @IsNotEmpty() applicationId!: string;
  @IsString() @IsNotEmpty() subjectId!: string;
  @IsNumber() @Min(0) score!: number;
  @IsOptional() @IsNumber() @Min(0) maxScore?: number;
  @IsOptional() @IsString() grade?: string;
  @IsOptional() @IsString() notes?: string;
}

export class EnrollStudentInput {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() dateOfBirth?: string;
  @IsOptional() @IsIn([...GENDERS]) gender?: (typeof GENDERS)[number];
  @IsOptional() @IsString() nationality?: string;
  @IsOptional() @IsString() religion?: string;
  @IsOptional() @IsString() house?: string;
  @IsOptional() @IsIn([...RESIDENCE]) residenceType?: (typeof RESIDENCE)[number];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => GuardianDto) guardians?: GuardianDto[];
}

export class GuardianDto {
  @IsString() @IsNotEmpty() guardianContactId!: string;
  @IsString() @IsNotEmpty() relationship!: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsBoolean() canPickup?: boolean;
  @IsOptional() @IsBoolean() receivesStatements?: boolean;
}

export class EnrollApplicationDto {
  @IsString() @IsNotEmpty() applicationId!: string;
  @IsString() @IsNotEmpty() classId!: string;
  @IsOptional() @IsString() sectionId?: string;
  @IsOptional() @IsString() streamId?: string;
  @IsString() @IsNotEmpty() termId!: string;
  @IsString() @IsNotEmpty() rollNumber!: string;

  @ValidateNested()
  @Type(() => EnrollStudentInput)
  student!: EnrollStudentInput;
}

export class ScheduleInterviewDto {
  @IsOptional() @IsString() interviewerId?: string;
  @IsOptional() @IsString() scheduledAt?: string;
  @IsOptional() @IsInt() @Min(1) @Max(5) rating?: number;
  @IsOptional() @IsIn(['strong', 'borderline', 'weak']) recommendation?: 'strong' | 'borderline' | 'weak';
  @IsOptional() @IsString() panelNotes?: string;
}

export class ScoreApplicationDto {
  @IsOptional() @IsNumber() @Min(0) examScore?: number;
  @IsOptional() @IsNumber() @Min(0) interviewScore?: number;
  @IsOptional() @IsNumber() @Min(0) documentScore?: number;
}

export class IssueOfferDto {
  @IsOptional() @IsString() templateId?: string;
  @IsOptional() @IsString() body?: string;
  @IsOptional() @IsString() expiresAt?: string;
}

export class ChargeFeeDto {
  @IsNumber() @Min(0) amount!: number;
  @IsOptional() @IsString() currency?: string;
}

export class BulkEnrollItemDto {
  @IsString() @IsNotEmpty() applicationId!: string;
  @IsString() @IsNotEmpty() classId!: string;
  @IsOptional() @IsString() sectionId?: string;
  @IsOptional() @IsString() streamId?: string;
  @IsString() @IsNotEmpty() termId!: string;
  @IsString() @IsNotEmpty() rollNumber!: string;

  @ValidateNested()
  @Type(() => EnrollStudentInput)
  student!: EnrollStudentInput;
}

export class BulkEnrollDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => BulkEnrollItemDto)
  items!: BulkEnrollItemDto[];
}

export class TransferInDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() dateOfBirth?: string;
  @IsOptional() @IsIn([...GENDERS]) gender?: (typeof GENDERS)[number];
  @IsOptional() @IsString() nationality?: string;
  @IsOptional() @IsString() religion?: string;
  @IsOptional() @IsString() house?: string;
  @IsOptional() @IsIn([...RESIDENCE]) residenceType?: (typeof RESIDENCE)[number];
  @IsOptional() @IsString() studentCategoryId?: string;
  @IsOptional() @IsString() transferredFrom?: string;
  @IsString() @IsNotEmpty() classId!: string;
  @IsOptional() @IsString() sectionId?: string;
  @IsOptional() @IsString() streamId?: string;
  @IsString() @IsNotEmpty() termId!: string;
  @IsString() @IsNotEmpty() rollNumber!: string;
  @IsOptional() @IsString() admissionNo?: string;
}

export class WithdrawStudentDto {
  @IsString() @IsNotEmpty() reason!: string;
  @IsOptional() @IsString() effectiveDate?: string;
}

export class ReEnrollDto {
  @IsString() @IsNotEmpty() classId!: string;
  @IsOptional() @IsString() sectionId?: string;
  @IsString() @IsNotEmpty() termId!: string;
  @IsString() @IsNotEmpty() rollNumber!: string;
}
