/**
 * seed-attendance-statuses.ts — idempotently ensure the DEMO organization has
 * the default attendance-status catalog (Absent / Present / Late).
 *
 * This is intentionally SEPARATE from seed-school-demo.ts so it can be re-run
 * at any time — even when the full demo seed has already bail-guarded itself
 * out (a SchoolProfile already exists). Safe to run repeatedly: existing
 * statuses are kept, missing ones are added, and labels/flags are refreshed.
 *
 * Run (from apps/api, with DATABASE_URL / .env present):
 *   npx ts-node prisma/seed-attendance-statuses.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// The default catalog every org starts with. Codes are stable; the UI and
// rate-math key off these plus the isPresent/isLate/isAbsent flags.
const DEFAULTS: Array<{
  code: string;
  label: string;
  color: string;
  isDefault?: boolean;
  isPresent?: boolean;
  isLate?: boolean;
  isAbsent?: boolean;
  sortOrder: number;
}> = [
  { code: 'present', label: 'Present', color: '#16a34a', isDefault: true, isPresent: true, sortOrder: 1 },
  { code: 'absent', label: 'Absent', color: '#dc2626', isAbsent: true, sortOrder: 2 },
  { code: 'late', label: 'Late', color: '#f59e0b', isLate: true, sortOrder: 3 },
];

async function main() {
  // Resolve the target org: prefer the DEMO short code, else the first org.
  const org =
    (await prisma.organization.findFirst({ where: { code: 'DEMO' } })) ??
    (await prisma.organization.findFirst({}));
  if (!org) {
    console.error('No organization found — run the main demo seed first.');
    process.exit(1);
  }
  console.log(`Seeding attendance statuses for org ${org.id} (${org.name})`);

  for (const def of DEFAULTS) {
    const existing = await prisma.attendanceStatusConfig.findFirst({
      where: { organizationId: org.id, code: def.code },
    });
    if (existing) {
      await prisma.attendanceStatusConfig.update({
        where: { id: existing.id },
        data: { label: def.label, color: def.color, sortOrder: def.sortOrder, isDefault: def.isDefault ?? false, isPresent: def.isPresent ?? false, isLate: def.isLate ?? false, isAbsent: def.isAbsent ?? false },
      });
      console.log(`  updated ${def.code}`);
    } else {
      await prisma.attendanceStatusConfig.create({
        data: { organizationId: org.id, code: def.code, label: def.label, color: def.color, isDefault: def.isDefault ?? false, isPresent: def.isPresent ?? false, isLate: def.isLate ?? false, isAbsent: def.isAbsent ?? false, sortOrder: def.sortOrder },
      });
      console.log(`  created ${def.code}`);
    }
  }
  const count = await prisma.attendanceStatusConfig.count({ where: { organizationId: org.id } });
  console.log(`Done. Org now has ${count} attendance status(es).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
