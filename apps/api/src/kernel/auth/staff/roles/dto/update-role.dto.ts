import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { RoleDataScope } from '@erp/shared';

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

  /**
   * Data scope — the "WHERE" dimension. Validated against RoleDataScope. An
   * actor may only set a scope no wider than their own (enforced in the
   * service via DataScopeService.canGrantScope).
   */
  @IsOptional()
  @IsIn(['own', 'class', 'department', 'school'])
  dataScope?: RoleDataScope;
}
