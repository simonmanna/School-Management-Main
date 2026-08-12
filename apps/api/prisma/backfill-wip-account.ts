/**
 * Manufacturing Phase 0 backfill — give every existing organization a Work In
 * Progress account and correct the production posting rules.
 *
 * Two production GL methods (postProductionConsume / postProductionOutput)
 * shipped long ago but were inert: the `wip` mapping pointed at no account, and
 * the seeded InventoryPostingRule rows sent BOTH legs of BOTH production
 * movement types to `stock_valuation`, so every entry cancelled to zero. This
 * backfill repairs live orgs so a production order posts Dr WIP / Cr Stock
 * Valuation (consume) and Dr Stock Valuation / Cr WIP (output).
 *
 * For each org:
 *   1. seedAccountingCore — idempotent upsert; creates account 1420 (Work In
 *      Progress) and the `wip` AccountMapping, touches nothing else.
 *   2. correct the two default posting-rule legs:
 *        PRODUCTION_CONSUME line 0 (debit)  → `wip`
 *        PRODUCTION_OUTPUT  line 1 (credit) → `wip`
 *      scoped to productId IS NULL AND categoryId IS NULL, so per-product /
 *      per-category overrides are never clobbered.
 *
 * `AccountCategory` is global and boot-seeded, so `work_in_progress` already
 * exists — no category backfill.
 *
 * DRY-RUN BY DEFAULT — prints what it would do. Pass `--apply` to commit:
 *   ts-node prisma/backfill-wip-account.ts            # preview
 *   ts-node prisma/backfill-wip-account.ts --apply    # execute
 */
import { PrismaClient } from '@prisma/client';
import { seedAccountingCore } from '../src/modules/accounting/coa/coa-seeder';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const tag = APPLY ? '' : '[dry-run] ';

/**
 * The full production rule set. All four legs are ensured (created if missing,
 * corrected if wrong) so BOTH failure shapes are fixed: an org whose rules were
 * mis-seeded to stock_valuation on both legs, AND an older org that never got
 * production rules at all (whose consume leg would otherwise fall through
 * postIssue to COGS).
 */
const PRODUCTION_LEGS: {
  movementType: string;
  lineIndex: number;
  debitOrCredit: 'debit' | 'credit';
  accountMappingKey: string;
}[] = [
  { movementType: 'PRODUCTION_CONSUME', lineIndex: 0, debitOrCredit: 'debit', accountMappingKey: 'wip' },
  { movementType: 'PRODUCTION_CONSUME', lineIndex: 1, debitOrCredit: 'credit', accountMappingKey: 'stock_valuation' },
  { movementType: 'PRODUCTION_OUTPUT', lineIndex: 0, debitOrCredit: 'debit', accountMappingKey: 'stock_valuation' },
  { movementType: 'PRODUCTION_OUTPUT', lineIndex: 1, debitOrCredit: 'credit', accountMappingKey: 'wip' },
];

async function backfillOrg(orgId: string, name: string): Promise<void> {
  console.log(`\n${tag}org "${name}" (${orgId})`);

  // 1. Account + mapping (idempotent upsert; creates account 1420 + wip mapping).
  const existingWip = await prisma.accountMapping.findUnique({
    where: { organizationId_key: { organizationId: orgId, key: 'wip' } },
  });
  if (existingWip) {
    console.log(`  = wip mapping already present (account ${existingWip.accountId})`);
  } else {
    console.log(`  ${tag}+ seed WIP account (1420) + wip mapping`);
  }
  if (APPLY) {
    await seedAccountingCore(prisma, orgId);
  }

  // 2. Ensure all four production posting-rule legs. Scoped to the org default
  //    (productId/categoryId null) so per-product/category overrides are untouched.
  for (const leg of PRODUCTION_LEGS) {
    const existing = await prisma.inventoryPostingRule.findFirst({
      where: {
        organizationId: orgId,
        movementType: leg.movementType as any,
        lineIndex: leg.lineIndex,
        productId: null,
        categoryId: null,
      },
      select: { id: true, accountMappingKey: true },
    });
    const label = `${leg.movementType} line ${leg.lineIndex} (${leg.debitOrCredit}) → ${leg.accountMappingKey}`;
    if (!existing) {
      console.log(`  ${tag}+ create ${label}`);
      if (APPLY) {
        await prisma.inventoryPostingRule.create({
          data: {
            organizationId: orgId,
            movementType: leg.movementType as any,
            lineIndex: leg.lineIndex,
            debitOrCredit: leg.debitOrCredit,
            accountSource: 'account_mapping',
            accountMappingKey: leg.accountMappingKey,
            isActive: true,
          } as any,
        });
      }
    } else if (existing.accountMappingKey !== leg.accountMappingKey) {
      console.log(`  ${tag}~ fix ${leg.movementType} line ${leg.lineIndex}: ${existing.accountMappingKey} → ${leg.accountMappingKey}`);
      if (APPLY) {
        await prisma.inventoryPostingRule.update({
          where: { id: existing.id },
          data: { accountSource: 'account_mapping', accountMappingKey: leg.accountMappingKey },
        });
      }
    } else {
      console.log(`  = ${label} already correct`);
    }
  }
}

async function main(): Promise<void> {
  console.log(`${tag}Manufacturing WIP-account backfill starting…`);
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  console.log(`${tag}${orgs.length} organization(s) to process.`);
  for (const org of orgs) {
    await backfillOrg(org.id, org.name);
  }
  console.log(`\n${tag}Done.${APPLY ? '' : ' Re-run with --apply to commit.'}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
