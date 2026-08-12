import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { REQUIRES_MODULE_KEY } from './requires-module.decorator';

/**
 * Enforces `@RequiresModule(...)` (ADR-005): a tenant may only reach an optional
 * vertical's routes when it has an active `OrganizationModule` row.
 *
 * Registered globally in `kernel.module.ts`. Routes without the decorator are
 * unaffected and pay only a metadata lookup.
 *
 * **Unconfigured tenants are allowed through.** An organization with zero
 * `OrganizationModule` rows has never used the Modules page, so treating its
 * empty set as "everything disabled" would take working modules away from an
 * existing deployment the moment this guard ships. Such a tenant is allowed and
 * warned once; run `apps/api/prisma/backfill-organization-modules.ts` to write
 * explicit rows, after which the guard is strictly fail-closed for that tenant.
 */
@Injectable()
export class ModuleEnabledGuard implements CanActivate {
  private readonly logger = new Logger('ModuleEnabledGuard');
  private readonly warned = new Set<string>();

  constructor(
    private readonly reflector: Reflector,
    private readonly tenant: TenantContextService,
    private readonly flags: FeatureFlagsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string>(REQUIRES_MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    // No tenant context (public/unauthenticated route). Authentication guards
    // own that decision; there is no organization whose modules we could check.
    const orgId = this.tenant.optionalOrganizationId;
    if (!orgId) return true;

    if (!(await this.flags.hasAnyModuleRow())) {
      if (!this.warned.has(orgId)) {
        this.warned.add(orgId);
        this.logger.warn(
          `Organization ${orgId} has no OrganizationModule rows; allowing '${required}' by default. ` +
            'Run prisma/backfill-organization-modules.ts to make module gating explicit for this tenant.',
        );
      }
      return true;
    }

    if (!(await this.flags.isModuleEnabled(required))) {
      throw new ForbiddenException(`Module '${required}' is not enabled for this organization`);
    }
    return true;
  }
}
