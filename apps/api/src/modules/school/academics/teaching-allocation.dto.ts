import { ArrayMaxSize, IsArray, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class AllocationCellDto {
  @IsString() @IsNotEmpty() classId!: string;
  @IsOptional() @IsString() sectionId?: string | null;
  @IsString() @IsNotEmpty() subjectId!: string;
  /** null clears the cell. */
  @IsOptional() @IsString() teacherPartnerId!: string | null;
}

export class ClassTeacherCellDto {
  @IsString() @IsNotEmpty() classId!: string;
  @IsOptional() @IsString() sectionId?: string | null;
  /** null clears the class teacher. */
  @IsOptional() @IsString() staffProfileId!: string | null;
}

export class SaveAllocationDto {
  @IsString() @IsNotEmpty() termId!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => AllocationCellDto)
  cells?: AllocationCellDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => ClassTeacherCellDto)
  classTeachers?: ClassTeacherCellDto[];
}

export class CopyAllocationDto {
  @IsString() @IsNotEmpty() fromTermId!: string;
  @IsString() @IsNotEmpty() toTermId!: string;
}
