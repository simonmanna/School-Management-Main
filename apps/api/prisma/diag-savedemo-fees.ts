/**
 * READ-ONLY diagnostic for Save-Demo fee/AR/GL drift.
 * Does NOT mutate anything. Prints the composition of the two failing gates
 * (G1-paid, G2) for the Save-Demo organization so a remediation batch can be
 * written with evidence, not guesswork.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const FEE_SOURCES = ['school_fee', 'school_penalty', 'library_fine', 'school_meal'];
const ACTIVE = ['posted', 'paid'];

async function main() {
  const org = await prisma.organization.findFirst({ where: { name: 'Save-Demo' } });
  if (!org) { console.log('Save-Demo not found'); return; }
  console.log(`\n=== Save-Demo (${org.id}) ===\n`);

  // G1: documents where cached amountPaid != SUM(posted allocations)
  const g1 = await prisma.$queryRawUnsafe<any[]>(
    `SELECT d."documentNumber", d."amountPaid" cached,
            (d."journalEntryId" IS NOT NULL) posted,
            COALESCE(SUM(pa.amount) FILTER (WHERE pa.status='posted'),0) sub,
            d.status
       FROM "Document" d
       LEFT JOIN "PaymentAllocation" pa ON pa."documentId" = d.id
      WHERE d."organizationId" = $1 AND d."sourceType" = ANY($2::text[])
        AND d.status::text = ANY($3::text[])
      GROUP BY d.id, d."documentNumber", d."amountPaid", d."journalEntryId", d.status
     HAVING ABS(d."amountPaid" - COALESCE(SUM(pa.amount) FILTER (WHERE pa.status='posted'),0)) > 0.01
      ORDER BY ABS(d."amountPaid" - COALESCE(SUM(pa.amount) FILTER (WHERE pa.status='posted'),0)) DESC
      LIMIT 30`,
    org.id, FEE_SOURCES, ACTIVE,
  );
  console.log(`G1-paid drifted documents: ${g1.length}`);
  for (const r of g1.slice(0, 20)) {
    console.log(`   ${r.documentNumber}  cached=${r.cached}  subledger=${r.sub}  ${r.posted ? 'ENGINE-POSTED' : 'SEEDED(no journal)'}`);
  }

  // G1 breakdown: how many drifted are seeded (no journal) vs engine-posted
  const g1break = await prisma.$queryRawUnsafe<any[]>(
    `SELECT (d."journalEntryId" IS NOT NULL) posted,
            COUNT(*) cnt,
            SUM(ABS(d."amountPaid" - COALESCE(sub.sub,0))) drift
       FROM "Document" d
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(pa.amount) FILTER (WHERE pa.status='posted'),0) sub
           FROM "PaymentAllocation" pa WHERE pa."documentId" = d.id
       ) sub ON true
      WHERE d."organizationId" = $1 AND d."sourceType" = ANY($2::text[])
        AND d.status::text = ANY($3::text[])
      GROUP BY (d."journalEntryId" IS NOT NULL)
     HAVING SUM(ABS(d."amountPaid" - COALESCE(sub.sub,0))) > 0.01`,
    org.id, FEE_SOURCES, ACTIVE,
  );
  console.log('\nG1 breakdown (posted vs seeded):');
  for (const r of g1break) console.log(`   ${r.posted ? 'ENGINE-POSTED' : 'SEEDED'}  docs=${r.cnt}  drift=${r.drift}`);

  // G2 components for Save-Demo
  const g2 = await prisma.$queryRawUnsafe<any[]>(
    `WITH ar AS (SELECT a.id FROM "Account" a WHERE a."name" ILIKE '%receivable%' AND a."name" NOT ILIKE '%not%'),
            sub AS (SELECT SUM(d."amountResidual") total,
                           SUM(d."amountResidual") FILTER (WHERE d."journalEntryId" IS NOT NULL) posted_total,
                           COUNT(*) FILTER (WHERE d."journalEntryId" IS NULL) seeded_docs
                      FROM "Document" d
                     WHERE d."organizationId"=$1 AND d."sourceType"=ANY($2::text[]) AND d.status::text=ANY($3::text[])
                       AND d."paymentStatus"::text IN ('not_paid','partial') AND d."amountResidual">0),
            gl AS (SELECT SUM(jl."baseDebit"-jl."baseCredit") total
                     FROM "JournalLine" jl JOIN ar ON ar.id=jl."accountId"
                     JOIN "StudentProfile" sp ON sp."partnerId"=jl."partnerId" WHERE jl."organizationId"=$1),
            unalloc AS (SELECT SUM(pay."unallocatedAmount") total
                          FROM "Payment" pay JOIN "StudentProfile" sp ON sp."partnerId"=pay."partnerId"
                         WHERE pay."organizationId"=$1 AND pay.direction='inbound' AND pay.status::text<>'cancelled')
       SELECT COALESCE(sub.total,0) sub, COALESCE(sub.posted_total,0) posted_sub,
              COALESCE(sub.seeded_docs,0) seeded_docs,
              COALESCE(gl.total,0) gl, COALESCE(unalloc.total,0) unallocated,
              COALESCE(sub.posted_total,0)-COALESCE(unalloc.total,0)-COALESCE(gl.total,0) variance
         FROM sub, gl, unalloc`,
    org.id, FEE_SOURCES, ACTIVE,
  );
  console.log('\nG2 components:');
  for (const r of g2) console.log(`   posted_sub=${r.posted_sub}  seeded_docs=${r.seeded_docs}  unallocated=${r.unallocated}  gl_AR=${r.gl}  VARIANCE=${r.variance}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
