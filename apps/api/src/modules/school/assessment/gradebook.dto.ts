import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class GradebookCellDto {
  @IsString() studentProfileId!: string;
  @IsString() assessmentId!: string;

  /** null clears the cell. */
  @IsOptional() @IsNumber() marks?: number | null;

  @IsOptional() @IsIn(['present', 'absent', 'exempt', 'excused', 'malpractice'])
  participation?: string;
}

export class GradebookColumnDto {
  @IsString() classId!: string;
  @IsString() termId!: string;
  @IsString() subjectId!: string;
  @IsString() title!: string;

  @IsOptional() @IsNumber() @Min(1) maxScore?: number;

  /** Attach to a weighting-policy component, or leave null for an ungraded column. */
  @IsOptional() @IsString() componentId?: string;

  @IsOptional() @IsString() dueAt?: string;
}

export class UpdateGradebookColumnDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsNumber() @Min(1) maxScore?: number;
  @IsOptional() @IsString() componentId?: string | null;
  @IsOptional() @IsBoolean() hiddenFromStudents?: boolean;
  @IsOptional() @IsString() dueAt?: string | null;
}

export class LockColumnDto {
  @IsBoolean() locked!: boolean;
}
