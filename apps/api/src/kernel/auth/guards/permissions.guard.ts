import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PermissionResolverService } from '../permission-resolver.service';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { NO_PERMISSION_REQUIRED_KEY } from '../decorators/no-permission-required.decorator';
import type { AuthUser } from '../jwt-token.service';
import { TenantContextService } from '../../tenancy/tenant-context.service';

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
  /**
   * Fail-closed is the production default: the ledger of undecorated routes is
   * empty, so an undecorated handler is a new defect and must be refused, not
   * served to every authenticated caller (a parent portal account included).
   * PERMISSIONS_FAIL_CLOSED=false opts out explicitly; outside production it is opt-in.
   */
  private static readonly strictMode =
    process.env.PERMISSIONS_FAIL_CLOSED === 'true' ||
    (process.env.NODE_ENV === 'production' && process.env.PERMISSIONS_FAIL_CLOSED !== 'false');
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
    private readonly tenant: TenantContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Explicit opt-outs take precedence: a route is either public, explicitly
    // session-only (with a recorded reason), or gated by permissions.
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()])) {
      return true;
    }
    const request = context.switchToHttp().getRequest<{ auth?: AuthUser }>();

    // A deactivated or deleted account loses the session on its NEXT request,
    // not when its access token expires. Portal and staff alike; one indexed
    // read, which DB mode needs anyway for the permission set below.
    let dbGrants: string[] | null = null;
    if (request.auth && this.dbMode) {
      const state = await this.resolver.sessionState(request.auth.sub);
      if (!state) throw new UnauthorizedException('This account is no longer active');
      dbGrants = state.permissions;
      // Services that make their own authorization decisions (capacity override,
      // re-opening a year, role grants, approvals) read `tenant.permissions`.
      // Give them the database's answer, not the token's up-to-15-minute-old copy.
      const store = this.tenant.store;
      if (store) store.permissions = dbGrants;
    }

    if (this.reflector.getAllAndOverride<string>(NO_PERMISSION_REQUIRED_KEY, [context.getHandler(), context.getClass()])) {
      if (!request.auth) throw new ForbiddenException('Authentication required');
      return true;
    }

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

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
      granted = dbGrants ?? [];
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