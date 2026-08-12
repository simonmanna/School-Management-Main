import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class RunDepreciationDto {
  @IsString() period!: string;
  @IsOptional() @IsBoolean() postEntries?: boolean;
  @IsOptional() @IsString() assetId?: string;
}
