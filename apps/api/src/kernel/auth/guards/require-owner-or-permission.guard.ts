import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

/**
 * Combined role + ownership guard.
 *
 * A handler decorated with `@RequireOwnerOrPermission('school:lessonplans:write', 'teacherPartnerId')`
 * will:
 *   1. Allow the request if the caller holds the given permission (admin / delegated scope).
 *   2. Otherwise, if the caller's request carries `x-teacher-partner-id` and the *resolved resource
 *      owner id* equals it, allow the request.
 *   3. Otherwise 403.
 *
 * The `ownerField` is the name of a request field (param/body, e.g. `teacherPartnerId`) whose value is
 * the StaffProfile id that owns the resource. This confines teacher self-service writes to the teacher's
 * own rows without fabricating a JWT→StaffProfile join (StaffProfile has no userId column).
 *
 * Permission checks read `request.tenant.permissions` (populated by the auth/permissions guard per
 * request), exactly like `@RequirePermissions`. The caller's teacher identity is read from the trusted
 * `x-teacher-partner-id` header set by the school portal's teacher session exchange.
 */
export const OWNER_PERMISSION_KEY = 'ownerPermission';
export const OWNER_FIELD_KEY = 'ownerField';

@Injectable()
export class RequireOwnerOrPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const permission = this.reflector.get<string>(OWNER_PERMISSION_KEY, context.getHandler());
    const ownerField = this.reflector.get<string>(OWNER_FIELD_KEY, context.getHandler());
    if (!permission || !ownerField) return true; // not configured on this handler

    const request = context.switchToHttp().getRequest();
    const perms: string[] = request.tenant?.permissions ?? [];
    if (perms.includes(permission) || perms.includes('*')) return true;

    // Trusted teacher session identity (set by the portal token exchange, not by the client directly).
    const callerTeacherId =
      (request.headers['x-teacher-partner-id'] as string | undefined) ??
      (request as any).teacherPartnerId;
    const resourceOwnerId = request.params?.[ownerField] ?? request.body?.[ownerField];

    if (!callerTeacherId || !resourceOwnerId || callerTeacherId !== resourceOwnerId) {
      throw new ForbiddenException(
        'You may only modify records you own, or you require the appropriate permission.',
      );
    }
    return true;
  }
}
