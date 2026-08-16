import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateInvigilatorDto {
  /// Staff/partner id when the invigilator is a school employee; omit for external.
  @IsOptional() @IsString() staffId?: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateInvigilatorDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class AssignInvigilatorDto {
  @IsString() @IsNotEmpty() examScheduleId!: string;
  @IsString() @IsNotEmpty() invigilatorId!: string;
}
