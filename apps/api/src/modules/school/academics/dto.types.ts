/**
 * DTOs for the Academics module.
 *
 * H2/B6: class-validator classes (were bare interfaces). Import as values.
 */
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CurriculumSubjectInput {
  @IsString() @IsNotEmpty() subjectId!: string;
  @IsInt() @Min(1) periodsPerWeek!: number;
  @IsOptional() @IsBoolean() isCore?: boolean;
}

export class CreateCurriculumDto {
  @IsString() @IsNotEmpty() classId!: string;
  @IsString() @IsNotEmpty() academicYearId!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() description?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CurriculumSubjectInput)
  subjects!: CurriculumSubjectInput[];
}

export class UpdateCurriculumDto {
  @IsOptional() @IsString() @IsNotEmpty() classId?: string;
  @IsOptional() @IsString() @IsNotEmpty() academicYearId?: string;
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CurriculumSubjectInput)
  subjects?: CurriculumSubjectInput[];
}

export class CreateLessonPlanDto {
  @IsString() @IsNotEmpty() subjectId!: string;
  @IsOptional() @IsString() classId?: string;
  @IsOptional() @IsString() termId?: string;
  @IsOptional() @IsString() teacherPartnerId?: string;
  @IsString() @IsNotEmpty() weekOf!: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsOptional() @IsString() objectives?: string;
  @IsOptional() @IsString() materials?: string;
}

export class UpdateLessonPlanDto {
  @IsOptional() @IsString() @IsNotEmpty() subjectId?: string;
  @IsOptional() @IsString() classId?: string;
  @IsOptional() @IsString() termId?: string;
  @IsOptional() @IsString() teacherPartnerId?: string;
  @IsOptional() @IsString() weekOf?: string;
  @IsOptional() @IsString() @IsNotEmpty() title?: string;
  @IsOptional() @IsString() objectives?: string;
  @IsOptional() @IsString() materials?: string;
}

export class CreateTeacherAssignmentDto {
  @IsString() @IsNotEmpty() teacherPartnerId!: string;
  @IsString() @IsNotEmpty() subjectId!: string;
  @IsString() @IsNotEmpty() classId!: string;
  @IsOptional() @IsString() sectionId?: string;
  @IsOptional() @IsString() termId?: string;
  @IsOptional() @IsInt() @Min(1) periodsPerWeek?: number;
}

export class UpdateTeacherAssignmentDto {
  @IsOptional() @IsString() @IsNotEmpty() teacherPartnerId?: string;
  @IsOptional() @IsString() @IsNotEmpty() subjectId?: string;
  @IsOptional() @IsString() @IsNotEmpty() classId?: string;
  @IsOptional() @IsString() sectionId?: string;
  @IsOptional() @IsString() termId?: string;
  @IsOptional() @IsInt() @Min(1) periodsPerWeek?: number;
}

export class CreateTimetableSlotDto {
  @IsString() @IsNotEmpty() classId!: string;
  @IsOptional() @IsString() sectionId?: string;
  @IsInt() @Min(1) @Max(7) dayOfWeek!: number; // 1=Mon ... 7=Sun
  @IsString() @IsNotEmpty() periodId!: string;
  @IsString() @IsNotEmpty() subjectId!: string;
  @IsOptional() @IsString() teacherPartnerId?: string;
  @IsOptional() @IsString() campusId?: string;
  @IsOptional() @IsString() room?: string;
}

export class BulkTimetableSlot {
  @IsInt() @Min(1) @Max(7) dayOfWeek!: number;
  @IsString() @IsNotEmpty() periodId!: string;
  @IsString() @IsNotEmpty() subjectId!: string;
  @IsOptional() @IsString() teacherPartnerId?: string;
  @IsOptional() @IsString() campusId?: string;
  @IsOptional() @IsString() room?: string;
}

export class BulkTimetableDto {
  @IsString() @IsNotEmpty() classId!: string;
  @IsOptional() @IsString() sectionId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkTimetableSlot)
  slots!: BulkTimetableSlot[];
}

export class UpdateTimetableSlotDto {
  @IsOptional() @IsString() @IsNotEmpty() classId?: string;
  @IsOptional() @IsString() sectionId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(7) dayOfWeek?: number;
  @IsOptional() @IsString() @IsNotEmpty() periodId?: string;
  @IsOptional() @IsString() @IsNotEmpty() subjectId?: string;
  @IsOptional() @IsString() teacherPartnerId?: string;
  @IsOptional() @IsString() campusId?: string;
  @IsOptional() @IsString() room?: string;
}
