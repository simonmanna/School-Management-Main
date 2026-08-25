/**
 * FinancialRemediationBatch — Save-Demo.
 *
 * DRY RUN by default. Prints exactly what would change. Pass --apply to
 * execute. READ-ONLY unless --apply.
 *
 * Two classes of drift, handled differently:
 *   A) Seeded demo documents: sourceType in fee-family, no journalEntryId,
 *      no PaymentAllocation. Pure demo noise — safe to delete in a demo org.
 *   B) Phantom-paid invoices: engine-posted (journalEntryId present),
 *      paymentStatus='paid', amountPaid>0, BUT zero posted allocations and
 *      residual=0. The cached "paid" is fictional. We reset the cached
 *      payment columns to the true (zero) allocation subledger: this is the
 *      ONLY correction consistent with the economic-event model (balances
 *      derive from events; an invoice with no allocation event is unpaid).
 *
 * NOTE: G2's 690k GL-vs-subledger gap in OTHER posted invoices is NOT touched
 * here — it requires per-invoice investigation and is reported separately.
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const FEE_SOURCES = ['school_fee', 'school_penalty', 'library_fine', 'school_meal'];
const APPLY = process.argv.includes('--apply');

async function main() {
  const org = await prisma.organization.findFirst({ where: { name: 'Save-Demo' } });
  if (!org) { console.log('Save-Demo not found'); return; }
  console.log(`Save-Demo: ${org.id}  [${APPLY ? 'APPLYING' : 'DRY RUN'}]`);

  // A) seeded demo docs (no journal, no allocation)
  const seedDocs = await prisma.$queryRawUnsafe<any[]>(
    `SELECT d.id, d."documentNumber", d."amountPaid", d."sourceType"
       FROM "Document" d
      WHERE d."organizationId"=$1 AND d."sourceType"=ANY($2::text[])
        AND d."journalEntryId" IS NULL
        AND NOT EXISTS (SELECT 1 FROM "PaymentAllocation" pa WHERE pa."documentId"=d.id)
      ORDER BY d."documentNumber"`,
    org.id, FEE_SOURCES,
  );
  console.log(`\n[A] Seeded demo documents to DELETE: ${seedDocs.length}`);
  let seedTotal = 0;
  for (const d of seedDocs.slice(0, 50)) { seedTotal += Number(d.amountPaid); console.log(`   ${d.documentNumber}  paid=${d.amountPaid}  (${d.sourceType})`); }
  if (seedDocs.length > 50) console.log(`   ... +${seedDocs.length - 50} more`);
  console.log(`   total amountPaid on these (cosmetic): ${seedTotal}`);

  // B) phantom-paid invoices (posted journal, marked paid, zero allocations)
  const phantom = await prisma.$queryRawUnsafe<any[]>(
    `SELECT d.id, d."documentNumber", d."totalAmount" billed, d."amountPaid" cached,
            d."amountResidual" residual, d."paymentStatus"
       FROM "Document" d
      WHERE d."organizationId"=$1 AND d."sourceType"=ANY($2::text[])
        AND d."journalEntryId" IS NOT NULL AND d."paymentStatus"::text='paid'
        AND d."amountPaid" > 0
        AND NOT EXISTS (SELECT 1 FROM "PaymentAllocation" pa WHERE pa."documentId"=d.id AND pa.status='posted')
      ORDER BY d."documentNumber"`,
    org.id, FEE_SOURCES,
  );
  console.log(`\n[B] Phantom-paid invoices to RESET (unpaid, matches zero allocations): ${phantom.length}`);
  for (const d of phantom) {
    console.log(`   ${d.documentNumber}  billed=${d.billed}  cached=${d.cached} -> 0   residual ${d.residual} -> ${d.billed}   status paid -> not_paid`);
  }

  // G2 residual gap report (informational, not auto-fixed)
  const g2 = await prisma.$queryRawUnsafe<any[]>(
    `WITH ar AS (SELECT a.id FROM "Account" a WHERE a."name" ILIKE '%receivable%' AND a."name" NOT ILIKE '%not%'),
            sub AS (SELECT SUM(d."amountResidual") total,
                           SUM(d."amountResidual") FILTER (WHERE d."journalEntryId" IS NOT NULL) posted_total
                      FROM "Document" d
                     WHERE d."organizationId"=$1 AND d."sourceType"=ANY($2::text[]) AND d.status::text=ANY(ARRAY['posted','paid'])
                       AND d."paymentStatus"::text IN ('not_paid','partial') AND d."amountResidual">0),
            gl AS (SELECT SUM(jl."baseDebit"-jl."baseCredit") total
                     FROM "JournalLine" jl JOIN ar ON ar.id=jl."accountId"
                     JOIN "StudentProfile" sp ON sp."partnerId"=jl."partnerId" WHERE jl."organizationId"=$1)
       SELECT COALESCE(sub.posted_total,0) posted_sub, COALESCE(gl.total,0) gl,
              COALESCE(sub.posted_total,0)-COALESCE(gl.total,0) variance
         FROM sub, gl`,
    org.id, FEE_SOURCES,
  );
  console.log('\n[G2 residual gap — NOT auto-fixed, needs per-invoice review]:');
  for (const r of g2) console.log(`   posted_sub=${r.posted_sub}  gl_AR=${r.gl}  VARIANCE=${r.variance}`);

  if (!APPLY) { console.log('\n*** DRY RUN — no changes made. Re-run with --apply to execute. ***'); await prisma.$disconnect(); return; }

  // APPLY
  const del = await prisma.document.deleteMany({ where: { id: { in: seedDocs.map((d) => d.id) } } });
  console.log(`\n[A] deleted ${del.count} seeded documents`);
  for (const d of phantom) {
    await prisma.document.update({
      where: { id: d.id },
      data: { amountPaid: 0, amountResidual: d.billed, paymentStatus: 'not_paid' as any },
    });
  }
  console.log(`[B] reset ${phantom.length} phantom-paid invoices to unpaid`);
  console.log('\n*** APPLIED. Re-run audit-fees-accounting.ts to confirm gates. ***');
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
