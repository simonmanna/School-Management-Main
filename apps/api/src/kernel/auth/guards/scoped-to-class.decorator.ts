import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { SCOPED_CLASS_FIELD_KEY, ScopedToClassGuard } from './scoped-to-class.guard';

/**
 * Restrict a route to a class the caller may actually touch.
 *
 * Add it alongside @RequirePermissions, which stays responsible for "may this
 * account use this feature at all":
 *
 *   @RequirePermissions(PERMISSIONS.school.attendance.write)
 *   @ScopedToClass('classId')
 *   markRegister(@Param('classId') id: string) { ... }
 *
 * The named field is read from the route params, then the body. Mirrors
 * @ScopedToStudent: fails closed when the field is absent, and every id in a
 * comma-separated list must be permitted.
 */
export function ScopedToClass(field: string) {
  return applyDecorators(SetMetadata(SCOPED_CLASS_FIELD_KEY, field), UseGuards(ScopedToClassGuard));
}
