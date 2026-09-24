import { ArrayUnique, IsArray, IsEmail, IsOptional, IsString, Length } from 'class-validator';

export class InviteUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(1, 64)
  firstName!: string;

  @IsOptional()
  @IsString()
  @Length(0, 64)
  lastName?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  roleIds?: string[];
}
