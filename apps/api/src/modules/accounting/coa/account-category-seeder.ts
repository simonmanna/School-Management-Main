import {
  ACCOUNT_CATEGORY_SEED,
  categorySystemVersion,
  type AccountCategoryDef,
} from '@erp/shared';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Seeds the global account-category catalog.
 *
 * Categories are **global** — they describe accounting concepts ("cash",
 * "inventory", "receivable"), not tenant configuration, so a single row is
 * shared by every organization. They are also system-managed: there is no
 * tenant CRUD, and this seeder is the only writer.
 *
 * Upgrades are version-gated. A row is rewritten only when the shipped template
 * declares a higher `systemVersion`, so:
 *   - re-running on an up-to-date database is a no-op,
 *   - changing a category's behavior requires bumping its version, which makes
 *     the change explicit and auditable in the diff.
 *
 * Uses raw SQL for the same reason `CoreModule.syncPermissions` does: it runs at
 * boot with no tenant context, and `ON CONFLICT` gives us the version gate in a
 * single statement.
 */
export async function seedAccountCategories(db: any): Promise<{ count: number }> {
  for (const c of ACCOUNT_CATEGORY_SEED as readonly AccountCategoryDef[]) {
    await db.$executeRawUnsafe(
      `INSERT INTO "AccountCategory" (
         "id", "key", "name", "description",
         "classification", "normalBalance", "reportSection", "cashFlowClass",
         "isContra", "isCashEquivalent",
         "allowReconciliation", "allowManualPosting", "allowBudgeting",
         "isSystem", "isActive", "sortOrder", "systemVersion",
         "createdAt", "updatedAt"
       ) VALUES (
         gen_random_uuid()::text, $1, $2, $3,
         $4::"AccountClassification", $5::"NormalBalance", $6::"ReportSection", $7::"CashFlowClass",
         $8, $9,
         $10, $11, $12,
         true, true, $13, $14,
         NOW(), NOW()
       )
       ON CONFLICT ("key") DO UPDATE SET
         "name"                = EXCLUDED."name",
         "description"         = EXCLUDED."description",
         "classification"      = EXCLUDED."classification",
         "normalBalance"       = EXCLUDED."normalBalance",
         "reportSection"       = EXCLUDED."reportSection",
         "cashFlowClass"       = EXCLUDED."cashFlowClass",
         "isContra"            = EXCLUDED."isContra",
         "isCashEquivalent"    = EXCLUDED."isCashEquivalent",
         "allowReconciliation" = EXCLUDED."allowReconciliation",
         "allowManualPosting"  = EXCLUDED."allowManualPosting",
         "allowBudgeting"      = EXCLUDED."allowBudgeting",
         "sortOrder"           = EXCLUDED."sortOrder",
         "systemVersion"       = EXCLUDED."systemVersion",
         "isSystem"            = true,
         "updatedAt"           = NOW()
       WHERE "AccountCategory"."systemVersion" < EXCLUDED."systemVersion"`,
      c.key,
      c.name,
      c.description ?? null,
      c.classification,
      c.normalBalance,
      c.reportSection,
      c.cashFlowClass,
      c.isContra,
      c.isCashEquivalent,
      c.allowReconciliation,
      c.allowManualPosting,
      c.allowBudgeting,
      c.sortOrder,
      categorySystemVersion(c),
    );
  }
  return { count: ACCOUNT_CATEGORY_SEED.length };
}
