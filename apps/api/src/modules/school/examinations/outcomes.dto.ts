import { IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class CreateLearningOutcomeDto {
  @IsString() @IsNotEmpty() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() subjectId?: string;
  @IsOptional() @IsString() topicId?: string;
  @IsOptional() @IsString() competencyId?: string;
  /// Expected proficiency band.
  @IsOptional() @IsString() expectedLevel?: string;
  @IsOptional() @IsInt() @Min(0) order?: number;
}

export class UpdateLearningOutcomeDto {
  @IsOptional() @IsString() @IsNotEmpty() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() subjectId?: string;
  @IsOptional() @IsString() topicId?: string;
  @IsOptional() @IsString() competencyId?: string;
  @IsOptional() @IsString() expectedLevel?: string;
  @IsOptional() @IsInt() @Min(0) order?: number;
}

export class RecordOutcomeAchievementDto {
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsString() @IsNotEmpty() learningOutcomeId!: string;
  @IsString() @IsNotEmpty() termId!: string;
  /// 'not_met' | 'approaching' | 'met' | 'exceeded'.
  @IsIn(['not_met', 'approaching', 'met', 'exceeded']) level!: string;
  @IsOptional() @IsInt() @Min(0) masteryPercent?: number;
  @IsOptional() @IsString() comment?: string;
  @IsOptional() @IsString() assessedById?: string;
}
