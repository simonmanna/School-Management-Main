/**
 * READ-ONLY diagnostic for the latest elementary e2e org.
 * Prints G2 components (posted_sub, unallocated, GL AR) and the AR journal
 * lines so we can see where the 500k variance comes from.
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const UGX = (v: any) => Number(v ?? 0).toLocaleString('en-UG');

(async () => {
  await prisma.$connect();
  const org: any = await prisma.organization.findFirst({
    where: { code: { startsWith: 'ELEM-' } },
    orderBy: { createdAt: 'desc' },
  });
  if (!org) { console.log('no ELEM org found'); await prisma.$disconnect(); return; }
  console.log('ORG', org.id, org.code, org.name);

  const sub: any = await prisma.$queryRawUnsafe(
    `SELECT COALESCE(SUM(d."amountResidual"),0) total,
            COALESCE(SUM(CASE WHEN d."journalEntryId" IS NOT NULL THEN d."amountResidual" ELSE 0 END),0) posted_total
       FROM "Document" d
      WHERE d."organizationId"=$1 AND d."sourceType"=ANY(ARRAY['school_fee','school_penalty','library_fine','school_meal'])
        AND d.status::text=ANY(ARRAY['posted','paid']) AND d."paymentStatus"::text IN ('not_paid','partial') AND d."amountResidual">0`,
    org.id,
  );
  const unalloc: any = await prisma.$queryRawUnsafe(
    `SELECT COALESCE(SUM(p."unallocatedAmount"),0) total
       FROM "Payment" p JOIN "StudentProfile" sp ON sp."partnerId"=p."partnerId"
      WHERE p."organizationId"=$1 AND p.direction='inbound' AND p.status::text<>'cancelled'`,
    org.id,
  );
  const gl: any = await prisma.$queryRawUnsafe(
    `SELECT COALESCE(SUM(jl."baseDebit"-jl."baseCredit"),0) total
       FROM "JournalLine" jl JOIN "Account" a ON a.id=jl."accountId"
      WHERE a."organizationId"=$1 AND a."name" ILIKE '%receivable%' AND a."name" NOT ILIKE '%not%'`,
    org.id,
  );
  console.log('posted_sub ', UGX(sub[0].posted_total));
  console.log('unalloc    ', UGX(unalloc[0].total));
  console.log('gl_ar      ', UGX(gl[0].total));
  console.log('variance   ', UGX(Number(sub[0].posted_total) - Number(unalloc[0].total) - Number(gl[0].total)));

  // List AR journal lines (per entry) to find the 500k.
  const lines: any = await prisma.$queryRawUnsafe(
    `SELECT je.id, je."entryNumber", je."sourceType", je.status,
            SUM(jl."baseDebit"-jl."baseCredit") net
       FROM "JournalEntry" je
       JOIN "JournalLine" jl ON jl."journalEntryId"=je.id
       JOIN "Account" a ON a.id=jl."accountId"
      WHERE je."organizationId"=$1 AND a."name" ILIKE '%receivable%' AND a."name" NOT ILIKE '%not%'
      GROUP BY je.id, je."entryNumber", je."sourceType", je.status
      ORDER BY ABS(SUM(jl."baseDebit"-jl."baseCredit")) DESC
      LIMIT 15`,
    org.id,
  );
  console.log('--- AR journal entries (net Dr-Cr) ---');
  for (const l of lines) console.log('  ', l.entryNumber, l.sourceType, l.status, 'net', UGX(l.net));

  await prisma.$disconnect();
})();
