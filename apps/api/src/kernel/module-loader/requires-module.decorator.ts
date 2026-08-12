import { SetMetadata } from '@nestjs/common';

export const REQUIRES_MODULE_KEY = 'requires_module';

/**
 * Gates a controller (or a single route) behind a per-tenant module enablement,
 * i.e. an active `OrganizationModule` row for the current organization.
 *
 * This is the *tenant* layer. The `ENABLE_*` env flags in `app.module.ts` remain
 * the process-level kill switch: a module that is not imported at boot cannot be
 * reached at all, regardless of what a tenant has enabled. Apply this to the
 * optional verticals so one deployment can serve tenants with different module
 * sets.
 *
 * Use the module's manifest name (ADR-005), e.g. `manufacturing`, `rental`,
 * `repair`, `hr`, `fixed-asset`.
 */
export const RequiresModule = (moduleName: string) => SetMetadata(REQUIRES_MODULE_KEY, moduleName);
