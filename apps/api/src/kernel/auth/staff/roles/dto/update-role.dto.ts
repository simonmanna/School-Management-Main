import {
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @Length(2, 64)
  @Matches(/^[A-Za-z0-9 _\-\.]+$/, {
    message: 'name may contain letters, digits, spaces, dashes, dots and underscores only',
  })
  name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 250)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions?: string[];
}
