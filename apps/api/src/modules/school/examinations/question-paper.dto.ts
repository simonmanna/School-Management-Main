import { IsArray, IsNotEmpty, IsOptional, IsString, IsInt, Min } from 'class-validator';

export class CreateQuestionPaperDto {
  @IsString() @IsNotEmpty() examScheduleId!: string;
  @IsString() @IsNotEmpty() title!: string;
  /// 'theory' | 'practical' | 'alternative_to_practical' | 'oral'.
  @IsOptional() @IsString() paperKind?: string;
  @IsOptional() @IsInt() @Min(1) paperNumber?: number;
  @IsOptional() @IsInt() @Min(0) totalMarks?: number;
  /// Free-form question list: [{ number, text, marks }].
  @IsOptional() @IsArray() questions?: Array<{ number: number; text: string; marks: number }>;
  @IsOptional() @IsString() fileUrl?: string;
  @IsOptional() @IsString() setterId?: string;
  @IsOptional() @IsString() moderatorId?: string;
}

export class UpdateQuestionPaperDto {
  @IsOptional() @IsString() @IsNotEmpty() title?: string;
  @IsOptional() @IsString() paperKind?: string;
  @IsOptional() @IsInt() @Min(1) paperNumber?: number;
  @IsOptional() @IsInt() @Min(0) totalMarks?: number;
  @IsOptional() @IsArray() questions?: Array<{ number: number; text: string; marks: number }>;
  @IsOptional() @IsString() fileUrl?: string;
  @IsOptional() @IsString() setterId?: string;
  @IsOptional() @IsString() moderatorId?: string;
}
