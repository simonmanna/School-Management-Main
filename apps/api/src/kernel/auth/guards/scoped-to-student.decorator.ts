import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { SCOPED_STUDENT_FIELD_KEY, ScopedToStudentGuard } from './scoped-to-student.guard';

/**
 * Restrict a route to a pupil the caller may actually see.
 *
 * Add it alongside @RequirePermissions, which stays responsible for "may this
 * account use this feature at all":
 *
 *   @RequirePermissions(PERMISSIONS.school.parentPortal)
 *   @ScopedToStudent('studentProfileId')
 *   statement(@Param('studentProfileId') id: string) { ... }
 *
 * The named field is read from the route params, then the body. It may hold one
 * id or a comma-separated list; every id in the list must be permitted.
 */
export function ScopedToStudent(field: string) {
  return applyDecorators(SetMetadata(SCOPED_STUDENT_FIELD_KEY, field), UseGuards(ScopedToStudentGuard));
}
