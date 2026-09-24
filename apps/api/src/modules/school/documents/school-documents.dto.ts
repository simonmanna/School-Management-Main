import { IsArray, IsBoolean, IsISO8601, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

/**
 * Request contracts for the documents register. They were `any`, so an
 * unvalidated body went straight into Prisma (E2E audit P2 / D2). Every field
 * carries a decorator: the global ValidationPipe whitelists, and an undecorated
 * field would be rejected as forbidden.
 */
export class CreateSchoolDocDto {
  @IsOptional() @IsString() ownerType?: string;
  @IsString() @IsNotEmpty() ownerId!: string;
  @IsOptional() @IsString() category?: string;
  @IsString() @IsNotEmpty() type!: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsString() @IsNotEmpty() fileId!: string;
  @IsOptional() @IsString() signatureFileId?: string;
  @IsOptional() @IsISO8601() expiresAt?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) accessRoles?: string[];
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}

export class UpdateSchoolDocDto {
  @IsOptional() @IsString() @IsNotEmpty() title?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsISO8601() expiresAt?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) accessRoles?: string[];
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() changeNote?: string;
  @IsOptional() @IsString() fileId?: string;
}

export class VerifySchoolDocDto {
  @IsBoolean() verified!: boolean;
}

export class SignSchoolDocDto {
  @IsString() @IsNotEmpty() signatureFileId!: string;
}
