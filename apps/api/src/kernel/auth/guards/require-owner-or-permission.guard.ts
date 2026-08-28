import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EmployeeIdentityService } from '../employee-identity.service';

/**
 * Combined permission + ownership guard.
 *
 * `@RequireOwnerOrPermission('school:lessonplans:write', 'teacherPartnerId')`:
 *   1. allow when the caller holds the permission (admin / delegated scope);
 *   2. otherwise allow only when the resource owner IS the caller;
 *   3. otherwise 403.
 *
 * `ownerField` names the request param/body field carrying the owning
 * `StaffProfile.id`.
 *
 * ── What this used to do, and why it changed ────────────────────────────────
 * The previous implementation read the caller's teacher id from an
 * `x-teacher-partner-id` REQUEST HEADER, described as "trusted". Nothing ever
 * set it, and nothing stripped it either — so any client could have sent the
 * header matching the id in the URL and walked straight through. It also read
 * permissions from `request.tenant.permissions`, but the middleware populates
 * `request.auth` (`main.ts`), so the permission branch silently never fired.
 *
 * Identity now comes from the verified session via `EmployeeIdentityService`,
 * which resolves User → HrEmployee → Partner → StaffProfile server-side. No
 * client-supplied identity is trusted.
 */
export const OWNER_PERMISSION_KEY = 'ownerPermission';
export const OWNER_FIELD_KEY = 'ownerField';

@Injectable()
export class RequireOwnerOrPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly identity: EmployeeIdentityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.get<string>(OWNER_PERMISSION_KEY, context.getHandler());
    const ownerField = this.reflector.get<string>(OWNER_FIELD_KEY, context.getHandler());
    if (!permission || !ownerField) return true; // not configured on this handler

    const request = context.switchToHttp().getRequest();
    // `auth` is what the tenant middleware sets. (`tenant` never existed.)
    const perms: string[] = request.auth?.permissions ?? [];
    if (perms.includes(permission) || perms.includes('*')) return true;

    const resourceOwnerId: string | undefined =
      request.params?.[ownerField] ?? request.body?.[ownerField];
    if (!resourceOwnerId) {
      throw new ForbiddenException(
        'You may only modify records you own, or you require the appropriate permission.',
      );
    }

    if (await this.identity.isSelfTeacher(resourceOwnerId)) return true;

    throw new ForbiddenException(
      'You may only modify records you own, or you require the appropriate permission.',
    );
  }
}
