import { IsOptional, IsString, IsNotEmpty } from 'class-validator';

export class CreateFrontDeskLogDto {
  @IsOptional() @IsString() partnerId?: string;
  @IsString() @IsNotEmpty() visitorName!: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() purpose?: string;
  @IsOptional() @IsString() personVisited?: string;
  @IsOptional() @IsString() notes?: string;
}

export class CheckoutFrontDeskDto {
  @IsOptional() @IsString() notes?: string;
}
