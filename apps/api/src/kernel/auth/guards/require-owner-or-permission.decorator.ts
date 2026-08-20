import { applyDecorators, UseGuards } from '@nestjs/common';
import { RequirePermissions } from '../decorators/require-permissions.decorator';
import {
  OWNER_FIELD_KEY,
  OWNER_PERMISSION_KEY,
  RequireOwnerOrPermissionGuard,
} from './require-owner-or-permission.guard';

/**
 * Add to a route in addition to @RequirePermissions(READ).
 *
 * Example:
 *   @RequirePermissions(PERMISSIONS.school.read)
 *   @RequireOwnerOrPermission('teacherPartnerId', PERMISSIONS.school.manageLessonPlans)
 *   update(@Param('teacherPartnerId') id: string) { ... }
 *
 * Semantics: a caller with the permission may act on any record; a caller without it
 * (e.g. a teacher-scoped portal session) may only act when the route/body's owner id
 * (the field named by the first argument) matches their teacher identity.
 */
export function RequireOwnerOrPermission(ownerField: string, permission: string) {
  return applyDecorators(
    // Stash the metadata the guard reads.
    (target: any, key?: string) => {
      if (key) {
        Reflect.defineMetadata(OWNER_PERMISSION_KEY, permission, target[key]);
        Reflect.defineMetadata(OWNER_FIELD_KEY, ownerField, target[key]);
      }
    },
    UseGuards(RequireOwnerOrPermissionGuard),
  );
}
