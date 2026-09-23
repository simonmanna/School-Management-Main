import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';

/**
 * PermissionResolverService — "what may this caller do?", answered once.
 *
 * Extracted from PermissionsGuard so that code running BEHIND the guard can ask
 * the same question and get the same answer. The reporting runner needs this:
 * a generic controller can only carry a blanket route permission, so the
 * per-report grant has to be checked in the service layer, and checking it
 * against a different source than the guard would mean two different notions of
 * "granted" in one request.
 *
 * The two modes mirror the guard exactly (see PermissionsGuard's docblock):
 *   - DB mode (default, PERMISSIONS_DB_LOOKUP !== 'false') — re-read roles from
 *     Postgres. Revocation is immediate.
 *   - JWT mode — trust the token snapshot. Stale for up to JWT_TTL.
 *
 * Reading the JWT snapshot here while the guard reads the database would let a
 * revoked grant keep working for the length of a token, so the mode is shared
 * rather than re-decided.
 */
@Injectable()
export class PermissionResolverService {
  private readonly dbMode = process.env.PERMISSIONS_DB_LOOKUP !== 'false';

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /** Re-read a user's role permissions from Postgres. */
  /**
   * A deactivated, deleted or locked-out account holds NOTHING, even while its
   * access token is still inside its TTL — deactivation must take effect on the
   * next request, not up to JWT_ACCESS_TTL later. `includeInactive` exists only
   * for administrative comparisons (what authority would this account carry?).
   */
  async lookupPermissions(userId: string, opts: { includeInactive?: boolean } = {}): Promise<string[]> {
    const user = await this.prisma.client.user.findFirst({
      where: { id: userId, ...(opts.includeInactive ? {} : { isActive: true }) },
      include: { roles: true },
    });
    if (!user) return [];
    const all = new Set<string>();
    for (const role of user.roles as any[]) {
      for (const p of role.permissions ?? []) all.add(p);
    }
    return [...all];
  }

  /**
   * The caller's account state in one read: `null` when the account no longer
   * exists or is deactivated (the session must end), otherwise its permissions.
   */
  async sessionState(userId: string): Promise<{ permissions: string[] } | null> {
    const user = await this.prisma.client.user.findFirst({
      where: { id: userId, isActive: true },
      include: { roles: true },
    });
    if (!user) return null;
    const all = new Set<string>();
    for (const role of user.roles as any[]) {
      for (const p of role.permissions ?? []) all.add(p);
    }
    return { permissions: [...all] };
  }

  /** Everything the current caller holds, resolved under the active mode. */
  async grantedForCaller(): Promise<string[]> {
    const userId = this.tenant.userId;
    if (!userId) return this.tenant.permissions;
    if (!this.dbMode) return this.tenant.permissions;
    return this.lookupPermissions(userId);
  }

  /** True when the caller holds every one of `required`. */
  async hasAll(required: string[]): Promise<boolean> {
    if (required.length === 0) return true;
    const granted = await this.grantedForCaller();
    return required.every((p) => granted.includes(p));
  }
}
