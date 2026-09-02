/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import { PERMISSIONS } from '@erp/shared';

/**
 * Grant report permissions to existing roles based on role name/intent.
 * Run with: pnpm --filter @erp/api exec tsx scripts/grant-report-permissions.ts
 */

const REPORT_GRANTS = {
  // Management roles - full access
  management: [
    PERMISSIONS.school.readReports,
    PERMISSIONS.school.exportReports,
    PERMISSIONS.school.readFinanceReports,
    PERMISSIONS.school.readAuditReports,
    PERMISSIONS.school.manageSavedReports,
    PERMISSIONS.school.scheduleReports,
  ],
  // Admin/Head Teacher equivalent
  admin: [
    PERMISSIONS.school.readReports,
    PERMISSIONS.school.exportReports,
    PERMISSIONS.school.readFinanceReports,
    PERMISSIONS.school.readAuditReports,
    PERMISSIONS.school.manageSavedReports,
    PERMISSIONS.school.scheduleReports,
  ],
  // Teachers - read + export
  teacher: [
    PERMISSIONS.school.readReports,
    PERMISSIONS.school.exportReports,
  ],
  // Bursar/Finance
  finance: [
    PERMISSIONS.school.readReports,
    PERMISSIONS.school.exportReports,
    PERMISSIONS.school.readFinanceReports,
    PERMISSIONS.school.manageSavedReports,
  ],
  // Registrar/Academic
  academic: [
    PERMISSIONS.school.readReports,
    PERMISSIONS.school.exportReports,
    PERMISSIONS.school.manageSavedReports,
  ],
};

function getGrantsForRole(name: string): string[] {
  const lower = name.toLowerCase();
  
  // Management roles
  if (['head teacher', 'deputy head', 'principal', 'director', 'administrator', 'admin'].some(k => lower.includes(k))) {
    return REPORT_GRANTS.admin;
  }
  
  // Finance roles
  if (['bursar', 'accountant', 'finance', 'cashier', 'account'].some(k => lower.includes(k))) {
    return REPORT_GRANTS.finance;
  }
  
  // Teacher roles
  if (['teacher', 'instructor', 'lecturer', 'faculty'].some(k => lower.includes(k))) {
    return REPORT_GRANTS.teacher;
  }
  
  // Academic/Registrar
  if (['registrar', 'academic', 'exams', 'examination'].some(k => lower.includes(k))) {
    return REPORT_GRANTS.academic;
  }
  
  // Supervisor might need some access
  if (lower.includes('supervisor')) {
    return REPORT_GRANTS.management;
  }
  
  return [];
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const prisma = new PrismaClient();

  console.log(`${dryRun ? '[dry run] ' : ''}Granting report permissions to existing roles...`);

  const roles = await prisma.role.findMany({
    select: { id: true, name: true, organizationId: true, permissions: true },
  });

  let updated = 0;
  let skipped = 0;

  for (const role of roles) {
    if (role.permissions.includes('*')) {
      console.log(`  Skipping "${role.name}" (wildcard permission)`);
      skipped++;
      continue;
    }

    const grants = getGrantsForRole(role.name);
    if (grants.length === 0) {
      console.log(`  No report grants mapped for "${role.name}"`);
      skipped++;
      continue;
    }

    const missing = grants.filter((p) => !role.permissions.includes(p));
    if (missing.length === 0) {
      console.log(`  "${role.name}" already has all grants`);
      skipped++;
      continue;
    }

    console.log(`  ${dryRun ? 'Would add' : 'Adding'} [${missing.join(', ')}] to "${role.name}" (org ${role.organizationId})`);
    
    if (!dryRun) {
      await prisma.role.update({
        where: { id: role.id },
        data: { permissions: { set: [...role.permissions, ...missing] } },
      });
    }
    updated++;
  }

  console.log(`\n${dryRun ? 'Would update' : 'Updated'}: ${updated} role(s)`);
  console.log(`Skipped: ${skipped} role(s)`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});