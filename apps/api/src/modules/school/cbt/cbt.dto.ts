import { ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

const QUESTION_TYPE = ['mcq_single', 'mcq_multi', 'true_false', 'short_answer', 'numeric', 'matching', 'fill_blank', 'essay'] as const;

export class CreateQuestionBankDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() subjectId?: string;
  @IsOptional() @IsString() description?: string;
}

export class QuestionOptionDto {
  @IsString() @IsNotEmpty() label!: string;
  @IsOptional() @IsBoolean() isCorrect?: boolean;
  @IsOptional() @IsInt() order?: number;
}

export class CreateQuestionDto {
  @IsString() @IsNotEmpty() bankId!: string;
  @IsIn([...QUESTION_TYPE]) type!: (typeof QUESTION_TYPE)[number];
  @IsString() @IsNotEmpty() prompt!: string;
  @IsOptional() @IsNumber() @Min(0) marks?: number;
  @IsOptional() @IsObject() answerKey?: unknown;
  @IsOptional() @IsArray() tags?: unknown[];
  @IsOptional() @IsString() difficulty?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => QuestionOptionDto) options?: QuestionOptionDto[];
}

export class CreatePaperDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() subjectId?: string;
  @IsOptional() @IsInt() @Min(1) durationMinutes?: number;
  @IsOptional() @IsBoolean() isRandom?: boolean;
  @IsOptional() @IsObject() blueprint?: unknown;
}

export class AddPaperQuestionDto {
  @IsString() @IsNotEmpty() questionId!: string;
  @IsOptional() @IsInt() order?: number;
  @IsOptional() @IsNumber() @Min(0) marks?: number;
}

export class StartAttemptDto {
  @IsString() @IsNotEmpty() paperId!: string;
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsOptional() @IsString() studentAssessmentId?: string;
}

export class SaveResponseDto {
  @IsString() @IsNotEmpty() attemptId!: string;
  @IsString() @IsNotEmpty() questionId!: string;
  @IsOptional() @IsString() clientEventId?: string;
  @IsInt() @Min(0) sequenceNumber!: number;
  @IsObject() response!: Record<string, unknown>;
}

export class SubmitAttemptDto {
  @IsString() @IsNotEmpty() attemptId!: string;
  @IsOptional() @IsString() idempotencyKey?: string;
}
