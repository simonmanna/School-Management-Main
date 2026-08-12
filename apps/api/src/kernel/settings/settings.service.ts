import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { AuditService } from '../audit/audit.service';
import {
  assertScopeAllowed,
  coerceSettingValue,
  getSettingDefinition,
  ScopeType,
  SettingGroup,
  settingsForGroup,
} from './setting-registry';
import { SettingContext, SettingResolverService } from './setting-resolver.service';

/**
 * Settings live at system / organization / warehouse / category / product scope
 * (ADR-005). The Setting table has a nullable organizationId, so it is excluded
 * from the tenancy extension and scoped explicitly here via the raw client.
 *
 * Reads that need cascade resolution go through SettingResolverService; this
 * service handles writes (validated against the registry) and admin listing.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly resolver: SettingResolverService,
    private readonly audit: AuditService,
  ) {}

  listForOrganization() {
    return this.prisma.raw.setting.findMany({
      where: { organizationId: this.tenant.organizationId, scopeType: 'organization', scopeId: '' },
      orderBy: { key: 'asc' },
    });
  }

  /** Raw org-level row (legacy accessor). Callers read `.value`. */
  get(key: string) {
    return this.prisma.raw.setting.findFirst({
      where: {
        organizationId: this.tenant.optionalOrganizationId ?? null,
        scopeType: 'organization',
        scopeId: '',
        key,
      },
    });
  }

  /**
   * Write a setting at a given scope (organization by default). Registered keys
   * are validated + coerced against the registry; unregistered legacy keys are
   * stored as-is but only at organization level.
   */
  async set(
    key: string,
    value: unknown,
    opts: { scopeType?: ScopeType; scopeId?: string } = {},
  ) {
    const organizationId = this.tenant.organizationId;
    const scopeType = opts.scopeType ?? 'organization';
    const scopeId = scopeType === 'organization' ? '' : (opts.scopeId ?? '');

    const def = getSettingDefinition(key);
    let toStore = value;
    if (def) {
      try {
        assertScopeAllowed(def, scopeType);
        toStore = coerceSettingValue(def, value);
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
    } else if (scopeType !== 'organization') {
      throw new BadRequestException(`Unknown setting '${key}' cannot be scoped below organization.`);
    }
    if (scopeType !== 'organization' && !scopeId) {
      throw new BadRequestException(`A scopeId is required for ${scopeType}-level settings.`);
    }

    const existing = await this.prisma.raw.setting.findFirst({
      where: { organizationId, scopeType, scopeId, key },
    });
    const row = existing
      ? await this.prisma.raw.setting.update({
          where: { id: existing.id },
          data: { value: toStore as Prisma.InputJsonValue },
        })
      : await this.prisma.raw.setting.create({
          data: {
            organizationId,
            // Legacy `scope` column mirrors scopeType so old org-level readers still match.
            scope: scopeType,
            scopeType,
            scopeId,
            key,
            value: toStore as Prisma.InputJsonValue,
          },
        });

    this.resolver.invalidate(organizationId);
    await this.audit.record({
      entity: 'Setting',
      entityId: row.id,
      action: 'update',
      newValues: { key, scopeType, scopeId, value: toStore },
    });
    return row;
  }

  /** Remove an override so the value falls back up the cascade. */
  async unset(key: string, opts: { scopeType?: ScopeType; scopeId?: string } = {}) {
    const organizationId = this.tenant.organizationId;
    const scopeType = opts.scopeType ?? 'organization';
    const scopeId = scopeType === 'organization' ? '' : (opts.scopeId ?? '');
    await this.prisma.raw.setting.deleteMany({
      where: { organizationId, scopeType, scopeId, key },
    });
    this.resolver.invalidate(organizationId);
    await this.audit.record({
      entity: 'Setting',
      entityId: `${scopeType}:${scopeId}:${key}`,
      action: 'delete',
      newValues: { key, scopeType, scopeId },
    });
  }

  /**
   * Effective values for a settings group at a given scope, with the level each
   * value came from ('default' when unset). Drives the admin UI.
   *
   * Deprecated keys are omitted: they remain readable and writable through the
   * per-key endpoints so existing clients do not break, but showing them in the
   * admin UI implies the engine honors them, and it does not. Pass
   * `includeDeprecated` to see them anyway.
   */
  async listEffective(
    group: SettingGroup,
    ctx: SettingContext = {},
    opts: { includeDeprecated?: boolean } = {},
  ) {
    const defs = settingsForGroup(group).filter((d) => opts.includeDeprecated || !d.deprecated);
    return Promise.all(
      defs.map(async (def) => {
        const { value, source, scopeId } = await this.resolver.describe(def.key, ctx);
        return {
          key: def.key,
          label: def.label,
          description: def.description ?? null,
          type: def.type,
          enumValues: def.enumValues ?? null,
          cascades: def.cascades,
          scopeLevels: def.scopeLevels,
          value,
          source,
          scopeId,
        };
      }),
    );
  }

  /**
   * Org-level inventory-tracking defaults new products inherit. Read/written as a
   * single object over the generic Setting `inventory.default*` keys, so a product
   * with no explicit value falls back to these (see ProductService).
   */
  private static readonly INVENTORY_DEFAULT_KEYS: Record<string, string> = {
    costingMethod: 'inventory.defaultCostingMethod',
    pickingStrategy: 'inventory.defaultPickingStrategy',
    batchTracking: 'inventory.defaultBatchTracking',
    expiryTracking: 'inventory.defaultExpiryTracking',
    serialTracking: 'inventory.defaultSerialTracking',
  };

  async getInventoryDefaults() {
    const map = SettingsService.INVENTORY_DEFAULT_KEYS;
    const rows = await this.prisma.raw.setting.findMany({
      where: {
        organizationId: this.tenant.organizationId,
        scopeType: 'organization',
        scopeId: '',
        key: { in: Object.values(map) },
      },
    });
    const byKey = new Map(rows.map((r) => [r.key, r.value as unknown]));
    return {
      costingMethod: (byKey.get(map.costingMethod) as string | undefined) ?? null,
      pickingStrategy: (byKey.get(map.pickingStrategy) as string | undefined) ?? null,
      batchTracking: (byKey.get(map.batchTracking) as boolean | undefined) ?? false,
      expiryTracking: (byKey.get(map.expiryTracking) as boolean | undefined) ?? false,
      serialTracking: (byKey.get(map.serialTracking) as boolean | undefined) ?? false,
    };
  }

  async setInventoryDefaults(dto: Record<string, unknown>) {
    const map = SettingsService.INVENTORY_DEFAULT_KEYS;
    for (const [field, key] of Object.entries(map)) {
      if (dto[field] !== undefined) await this.set(key, dto[field]);
    }
    return this.getInventoryDefaults();
  }
}
