import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Length,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(10, { message: 'password must be at least 10 characters' })
  @Length(0, 128)
  password!: string;

  @IsString()
  @Length(1, 64)
  firstName!: string;

  @IsOptional()
  @IsString()
  @Length(0, 64)
  lastName?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  roleIds!: string[];
}
