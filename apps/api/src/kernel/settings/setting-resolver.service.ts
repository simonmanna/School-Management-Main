import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import {
  coerceSettingValue,
  getSettingDefinition,
  SCOPE_PRECEDENCE,
  ScopeType,
  SettingDefinition,
} from './setting-registry';

/**
 * Resolution context: the ids of the entities a setting is being resolved for.
 * Any subset may be supplied; missing levels are skipped.
 */
export interface SettingContext {
  productId?: string | null;
  categoryId?: string | null;
  warehouseId?: string | null;
}

interface CacheEntry {
  value: unknown;
  expires: number;
  version: number;
}

/**
 * Hierarchical setting resolver (ADR-005). Mirrors AccountDeterminationService:
 * business code calls typed helpers instead of reading Setting rows directly.
 *
 * Resolution order, most specific first:
 *   product -> category -> warehouse -> organization -> registry default.
 *
 * The Setting table has a nullable organizationId and is excluded from the
 * tenancy Prisma extension, so all access goes through `prisma.raw` scoped
 * explicitly by the current tenant.
 */
@Injectable()
export class SettingResolverService {
  private readonly TTL_MS = 30_000;
  private readonly cache = new Map<string, CacheEntry>();
  /** Per-org cache version; bumped on any write so stale entries are ignored. */
  private readonly orgVersion = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /** Drop cached values for an org (all orgs if omitted) after a write. */
  invalidate(organizationId?: string): void {
    if (!organizationId) {
      this.orgVersion.clear();
      this.cache.clear();
      return;
    }
    this.orgVersion.set(organizationId, (this.orgVersion.get(organizationId) ?? 0) + 1);
  }

  async resolve<T = unknown>(key: string, ctx: SettingContext = {}): Promise<T> {
    const def = getSettingDefinition(key);
    if (!def) throw new BadRequestException(`Unknown setting '${key}'.`);

    const organizationId = this.tenant.optionalOrganizationId ?? null;
    const version = organizationId ? (this.orgVersion.get(organizationId) ?? 0) : 0;
    const cacheKey = this.cacheKey(organizationId, def, ctx);

    const hit = this.cache.get(cacheKey);
    if (hit && hit.version === version && hit.expires > Date.now()) {
      return hit.value as T;
    }

    const { value } = await this.compute(def, organizationId, ctx);
    this.cache.set(cacheKey, { value, version, expires: Date.now() + this.TTL_MS });
    return value as T;
  }

  /**
   * Like {@link resolve} but also reports which scope level supplied the value
   * ('default' when no override exists). Uncached — for admin/read surfaces.
   */
  async describe(
    key: string,
    ctx: SettingContext = {},
  ): Promise<{ value: unknown; source: ScopeType | 'default'; scopeId: string | null }> {
    const def = getSettingDefinition(key);
    if (!def) throw new BadRequestException(`Unknown setting '${key}'.`);
    const organizationId = this.tenant.optionalOrganizationId ?? null;
    return this.compute(def, organizationId, ctx);
  }

  async resolveBool(key: string, ctx?: SettingContext): Promise<boolean> {
    return this.resolve<boolean>(key, ctx);
  }

  async resolveString(key: string, ctx?: SettingContext): Promise<string> {
    return this.resolve<string>(key, ctx);
  }

  async resolveNumber(key: string, ctx?: SettingContext): Promise<number> {
    return this.resolve<number>(key, ctx);
  }

  /** Resolve an enum setting; the return type narrows to the caller's union. */
  async resolveEnum<T extends string = string>(key: string, ctx?: SettingContext): Promise<T> {
    return this.resolve<T>(key, ctx);
  }

  // --- internals -----------------------------------------------------------

  private async compute(
    def: SettingDefinition,
    organizationId: string | null,
    ctx: SettingContext,
  ): Promise<{ value: unknown; source: ScopeType | 'default'; scopeId: string | null }> {
    // Build the candidate (scopeType, scopeId) tuples in precedence order, only
    // for levels this key cascades to and for which the ctx supplies an id.
    const candidates = this.candidates(def, ctx);

    if (candidates.length > 0) {
      const rows = await this.prisma.raw.setting.findMany({
        where: {
          organizationId,
          key: def.key,
          OR: candidates.map((c) => ({ scopeType: c.scopeType, scopeId: c.scopeId })),
        },
        select: { scopeType: true, scopeId: true, value: true },
      });
      const byScope = new Map(rows.map((r) => [`${r.scopeType}:${r.scopeId}`, r.value as unknown]));
      for (const c of candidates) {
        const found = byScope.get(`${c.scopeType}:${c.scopeId}`);
        if (found !== undefined && found !== null) {
          return { value: this.safeCoerce(def, found), source: c.scopeType, scopeId: c.scopeId };
        }
      }
    }

    return { value: def.default, source: 'default', scopeId: null };
  }

  private candidates(
    def: SettingDefinition,
    ctx: SettingContext,
  ): Array<{ scopeType: ScopeType; scopeId: string }> {
    const idFor = (level: ScopeType): string | null | undefined => {
      switch (level) {
        case 'product':
          return ctx.productId;
        case 'category':
          return ctx.categoryId;
        case 'warehouse':
          return ctx.warehouseId;
        case 'organization':
          return '';
      }
    };
    const out: Array<{ scopeType: ScopeType; scopeId: string }> = [];
    for (const level of SCOPE_PRECEDENCE) {
      if (level !== 'organization' && !def.cascades) continue;
      if (level !== 'organization' && !def.scopeLevels.includes(level)) continue;
      const id = idFor(level);
      if (level === 'organization') {
        out.push({ scopeType: 'organization', scopeId: '' });
      } else if (id) {
        out.push({ scopeType: level, scopeId: id });
      }
    }
    return out;
  }

  /** Coerce a stored value, falling back to the default if it is corrupt. */
  private safeCoerce(def: SettingDefinition, raw: unknown): unknown {
    try {
      return coerceSettingValue(def, raw);
    } catch {
      return def.default;
    }
  }

  private cacheKey(organizationId: string | null, def: SettingDefinition, ctx: SettingContext): string {
    return [
      organizationId ?? '_sys',
      def.key,
      ctx.productId ?? '',
      ctx.categoryId ?? '',
      ctx.warehouseId ?? '',
    ].join('::');
  }
}
