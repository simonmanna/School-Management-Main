/**
 * Workforce Management (HR) backfill — give every existing organization the
 * eight payroll GL accounts + AccountMappings so payroll runs can post.
 *
 * For each org:
 *   1. seedAccountingCore — idempotent upsert; creates accounts 1350 (Employee
 *      Advances), 1355 (Employee Loans), 2180 (Net Pay Payable), 2210 (PAYE Tax
 *      Payable), 2220 (Pension Payable), 2230 (Social Security Payable), 2240
 *      (Insurance Payable), 5710 (Salaries & Wages Expense) and the eight
 *      AccountMapping rows, touches nothing else.
 *
 * `AccountCategory` is global and boot-seeded, so `current_asset` /
 * `current_liability` / `operating_expense` already exist — no category backfill.
 *
 * DRY-RUN BY DEFAULT — prints what it would do. Pass `--apply` to commit:
 *   ts-node prisma/backfill-hr-accounts.ts           # preview
 *   ts-node prisma/backfill-hr-accounts.ts --apply   # execute
 */
import { PrismaClient } from '@prisma/client';
import { seedAccountingCore } from '../src/modules/accounting/coa/coa-seeder';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const tag = APPLY ? '' : '[dry-run] ';

const HR_MAPPING_KEYS = [
  'salary_expense',
  'net_pay_payable',
  'paye_payable',
  'pension_payable',
  'social_security_payable',
  'insurance_payable',
  'employee_advance_receivable',
  'employee_loan_receivable',
] as const;

async function backfillOrg(org: { id: string; name: string }): Promise<void> {
  console.log(`\n${tag}org "${org.name}" (${org.id})`);

  const existing = await prisma.accountMapping.findUnique({
    where: { organizationId_key: { organizationId: org.id, key: 'salary_expense' } },
  });
  if (existing) {
    console.log('  = salary_expense mapping already present — HR accounts seeded');
    return;
  }
  console.log(
    `  ${tag}+ seed HR accounts (1350/1355/2180/2210/2220/2230/2240/5710) + ${HR_MAPPING_KEYS.length} mappings`,
  );
  if (!APPLY) return;

  await seedAccountingCore(prisma, org.id);

  // Verify every HR mapping landed.
  for (const key of HR_MAPPING_KEYS) {
    const mapping = await prisma.accountMapping.findUnique({
      where: { organizationId_key: { organizationId: org.id, key } },
      select: { accountId: true },
    });
    if (!mapping) {
      throw new Error(`Mapping '${key}' missing after seedAccountingCore for org ${org.id}`);
    }
  }
  console.log(`  ✔ ${HR_MAPPING_KEYS.length}/${HR_MAPPING_KEYS.length} HR mappings verified`);
}

async function main(): Promise<void> {
  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`${tag}Found ${orgs.length} org(s)`);
  for (const org of orgs) {
    await backfillOrg(org);
  }
  if (!APPLY) {
    console.log('\nDry-run complete — pass --apply to commit.');
  } else {
    console.log('\nBackfill complete.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
