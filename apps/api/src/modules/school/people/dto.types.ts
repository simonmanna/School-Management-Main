/**
 * DTOs for the People module.
 *
 * H2/B6: converted from bare interfaces to class-validator classes so the
 * global ValidationPipe (whitelist + forbidNonWhitelisted + transform) actually
 * enforces them. Controllers must import these as values, not `import type`.
 */
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../../kernel/common/pagination.dto';

const GENDERS = ['male', 'female', 'other'] as const;
const RESIDENCE = ['day', 'boarder'] as const;
const STUDENT_STATUS = ['applicant', 'active', 'suspended', 'transferred', 'withdrawn', 'graduated', 'deceased', 'archived', 'alumni'] as const;
const STAFF_STATUS = ['active', 'on_leave', 'suspended', 'inactive', 'terminated', 'resigned', 'retired'] as const;
const RELATIONSHIP = ['father', 'mother', 'uncle', 'aunt', 'sibling', 'grandparent', 'guardian', 'other'] as const;
const CONTRACT = ['permanent', 'contract', 'temporary', 'probation'] as const;
const STAFF_CATEGORY = ['teaching', 'non_teaching', 'admin', 'support'] as const;
const STAFF_ATT_STATUS = ['present', 'absent', 'late', 'leave', 'off_duty'] as const;

/** Roster query: pagination plus an optional class / stream filter. */
export class StudentListQueryDto extends PaginationDto {
  @IsOptional() @IsString() classId?: string;
  @IsOptional() @IsString() sectionId?: string;
  /** Learners placed in the class during THIS term — a past term's cohort, not today's (F19). */
  @IsOptional() @IsString() termId?: string;
}

export class CreateStudentDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsBoolean() isCompany?: boolean;

  @IsString() @IsNotEmpty() admissionNo!: string;
  @IsString() @IsNotEmpty() enrollmentDate!: string;
  /**
   * Create the record even though a learner with the same name and date of
   * birth already exists (twins with the same name are rare but real). Without
   * it, a likely duplicate is refused with the candidates listed.
   */
  @IsOptional() @IsBoolean() allowDuplicate?: boolean;
  /** Admit straight into a class. Creates the enrollment and opening placement. */
  @IsOptional() @IsString() classId?: string;
  /** The class's stream (section), when the class is divided. */
  @IsOptional() @IsString() sectionId?: string;
  /** Term to place into; defaults to the current term. */
  @IsOptional() @IsString() termId?: string;
  @IsOptional() @IsString() dateOfBirth?: string;
  @IsOptional() @IsIn([...GENDERS]) gender?: (typeof GENDERS)[number];
  @IsOptional() @IsString() nationality?: string;
  @IsOptional() @IsString() religion?: string;
  @IsOptional() @IsIn([...RESIDENCE]) residenceType?: (typeof RESIDENCE)[number];
  @IsOptional() @IsString() house?: string;
  @IsOptional() @IsString() middleName?: string;
  @IsOptional() @IsString() preferredName?: string;
  @IsOptional() @IsString() countryOfBirth?: string;
  @IsOptional() @IsString() placeOfBirth?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}

export class UpdateStudentDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsBoolean() isCompany?: boolean;
  @IsOptional() @IsString() @IsNotEmpty() admissionNo?: string;
  @IsOptional() @IsString() enrollmentDate?: string;
  // NO class or stream here, deliberately. Placement is an academic event, not
  // a profile attribute: moving a learner goes through
  // POST /school/placements/:enrollmentId/move (or promotion), which appends an
  // effective-dated placement. The global ValidationPipe runs
  // forbidNonWhitelisted, so sending a class here is a 400.
  @IsOptional() @IsString() dateOfBirth?: string;
  @IsOptional() @IsIn([...GENDERS]) gender?: (typeof GENDERS)[number];
  @IsOptional() @IsString() nationality?: string;
  @IsOptional() @IsString() religion?: string;
  @IsOptional() @IsIn([...RESIDENCE]) residenceType?: (typeof RESIDENCE)[number];
  @IsOptional() @IsString() house?: string;
  @IsOptional() @IsString() studentCategoryId?: string;
  // New editable profile fields (stored on StudentProfile.customFields).
  @IsOptional() @IsString() middleName?: string;
  @IsOptional() @IsString() preferredName?: string;
  @IsOptional() @IsString() countryOfBirth?: string;
  @IsOptional() @IsString() placeOfBirth?: string;
  @IsOptional() @IsString() address?: string;
  /** National ID. Stored encrypted; responses carry only `ninOnFile`/`ninLast4` (F08). */
  @IsOptional() @IsString() @MaxLength(40) nin?: string;
  /** Profile photo as an https URL or a data:image URL (≤ 1.5 MB), saved with the record (F15). */
  @IsOptional() @IsString() @MaxLength(2_000_000) @Matches(/^(https:\/\/|data:image\/(png|jpeg|webp);base64,)/, { message: 'photoUrl must be an https URL or a PNG/JPEG/WebP data URL' }) photoUrl?: string;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
  @IsOptional() @IsIn([...STUDENT_STATUS]) status?: (typeof STUDENT_STATUS)[number];
  @IsOptional() @IsString() reason?: string;
}

export class GuardianContactInput {
  @IsString() @IsNotEmpty() firstName!: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() position?: string;
}

export class CreateGuardianDto {
  @IsString() @IsNotEmpty() studentProfileId!: string;

  /**
   * Link an EXISTING guardian (e.g. a sibling's parent) instead of creating a
   * new contact. One parent, one record — however many children they have.
   */
  @IsOptional() @IsString() guardianContactId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => GuardianContactInput)
  guardian?: GuardianContactInput;

  @IsIn([...RELATIONSHIP]) relationship!: (typeof RELATIONSHIP)[number];
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsBoolean() canPickup?: boolean;
  @IsOptional() @IsBoolean() receivesStatements?: boolean;
}

export class UpdateGuardianDto {
  @IsOptional() @IsIn([...RELATIONSHIP]) relationship?: (typeof RELATIONSHIP)[number];
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsBoolean() canPickup?: boolean;
  @IsOptional() @IsBoolean() receivesStatements?: boolean;

  /// Editable contact (parent) details — name / email / phone.
  @IsOptional() @ValidateNested() @Type(() => GuardianContactInput)
  guardian?: GuardianContactInput;
}

export class UpsertMedicalRecordDto {
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsOptional() @IsString() bloodGroup?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) allergies?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) dietaryRequirements?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) conditions?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) medications?: string[];
  @IsOptional() @IsString() emergencyNotes?: string;
  @IsOptional() @IsString() doctorName?: string;
  @IsOptional() @IsString() doctorPhone?: string;
}

export class CreateEmergencyContactDto {
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsString() @IsNotEmpty() firstName!: string;
  @IsOptional() @IsString() middleName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() preferredName?: string;
  @IsOptional() @IsString() relationship?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() alternativePhone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsInt() priority?: number;
  @IsOptional() @IsBoolean() authorizedPickup?: boolean;
}

export class UpdateEmergencyContactDto {
  @IsOptional() @IsString() @IsNotEmpty() firstName?: string;
  @IsOptional() @IsString() middleName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() preferredName?: string;
  @IsOptional() @IsString() relationship?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() alternativePhone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsInt() priority?: number;
  @IsOptional() @IsBoolean() authorizedPickup?: boolean;
}

export class CreateStudentDocumentDto {
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsIn(['birth_cert', 'report_card', 'transfer_letter', 'photo', 'medical', 'other'])
  type!: 'birth_cert' | 'report_card' | 'transfer_letter' | 'photo' | 'medical' | 'other';
  @IsString() @IsNotEmpty() title!: string;
  // P0/B10: id of a platform File row (see File model) rather than a raw URL.
  @IsString() @IsNotEmpty() fileId!: string;
  @IsOptional() @IsString() expiresAt?: string;
}

export class CreateStaffDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsBoolean() isCompany?: boolean;

  @IsString() @IsNotEmpty() employeeNo!: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() positionId?: string;
  @IsOptional() @IsString() campusId?: string;
  @IsString() @IsNotEmpty() joinDate!: string;
  @IsOptional() @IsIn([...CONTRACT]) contractType?: (typeof CONTRACT)[number];
  @IsOptional() @IsString() contractEndDate?: string;
  @IsOptional() @IsObject() compensation?: Record<string, unknown>;
  @IsOptional() @IsIn([...STAFF_CATEGORY]) staffCategory?: (typeof STAFF_CATEGORY)[number];
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}

export class UpdateStaffDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsBoolean() isCompany?: boolean;
  @IsOptional() @IsString() @IsNotEmpty() employeeNo?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() positionId?: string;
  @IsOptional() @IsString() campusId?: string;
  @IsOptional() @IsString() joinDate?: string;
  @IsOptional() @IsIn([...CONTRACT]) contractType?: (typeof CONTRACT)[number];
  @IsOptional() @IsString() contractEndDate?: string;
  @IsOptional() @IsObject() compensation?: Record<string, unknown>;
  @IsOptional() @IsIn([...STAFF_CATEGORY]) staffCategory?: (typeof STAFF_CATEGORY)[number];
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
  @IsOptional() @IsIn([...STAFF_STATUS]) status?: (typeof STAFF_STATUS)[number];
  @IsOptional() @IsString() reason?: string;
}

export class CreatePositionDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsBoolean() isTeaching?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) defaultPermissions?: string[];
}

export class UpdatePositionDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsBoolean() isTeaching?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) defaultPermissions?: string[];
}

export class StaffAttendanceEntry {
  @IsString() @IsNotEmpty() staffProfileId!: string;
  @IsIn([...STAFF_ATT_STATUS]) status!: (typeof STAFF_ATT_STATUS)[number];
  @IsOptional() @IsString() checkIn?: string;
  @IsOptional() @IsString() checkOut?: string;
  @IsOptional() @IsString() notes?: string;
}

export class MarkStaffAttendanceDto {
  @IsString() @IsNotEmpty() date!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StaffAttendanceEntry)
  entries!: StaffAttendanceEntry[];
}
