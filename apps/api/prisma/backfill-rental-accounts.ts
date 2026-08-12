/**
 * Rental Management backfill — give every existing organization the four
 * rental GL accounts + AccountMappings, and seed the four rental fee products
 * (RENT-LATE / RENT-DAMAGE / RENT-MISSING / RENT-EXTEND) with income-account
 * overrides so settlement fee lines book to the right revenue accounts.
 *
 * For each org:
 *   1. seedAccountingCore — idempotent upsert; creates accounts 2175 (Customer
 *      Deposits), 4250 (Rental Income), 4260 (Late Fee Income), 4270 (Damage
 *      Recovery Income) and the four AccountMapping rows, touches nothing else.
 *   2. seed the four fee products (skipped if a product with the code already
 *      exists in the org — codes are unique per org).
 *
 * `AccountCategory` is global and boot-seeded, so `current_liability` /
 * `revenue` already exist — no category backfill.
 *
 * DRY-RUN BY DEFAULT — prints what it would do. Pass `--apply` to commit:
 *   ts-node prisma/backfill-rental-accounts.ts           # preview
 *   ts-node prisma/backfill-rental-accounts.ts --apply   # execute
 */
import { PrismaClient } from '@prisma/client';
import { seedAccountingCore } from '../src/modules/accounting/coa/coa-seeder';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const tag = APPLY ? '' : '[dry-run] ';

/** code → { name, incomeMappingKey } for the four seeded fee products. */
const FEE_PRODUCTS: { code: string; name: string; incomeMappingKey: string }[] = [
  { code: 'RENT-LATE', name: 'Rental Late Fee', incomeMappingKey: 'late_fee_income' },
  { code: 'RENT-DAMAGE', name: 'Rental Damage Recovery', incomeMappingKey: 'damage_recovery_income' },
  { code: 'RENT-MISSING', name: 'Rental Missing Item', incomeMappingKey: 'damage_recovery_income' },
  { code: 'RENT-EXTEND', name: 'Rental Extension Fee', incomeMappingKey: 'rental_income' },
];

async function backfillOrg(org: { id: string; name: string }): Promise<void> {
  console.log(`\n${tag}org "${org.name}" (${org.id})`);

  // 1. Accounts + mappings (idempotent upsert; creates the four rental accounts
  //    + four mappings).
  const existing = await prisma.accountMapping.findUnique({
    where: { organizationId_key: { organizationId: org.id, key: 'customer_deposit' } },
  });
  if (existing) {
    console.log('  = customer_deposit mapping already present');
  } else {
    console.log(`  ${tag}+ seed rental accounts (2175/4250/4260/4270) + 4 mappings`);
  }
  if (APPLY) {
    await seedAccountingCore(prisma, org.id);
  }

  // 2. Fee products — each with an incomeAccountId override pointing at the
  //    mapped rental account. Products are soft-deleted masters; skip when the
  //    code already exists (org-unique), and revive nothing.
  for (const fee of FEE_PRODUCTS) {
    const existingProduct = await prisma.product.findUnique({
      where: { organizationId_code: { organizationId: org.id, code: fee.code } },
      select: { id: true },
    });
    if (existingProduct) {
      console.log(`  = fee product ${fee.code} already exists`);
      continue;
    }
    if (!APPLY) {
      console.log(`  ${tag}+ fee product ${fee.code} (${fee.name}) → ${fee.incomeMappingKey}`);
      continue;
    }
    const mapping = await prisma.accountMapping.findUnique({
      where: { organizationId_key: { organizationId: org.id, key: fee.incomeMappingKey } },
      select: { accountId: true },
    });
    if (!mapping) {
      throw new Error(
        `Mapping '${fee.incomeMappingKey}' missing after seedAccountingCore for org ${org.id}`,
      );
    }
    await prisma.product.create({
      data: {
        organizationId: org.id,
        code: fee.code,
        name: fee.name,
        productType: 'service',
        trackInventory: false,
        incomeAccountOverrideId: mapping.accountId,
        isActive: true,
      },
    });
    console.log(`  ${tag}+ fee product ${fee.code} → account ${mapping.accountId}`);
  }
}

async function main(): Promise<void> {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  console.log(`${tag}found ${orgs.length} organization(s)`);
  for (const org of orgs) await backfillOrg(org);
  console.log(`\n${tag}done. ${APPLY ? '' : 'Pass --apply to commit.'}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
