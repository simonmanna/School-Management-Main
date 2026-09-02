import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional,
  IsString, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { COLUMN_TRANSFORMS, STATUTORY_SCOPES } from './statutory.datasets';

export const EXAM_LEVELS = ['PLE', 'UCE', 'UACE'] as const;
export const REFERENCE_STATUSES = ['provisional', 'registered', 'confirmed', 'withdrawn'] as const;

/** A sitting year, bounded so a typo cannot register a candidate for 202. */
const YEAR_MIN = 2000;
const YEAR_MAX = 2100;

// ── candidate references ─────────────────────────────────────────────────────

export class UpsertExamReferenceDto {
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsOptional() @IsString() @MaxLength(20) board?: string;
  @IsIn([...EXAM_LEVELS]) level!: (typeof EXAM_LEVELS)[number];
  @IsInt() @Min(YEAR_MIN) @Max(YEAR_MAX) registrationYear!: number;
  @IsOptional() @IsString() @MaxLength(20) centreNumber?: string;
  @IsOptional() @IsString() @MaxLength(20) candidateNumber?: string;
  @IsOptional() @IsString() @MaxLength(30) indexNumber?: string;
  @IsOptional() @IsIn([...REFERENCE_STATUSES]) status?: (typeof REFERENCE_STATUSES)[number];
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class AssignCandidateNumbersDto {
  @IsOptional() @IsString() @MaxLength(20) board?: string;
  @IsIn([...EXAM_LEVELS]) level!: (typeof EXAM_LEVELS)[number];
  @IsInt() @Min(YEAR_MIN) @Max(YEAR_MAX) registrationYear!: number;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) classIds?: string[];
  @IsOptional() @IsString() @MaxLength(20) centreNumber?: string;
  @IsOptional() @IsString() @MaxLength(10) prefix?: string;
  @IsOptional() @IsInt() @Min(1) @Max(99999) startAt?: number;
  @IsOptional() @IsInt() @Min(1) @Max(8) padTo?: number;
  /** Order the numbers run in. Admission number by default — the register's order. */
  @IsOptional() @IsIn(['admissionNo', 'name']) orderBy?: 'admissionNo' | 'name';
}

export class IndexNumberRowDto {
  @IsString() @IsNotEmpty() @MaxLength(20) candidateNumber!: string;
  @IsString() @IsNotEmpty() @MaxLength(30) indexNumber!: string;
}

export class ImportIndexNumbersDto {
  @IsIn([...EXAM_LEVELS]) level!: (typeof EXAM_LEVELS)[number];
  @IsInt() @Min(YEAR_MIN) @Max(YEAR_MAX) registrationYear!: number;
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(2000)
  @ValidateNested({ each: true }) @Type(() => IndexNumberRowDto)
  rows!: IndexNumberRowDto[];
}

export class WithdrawReferenceDto {
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

// ── export templates ─────────────────────────────────────────────────────────

export class TemplateColumnDto {
  @IsString() @IsNotEmpty() @MaxLength(60) header!: string;
  @IsString() @IsNotEmpty() @MaxLength(60) source!: string;
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsString() @MaxLength(60) fallback?: string;
  @IsOptional() @IsIn([...COLUMN_TRANSFORMS]) transform?: (typeof COLUMN_TRANSFORMS)[number];
}

export class CreateExportTemplateDto {
  @IsString() @IsNotEmpty() @MaxLength(40) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsString() @MaxLength(20) board?: string;
  @IsOptional() @IsIn([...EXAM_LEVELS]) level?: (typeof EXAM_LEVELS)[number];
  @IsIn([...STATUTORY_SCOPES]) scope!: string;
  @IsOptional() @IsString() programmeId?: string;
  @IsOptional() @IsString() @MaxLength(3) delimiter?: string;
  @IsOptional() @IsBoolean() includeHeader?: boolean;
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(80)
  @ValidateNested({ each: true }) @Type(() => TemplateColumnDto)
  columns!: TemplateColumnDto[];
}

export class UpdateExportTemplateDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsString() @MaxLength(3) delimiter?: string;
  @IsOptional() @IsBoolean() includeHeader?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(80)
  @ValidateNested({ each: true }) @Type(() => TemplateColumnDto)
  columns?: TemplateColumnDto[];
}

// ── running an export ────────────────────────────────────────────────────────

export class RunExportDto {
  @IsString() @IsNotEmpty() templateId!: string;
  @IsOptional() @IsString() termId?: string;
  @IsOptional() @IsString() academicYearId?: string;
  @IsOptional() @IsString() examId?: string;
  @IsOptional() @IsString() programmeId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) classIds?: string[];
  @IsOptional() @IsIn([...EXAM_LEVELS]) level?: (typeof EXAM_LEVELS)[number];
  @IsOptional() @IsInt() @Min(YEAR_MIN) @Max(YEAR_MAX) registrationYear?: number;
  /**
   * Produce the file even though the readiness board has blocking findings.
   *
   * A school that has agreed a partial submission with the board must be able
   * to send one, but never by accident: the override is recorded on the run and
   * the findings travel with it.
   */
  @IsOptional() @IsBoolean() allowIncomplete?: boolean;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class MarkSubmittedDto {
  @IsString() @IsNotEmpty() @MaxLength(120) submissionReference!: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
