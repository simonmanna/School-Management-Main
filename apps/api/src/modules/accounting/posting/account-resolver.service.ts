import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ACCOUNT_MAPPING_BY_KEY,
  type AccountClassification,
  type CashFlowClass,
  type ControlAccountType,
  type NormalBalance,
  type ReportSection,
} from '@erp/shared';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The one place an account is looked up.
 *
 * Before this service, four mechanisms coexisted and drifted apart:
 *   (a) `AccountMapping.key` string lookups, hardcoded per call site
 *   (b) `accountType` enum filters, with the same array copy-pasted into five
 *       report services
 *   (c) literal `code` strings ('ROUNDING', '1300', '4100'…)
 *   (d) per-record FK columns
 *
 * (a) still exists — it is the right mechanism for "which account does this
 * org use for X" — but it now runs through here, is validated against the
 * mapping registry's `expectedCategories`, and can never resolve to a group or
 * deprecated account. (b) is replaced by category lookups and (c) by
 * `ensureByCode`, which is the only sanctioned literal-code path.
 */

export interface AccountMeta {
  id: string;
  code: string;
  name: string;
  isPostable: boolean;
  isActive: boolean;
  deprecatedAt: Date | null;
  parentAccountId: string | null;
  sortOrder: number;
  controlAccountType: ControlAccountType | null;
  isDefault: boolean;

  categoryId: string | null;
  categoryKey: string | null;
  categoryName: string | null;
  classification: AccountClassification | null;
  normalBalance: NormalBalance;
  reportSection: ReportSection | null;
  /** Account override, else the category default. */
  cashFlowClass: CashFlowClass;
  isContra: boolean;
  isCashEquivalent: boolean;

  /** Already merged with the category default — `null` never reaches callers. */
  allowReconciliation: boolean;
  allowManualPosting: boolean;
  allowBudgeting: boolean;
}

interface CacheEntry {
  at: number;
  byId: Map<string, AccountMeta>;
}

const CACHE_TTL_MS = 30_000;

@Injectable()
export class AccountResolverService {
  /** Per-organization account metadata. Accounts change, so this is TTL-cached. */
  private readonly cache = new Map<string, CacheEntry>();

  /**
   * The global category catalog, keyed by `key`.
   *
   * Categories are global and system-managed — the only writer is the boot
   * seeder — so this is cached for the process lifetime rather than on a TTL.
   * The seeder calls {@link reloadCategories} after it runs.
   */
  private categoriesByKey: Map<string, any> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /** Drop the cached account metadata. Called by Account writes. */
  invalidate(organizationId?: string): void {
    if (organizationId) this.cache.delete(organizationId);
    else this.cache.clear();
  }

  /** Drop ALL cached account metadata. */
  invalidateAll(): void {
    this.cache.clear();
  }

  /** Re-read the global category catalog. Called by the boot seeder. */
  async reloadCategories(): Promise<void> {
    const rows = await this.prisma.raw.accountCategory.findMany({ where: { deletedAt: null } });
    this.categoriesByKey = new Map((rows as any[]).map((c) => [c.key, c]));
    // Account metadata embeds category fields, so it has to be re-derived too.
    this.cache.clear();
  }

  /** Global category catalog, loaded once. */
  async categories(): Promise<Map<string, any>> {
    if (!this.categoriesByKey) await this.reloadCategories();
    return this.categoriesByKey!;
  }

  async categoryByKey(key: string): Promise<any | null> {
    return (await this.categories()).get(key) ?? null;
  }

  // ───────────────────────────── mapping keys ──────────────────────────────

  /**
   * Resolve an org-level mapping (e.g. 'accounts_receivable'). Throws if the
   * mapping is unconfigured, mirroring the pre-existing behavior so callers —
   * notably the POS sale path — see the same error they always did.
   */
  async byMapping(key: string, client: any = this.prisma.client): Promise<string> {
    const accountId = await this.byMappingOptional(key, client);
    if (!accountId) {
      throw new BadRequestException(
        `Account mapping '${key}' is not configured. Set it under Accounting > Account Mapping.`,
      );
    }
    return accountId;
  }

  async byMappingOptional(key: string, client: any = this.prisma.client): Promise<string | null> {
    const mapping = await client.accountMapping.findFirst({ where: { key } });
    return mapping?.accountId ?? null;
  }

  // ──────────────────────────── category keys ──────────────────────────────

  /** Every postable account in a category, ordered by sortOrder then code. */
  async byCategory(key: string, opts: { includeGroups?: boolean } = {}): Promise<AccountMeta[]> {
    return this.byCategories([key], opts);
  }

  async byCategories(
    keys: string[],
    opts: { includeGroups?: boolean } = {},
  ): Promise<AccountMeta[]> {
    const all = await this.allMeta();
    return this.sorted(
      [...all.values()].filter(
        (m) =>
          m.categoryKey !== null &&
          keys.includes(m.categoryKey) &&
          m.isActive &&
          !m.deprecatedAt &&
          (opts.includeGroups || m.isPostable),
      ),
    );
  }

  async byClassification(
    classification: AccountClassification,
    opts: { includeGroups?: boolean } = {},
  ): Promise<AccountMeta[]> {
    const all = await this.allMeta();
    return this.sorted(
      [...all.values()].filter(
        (m) =>
          m.classification === classification &&
          m.isActive &&
          !m.deprecatedAt &&
          (opts.includeGroups || m.isPostable),
      ),
    );
  }

  /**
   * First postable account in a category. Prefers `isDefault`, then sortOrder.
   * Returns null rather than throwing — callers decide whether it is fatal,
   * which keeps the "a sale must never be blocked" rule intact.
   */
  async oneByCategory(key: string): Promise<string | null> {
    const rows = await this.byCategory(key);
    if (rows.length === 0) return null;
    return (rows.find((r) => r.isDefault) ?? rows[0]).id;
  }

  // ────────────────────────── cash & equivalents ───────────────────────────

  /**
   * Cash, bank, mobile money, petty cash — whatever the org's categories flag as
   * cash-equivalent. Replaces the `CASH_ACCOUNT_TYPES` / `PAYMENT_ACCOUNT_TYPES`
   * arrays that were duplicated across the reporting and treasury services.
   */
  async cashEquivalentAccounts(opts: { includeGroups?: boolean } = {}): Promise<AccountMeta[]> {
    const all = await this.allMeta();
    return this.sorted(
      [...all.values()].filter(
        (m) => m.isCashEquivalent && m.isActive && (opts.includeGroups || m.isPostable),
      ),
    );
  }

  async cashEquivalentIds(): Promise<string[]> {
    return (await this.cashEquivalentAccounts()).map((m) => m.id);
  }

  // ─────────────────────────── literal codes ───────────────────────────────

  /**
   * The only sanctioned literal-code lookup: fetch an account by code, creating
   * it (and optionally its mapping) if the org has not got one yet. Used by the
   * posting engine for the rounding account, which must exist mid-transaction.
   */
  async ensureByCode(
    code: string,
    def: { name: string; categoryKey: string; mappingKey?: string },
    client: any = this.prisma.client,
  ): Promise<string> {
    const organizationId = this.tenant.organizationId;

    if (def.mappingKey) {
      const mapped = await this.byMappingOptional(def.mappingKey, client);
      if (mapped) return mapped;
    }

    let account = await client.account.findFirst({ where: { code } });
    if (!account) {
      const category = await client.accountCategory.findFirst({ where: { key: def.categoryKey } });
      if (!category) {
        throw new BadRequestException(
          `Account category '${def.categoryKey}' is missing for this organization. ` +
            'The global catalog is seeded by AccountingModule at boot; if it is empty ' +
            'the API started without it. On a database upgraded from a pre-category ' +
            'schema, run deployment/2026-08-r1/phaseB-backfill.ts to map the existing ' +
            'chart of accounts.',
        );
      }
      account = await client.account.create({
        data: {
          organizationId,
          code,
          name: def.name,
          categoryId: category.id,
          normalBalance: category.normalBalance,
          isSystem: true,
          isProtected: true,
        },
      });
      this.invalidate(organizationId);
    }

    if (def.mappingKey) {
      await client.accountMapping.upsert({
        where: { organizationId_key: { organizationId, key: def.mappingKey } },
        create: { organizationId, key: def.mappingKey, accountId: account.id },
        update: {},
      });
    }
    return account.id;
  }

  // ───────────────────────────── metadata ──────────────────────────────────

  async metaById(id: string): Promise<AccountMeta> {
    const all = await this.allMeta();
    const meta = all.get(id);
    if (!meta) throw new NotFoundException('Account not found');
    return meta;
  }

  async meta(ids: string[]): Promise<Map<string, AccountMeta>> {
    const all = await this.allMeta();
    const out = new Map<string, AccountMeta>();
    for (const id of ids) {
      const m = all.get(id);
      if (m) out.set(id, m);
    }
    return out;
  }

  /** All accounts for the current org with their category behavior merged in. */
  async allMeta(): Promise<Map<string, AccountMeta>> {
    const organizationId = this.tenant.organizationId;
    const cached = this.cache.get(organizationId);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.byId;

    const rows = await this.prisma.client.account.findMany({
      where: { deletedAt: null },
      include: { category: true },
    });

    const byId = new Map<string, AccountMeta>();
    for (const a of rows as any[]) {
      byId.set(a.id, toMeta(a));
    }
    this.cache.set(organizationId, { at: Date.now(), byId });
    return byId;
  }

  // ───────────────────────────── validation ────────────────────────────────

  /**
   * Postability gate. Group accounts are summary nodes, deprecated accounts are
   * retired, and a category (or account) may forbid manual posting entirely.
   * `systemContext` is set by the posting engine for machine-generated entries,
   * which are allowed into control accounts.
   */
  assertPostable(meta: AccountMeta, opts: { systemContext?: boolean } = {}): void {
    if (!meta.isPostable) {
      throw new BadRequestException(
        `Account ${meta.code} is a summary/group account and cannot be posted to`,
      );
    }
    if (!meta.isActive) {
      throw new BadRequestException(`Account ${meta.code} is inactive and cannot be posted to`);
    }
    if (meta.deprecatedAt) {
      throw new BadRequestException(`Account ${meta.code} is deprecated and cannot be posted to`);
    }
    if (!opts.systemContext && !meta.allowManualPosting) {
      throw new BadRequestException(
        `Account ${meta.code} does not allow manual posting (${meta.categoryName ?? 'control account'}). ` +
          'Post through the originating document instead.',
      );
    }
  }

  /**
   * Validate that `accountId` is an acceptable target for `mappingKey`. Wrong-kind
   * mappings (e.g. `cogs` pointed at a revenue account) silently corrupt every
   * downstream report, so this is rejected unless explicitly forced.
   */
  async assertValidForMapping(
    mappingKey: string,
    accountId: string,
    opts: { force?: boolean } = {},
  ): Promise<AccountMeta> {
    const meta = await this.metaById(accountId);
    if (!meta.isPostable) throw new BadRequestException('Group/header accounts cannot be mapped.');
    if (!meta.isActive || meta.deprecatedAt) {
      throw new BadRequestException('Account is inactive or deprecated.');
    }

    const def = ACCOUNT_MAPPING_BY_KEY[mappingKey];
    if (def && def.expectedCategories.length > 0 && meta.categoryKey) {
      if (!def.expectedCategories.includes(meta.categoryKey) && !opts.force) {
        throw new BadRequestException(
          `Mapping '${mappingKey}' expects a ${def.expectedCategories.join(' or ')} account; ` +
            `'${meta.code} ${meta.name}' is ${meta.categoryKey}. Pass force=true to override.`,
        );
      }
    }
    return meta;
  }

  private sorted(rows: AccountMeta[]): AccountMeta[] {
    return rows.sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
  }
}

/** Merge an Account row and its category into the flat shape callers use. */
export function toMeta(a: any): AccountMeta {
  const c = a.category ?? null;
  return {
    id: a.id,
    code: a.code,
    name: a.name,
    isPostable: a.isPostable ?? true,
    isActive: a.isActive,
    deprecatedAt: a.deprecatedAt ?? null,
    parentAccountId: a.parentAccountId ?? null,
    sortOrder: a.sortOrder ?? 0,
    controlAccountType: a.controlAccountType ?? null,
    isDefault: a.isDefault ?? false,

    categoryId: a.categoryId ?? null,
    categoryKey: c?.key ?? null,
    categoryName: c?.name ?? null,
    classification: (c?.classification ?? null) as AccountClassification | null,
    normalBalance: (a.normalBalance ?? c?.normalBalance ?? 'debit') as NormalBalance,
    // Per-account override wins over the category default, matching normalBalance
    // and cashFlowClass below.
    reportSection: (a.reportSection ?? c?.reportSection ?? null) as ReportSection | null,
    cashFlowClass: (a.cashFlowCategory ?? c?.cashFlowClass ?? 'operating') as CashFlowClass,
    isContra: c?.isContra ?? false,
    isCashEquivalent: c?.isCashEquivalent ?? false,

    allowReconciliation: a.allowReconciliation ?? c?.allowReconciliation ?? false,
    allowManualPosting: a.allowManualPosting ?? c?.allowManualPosting ?? true,
    allowBudgeting: a.allowBudgeting ?? c?.allowBudgeting ?? false,
  };
}
