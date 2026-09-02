import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@erp/shared';
import { CLASS_BASES } from './report.types';

/**
 * The one filter vocabulary every report shares. A definition declares WHICH of
 * these it accepts (`ReportDefinition.filters`); the runner rejects anything
 * else, so an unsupported filter fails loudly rather than being ignored and
 * quietly widening a report.
 *
 * These are classes, not interfaces, because the global ValidationPipe runs with
 * `whitelist: true, forbidNonWhitelisted: true, transform: true` (main.ts) —
 * an interface carries no metadata and every field would be stripped.
 */
export class ReportFilterDto {
  @IsOptional() @IsUUID() academicYearId?: string;
  @IsOptional() @IsUUID() termId?: string;
  @IsOptional() @IsUUID() campusId?: string;
  @IsOptional() @IsUUID() gradeLevelId?: string;
  @IsOptional() @IsUUID() classId?: string;
  @IsOptional() @IsUUID() sectionId?: string;
  @IsOptional() @IsUUID() streamId?: string;
  @IsOptional() @IsUUID() studentProfileId?: string;
  @IsOptional() @IsUUID() staffProfileId?: string;
  @IsOptional() @IsUUID() subjectId?: string;
  @IsOptional() @IsUUID() resultSetId?: string;
  @IsOptional() @IsUUID() studentCategoryId?: string;

  @IsOptional() @IsDateString() dateFrom?: string;
  @IsOptional() @IsDateString() dateTo?: string;

  /**
   * Only honoured by definitions declaring `asOfMode: 'as-of'`. For
   * 'current-only' the runner pins this to now and attaches a note, rather than
   * returning a figure that looks historical and is not.
   */
  @IsOptional() @IsDateString() asOf?: string;

  /** Domain vocabulary; each definition validates its own allowed values. */
  @IsOptional() @IsArray() @IsString({ each: true }) status?: string[];

  @IsOptional() @IsIn(['male', 'female', 'other']) gender?: string;
  @IsOptional() @IsIn(['day', 'boarder']) residenceType?: string;
  @IsOptional() @IsString() house?: string;
  @IsOptional() @IsString() search?: string;

  /**
   * Overrides the definition's `classBasisDefault`. See ClassBasis — omitting
   * this is the norm; setting it is for reconciling two reports that disagree.
   */
  @IsOptional() @IsIn(CLASS_BASES as unknown as string[]) classBasis?: string;
}

export class RunReportDto {
  /**
   * `@Type` alone transforms but does not validate the nested object, and
   * `@ValidateNested` alone has no class to validate against — both are needed
   * or every filter silently passes.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => ReportFilterDto)
  filters: ReportFilterDto = new ReportFilterDto();

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page: number = DEFAULT_PAGE;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(MAX_PAGE_SIZE)
  pageSize: number = DEFAULT_PAGE_SIZE;

  /** Validated against the definition's column keys — never passed to Prisma raw. */
  @IsOptional() @IsString() sortBy?: string;

  @IsOptional() @IsIn(['asc', 'desc']) sortOrder?: 'asc' | 'desc';
}

export class ExportReportDto extends RunReportDto {
  @IsIn(['csv', 'xlsx', 'pdf']) format!: 'csv' | 'xlsx' | 'pdf';
}
