import { IsBoolean, IsEmail, IsIn, IsObject, IsOptional, IsString, Length, MaxLength } from 'class-validator';

/**
 * The editable school profile. Previously `PATCH /school/profile` took an
 * arbitrary body and wrote it straight into the row, so any column — capacity
 * policy, currency, terminology — could be set to anything.
 */
export class UpdateSchoolProfileDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(300) motto?: string;
  @IsOptional() @IsString() @MaxLength(2000) logoUrl?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(50) phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(300) website?: string;
  /** ISO 3166-1 alpha-2, e.g. UG. */
  @IsOptional() @IsString() @Length(2, 2) country?: string;
  /** ISO 4217, e.g. UGX. Stored on the Organization (the single source) and mirrored here. */
  @IsOptional() @IsString() @Length(3, 3) currencyCode?: string;
  /** IANA zone, e.g. Africa/Kampala. Stored on the Organization. */
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  @IsOptional() @IsString() @MaxLength(40) educationLevel?: string;
  @IsOptional() @IsString() @MaxLength(40) gradingSystem?: string;
  @IsOptional() @IsString() @MaxLength(40) attendanceMode?: string;
  @IsOptional() @IsIn(['ENFORCE', 'WARN', 'OFF']) capacityPolicy?: 'ENFORCE' | 'WARN' | 'OFF';
  /** ADR-031 D2: how absent/exempt learners count toward term results. */
  @IsOptional() @IsIn(['ABSENT_AS_ZERO', 'ABSENT_BLOCKS', 'ALL_BLOCK'])
  resultAbsencePolicy?: 'ABSENT_AS_ZERO' | 'ABSENT_BLOCKS' | 'ALL_BLOCK';
  /** ADR-031 D4: class teacher reads own stream, or every stream of the class. */
  @IsOptional() @IsIn(['STREAM', 'CLASS']) classTeacherScope?: 'STREAM' | 'CLASS';
  /** ADR-032 P1: a late mark counts as a whole session (1) or half (0.5). No default. */
  @IsOptional() @IsIn([1, 0.5]) attendanceLateContribution?: 1 | 0.5;
  /** ADR-032 P1: whether an excused absence counts in the attendance denominator. */
  @IsOptional() @IsBoolean() attendanceExcusedInDenominator?: boolean;
  /** ADR-032 P3: cash through a drawer session, or a cashbook with untracked custody. */
  @IsOptional() @IsIn(['drawer', 'cashbook']) cashCustodyMode?: 'drawer' | 'cashbook';
  /** Label overrides, e.g. { "section": "Class Group" }. Validated key by key. */
  @IsOptional() @IsObject() terminology?: Record<string, string>;
  @IsOptional() @IsObject() contacts?: Record<string, unknown>;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}
