import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsArray, Min } from 'class-validator';

/* ── SchoolCalendarEvent ─────────────────────────────────────────────────── */
export class CreateCalendarEventDto {
  @IsString() @IsNotEmpty() title!: string;
  @IsIn(['holiday', 'working_day', 'event', 'exam', 'meeting', 'trip', 'sports', 'ceremony']) type!: string;
  @IsString() @IsNotEmpty() startDate!: string; // ISO
  @IsString() @IsNotEmpty() endDate!: string; // ISO
  @IsOptional() @IsString() termId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() allDay?: boolean;
}
export class UpdateCalendarEventDto {
  @IsOptional() @IsString() @IsNotEmpty() title?: string;
  @IsOptional() @IsIn(['holiday', 'working_day', 'event', 'exam', 'meeting', 'trip', 'sports', 'ceremony']) type?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() endDate?: string;
  @IsOptional() @IsString() termId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() allDay?: boolean;
}

/* ── SchoolPolicy ───────────────────────────────────────────────────────── */
export class CreateSchoolPolicyDto {
  @IsString() @IsNotEmpty() key!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() category?: string;
  // value accepted as any JSON-serialisable payload
  value!: unknown;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateSchoolPolicyDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() category?: string;
  value?: unknown;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

/* ── CustomField ────────────────────────────────────────────────────────── */
export class CreateCustomFieldDto {
  @IsString() @IsNotEmpty() entityType!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsNotEmpty() label!: string;
  @IsOptional() @IsIn(['text', 'number', 'date', 'select', 'boolean', 'textarea']) type?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) options?: string[];
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() @Min(0) order?: number;
}
export class UpdateCustomFieldDto {
  @IsOptional() @IsString() @IsNotEmpty() label?: string;
  @IsOptional() @IsIn(['text', 'number', 'date', 'select', 'boolean', 'textarea']) type?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) options?: string[];
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() @Min(0) order?: number;
}
