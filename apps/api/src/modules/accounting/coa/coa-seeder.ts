import { ACCOUNT_CATEGORY_SEED, COA_JOURNALS, COA_MAPPINGS, COA_TEMPLATE } from './coa-template';
import { seedAccountCategories } from './account-category-seeder';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface SeedAccountingCoreResult {
  /** category key -> AccountCategory.id */
  categoryIds: Record<string, string>;
  /** account code -> Account.id */
  accountIds: Record<string, string>;
}

/**
 * Seed (or repair) the accounting core for ONE organization: the chart of
 * accounts including its parent hierarchy, journals, and every
 * account-determination mapping.
 *
 * Account *categories* are global and system-managed, so they are NOT seeded
 * here — see `seedAccountCategories`, which runs once at boot. This function
 * only resolves the existing catalog by key.
 *
 * Idempotent (upsert-only). Takes a raw Prisma client or transaction client
 * rather than a Nest service so both `prisma/seed.ts` and `OrganizationsService`
 * can call it.
 */
export async function seedAccountingCore(
  db: any,
  orgId: string,
): Promise<SeedAccountingCoreResult> {
  // --- 1. Resolve the global category catalog -------------------------------
  // Categories are global and seeded at boot. If they are missing the app was
  // started without the seeder, and every account below would be uncategorized.
  const categoryRows: Array<{ id: string; key: string }> =
    await db.accountCategory.findMany({ select: { id: true, key: true } });
  const categoryIds: Record<string, string> = Object.fromEntries(
    categoryRows.map((c) => [c.key, c.id]),
  );
  if (categoryRows.length === 0) {
    await seedAccountCategories(db);
    const refreshed: Array<{ id: string; key: string }> =
      await db.accountCategory.findMany({ select: { id: true, key: true } });
    for (const c of refreshed) categoryIds[c.key] = c.id;
  }

  // --- 2. Accounts, pass 1: upsert without parents --------------------------
  // A parentCode may appear later in the template than its child, so parents are
  // wired in a second pass.
  const accountIds: Record<string, string> = {};
  for (const a of COA_TEMPLATE) {
    const categoryId = a.categoryKey ? categoryIds[a.categoryKey] : null;
    if (a.categoryKey && !categoryId) {
      throw new Error(
        `COA_TEMPLATE account '${a.code}' references unknown category '${a.categoryKey}'`,
      );
    }
    const category = a.categoryKey
      ? ACCOUNT_CATEGORY_SEED.find((c) => c.key === a.categoryKey)!
      : null;
    const common = {
      name: a.name,
      categoryId,
      normalBalance: (category?.normalBalance ?? 'debit') as any,
      isPostable: a.isPostable ?? true,
      controlAccountType: (a.controlAccountType ?? null) as any,
      sortOrder: a.sortOrder ?? 0,
      cashFlowCategory: a.cashFlowCategory ?? null,
      isDefault: a.isDefault ?? false,
      bankName: a.bankName ?? null,
      accountNumber: a.accountNumber ?? null,
    };
    const row = await db.account.upsert({
      where: { organizationId_code: { organizationId: orgId, code: a.code } },
      update: common,
      create: { organizationId: orgId, code: a.code, ...common },
    });
    accountIds[a.code] = row.id;
  }

  // --- 3. Accounts, pass 2: wire the reporting hierarchy --------------------
  for (const a of COA_TEMPLATE) {
    if (!a.parentCode) continue;
    const parentId = accountIds[a.parentCode];
    if (!parentId) {
      throw new Error(`COA_TEMPLATE account '${a.code}' references unknown parent '${a.parentCode}'`);
    }
    await db.account.update({
      where: { id: accountIds[a.code] },
      data: { parentAccountId: parentId },
    });
  }

  // --- 4. Journals ----------------------------------------------------------
  for (const j of COA_JOURNALS) {
    const defaultDebitAccountId = j.defaultDebitCode ? accountIds[j.defaultDebitCode] : undefined;
    await db.journal.upsert({
      where: { organizationId_code: { organizationId: orgId, code: j.code } },
      update: {
        name: j.name,
        journalType: j.journalType as any,
        ...(defaultDebitAccountId ? { defaultDebitAccountId } : {}),
      },
      create: {
        organizationId: orgId,
        code: j.code,
        name: j.name,
        journalType: j.journalType as any,
        ...(defaultDebitAccountId ? { defaultDebitAccountId } : {}),
      },
    });
  }

  // --- 5. Account determination mappings ------------------------------------
  const mappedAccountIds = new Set<string>();
  for (const [key, code] of Object.entries(COA_MAPPINGS)) {
    const accountId = accountIds[code];
    if (!accountId) throw new Error(`COA_MAPPINGS['${key}'] references unknown code '${code}'`);
    await db.accountMapping.upsert({
      where: { organizationId_key: { organizationId: orgId, key } },
      update: { accountId },
      create: { organizationId: orgId, key, accountId },
    });
    mappedAccountIds.add(accountId);
  }

  // --- 6. Protect accounts wired into the posting engine --------------------
  // Everything referenced by a mapping, plus every group header, becomes a
  // non-deletable system account: deleting these would break posting and
  // period-close.
  await db.account.updateMany({
    where: { organizationId: orgId, id: { in: Array.from(mappedAccountIds) } },
    data: { isSystem: true },
  });
  await db.account.updateMany({
    where: { organizationId: orgId, isPostable: false },
    data: { isSystem: true },
  });

  return { categoryIds, accountIds };
}
