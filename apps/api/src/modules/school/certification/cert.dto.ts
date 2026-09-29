import { ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

const CERT_TYPE = ['completion', 'leaving', 'testimonial', 'merit', 'award'] as const;

export class ExternalSubjectDto {
  @IsString() @IsNotEmpty() subject!: string;
  @IsString() @IsNotEmpty() grade!: string;
  @IsOptional() @IsString() mark?: string;
  @IsOptional() @IsString() result?: string;
}

export class RecordExternalResultDto {
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsOptional() @IsString() board?: string;
  @IsString() @IsNotEmpty() level!: string; // PLE | UCE | UACE
  @IsInt() @Min(1900) year!: number;
  @IsOptional() @IsString() indexNumber?: string;
  @IsOptional() @IsInt() aggregate?: number;
  @IsOptional() @IsString() division?: string;
  @IsOptional() @IsBoolean() verified?: boolean;
  @IsOptional() @IsObject() importedPayload?: unknown;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ExternalSubjectDto) subjects?: ExternalSubjectDto[];
}

export class IssueCertificateDto {
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsIn([...CERT_TYPE]) type!: (typeof CERT_TYPE)[number];
  @IsString() @IsNotEmpty() title!: string;
  @IsOptional() @IsObject() payload?: unknown;
}

export class RevokeCertificateDto {
  @IsString() @IsNotEmpty() reason!: string;
  @IsOptional() @IsBoolean() void?: boolean;
}

/**
 * Wave 16 — the leaving (transfer) certificate. The server snapshots the
 * pupil's record, last class and fee position at issue; the office supplies
 * only what it alone knows.
 */
export class IssueLeavingCertificateDto {
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsString() @IsNotEmpty() reasonForLeaving!: string;
  @IsOptional() @IsString() leavingDate?: string;
  @IsOptional() @IsString() conduct?: string;
  @IsOptional() @IsString() destinationSchool?: string;
  @IsOptional() @IsString() remarks?: string;
}
