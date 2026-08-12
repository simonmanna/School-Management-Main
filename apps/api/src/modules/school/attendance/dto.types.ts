/**
 * DTOs for the Attendance module.
 *
 * H2/B6: class-validator classes (were bare interfaces). Import as values.
 */
import { IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

const ATT_STATUS = ['present', 'absent', 'late', 'excused'] as const;

export class AttendanceEntry {
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsIn([...ATT_STATUS]) status!: (typeof ATT_STATUS)[number];
  @IsOptional() @IsInt() @Min(0) minutesLate?: number;
  @IsOptional() @IsString() reason?: string;
}

export class BulkMarkAttendanceDto {
  @IsString() @IsNotEmpty() date!: string;
  @IsString() @IsNotEmpty() classId!: string;
  @IsOptional() @IsString() sectionId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttendanceEntry)
  entries!: AttendanceEntry[];
}
