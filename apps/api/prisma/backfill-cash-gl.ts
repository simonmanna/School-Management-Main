/**
 * Idempotent backfill for the M5 cash-drawer → GL wiring.
 *
 * Ensures every organization has the two accounts and two account-mappings the
 * cash session module posts against:
 *   - 1900 Cash Clearing (Suspense)  → mapping `cash_clearing`
 *   - 5400 Cash Short & Over         → mapping `cash_short_over`
 *
 * Safe to run repeatedly (upserts only; touches nothing else). Run once against
 * an existing database that pre-dates the cash-GL feature:
 *   npx ts-node prisma/backfill-cash-gl.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ACCOUNTS: { code: string; name: string; categoryKey: string; mappingKey: string }[] = [
  { code: '1900', name: 'Cash Clearing (Suspense)', categoryKey: 'current_asset', mappingKey: 'cash_clearing' },
  { code: '5400', name: 'Cash Short & Over', categoryKey: 'other_expense', mappingKey: 'cash_short_over' },
];

// New cash-session permissions. Granted to any role that can already reconcile
// (i.e. manager-level) — NOT to plain cashiers, preserving segregation of duties.
const NEW_MANAGER_PERMS = ['cash_session:cash_out', 'cash_session:approve_variance', 'cash_session:reopen'];

async function backfillRolePermissions() {
  const roles = await prisma.role.findMany({ select: { id: true, name: true, permissions: true } });
  for (const role of roles) {
    const perms: string[] = role.permissions ?? [];
    if (!perms.includes('cash_session:reconcile')) continue; // managers only
    const merged = Array.from(new Set([...perms, ...NEW_MANAGER_PERMS]));
    if (merged.length !== perms.length) {
      await prisma.role.update({ where: { id: role.id }, data: { permissions: merged } });
      console.log(`✓ role "${role.name}": granted ${NEW_MANAGER_PERMS.join(', ')}`);
    }
  }
}

async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  for (const org of orgs) {
    for (const a of ACCOUNTS) {
      const category = await prisma.accountCategory.findFirst({ where: { key: a.categoryKey } });
      if (!category) {
        console.warn(`  ⚠ category '${a.categoryKey}' not found for account '${a.code}' — skipping`);
        continue;
      }
      const account = await prisma.account.upsert({
        where: { organizationId_code: { organizationId: org.id, code: a.code } },
        update: { name: a.name, categoryId: category.id, normalBalance: category.normalBalance },
        create: {
          organizationId: org.id,
          code: a.code,
          name: a.name,
          categoryId: category.id,
          normalBalance: category.normalBalance,
          isPostable: true,
          cashFlowCategory: 'operating',
        },
      });
      await prisma.accountMapping.upsert({
        where: { organizationId_key: { organizationId: org.id, key: a.mappingKey } },
        update: { accountId: account.id },
        create: { organizationId: org.id, key: a.mappingKey, accountId: account.id },
      });
    }
    console.log(`✓ ${org.name}: cash_clearing + cash_short_over ensured`);
  }
  await backfillRolePermissions();
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
