/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import { PERMISSIONS, SCHOOL_ROLE_PRESETS } from '@erp/shared';

/**
 * One-shot backfill for the `school:reports:*` grants (ADR-017).
 *
 * WHY THIS EXISTS. `ALL_PERMISSIONS` is flattened from source, so a NEW
 * organisation picks the keys up for free at seed time
 * (core.module.ts, organizations.service.ts). But an EXISTING tenant's grants
 * live in `Role.permissions` — a stored String[] that no code path ever widens.
 * Deploy the report centre without this and every current head teacher, bursar
 * and registrar gets a 403 on a screen that has just appeared in their nav.
 *
 * WHAT IT DOES. For each role whose name matches a school role preset, add the
 * report grants that preset declares. Matching is by name, case-insensitively,
 * because that is how the presets were applied in the first place.
 *
 * WHAT IT DOES NOT DO. It never removes a grant, never touches a role it cannot
 * match to a preset, and never invents a grant a preset does not declare — in
 * particular it will not hand `school:reports:finance:read` to a role the
 * presets do not give it to. Unmatched roles are listed for a human to decide.
 *
 * Idempotent: re-running adds nothing the second time.
 *
 * Usage:
 *   pnpm --filter @erp/api exec tsx scripts/backfill-report-permissions.ts --dry-run
 *   pnpm --filter @erp/api exec tsx scripts/backfill-report-permissions.ts
 */

const REPORT_GRANTS = new Set<string>([
  PERMISSIONS.school.readReports,
  PERMISSIONS.school.exportReports,
  PERMISSIONS.school.readFinanceReports,
  PERMISSIONS.school.readAuditReports,
  PERMISSIONS.school.manageSavedReports,
  PERMISSIONS.school.scheduleReports,
]);

/** preset name (lower-cased) -> the report grants that preset declares. */
function grantsByPresetName(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const preset of SCHOOL_ROLE_PRESETS) {
    const grants = preset.permissions.filter((p) => REPORT_GRANTS.has(p));
    if (grants.length > 0) out.set(preset.name.toLowerCase(), grants);
  }
  return out;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const prisma = new PrismaClient();
  const presets = grantsByPresetName();

  console.log(
    `${dryRun ? '[dry run] ' : ''}Backfilling report grants for ${presets.size} known school role(s).`,
  );

  // Raw client on purpose: this is a system migration across every tenant, so it
  // must not be narrowed by the request-scoped tenancy extension.
  const roles = await prisma.role.findMany({
    select: { id: true, name: true, organizationId: true, permissions: true },
  });

  let updated = 0;
  let alreadyCurrent = 0;
  const unmatched = new Map<string, number>();

  for (const role of roles) {
    // An administrator role holding the wildcard already implies everything.
    if (role.permissions.includes('*')) { alreadyCurrent += 1; continue; }

    const wanted = presets.get(role.name.trim().toLowerCase());
    if (!wanted) {
      unmatched.set(role.name, (unmatched.get(role.name) ?? 0) + 1);
      continue;
    }

    const missing = wanted.filter((p) => !role.permissions.includes(p));
    if (missing.length === 0) { alreadyCurrent += 1; continue; }

    console.log(
      `  ${dryRun ? 'would add' : 'adding'} [${missing.join(', ')}] to "${role.name}" (org ${role.organizationId})`,
    );
    if (!dryRun) {
      await prisma.role.update({
        where: { id: role.id },
        data: { permissions: { set: [...role.permissions, ...missing] } },
      });
    }
    updated += 1;
  }

  console.log(`\n${dryRun ? 'Would update' : 'Updated'}: ${updated} role(s)`);
  console.log(`Already current: ${alreadyCurrent} role(s)`);

  if (unmatched.size > 0) {
    // Custom roles are deliberately left alone — guessing which of them should
    // see fee arrears is not a decision a migration script gets to make.
    console.log(
      `\nSkipped ${unmatched.size} role name(s) that match no school preset. `
      + 'Grant these by hand if they need the report centre:',
    );
    for (const [name, count] of [...unmatched].sort()) {
      console.log(`  - ${name} (${count} org(s))`);
    }
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
