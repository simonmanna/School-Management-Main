import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

/**
 * Permissions are typed as strings here; the service layer validates that each
 * entry is a known key from the shared PERMISSIONS catalog. This keeps the
 * DTO free of a custom decorator and lets RolesService emit a precise error
 * listing the unknown key.
 */
export class CreateRoleDto {
  @IsString()
  @Length(2, 64)
  @Matches(/^[A-Za-z0-9 _\-\.]+$/, {
    message: 'name may contain letters, digits, spaces, dashes, dots and underscores only',
  })
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 250)
  description?: string;

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions!: string[];

  @IsOptional()
  @IsBoolean()
  isSystem?: boolean;
}
