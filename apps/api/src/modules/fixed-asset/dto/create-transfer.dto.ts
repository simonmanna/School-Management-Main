import { IsString, IsOptional, IsDateString } from 'class-validator';

export class CreateTransferDto {
  @IsOptional() @IsString() fromLocation?: string;
  @IsOptional() @IsString() toLocation?: string;
  @IsOptional() @IsString() fromBranchId?: string;
  @IsOptional() @IsString() toBranchId?: string;
  @IsOptional() @IsString() fromDepartment?: string;
  @IsOptional() @IsString() toDepartment?: string;
  @IsOptional() @IsString() fromPersonId?: string;
  @IsOptional() @IsString() toPersonId?: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() approvedBy?: string;
  @IsOptional() @IsDateString() transferDate?: string;
  @IsOptional() @IsString() notes?: string;
}
