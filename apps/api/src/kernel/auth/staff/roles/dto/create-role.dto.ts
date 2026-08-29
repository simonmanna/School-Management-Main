import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { RoleDataScope } from '@erp/shared';

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

  /**
   * Data scope — the "WHERE" dimension of the role, independent of permissions
   * (the "WHAT"). Must be a valid RoleDataScope. Defaults to `school` in the
   * service when omitted, so existing callers are unaffected.
   */
  @IsOptional()
  @IsIn(['own', 'class', 'department', 'school'])
  dataScope?: RoleDataScope;
}
