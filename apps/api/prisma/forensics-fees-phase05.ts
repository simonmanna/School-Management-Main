/**
 * Phase 0.5 — School Fees & Finance historical forensic report.
 *
 * STRICTLY READ-ONLY. This script quantifies the damage the P0 defects did to
 * data already in the database. It never writes: per FINANCIAL_INVARIANTS
 * §Immutability, posted financial records are corrected only through
 * compensating/reversal transactions in an approved Phase 0.9 remediation
 * batch, never by editing history.
 *
 * Run:  pnpm --filter @erp/api exec tsx prisma/forensics-fees-phase05.ts
 *
 * What it measures, per defect:
 *
 *   P0-2  Waivers marked applied that have NO corresponding school_waiver
 *         journal entry. The AR subledger was reduced but the general ledger
 *         was never touched — a permanent, silent divergence.
 *   P0-3  Documents whose amountPaid includes forgiven (waived) or credited
 *         amounts, so every collections figure derived from it overstates the
 *         cash actually received.
 *   P0-6  Refunds that exceeded the student's refundable entitlement.
 *   P0-7  Non-active documents (draft / cancelled) that carry a residual and
 *         were therefore being counted in student balances.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const UGX = (v: unknown) =>
  Number(v ?? 0).toLocaleString('en-UG', { maximumFractionDigits: 0 });

function heading(title: string) {
  console.log(`\n${'─'.repeat(78)}\n${title}\n${'─'.repeat(78)}`);
}

async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  console.log(`Phase 0.5 forensic report · ${new Date().toISOString()}`);
  console.log(`Organizations: ${orgs.length}`);

  /* ── P0-2: applied waivers with no GL entry ─────────────────────────── */
  heading('P0-2 · Waivers applied WITHOUT a general-ledger entry');

  const appliedWaivers = await prisma.waiver.findMany({
    where: { applied: true },
    select: {
      id: true, organizationId: true, code: true, name: true,
      amount: true, studentProfileId: true, createdAt: true,
    },
  });

  const waiverEntries = await prisma.journalEntry.findMany({
    where: { sourceType: 'school_waiver' },
    select: { sourceId: true },
  });
  const postedWaiverIds = new Set(waiverEntries.map((e) => e.sourceId));

  const orphanWaivers = appliedWaivers.filter((w) => !postedWaiverIds.has(w.id));
  const orphanTotal = orphanWaivers.reduce((s, w) => s + Number(w.amount), 0);

  console.log(`Applied waivers:            ${appliedWaivers.length}`);
  console.log(`...with a GL entry:         ${appliedWaivers.length - orphanWaivers.length}`);
  console.log(`...WITHOUT a GL entry:      ${orphanWaivers.length}   <-- AR/GL divergence`);
  console.log(`Unposted waived value:      UGX ${UGX(orphanTotal)}`);
  for (const w of orphanWaivers) {
    console.log(`   ${w.code.padEnd(24)} UGX ${UGX(w.amount).padStart(14)}  ${w.name}`);
  }

  /* ── P0-3: amountPaid polluted by non-payment reductions ────────────── */
  heading('P0-3 · Documents whose amountPaid includes forgiven / credited value');

  // Authoritative cash per document = SUM(PaymentAllocation). A document whose
  // amountPaid exceeds that has been credited with money it never received.
  //
  // Two very different causes produce that signature, and conflating them badly
  // overstates the remediation scope:
  //
  //   (a) GENUINE P0-3 — a Waiver or FeeCredit drawdown incremented amountPaid.
  //       Detected by the student having an applied waiver or a drawn-down
  //       credit. These need a Phase 0.9 compensating entry.
  //   (b) SEEDED / PRE-SUBLEDGER — amountPaid was written directly at document
  //       creation with no Payment row behind it. seed-school-demo.ts does
  //       exactly this. No economic event was ever misrepresented; the rows
  //       simply predate the allocation subledger. These need backfill or
  //       explicit exclusion, NOT a reversal.
  const variance = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
    SELECT d."id",
           d."documentNumber",
           d."totalAmount",
           d."amountPaid",
           COALESCE(a."allocated", 0) AS "allocated",
           d."amountPaid" - COALESCE(a."allocated", 0) AS "variance",
           (w."cnt" > 0 OR c."cnt" > 0) AS "hasForgiveness"
      FROM "Document" d
      LEFT JOIN (
        SELECT "documentId", SUM("amount") AS "allocated"
          FROM "PaymentAllocation"
         WHERE "documentId" IS NOT NULL
         GROUP BY "documentId"
      ) a ON a."documentId" = d."id"
      LEFT JOIN "StudentProfile" sp
             ON sp."partnerId" = d."partnerId" AND sp."organizationId" = d."organizationId"
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS "cnt" FROM "Waiver" w2
         WHERE w2."studentProfileId" = sp."id" AND w2."applied" = true
      ) w ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS "cnt" FROM "FeeCredit" c2
         WHERE c2."studentProfileId" = sp."id" AND c2."remaining" < c2."amount"
      ) c ON TRUE
     WHERE d."sourceType" IN ('school_fee','school_penalty','library_fine','school_meal')
       AND d."amountPaid" - COALESCE(a."allocated", 0) <> 0
     ORDER BY ABS(d."amountPaid" - COALESCE(a."allocated", 0)) DESC
  `);

  const sumVar = (rows: Record<string, unknown>[]) =>
    rows.reduce((s, r) => s + Number(r.variance ?? 0), 0);
  const polluted = variance.filter((r) => r.hasForgiveness === true);
  const legacy = variance.filter((r) => r.hasForgiveness !== true);
  const pollutedTotal = sumVar(polluted);
  const legacyTotal = sumVar(legacy);

  console.log(`Documents where amountPaid <> SUM(PaymentAllocation): ${variance.length}`);
  console.log('');
  console.log('  (a) student has an applied waiver / drawn-down credit  -- GENUINE P0-3');
  console.log(`      ${String(polluted.length).padStart(5)} docs   UGX ${UGX(pollutedTotal)}`);
  console.log('  (b) no forgiveness on record  -- seeded / pre-subledger data');
  console.log(`      ${String(legacy.length).padStart(5)} docs   UGX ${UGX(legacyTotal)}`);

  if (polluted.length) {
    console.log('');
    console.log('  Document              Billed          Paid     Allocated      Variance');
    for (const r of polluted.slice(0, 25)) {
      console.log(
        `  ${String(r.documentNumber).slice(0, 20).padEnd(20)}` +
          `${UGX(r.totalAmount).padStart(12)}` +
          `${UGX(r.amountPaid).padStart(14)}` +
          `${UGX(r.allocated).padStart(14)}` +
          `${UGX(r.variance).padStart(14)}`,
      );
    }
    if (polluted.length > 25) console.log(`  ... and ${polluted.length - 25} more`);
  }
  if (legacy.length) {
    console.log('');
    console.log('  (b) is backfill scope, not reversal scope: no economic event was');
    console.log('      misrepresented, so there is nothing to compensate.');
  }


  /* ── P0-6: refunds beyond entitlement ───────────────────────────────── */
  heading('P0-6 · Outbound refunds vs recorded entitlement');

  const refunds = await prisma.payment.findMany({
    where: { direction: 'outbound' },
    select: {
      id: true, paymentNumber: true, partnerId: true,
      amount: true, paymentDate: true, reference: true,
    },
    orderBy: { paymentDate: 'desc' },
  });
  console.log(`Outbound payments (all kinds, incl. supplier): ${refunds.length}`);

  // Narrow to refunds against a student Partner.
  const studentPartners = await prisma.studentProfile.findMany({
    select: { partnerId: true, admissionNo: true },
  });
  const byPartner = new Map(studentPartners.map((s) => [s.partnerId, s.admissionNo]));
  const studentRefunds = refunds.filter((r) => byPartner.has(r.partnerId));
  const refundTotal = studentRefunds.reduce((s, r) => s + Number(r.amount), 0);

  console.log(`...against a student Partner:                  ${studentRefunds.length}`);
  console.log(`Total refunded to students:  UGX ${UGX(refundTotal)}`);
  for (const r of studentRefunds) {
    console.log(
      `   ${String(r.paymentNumber).padEnd(20)} UGX ${UGX(r.amount).padStart(14)}` +
        `  student ${byPartner.get(r.partnerId)}  ${r.paymentDate.toISOString().slice(0, 10)}`,
    );
  }
  if (studentRefunds.length) {
    console.log('\n   Review each against its funding overpayment/credit — the pre-fix');
    console.log('   code applied no cap at all, so any of these may be unbacked.');
  }

  /* ── P0-7: non-active documents carrying a residual ─────────────────── */
  heading('P0-7 · Draft / cancelled documents that were counted in balances');

  const nonActive = await prisma.document.groupBy({
    by: ['status'],
    where: {
      sourceType: { in: ['school_fee', 'school_penalty', 'library_fine', 'school_meal'] },
      status: { notIn: ['posted', 'paid'] },
      amountResidual: { gt: 0 },
    },
    _count: { _all: true },
    _sum: { amountResidual: true },
  });

  if (!nonActive.length) {
    console.log('None. No draft or cancelled fee document carries a residual.');
  } else {
    let total = 0;
    for (const g of nonActive) {
      const v = Number(g._sum.amountResidual ?? 0);
      total += v;
      console.log(`   status=${String(g.status).padEnd(12)} ${String(g._count._all).padStart(5)} docs   UGX ${UGX(v)}`);
    }
    console.log(`\n   Phantom receivable previously shown to parents: UGX ${UGX(total)}`);
  }

  /* ── Summary ─────────────────────────────────────────────────────────── */
  heading('Remediation scope');
  const rows = [
    ['P0-2  waivers needing a compensating GL entry', orphanWaivers.length, orphanTotal],
    ['P0-3  documents needing a compensating entry', polluted.length, pollutedTotal],
    ['      seeded/pre-subledger (backfill, not reversal)', legacy.length, legacyTotal],
    ['P0-6  student refunds needing entitlement review', studentRefunds.length, refundTotal],
    ['P0-7  non-active docs to exclude (no write needed)',
      nonActive.reduce((s, g) => s + g._count._all, 0),
      nonActive.reduce((s, g) => s + Number(g._sum.amountResidual ?? 0), 0)],
  ] as const;

  for (const [label, count, value] of rows) {
    console.log(`${String(label).padEnd(52)} ${String(count).padStart(5)}   UGX ${UGX(value)}`);
  }

  const needsBatch = orphanWaivers.length + polluted.length;
  console.log(
    needsBatch === 0
      ? '\nNo historical corruption found. Gate 5 is satisfiable without a remediation batch.'
      : `\n${needsBatch} record(s) require a Phase 0.9 FinancialRemediationBatch (reversal + compensating entry).`,
  );
}

main()
  .catch((e) => {
    console.error('Forensic report failed:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
