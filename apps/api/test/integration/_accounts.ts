/**
 * Account factory for integration specs.
 *
 * `Account.accountType` was replaced by `categoryId` (→ AccountCategory) plus a
 * denormalized `normalBalance`. Every integration spec built its accounts with
 * the old column, so the whole suite stopped compiling — and because a suite
 * that does not compile also does not fail loudly, the POS sale pipeline went
 * untested for as long as the drift lasted. This helper is the single place that
 * knows how to make an account, so the next schema move breaks one file.
 *
 * AccountCategory rows are global (no organizationId) and system-seeded, so this
 * ensures the handful the specs need exist, then resolves them by key.
 */
import type { PrismaClient } from '@prisma/client';
import { ACCOUNT_CATEGORY_SEED } from '@erp/shared';

/** Category keys the integration specs actually use. */
export type TestAccountCategory =
  | 'cash'
  | 'bank'
  | 'receivable'
  | 'payable'
  | 'inventory'
  | 'tax'
  | 'revenue'
  | 'other_income'
  | 'cost_of_goods_sold'
  | 'operating_expense'
  | 'other_expense'
  | 'current_asset'
  | 'current_liability'
  | 'work_in_progress'
  | 'equity';

/**
 * Ensure the seeded AccountCategory rows exist and return {key → id}.
 * Idempotent: safe to call from every spec's beforeAll.
 */
export async function ensureAccountCategories(
  prisma: PrismaClient,
): Promise<Map<string, string>> {
  const byKey = new Map<string, string>();
  for (const def of ACCOUNT_CATEGORY_SEED as readonly any[]) {
    const row = await prisma.accountCategory.upsert({
      where: { key: def.key },
      update: {},
      create: {
        key: def.key,
        name: def.name,
        description: def.description ?? null,
        classification: def.classification,
        normalBalance: def.normalBalance,
        reportSection: def.reportSection,
        cashFlowClass: def.cashFlowClass ?? 'operating',
        isContra: def.isContra ?? false,
        isCashEquivalent: def.isCashEquivalent ?? false,
        allowReconciliation: def.allowReconciliation ?? false,
        allowManualPosting: def.allowManualPosting ?? true,
        allowBudgeting: def.allowBudgeting ?? false,
      },
    });
    byKey.set(row.key, row.id);
  }
  return byKey;
}

/**
 * Create an account under the given category key. `normalBalance` is
 * denormalized from the category exactly as the application services do it, so
 * test fixtures and production rows have identical shape.
 */
export function makeAccountFactory(prisma: PrismaClient, categories: Map<string, string>) {
  return async (
    organizationId: string,
    code: string,
    name: string,
    categoryKey: TestAccountCategory,
    extra: Record<string, unknown> = {},
  ) => {
    const categoryId = categories.get(categoryKey);
    if (!categoryId) {
      throw new Error(
        `Unknown account category "${categoryKey}". Call ensureAccountCategories() first.`,
      );
    }
    const def = (ACCOUNT_CATEGORY_SEED as readonly any[]).find((d) => d.key === categoryKey)!;
    return prisma.account.create({
      data: {
        organizationId,
        code,
        name,
        categoryId,
        normalBalance: def.normalBalance,
        ...extra,
      },
    });
  };
}
