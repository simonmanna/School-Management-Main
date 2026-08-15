/**
 * scripts/grant-all-permissions.ts
 * Flattens the shared PERMISSIONS catalog to every `resource:action` string and
 * assigns the COMPLETE set to the "School Admin" role (idempotent — duplicates removed).
 * Run from apps/api with: DATABASE_URL=... npx tsx ../../scripts/grant-all-permissions.ts
 */
import { PERMISSIONS } from '@erp/shared';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function flatten(obj: unknown, out: string[] = []): string[] {
  if (typeof obj === 'string') {
    out.push(obj);
  } else if (obj && typeof obj === 'object') {
    for (const v of Object.values(obj)) flatten(v, out);
  }
  return out;
}

async function main() {
  const all = Array.from(new Set(flatten(PERMISSIONS).filter((p) => typeof p === 'string' && p.includes(':'))));
  if (all.length === 0) throw new Error('No permissions extracted from PERMISSIONS catalog');

  const role = await prisma.role.findFirst({ where: { name: 'School Admin' } });
  if (!role) throw new Error('School Admin role not found');

  const existing: string[] = Array.isArray((role as any).permissions) ? (role as any).permissions : [];
  const merged = Array.from(new Set([...existing, ...all])).sort();

  await prisma.role.update({ where: { id: role.id }, data: { permissions: merged as any } });

  console.log(`Assigned ${merged.length} permissions to "School Admin" (was ${existing.length}).`);
  console.log('Sample:', merged.slice(0, 8).join(', '), '...');
}

main()
  .catch((e) => {
    console.error('FAILED:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
