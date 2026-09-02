import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// ───────────── CourseOffering ─────────────
export class CreateCourseOfferingDto {
  @IsString() @IsNotEmpty() academicYearId!: string;
  @IsString() @IsNotEmpty() termId!: string;
  @IsString() @IsNotEmpty() subjectId!: string;
  @IsString() @IsNotEmpty() classId!: string;
  @IsOptional() @IsString() sectionId?: string;
  @IsString() @IsNotEmpty() curriculumId!: string; // a Curriculum (version row)
  @IsOptional() @IsArray() @IsString({ each: true }) teacherPartnerIds?: string[];
}

export class AddCourseOfferingTeacherDto {
  @IsString() @IsNotEmpty() teacherPartnerId!: string;
  @IsOptional() @IsIn(['lead', 'assistant']) role?: 'lead' | 'assistant';
}

// ───────────── LessonPlan ─────────────
export class LessonPlanObjectiveDto {
  @IsString() @IsNotEmpty() learningObjectiveId!: string;
}

export class LessonPlanActivityDto {
  @IsOptional() @IsString() learningActivityId?: string;
  @IsOptional() @IsString() type?: string; // when creating inline activity
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() content?: string; // JSON string for inline activity
  @IsOptional() @IsInt() sequence?: number;
  @IsOptional() @IsInt() durationMin?: number;
  @IsOptional() @IsString() teacherInstructions?: string;
  @IsOptional() @IsString() studentInstructions?: string;
}

export class LessonPlanResourceDto {
  @IsString() @IsNotEmpty() learningResourceId!: string;
}

export class LessonPlanAssessmentDto {
  @IsIn(['formative', 'exit_ticket', 'success_criteria']) kind!: 'formative' | 'exit_ticket' | 'success_criteria';
  @IsString() @IsNotEmpty() prompt!: string;
  @IsOptional() @IsInt() sequence?: number;
}

export class LessonPlanDifferentiationDto {
  @IsOptional() @IsString() lessonPlanActivityId?: string;
  @IsOptional() @IsString() learningObjectiveId?: string;
  @IsIn(['support', 'core', 'extension']) tier!: 'support' | 'core' | 'extension';
  @IsString() @IsNotEmpty() description!: string;
}

export class CreateLessonPlanDto {
  /**
   * Phase 3: a plan belongs to a teaching context. Subject, class, term and
   * curriculum version are read from the offering when they are not sent, and
   * are rejected when they contradict it.
   */
  @IsString() @IsNotEmpty() courseOfferingId!: string;
  @IsOptional() @IsString() curriculumVersionId?: string;
  @IsOptional() @IsString() subjectId?: string;
  @IsOptional() @IsString() classId?: string;
  @IsOptional() @IsString() termId?: string;
  @IsOptional() @IsString() teacherPartnerId?: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsOptional() @IsString() weekOf?: string; // ISO date
  /** Scheme-of-work week this plan delivers. */
  @IsOptional() @IsString() schemeOfWorkWeekId?: string;
  /** Curriculum outcomes this plan covers. */
  @IsOptional() @IsArray() @IsString({ each: true }) learningOutcomeIds?: string[];
  @IsOptional() @IsString() objectives?: string;
  @IsOptional() @IsString() materials?: string;
  @IsOptional() @IsString() unitId?: string;
  @IsOptional() @IsString() topicId?: string;
  @IsOptional() @IsString() subtopic?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => LessonPlanObjectiveDto) objectivesList?: LessonPlanObjectiveDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => LessonPlanActivityDto) activities?: LessonPlanActivityDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => LessonPlanResourceDto) resources?: LessonPlanResourceDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => LessonPlanAssessmentDto) assessments?: LessonPlanAssessmentDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => LessonPlanDifferentiationDto) differentiation?: LessonPlanDifferentiationDto[];
}

export class UpdateLessonPlanDto {
  @IsOptional() @IsString() courseOfferingId?: string;
  @IsOptional() @IsString() schemeOfWorkWeekId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) learningOutcomeIds?: string[];
  @IsOptional() @IsString() curriculumVersionId?: string;
  @IsOptional() @IsString() subjectId?: string;
  @IsOptional() @IsString() classId?: string;
  @IsOptional() @IsString() termId?: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() weekOf?: string;
  @IsOptional() @IsString() objectives?: string;
  @IsOptional() @IsString() materials?: string;
  @IsOptional() @IsString() unitId?: string;
  @IsOptional() @IsString() topicId?: string;
  @IsOptional() @IsString() subtopic?: string;
  /** Optimistic concurrency guard — must match current version or 409. */
  @IsInt() @Min(1) version!: number;
}

export class SubmitLessonPlanDto {
  @IsInt() @Min(1) version!: number;
}

export class ReviewLessonPlanDto {
  @IsIn(['approved', 'needs_revision']) toStatus!: 'approved' | 'needs_revision';
  @IsOptional() @IsString() comment?: string;
  @IsOptional() @IsString() requestedChanges?: string;
}

/**
 * One workflow move on a lesson plan, expressed as the state to reach.
 *
 * The web client drives the plan's buttons off the target status, so a single
 * endpoint that dispatches is a better fit than making it choose between
 * `submit` and `review`. `version` stays optional but is honoured when sent —
 * dropping it silently would remove the optimistic-concurrency guard that
 * `submitLessonPlan` relies on.
 */
export class TransitionLessonPlanDto {
  @IsIn(['submitted', 'approved', 'needs_revision', 'archived', 'draft'])
  action!: 'submitted' | 'approved' | 'needs_revision' | 'archived' | 'draft';

  @IsOptional() @IsInt() @Min(1) version?: number;
  @IsOptional() @IsString() comment?: string;
  @IsOptional() @IsString() requestedChanges?: string;
}

export class SaveTemplateDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsIn(['school', 'department', 'subject', 'teacher']) scope!: 'school' | 'department' | 'subject' | 'teacher';
  @IsOptional() @IsString() subjectId?: string;
  @IsOptional() @IsBoolean() isSchoolWide?: boolean;
}

export class CreateFromTimetableDto {
  @IsString() @IsNotEmpty() timetableSlotId!: string;
  @IsString() @IsNotEmpty() plannedDate!: string; // ISO date
  @IsOptional() @IsString() lessonPlanId?: string;
}

export class CreateLearningActivityDto {
  @IsString() @IsNotEmpty() type!: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsString() learningObjectiveId?: string;
}
