// Idempotent seed of the default nationality list into schooldb-planet.
// Targets DEMO + every org whose code starts with 'ADM-' AND has >=1 AdmissionApplication.
// Skips any org that already has nationalities, and skips any name already present per org.
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const DEFAULTS = ['Ugandan', 'Kenyan', 'Tanzanian', 'Rwandan', 'South Sudanese', 'Burundian', 'Congolese', 'Other'];

(async () => {
  // Resolve target orgs.
  const demo = await prisma.organization.findUnique({ where: { code: 'DEMO' } });
  const admOrgs = await prisma.$queryRawUnsafe(`
    SELECT o.id, o.code FROM "Organization" o
    WHERE o.code LIKE 'ADM-%'
      AND EXISTS (SELECT 1 FROM "AdmissionApplication" a WHERE a."organizationId" = o.id)
    ORDER BY o.code
  `);
  const targets = [];
  if (demo) targets.push(demo);
  for (const o of admOrgs) targets.push(o);

  if (!targets.length) { console.error('No target orgs found'); process.exit(1); }
  console.log(`Target orgs (${targets.length}):`, targets.map((t) => t.code).join(', '));

  let totalInserted = 0;
  let totalSkipped = 0;
  for (const org of targets) {
    const existing = await prisma.nationality.findMany({
      where: { organizationId: org.id },
      select: { name: true },
    });
    const have = new Set(existing.map((e) => e.name.toLowerCase()));
    let inserted = 0;
    for (const name of DEFAULTS) {
      if (have.has(name.toLowerCase())) { totalSkipped++; continue; }
      await prisma.nationality.create({
        data: { organizationId: org.id, name, isActive: true },
      });
      inserted++;
      totalInserted++;
    }
    console.log(`  ${org.code}: +${inserted} nationalities (${existing.length} already present)`);
  }
  console.log(`\nDONE. Inserted ${totalInserted}, skipped-existing ${totalSkipped}.`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('SEED ERROR', e);
  await prisma.$disconnect();
  process.exit(1);
});
