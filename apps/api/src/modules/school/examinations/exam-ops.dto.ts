import { ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

const REG_STATUS = ['registered', 'sat', 'absent', 'withheld'] as const;

export class CreateExamVenueDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() campusId?: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
}

export class UpdateExamVenueDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class RegisterClassDto {
  @IsString() @IsNotEmpty() examId!: string;
  @IsString() @IsNotEmpty() classId!: string;
}

export class RegisterCandidatesDto {
  @IsString() @IsNotEmpty() examId!: string;
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) studentProfileIds!: string[];
  @IsOptional() @IsString() classId?: string;
}

export class UpdateExamRegistrationDto {
  @IsIn([...REG_STATUS]) status!: (typeof REG_STATUS)[number];
  @IsOptional() @IsString() venueId?: string;
  @IsOptional() @IsString() seatNumber?: string;
}

export class AllocateSeatsDto {
  @IsString() @IsNotEmpty() examId!: string;
  @IsString() @IsNotEmpty() venueId!: string;
}
