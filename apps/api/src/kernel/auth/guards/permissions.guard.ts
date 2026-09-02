import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PermissionResolverService } from '../permission-resolver.service';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { NO_PERMISSION_REQUIRED_KEY } from '../decorators/no-permission-required.decorator';
import type { AuthUser } from '../jwt-token.service';

/**
 * D4-2: Permissions guard with two modes:
 *
 *   - JWT mode (default): trusts the permissions baked into the access token.
 *     Fast (no DB hit per request) but allows up to JWT_TTL minutes of staleness
 *     when a role is updated.
 *
 *   - DB mode (PERMISSIONS_DB_LOOKUP=true): re-reads the user's role permissions
 *     from Postgres on every authenticated request. ~3–15 ms overhead, but
 *     revocation is immediate. This is the recommended mode for the beta —
 *     JWT stays the cache, the DB is the source of truth.
 *
 * Wire via env flag `PERMISSIONS_DB_LOOKUP`. Default is DB mode for the beta.
 *
 * The lookup itself lives in PermissionResolverService so that code running
 * behind this guard (the reporting runner, which can only carry a blanket route
 * permission and must check the per-report grant itself) resolves permissions
 * from the same source under the same mode.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger('PermissionsGuard');
  private readonly dbMode = process.env.PERMISSIONS_DB_LOOKUP !== 'false';

  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: PermissionResolverService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Explicit opt-outs take precedence: a route is either public, explicitly
    // session-only (with a recorded reason), or gated by permissions.
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()])) {
      return true;
    }
    if (this.reflector.getAllAndOverride<string>(NO_PERMISSION_REQUIRED_KEY, [context.getHandler(), context.getClass()])) {
      return true;
    }

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ auth?: AuthUser }>();
    if (!request.auth) {
      throw new ForbiddenException('Authentication required');
    }

    let granted: string[];
    if (this.dbMode) {
      granted = await this.resolver.lookupPermissions(request.auth.sub);
    } else {
      granted = request.auth.permissions ?? [];
    }

    const ok = required.every((perm) => granted.includes(perm));
    if (!ok) {
      throw new ForbiddenException(`Missing required permission(s): ${required.join(', ')}`);
    }
    return true;
  }
}