import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PortalIdentityService } from '../portal-identity.service';

export const SCOPED_STUDENT_FIELD_KEY = 'scopedStudentField';

/**
 * Enforces "you may only ask about a pupil who is yours".
 *
 * The rule itself already existed — `PortalIdentityService.canAccessStudent` —
 * but it was reached through `assertMaySee()`, a PRIVATE method hand-called
 * inside `PortalsController`. That meant the protection lived at exactly one
 * call site: every new per-student route anywhere else in the school vertical
 * defaulted to the org-wide `school:read` gate and served whoever asked. Making
 * it a decorator is the difference between a rule you must remember to apply and
 * one you have to deliberately leave off.
 *
 * Staff pass through — `canAccessStudent` returns true for them — and stay
 * governed by their own school permissions. What this stops is one FAMILY
 * reading another's, which no permission string can express.
 */
@Injectable()
export class ScopedToStudentGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly portalIdentity: PortalIdentityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const field = this.reflector.get<string>(SCOPED_STUDENT_FIELD_KEY, context.getHandler());
    if (!field) return true; // not configured on this handler

    const request = context.switchToHttp().getRequest();
    const raw: unknown = request.params?.[field] ?? request.body?.[field];

    // A route declaring itself student-scoped but carrying no subject is a
    // programming error, not an authorization decision. Fail closed either way.
    if (typeof raw !== 'string' && !Array.isArray(raw)) {
      throw new ForbiddenException('No student was named for a student-scoped route');
    }

    // Several routes take a comma-separated list (the parent dashboard opens all
    // of a guardian's children at once). Every id must be permitted, not just one
    // — otherwise a caller appends a stranger's id to their own and reads both.
    const ids = (Array.isArray(raw) ? raw : raw.split(',')).map((s) => String(s).trim()).filter(Boolean);
    if (ids.length === 0) {
      throw new ForbiddenException('No student was named for a student-scoped route');
    }

    const allowed = await this.portalIdentity.filterAccessibleStudents(ids);
    if (allowed.length !== ids.length) {
      throw new ForbiddenException(
        ids.length === 1
          ? 'Not permitted to view this student'
          : 'Not permitted to view one or more of these students',
      );
    }
    return true;
  }
}
