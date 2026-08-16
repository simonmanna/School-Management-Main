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

export class CreateApplicationDto {
  @IsString() @IsNotEmpty() academicYearId!: string;
  @IsString() @IsNotEmpty() applicantFirstName!: string;
  @IsString() @IsNotEmpty() applicantLastName!: string;
  @IsOptional() @IsString() applicantDob?: string;
  @IsOptional() @IsIn([...GENDERS]) applicantGender?: (typeof GENDERS)[number];
  @IsOptional() @IsString() applyingForClassId?: string;
  @IsOptional() @IsString() parentContactId?: string;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}

export class UpdateApplicationDto {
  @IsOptional() @IsString() @IsNotEmpty() academicYearId?: string;
  @IsOptional() @IsString() @IsNotEmpty() applicantFirstName?: string;
  @IsOptional() @IsString() @IsNotEmpty() applicantLastName?: string;
  @IsOptional() @IsString() applicantDob?: string;
  @IsOptional() @IsIn([...GENDERS]) applicantGender?: (typeof GENDERS)[number];
  @IsOptional() @IsString() applyingForClassId?: string;
  @IsOptional() @IsString() parentContactId?: string;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
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
}

export class EnrollApplicationDto {
  @IsString() @IsNotEmpty() applicationId!: string;
  @IsString() @IsNotEmpty() classId!: string;
  @IsOptional() @IsString() sectionId?: string;
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
  @IsOptional() @IsString() transferredFrom?: string;
  @IsString() @IsNotEmpty() classId!: string;
  @IsOptional() @IsString() sectionId?: string;
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
