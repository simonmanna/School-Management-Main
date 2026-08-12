/**
 * DTOs for the LMS module (homework, resources, announcements).
 *
 * H2/B6: class-validator classes (were bare interfaces). Import as values.
 */
import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const RESOURCE_TYPE = ['note', 'video', 'link', 'file', 'slide'] as const;
const ANN_SCOPE = ['school', 'campus', 'department', 'class', 'staff'] as const;
const ANN_PRIORITY = ['normal', 'urgent', 'info'] as const;
const ANN_AUDIENCE = ['all', 'parents', 'students', 'staff'] as const;

export class AttachmentInput {
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsNotEmpty() url!: string;
}

export class CreateHomeworkDto {
  @IsString() @IsNotEmpty() classId!: string;
  @IsOptional() @IsString() sectionId?: string;
  @IsString() @IsNotEmpty() subjectId!: string;
  @IsOptional() @IsString() termId?: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsString() @IsNotEmpty() dueDate!: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AttachmentInput) attachments?: AttachmentInput[];
  @IsOptional() @IsNumber() @Min(0) maxScore?: number;
}

export class UpdateHomeworkDto {
  @IsOptional() @IsString() @IsNotEmpty() classId?: string;
  @IsOptional() @IsString() sectionId?: string;
  @IsOptional() @IsString() @IsNotEmpty() subjectId?: string;
  @IsOptional() @IsString() termId?: string;
  @IsOptional() @IsString() @IsNotEmpty() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() dueDate?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AttachmentInput) attachments?: AttachmentInput[];
  @IsOptional() @IsNumber() @Min(0) maxScore?: number;
}

export class SubmitHomeworkDto {
  @IsString() @IsNotEmpty() assignmentId!: string;
  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AttachmentInput) attachments?: AttachmentInput[];
}

export class GradeSubmissionDto {
  @IsString() @IsNotEmpty() submissionId!: string;
  @IsNumber() @Min(0) score!: number;
  @IsOptional() @IsString() feedback?: string;
}

export class CreateLearningResourceDto {
  @IsOptional() @IsString() classId?: string;
  @IsOptional() @IsString() subjectId?: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsIn([...RESOURCE_TYPE]) type!: (typeof RESOURCE_TYPE)[number];
  @IsOptional() @IsString() url?: string;
  @IsOptional() @IsString() fileUrl?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsString() description?: string;
}

export class UpdateLearningResourceDto {
  @IsOptional() @IsString() classId?: string;
  @IsOptional() @IsString() subjectId?: string;
  @IsOptional() @IsString() @IsNotEmpty() title?: string;
  @IsOptional() @IsIn([...RESOURCE_TYPE]) type?: (typeof RESOURCE_TYPE)[number];
  @IsOptional() @IsString() url?: string;
  @IsOptional() @IsString() fileUrl?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsString() description?: string;
}

export class CreateAnnouncementDto {
  @IsIn([...ANN_SCOPE]) scope!: (typeof ANN_SCOPE)[number];
  @IsOptional() @IsString() scopeId?: string;
  @IsOptional() @IsString() classId?: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsString() @IsNotEmpty() body!: string;
  @IsOptional() @IsIn([...ANN_PRIORITY]) priority?: (typeof ANN_PRIORITY)[number];
  @IsOptional() @IsArray() @IsIn([...ANN_AUDIENCE], { each: true }) audience?: (typeof ANN_AUDIENCE)[number][];
  @IsOptional() @IsString() publishedAt?: string;
  @IsOptional() @IsString() expiresAt?: string;
}

export class UpdateAnnouncementDto {
  @IsOptional() @IsIn([...ANN_SCOPE]) scope?: (typeof ANN_SCOPE)[number];
  @IsOptional() @IsString() scopeId?: string;
  @IsOptional() @IsString() classId?: string;
  @IsOptional() @IsString() @IsNotEmpty() title?: string;
  @IsOptional() @IsString() @IsNotEmpty() body?: string;
  @IsOptional() @IsIn([...ANN_PRIORITY]) priority?: (typeof ANN_PRIORITY)[number];
  @IsOptional() @IsArray() @IsIn([...ANN_AUDIENCE], { each: true }) audience?: (typeof ANN_AUDIENCE)[number][];
  @IsOptional() @IsString() publishedAt?: string;
  @IsOptional() @IsString() expiresAt?: string;
}
