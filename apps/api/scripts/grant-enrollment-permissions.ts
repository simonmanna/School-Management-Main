/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import { ALL_PERMISSIONS, PERMISSIONS, PERMISSION_META } from '@erp/shared';

/**
 * Phase 1 permission rollout (ADR-018 / ADR-019).
 *
 * New permission strings do NOT reach existing tenants on their own —
 * `Role.permissions` is stored data, and the catalogue table is seeded, so a
 * fresh grant is invisible until something writes it. This script:
 *
 *   1. tops up the global `Permission` catalogue from ALL_PERMISSIONS, and
 *   2. grants the enrollment/programme/migration permissions to the roles that
 *      should hold them, matched by intent rather than by exact name.
 *
 * Idempotent. Run with:
 *   pnpm --filter @erp/api exec ts-node scripts/grant-enrollment-permissions.ts
 */

const ENROLLMENT = PERMISSIONS.school.manageEnrollment;
const PROGRAMMES = PERMISSIONS.school.manageProgrammes;
const MIGRATE = PERMISSIONS.school.runAcademicMigration;

/** Which of the three a role gets, by what the role is for. */
function grantsFor(name: string): string[] {
  const n = name.toLowerCase();
  if (n.includes('admin') || n.includes('head teacher') || n.includes('headteacher') || n.includes('director')) {
    return [ENROLLMENT, PROGRAMMES, MIGRATE];
  }
  if (n.includes('registrar') || n.includes('deputy') || n.includes('academic')) {
    return [ENROLLMENT, PROGRAMMES];
  }
  if (n.includes('secretary') || n.includes('front desk') || n.includes('receptionist')) {
    return [ENROLLMENT];
  }
  return [];
}

async function main() {
  const prisma = new PrismaClient();
  try {
    // 1. Catalogue top-up — the permission picker reads this table.
    let cataloged = 0;
    for (const key of ALL_PERMISSIONS) {
      const meta = PERMISSION_META[key];
      const [resource, ...rest] = key.split(':');
      await prisma.permission.upsert({
        where: { key },
        update: { description: meta?.description ?? undefined },
        create: {
          key,
          resource,
          action: rest.join(':') || 'read',
          description: meta?.description ?? meta?.label ?? key,
        },
      });
      cataloged += 1;
    }
    console.log(`Permission catalogue: ${cataloged} entries upserted.`);

    // 2. Role grants.
    const roles = await prisma.role.findMany({ select: { id: true, name: true, permissions: true, organizationId: true } });
    let updated = 0;
    for (const role of roles) {
      const isAdministrator = role.name.toLowerCase() === 'administrator';
      const wanted = isAdministrator ? [ENROLLMENT, PROGRAMMES, MIGRATE] : grantsFor(role.name);
      if (!wanted.length) continue;
      const missing = wanted.filter((p) => !role.permissions.includes(p));
      if (!missing.length) continue;
      await prisma.role.update({
        where: { id: role.id },
        data: { permissions: [...role.permissions, ...missing] },
      });
      updated += 1;
      console.log(`  ${role.name} (${role.organizationId ?? 'global'}) += ${missing.join(', ')}`);
    }
    console.log(`Roles updated: ${updated}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
