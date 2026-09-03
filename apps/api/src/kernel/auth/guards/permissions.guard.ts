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

  /** SEC-06 stage 2: refuse undecorated routes outright. See canActivate. */
  private static readonly strictMode = process.env.PERMISSIONS_FAIL_CLOSED === 'true';
  /** One line per handler, not one per request — this is a defect report, not traffic logging. */
  private static readonly warnedRoutes = new Set<string>();

  private warnUndecorated(label: string): void {
    if (PermissionsGuard.warnedRoutes.has(label)) return;
    PermissionsGuard.warnedRoutes.add(label);
    this.logger.warn(
      `${label} has no authorization policy; allowing any authenticated caller. ` +
        'Annotate it with @RequirePermissions or @NoPermissionRequired. ' +
        'Set PERMISSIONS_FAIL_CLOSED=true to refuse such routes.',
    );
  }

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

    const request = context.switchToHttp().getRequest<{ auth?: AuthUser }>();

    // SEC-06 — undecorated handlers no longer fall through to "allowed".
    //
    // This branch used to `return true` BEFORE the authentication check below,
    // so any handler that simply forgot `@RequirePermissions` was reachable
    // ANONYMOUSLY. 93 handlers were in that state, including
    // ApprovalsController#decide, AuditLogController#list and
    // OrganizationsController#deactivate. Absence of a decorator is not a
    // policy — it is a missing policy, and the safe reading of a missing policy
    // is "no".
    //
    // Two stages, because flipping straight to deny would break the ledger's
    // remaining handlers in one step:
    //   1. default — an undecorated route now requires a valid session. This
    //      removes anonymous access, which is the dangerous half.
    //   2. PERMISSIONS_FAIL_CLOSED=true — an undecorated route is refused
    //      outright. Turn this on once the ledger in
    //      test/unit/route-permission-exceptions.json reaches zero.
    //
    // Genuinely anonymous routes must say so with @Public(). A comment saying
    // "no auth" is not enforcement.
    if (!required || required.length === 0) {
      const label = `${context.getClass().name}#${context.getHandler().name}`;
      if (PermissionsGuard.strictMode) {
        throw new ForbiddenException(
          `Route ${label} has no authorization policy. Annotate it with @RequirePermissions, ` +
            '@NoPermissionRequired (session-only, with a reason) or @Public.',
        );
      }
      if (!request.auth) {
        throw new ForbiddenException('Authentication required');
      }
      this.warnUndecorated(label);
      return true;
    }

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