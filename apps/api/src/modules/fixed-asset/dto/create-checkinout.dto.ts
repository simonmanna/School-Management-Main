import { IsString, IsOptional, IsDateString } from 'class-validator';

export class CreateCheckInOutDto {
  @IsOptional() @IsString() checkedOutTo?: string;
  @IsOptional() @IsString() checkedOutToType?: string;
  @IsOptional() @IsDateString() checkoutDate?: string;
  @IsOptional() @IsDateString() expectedReturnDate?: string;
  @IsOptional() @IsDateString() returnDate?: string;
  @IsOptional() @IsString() conditionBefore?: string;
  @IsOptional() @IsString() conditionAfter?: string;
  @IsOptional() @IsString() notes?: string;
}
