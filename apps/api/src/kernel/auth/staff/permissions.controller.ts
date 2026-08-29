import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, buildPermissionCatalog } from '@erp/shared';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/require-permissions.decorator';

/**
 * Exposes the permission catalog for the admin UI so it can render a
 * permission matrix without bundling its own copy of the keys.
 *
 * Returns a grouped shape:
 *   { groups: [{ group, subgroups: [{ subgroup, permissions: [{key,label,description,risk}] }] }] }
 * Labels/groups come from `PERMISSION_META` (with a `humaniseKey` fallback for
 * the plain-CRUD keys the matrix does not hand-annotate).
 *
 * Gated on `role:read`: a full capability map is free reconnaissance for a
 * tenant, so it is not public. The only consumer is `usePermissionCatalog` in
 * the staff admin screens, which already runs behind an authenticated session.
 */
@ApiTags('auth')
@Controller('auth/permissions')
@UseGuards(PermissionsGuard)
export class PermissionsController {
  @Get()
  @RequirePermissions(PERMISSIONS.role.read)
  catalog() {
    return buildPermissionCatalog();
  }
}
