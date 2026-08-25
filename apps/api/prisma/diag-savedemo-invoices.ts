/**
 * READ-ONLY: investigate Save-Demo's 20 ENGINE-POSTED invoices that show
 * amountPaid = full amount but subledger (posted allocations) = 0.
 * Goal: determine if these are (a) phantom "paid" from a pre-hardening seed,
 * or (b) payments that exist but weren't linked. No mutation.
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.findFirst({ where: { name: 'Save-Demo' } });
  if (!org) { console.log('no org'); return; }

  const docs = await prisma.$queryRawUnsafe<any[]>(
    `SELECT d.id, d."documentNumber", d."amountPaid" cached, d."amountResidual" residual,
            d."paymentStatus", d."journalEntryId",
            (SELECT COUNT(*) FROM "PaymentAllocation" pa WHERE pa."documentId"=d.id) alloc_any,
            (SELECT COUNT(*) FROM "PaymentAllocation" pa WHERE pa."documentId"=d.id AND pa.status='posted') alloc_posted,
            (SELECT COUNT(*) FROM "Payment" p JOIN "PaymentAllocation" pa2 ON pa2."paymentId"=p.id WHERE pa2."documentId"=d.id) pay_linked
       FROM "Document" d
      WHERE d."organizationId"=$1 AND d."sourceType"=ANY(ARRAY['school_fee','school_penalty','library_fine','school_meal'])
        AND d.status::text=ANY(ARRAY['posted','paid']) AND d."journalEntryId" IS NOT NULL
        AND ABS(d."amountPaid" - COALESCE((SELECT SUM(pa.amount) FILTER (WHERE pa.status='posted') FROM "PaymentAllocation" pa WHERE pa."documentId"=d.id),0)) > 0.01
      LIMIT 25`,
    org.id,
  );
  console.log(`Engine-posted drifted docs: ${docs.length}\n`);
  for (const d of docs.slice(0, 25)) {
    console.log(`   ${d.documentNumber}`);
    console.log(`      cached=${d.cached}  residual=${d.residual}  paymentStatus=${d.paymentStatus}`);
    console.log(`      alloc_any=${d.alloc_any}  alloc_posted=${d.alloc_posted}  pay_linked=${d.pay_linked}  journal=${d.journalEntryId ? 'YES' : 'NO'}`);
  }

  // Are there any Payments at all in Save-Demo that are inbound & posted?
  const pays = await prisma.$queryRawUnsafe<any[]>(
    `SELECT p.status, COUNT(*) cnt, SUM(p."amount") total
       FROM "Payment" p JOIN "StudentProfile" sp ON sp."partnerId"=p."partnerId"
      WHERE p."organizationId"=$1 AND p.direction='inbound'
      GROUP BY p.status`,
    org.id,
  );
  console.log('\nSave-Demo inbound payments by status:');
  for (const p of pays) console.log(`   ${p.status}: cnt=${p.cnt} total=${p.total}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
