/**
 * scripts/seed-fee-categories.ts — Focused, idempotent demo seed for the new
 * FeeCategory catalog (Option A) on the Sunrise Academy org.
 *
 * This deliberately does NOT use the full seed-school.ts safety guard: that
 * script refuses to run against a database that already has posted documents,
 * but here we intentionally augment an already-populated tenant with the new
 * FeeCategory master data (and align the existing Standard Term Fees structure
 * to reference those category codes). Upserts are keyed by unique constraints
 * so re-running is a no-op.
 *
 * Usage: pnpm --filter @erp/api exec tsx scripts/seed-fee-categories.ts
 */
import { PrismaClient } from '@prisma/client';

const ORG_ID = process.env.SEED_ORG_ID ?? 'org_sunrise_academy';

const seedUrl = (() => {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  return url.includes('connection_limit=') ? url : `${url}${url.includes('?') ? '&' : '?'}connection_limit=1`;
})();

const prisma = seedUrl ? new PrismaClient({ datasources: { db: { url: seedUrl } } }) : new PrismaClient();

async function main() {
  console.log('🌱 Seeding Fee Categories for', ORG_ID);

  // Establish tenant scope for this single-connection seed session.
  await prisma.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, ORG_ID);

  const cats = [
    { code: 'TUITION', name: 'School Fees', type: 'mandatory', paymentOrder: 1 },
    { code: 'REGISTRATION', name: 'Registration Fees', type: 'mandatory', paymentOrder: 2 },
    { code: 'UNIFORM', name: 'School Uniform', type: 'mandatory', paymentOrder: 3 },
    { code: 'TRANSPORT', name: 'Transport', type: 'optional', paymentOrder: 4 },
    { code: 'MEAL', name: 'Meals', type: 'optional', paymentOrder: 5 },
    { code: 'SWIMMING', name: 'Swimming', type: 'optional', paymentOrder: 6 },
    { code: 'LAB', name: 'Laboratory', type: 'mandatory', paymentOrder: 7 },
    { code: 'ACTIVITY', name: 'Activity', type: 'mandatory', paymentOrder: 8 },
  ];

  for (const c of cats) {
    await prisma.feeCategory.upsert({
      where: { organizationId_code: { organizationId: ORG_ID, code: c.code } },
      create: {
        organizationId: ORG_ID,
        code: c.code,
        name: c.name,
        type: c.type,
        paymentOrder: c.paymentOrder,
        isActive: true,
        description: `${c.type === 'optional' ? 'Optional' : 'Mandatory'} fee category.`,
      },
      update: { name: c.name, type: c.type, paymentOrder: c.paymentOrder },
    });
  }
  console.log(`   ✅ FeeCategory rows: ${cats.length} (upserted)`);

  // Align the existing "Standard Term Fees" structure's components to reference
  // the new category codes, and add REGISTRATION / UNIFORM / SWIMMING if missing.
  const year = await prisma.academicYear.findFirst({ where: { organizationId: ORG_ID, isCurrent: true } });
  if (year) {
    const fs = await prisma.feeStructure.findFirst({
      where: { organizationId: ORG_ID, name: 'Standard Term Fees', academicYearId: year.id },
    });
    if (fs) {
      const existing = (fs.components as any[]) ?? [];
      const want = [
        { code: 'TUITION', amount: 800_000, isOptional: false },
        { code: 'REGISTRATION', amount: 50_000, isOptional: false },
        { code: 'UNIFORM', amount: 120_000, isOptional: false },
        { code: 'TRANSPORT', amount: 200_000, isOptional: true },
        { code: 'MEAL', amount: 250_000, isOptional: true },
        { code: 'SWIMMING', amount: 100_000, isOptional: true },
        { code: 'LAB', amount: 50_000, isOptional: false },
        { code: 'ACTIVITY', amount: 30_000, isOptional: false },
      ];
      const byCode = new Map(existing.map((c) => [c.code, c]));
      const merged = want.map((w) => {
        const prev = byCode.get(w.code);
        return {
          code: w.code,
          productId: prev?.productId ?? '',
          amount: w.amount,
          isOptional: w.isOptional,
        };
      });
      await prisma.feeStructure.update({ where: { id: fs.id }, data: { components: merged as any } });
      console.log('   ✅ Aligned Standard Term Fees structure components to category codes');
    } else {
      console.log('   ℹ️  No "Standard Term Fees" structure found — categories only were seeded (structures already exist via other means).');
    }
  }

  const total = await prisma.feeCategory.count({ where: { organizationId: ORG_ID } });
  console.log(`✅ Done. FeeCategory total for org: ${total}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
