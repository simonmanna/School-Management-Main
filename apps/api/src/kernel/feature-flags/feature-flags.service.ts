import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';

/**
 * F.5 — Per-tenant feature flags + vertical module enablement.
 *
 * Two layers:
 *   - `FeatureFlag`: arbitrary key/value flags (e.g. `enableFiscalYearLock`).
 *   - `OrganizationModule`: the canonical record of which vertical modules
 *     are active for a tenant. Set during onboarding or via the in-app
 *     "Modules" page.
 *
 * Absence of a `FeatureFlag` row means the flag is OFF (fail-closed). Use
 * `assertEnabled` to gate code paths.
 */
@Injectable()
export class FeatureFlagsService implements OnModuleInit {
  private readonly logger = new Logger('FeatureFlagsService');
  private cache = new Map<string, Map<string, { enabled: boolean; payload: Record<string, unknown> }>>();
  /** Per-org module enablement, cached on the same TTL — `ModuleEnabledGuard`
   *  consults this on every gated request, so it must not hit the DB each time. */
  private moduleCache = new Map<string, Map<string, boolean>>();
  /** Per-org "has this tenant configured modules at all?" — see ModuleEnabledGuard. */
  private moduleConfiguredCache = new Map<string, boolean>();
  private static readonly TTL_MS = 30_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  onModuleInit(): void {
    // Periodic cache flush.
    setInterval(() => {
      this.cache.clear();
      this.moduleCache.clear();
      this.moduleConfiguredCache.clear();
    }, FeatureFlagsService.TTL_MS).unref();
  }

  /** Drop cached module state for the current org (after enable/disable). */
  private invalidateModules(orgId: string): void {
    this.moduleCache.delete(orgId);
    this.moduleConfiguredCache.delete(orgId);
  }

  async isEnabled(key: string): Promise<boolean> {
    return (await this.get(key))?.enabled ?? false;
  }

  async assertEnabled(key: string): Promise<void> {
    if (!(await this.isEnabled(key))) {
      throw new Error(`Feature '${key}' is not enabled for this organization`);
    }
  }

  async get(key: string): Promise<{ enabled: boolean; payload: Record<string, unknown> } | null> {
    const orgId = this.tenant.organizationId;
    let orgCache = this.cache.get(orgId);
    if (!orgCache) {
      orgCache = new Map();
      this.cache.set(orgId, orgCache);
    }
    const cached = orgCache.get(key);
    if (cached) return cached;
    const row = await this.prisma.raw.featureFlag.findUnique({
      where: { organizationId_key: { organizationId: orgId, key } },
    });
    if (!row) {
      orgCache.set(key, { enabled: false, payload: {} });
      return null;
    }
    const val = { enabled: row.enabled, payload: (row.payload as Record<string, unknown>) ?? {} };
    orgCache.set(key, val);
    return val;
  }

  set(key: string, enabled: boolean, payload: Record<string, unknown> = {}) {
    return this.prisma.client.featureFlag.upsert({
      where: { organizationId_key: { organizationId: this.tenant.organizationId, key } },
      update: { enabled, payload: payload as any },
      create: { organizationId: this.tenant.organizationId, key, enabled, payload: payload as any },
    });
  }

  unset(key: string) {
    return this.prisma.client.featureFlag.deleteMany({
      where: { organizationId: this.tenant.organizationId, key },
    });
  }

  list() {
    return this.prisma.client.featureFlag.findMany({
      where: { organizationId: this.tenant.organizationId },
      orderBy: { key: 'asc' },
    });
  }

  // ---- Vertical module enablement ----

  enableModule(name: string, config: Record<string, unknown> = {}) {
    this.invalidateModules(this.tenant.organizationId);
    return this.prisma.client.organizationModule.upsert({
      where: { organizationId_moduleName: { organizationId: this.tenant.organizationId, moduleName: name } },
      update: { isActive: true, disabledAt: null, config: config as any },
      create: { organizationId: this.tenant.organizationId, moduleName: name, isActive: true, config: config as any },
    });
  }

  disableModule(name: string) {
    this.invalidateModules(this.tenant.organizationId);
    return this.prisma.client.organizationModule.updateMany({
      where: { organizationId: this.tenant.organizationId, moduleName: name },
      data: { isActive: false, disabledAt: new Date() },
    });
  }

  listModules() {
    return this.prisma.client.organizationModule.findMany({
      where: { organizationId: this.tenant.organizationId },
      orderBy: { moduleName: 'asc' },
    });
  }

  async isModuleEnabled(name: string): Promise<boolean> {
    const orgId = this.tenant.organizationId;
    let orgCache = this.moduleCache.get(orgId);
    if (!orgCache) {
      orgCache = new Map();
      this.moduleCache.set(orgId, orgCache);
    }
    const cached = orgCache.get(name);
    if (cached !== undefined) return cached;
    const row = await this.prisma.raw.organizationModule.findUnique({
      where: { organizationId_moduleName: { organizationId: orgId, moduleName: name } },
    });
    const enabled = !!row?.isActive;
    orgCache.set(name, enabled);
    return enabled;
  }

  /**
   * Has this tenant configured module enablement at all? Used by
   * `ModuleEnabledGuard` to distinguish "explicitly disabled" from "never set
   * up", so shipping the guard cannot silently revoke a live tenant's modules.
   */
  async hasAnyModuleRow(): Promise<boolean> {
    const orgId = this.tenant.organizationId;
    const cached = this.moduleConfiguredCache.get(orgId);
    if (cached !== undefined) return cached;
    const count = await this.prisma.raw.organizationModule.count({ where: { organizationId: orgId } });
    const configured = count > 0;
    this.moduleConfiguredCache.set(orgId, configured);
    return configured;
  }
}
