/**
 * P0 backfill — make per-tenant module enablement explicit.
 *
 * `ModuleEnabledGuard` gates the optional verticals behind an active
 * `OrganizationModule` row. An organization with NO rows is treated as
 * "never configured" and allowed through, so shipping the guard cannot revoke
 * a live tenant's modules. This script closes that gap: it writes an explicit
 * row per organization for every module the process currently has enabled,
 * after which the guard is strictly fail-closed for those tenants.
 *
 * Which modules get enabled is read from the same `ENABLE_*` env flags that
 * `app.module.ts` uses, so running this on a deployment reproduces exactly what
 * that deployment already serves. Always-on modules are not gated and are not
 * written.
 *
 * Existing rows are never modified — a module a tenant has explicitly disabled
 * stays disabled.
 *
 * DRY-RUN BY DEFAULT — prints what it would do. Pass `--apply` to commit:
 *   npx tsx prisma/backfill-organization-modules.ts           # preview
 *   npx tsx prisma/backfill-organization-modules.ts --apply   # execute
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const tag = APPLY ? '' : '[dry-run] ';

/** Optional verticals, keyed by the env flag that gates them in app.module.ts. */
const GATED_MODULES: { module: string; envFlag: string }[] = [
  { module: 'beverage', envFlag: 'ENABLE_BEVERAGE' },
  { module: 'fixed-asset', envFlag: 'ENABLE_ASSETS' },
  { module: 'task', envFlag: 'ENABLE_TASKS' },
  { module: 'manufacturing', envFlag: 'ENABLE_MANUFACTURING' },
  { module: 'rental', envFlag: 'ENABLE_RENTAL' },
  { module: 'repair', envFlag: 'ENABLE_REPAIR' },
  { module: 'hr', envFlag: 'ENABLE_HR' },
  { module: 'communication', envFlag: 'ENABLE_COMMUNICATION' },
];

async function main() {
  const active = GATED_MODULES.filter((m) => process.env[m.envFlag] === 'true');
  const inactive = GATED_MODULES.filter((m) => process.env[m.envFlag] !== 'true');

  console.log(`${tag}OrganizationModule backfill starting…`);
  console.log(`  enabled by env:  ${active.map((m) => m.module).join(', ') || '(none)'}`);
  console.log(`  disabled by env: ${inactive.map((m) => m.module).join(', ') || '(none)'}`);

  if (active.length === 0) {
    console.log(
      '\n  No ENABLE_* flags are set to "true" in this environment. Writing no rows would leave\n' +
        '  every organization "unconfigured", which the guard allows through. Set the same flags\n' +
        '  this deployment runs with (or source its .env) and re-run.',
    );
    return;
  }

  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  console.log(`\n  ${orgs.length} organization(s)\n`);

  let created = 0;
  let skipped = 0;

  for (const org of orgs) {
    for (const { module } of active) {
      const existing = await prisma.organizationModule.findUnique({
        where: { organizationId_moduleName: { organizationId: org.id, moduleName: module } },
      });
      if (existing) {
        console.log(
          `  = ${org.name} / ${module} — row exists (isActive=${existing.isActive}), leaving as-is`,
        );
        skipped++;
        continue;
      }
      console.log(`  ${tag}+ ${org.name} / ${module} → enabled`);
      if (APPLY) {
        await prisma.organizationModule.create({
          data: { organizationId: org.id, moduleName: module, isActive: true, config: {} },
        });
      }
      created++;
    }
  }

  console.log(
    `\n${tag}Done. ${created} row(s) to create, ${skipped} left untouched.` +
      (APPLY ? '' : ' Re-run with --apply to commit.'),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
