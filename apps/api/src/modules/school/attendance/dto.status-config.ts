import {
  IsBoolean,
  IsHexColor,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class CreateAttendanceStatusConfigDto {
  /// Stable machine code used as StudentAttendance.status (e.g. "present").
  @IsString()
  @Matches(/^[a-z0-9_]+$/, {
    message: 'Code must be lowercase letters/numbers/underscore (e.g. "present").',
  })
  code!: string;

  @IsString() label!: string;

  @IsOptional() @IsHexColor() color?: string;

  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() isPresent?: boolean;
  @IsOptional() @IsBoolean() isLate?: boolean;
  @IsOptional() @IsBoolean() isAbsent?: boolean;
  /** Excused absence — its denominator treatment is the school's choice (ADR-032 P1). */
  @IsOptional() @IsBoolean() isExcused?: boolean;
}

export class UpdateAttendanceStatusConfigDto {
  @IsOptional()
  @Matches(/^[a-z0-9_]+$/, {
    message: 'Code must be lowercase letters/numbers/underscore (e.g. "present").',
  })
  code?: string;

  @IsOptional() @IsString() label?: string;
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() isPresent?: boolean;
  @IsOptional() @IsBoolean() isLate?: boolean;
  @IsOptional() @IsBoolean() isAbsent?: boolean;
  /** Excused absence — its denominator treatment is the school's choice (ADR-032 P1). */
  @IsOptional() @IsBoolean() isExcused?: boolean;
}
