import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { InventoryMovementType } from '@erp/shared';
import { dec, ZERO } from '../../../kernel/common/money';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import type { PostingLineInput } from '../../accounting/posting/posting.types';
import { AccountResolverService } from '../../accounting/posting/account-resolver.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ResolvedLine {
  debitOrCredit: 'debit' | 'credit';
  accountId: string;
  description?: string;
}

/**
 * InventoryPostingRuleService — resolves GL accounts for inventory movements.
 *
 * Resolution order (most specific first):
 *   1. Product override   → InventoryPostingRule WHERE productId = {product.id}
 *   2. Category default   → InventoryPostingRule WHERE categoryId = {product.categoryId}
 *   3. Movement type def  → InventoryPostingRule WHERE productId IS NULL AND categoryId IS NULL
 *   4. AccountMapping     → fallback via accountMappingKey when no rule found
 *
 * accountSource values:
 *   'account_mapping'  → AccountDeterminationService.mapped(accountMappingKey)
 *   'literal'          → literalAccountId
 *   'category_field'   → ProductCategory.{field}
 *   'product_field'    → Product.{field}
 *
 * Each resolved line produces a PostingLineInput (debit or credit) that the
 * caller feeds directly to PostingService.post().
 */
@Injectable()
export class InventoryPostingRuleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly accounts: AccountResolverService,
  ) {}

  /**
   * Resolve full posting lines for a product + movement type + value.
   * Returns ready-to-post PostingLineInput[] with debit/credit values set.
   *
   * When totalValue is zero or negative, an empty array is returned (no GL effect).
   */
  async resolve(
    movementType: InventoryMovementType,
    productId: string,
    totalValue: Prisma.Decimal.Value,
    options?: {
      tx?: any;
      description?: string;
      /** When true, only looks for quantitative-only rules (returns empty lines). */
      skipGl?: boolean;
    },
  ): Promise<PostingLineInput[]> {
    if (options?.skipGl) return [];
    const value = dec(totalValue);
    if (value.lte(ZERO)) return [];

    const client = options?.tx ?? this.prisma.client;
    const orgId = this.tenant.organizationId;

    // 1. Fetch product + category for field resolution
    const product = await client.product.findFirst({
      where: { id: productId },
      include: { category: true },
    });
    if (!product) throw new BadRequestException('Product not found');

    // 2. Fetch rules in resolution order
    const rules = await this.loadRules(client, orgId, movementType, productId, product.categoryId);

    if (rules.length === 0) {
      // No rule found at any level — cannot determine accounts
      throw new BadRequestException(
        `No posting rule configured for movement type '${movementType}'. Go to Accounting > Posting Rules to set one up.`,
      );
    }

    // 3. Resolve each rule line to an account
    const lines: PostingLineInput[] = [];
    for (const rule of rules) {
      const accountId = await this.resolveAccount(rule, product, client);
      if (!accountId) continue;

      const entry: PostingLineInput = {
        accountId,
        description: options?.description ?? `Inventory ${movementType}`,
      };
      if (rule.debitOrCredit === 'debit') {
        const existing = lines.find((l) => l.accountId === accountId && l.debit);
        if (existing) {
          // Merge with existing line on same account (same-side accumulation)
          existing.debit = dec(existing.debit ?? 0).plus(value).toString();
        } else {
          entry.debit = value.toString();
        }
      } else {
        const existing = lines.find((l) => l.accountId === accountId && l.credit);
        if (existing) {
          existing.credit = dec(existing.credit ?? 0).plus(value).toString();
        } else {
          entry.credit = value.toString();
        }
      }

      // Only push if we didn't merge above
      if (!lines.includes(entry)) {
        lines.push(entry);
      }
    }

    return lines;
  }

  /**
   * Same as resolve() but returns the account IDs and side without value assignment.
   * Used by UI preview to show "what accounts would this movement post to"
   * independent of any specific transaction value.
   */
  async resolveStructure(
    movementType: InventoryMovementType,
    productId: string,
    options?: { tx?: any },
  ): Promise<{ debitAccountId: string | null; creditAccountId: string | null; accountSource: string }[]> {
    const client = options?.tx ?? this.prisma.client;
    const orgId = this.tenant.organizationId;

    const product = await client.product.findFirst({
      where: { id: productId },
      include: { category: true },
    });
    if (!product) throw new BadRequestException('Product not found');

    const rules = await this.loadRules(client, orgId, movementType, productId, product.categoryId);
    if (rules.length === 0) return [];

    const result: { debitAccountId: string | null; creditAccountId: string | null; accountSource: string }[] = [];
    for (const rule of rules) {
      result.push({
        debitAccountId: rule.debitOrCredit === 'debit' ? await this.resolveAccount(rule, product, client) : null,
        creditAccountId: rule.debitOrCredit === 'credit' ? await this.resolveAccount(rule, product, client) : null,
        accountSource: rule.accountSource,
      });
    }
    return result;
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  /**
   * Load rules in resolution order:
   *   1. Product override
   *   2. Category default
   *   3. Movement type default
   */
  private async loadRules(
    client: any,
    orgId: string,
    movementType: InventoryMovementType,
    productId: string,
    categoryId: string | null,
  ): Promise<any[]> {
    // Build OR conditions dynamically: product override always,
    // category default only if categoryId is set, movement-type default always.
    const orConditions: any[] = [
      { productId },                                     // 1. product override
      { productId: null, categoryId: null },              // 3. movement-type default (always)
    ];
    if (categoryId) {
      orConditions.splice(1, 0, { productId: null, categoryId }); // 2. category default
    }

    const allRules = await client.inventoryPostingRule.findMany({
      where: {
        organizationId: orgId,
        movementType,
        isActive: true,
        OR: orConditions,
      },
      orderBy: [
        // product override first, then category, then movement-type default
        { productId: { sort: 'desc', nulls: 'last' } },
        { categoryId: { sort: 'desc', nulls: 'last' } },
        { lineIndex: 'asc' },
      ],
    });

    // Deduplicate by (debitOrCredit, lineIndex): take the most specific per line
    const seen = new Set<string>();
    const result: any[] = [];
    for (const rule of allRules) {
      const key = `${rule.debitOrCredit}:${rule.lineIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(rule);
    }
    return result;
  }

  /**
   * Resolve a single rule line to an account ID.
   */
  private async resolveAccount(
    rule: any,
    product: any,
    client: any,
  ): Promise<string | null> {
    switch (rule.accountSource) {
      case 'account_mapping': {
        if (!rule.accountMappingKey) return null;
        return this.resolveMapping(rule.accountMappingKey, client);
      }

      case 'literal': {
        return rule.literalAccountId ?? null;
      }

      case 'category_field': {
        if (!product.category) {
          // Fallback to AccountMapping when no category assigned
          return this.resolveMapping(rule.accountMappingKey ?? 'stock_valuation', client);
        }
        return this.resolveCategoryField(product.category, rule.accountMappingKey, client);
      }

      case 'product_field': {
        return this.resolveProductField(product, rule.accountMappingKey, client);
      }

      default:
        return null;
    }
  }

  /**
   * Resolve an AccountMapping key -> account ID. Delegates to the shared
   * resolver; this used to be a private copy of the same lookup.
   */
  private async resolveMapping(key: string, client: any): Promise<string> {
    return this.accounts.byMapping(key, client);
  }

  /**
   * Resolve a field on ProductCategory (e.g. 'cogsAccountId' → account ID).
   * Falls back to AccountMapping when the field is null.
   */
  private async resolveCategoryField(
    category: any,
    fieldKey: string | null,
    client: any,
  ): Promise<string | null> {
    if (!fieldKey) return null;
    const fieldName = this.fieldKeyToColumn(fieldKey, 'category');
    const accountId = category[fieldName] ?? null;
    if (accountId) return accountId;
    // Fallback: try the AccountMapping
    try {
      return await this.resolveMapping(fieldKey, client);
    } catch {
      return null;
    }
  }

  /**
   * Resolve a field on Product (e.g. 'cogsAccountOverrideId' → account ID).
   * Falls back to category field, then AccountMapping.
   */
  private async resolveProductField(
    product: any,
    fieldKey: string | null,
    client: any,
  ): Promise<string | null> {
    if (!fieldKey) return null;
    const fieldName = this.fieldKeyToColumn(fieldKey, 'product');
    const overrideId = product[fieldName] ?? null;
    if (overrideId) return overrideId;
    // Fallback to category
    if (product.category) {
      const catFieldName = this.fieldKeyToColumn(fieldKey, 'category');
      const catId = product.category[catFieldName] ?? null;
      if (catId) return catId;
    }
    // Fallback to AccountMapping
    try {
      return await this.resolveMapping(fieldKey, client);
    } catch {
      return null;
    }
  }

  /**
   * Map AccountMapping keys to model fields:
   *   'stock_valuation'        → 'inventoryAccountOverrideId' (product) / 'inventoryAccountId' (category)
   *   'cogs'                   → 'cogsAccountOverrideId' / 'cogsAccountId'
   *   'stock_adjustment_income' → 'varianceGainAccountOverrideId' / 'varianceGainAccountId'
   *   'stock_adjustment_expense' → 'shrinkageAccountOverrideId' / 'shrinkageAccountId'
   *   'damage'                 → 'damageAccountOverrideId' / 'damageAccountId'
   *   'expiry'                 → 'expiryAccountOverrideId' / 'expiryAccountId'
   *   'promo_expense'          → not on product yet → 'promoExpenseAccountId' (category)
   *   'internal_use'           → not on product yet → 'internalUseAccountId' (category)
   */
  private fieldKeyToColumn(key: string, level: 'product' | 'category'): string {
    const productMap: Record<string, string> = {
      stock_valuation: 'inventoryAccountOverrideId',
      cogs: 'cogsAccountOverrideId',
      stock_adjustment_income: 'varianceGainAccountOverrideId',
      stock_adjustment_expense: 'shrinkageAccountOverrideId',
      damage: 'damageAccountOverrideId',
      expiry: 'expiryAccountOverrideId',
    };
    const categoryMap: Record<string, string> = {
      stock_valuation: 'inventoryAccountId',
      cogs: 'cogsAccountId',
      stock_adjustment_income: 'varianceGainAccountId',
      stock_adjustment_expense: 'shrinkageAccountId',
      damage: 'damageAccountId',
      expiry: 'expiryAccountId',
      promo_expense: 'promoExpenseAccountId',
      internal_use: 'internalUseAccountId',
    };
    const map = level === 'product' ? productMap : categoryMap;
    return map[key] ?? key;
  }
}
