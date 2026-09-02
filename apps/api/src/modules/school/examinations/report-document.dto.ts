import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export const REPORT_DOCUMENT_TYPE = ['term_report', 'competency_report', 'exam_result_slip', 'transcript', 'promotion_notice'] as const;
export const REPORT_DOCUMENT_STATUS = ['draft', 'generated', 'published', 'superseded', 'void'] as const;

export class GenerateReportDocumentsDto {
  @IsString() @IsNotEmpty() resultSetId!: string;
  @IsOptional() @IsIn([...REPORT_DOCUMENT_TYPE]) documentType?: (typeof REPORT_DOCUMENT_TYPE)[number];
  /** Omit to cover every learner in the result set. */
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) studentProfileIds?: string[];
  /** Issue a new revision over an existing document instead of skipping it. */
  @IsOptional() @IsBoolean() reissue?: boolean;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class PublishReportDocumentsDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(500) @IsString({ each: true }) documentIds!: string[];
}

export class VoidReportDocumentDto {
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

export class ReportDocumentQuery {
  @IsOptional() @IsString() termId?: string;
  @IsOptional() @IsString() resultSetId?: string;
  @IsOptional() @IsString() studentProfileId?: string;
  @IsOptional() @IsIn([...REPORT_DOCUMENT_STATUS]) status?: (typeof REPORT_DOCUMENT_STATUS)[number];
  @IsOptional() @IsIn([...REPORT_DOCUMENT_TYPE]) documentType?: (typeof REPORT_DOCUMENT_TYPE)[number];
}
