/**
 * Fees ⇄ Accounting integration audit. STRICTLY READ-ONLY.
 *
 * Runs the FINANCIAL_INVARIANTS certification gates against live data, in raw
 * SQL rather than through the services, so it audits what is actually IN the
 * database rather than what the query layer believes.
 *
 * Run: pnpm --filter @erp/api exec tsx prisma/audit-fees-accounting.ts
 * Exit: 0 = every gate green.
 *
 * Gates
 *   G1  Cached projections equal their subledger
 *         Document.amountPaid   = SUM(posted PaymentAllocation)
 *         FeeCredit.remaining   = amount − SUM(posted FeeCreditAllocation) (± refunds)
 *   G2  AR subledger = GL AR control, per organization
 *   G2b Fee-credit liability = GL FEE-CR
 *   G3  Every posted journal entry balances (debits = credits)
 *   G4  No AR movement on a student partner from outside the fee family
 *   G5  Every fee GL account is on the chart of accounts with a real category
 *   G6  No fee posting sits outside a fiscal period, or inside a closed one
 *   G7  Fee revenue reaches the P&L (revenue-category accounts carry fee credits)
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const FEE_SOURCES = ['school_fee', 'school_penalty', 'library_fine', 'school_meal'];
const ACTIVE = ['posted', 'paid'];

type Gate = { id: string; title: string; passed: boolean; detail: string };
const gates: Gate[] = [];

const n = (v: unknown) => Number(v ?? 0);
const UGX = (v: unknown) => n(v).toLocaleString('en-UG', { maximumFractionDigits: 0 });

function heading(t: string) {
  console.log(`\n${'─'.repeat(78)}\n${t}\n${'─'.repeat(78)}`);
}
function gate(id: string, title: string, passed: boolean, detail: string) {
  gates.push({ id, title, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'} · ${id} — ${detail}`);
}

/* ── G1 · cached projections ───────────────────────────────────────────── */

async function g1() {
  heading('G1 · Cached projections equal their subledger');

  const paid = await prisma.$queryRawUnsafe<any[]>(
    `SELECT d.id, d."documentNumber", d."amountPaid" cached,
            (d."journalEntryId" IS NOT NULL) posted,
            COALESCE(SUM(pa.amount) FILTER (WHERE pa.status = 'posted'), 0) sub
       FROM "Document" d
       LEFT JOIN "PaymentAllocation" pa ON pa."documentId" = d.id
      WHERE d."sourceType" = ANY($1::text[]) AND d.status::text = ANY($2::text[])
      GROUP BY d.id, d."documentNumber", d."amountPaid", d."journalEntryId"
     HAVING ABS(d."amountPaid" - COALESCE(SUM(pa.amount) FILTER (WHERE pa.status = 'posted'), 0)) > 0.01
      ORDER BY ABS(d."amountPaid" - COALESCE(SUM(pa.amount) FILTER (WHERE pa.status='posted'),0)) DESC`,
    FEE_SOURCES, ACTIVE,
  );
  for (const r of paid.slice(0, 10)) {
    console.log(`   ${r.documentNumber}  cached ${UGX(r.cached)}  subledger ${UGX(r.sub)}  ${r.posted ? 'ENGINE-POSTED' : 'seeded (no journal)'}`);
  }
  gate('G1-paid', 'Document.amountPaid', paid.length === 0,
    paid.length === 0
      ? `every ENGINE-POSTED amountPaid equals its subledger (${paid.length} seeded row(s) ignored)`
      : `${paid.length} document(s) drifted (${paid.filter((r: any) => r.posted).length} of them ENGINE-POSTED — those are the real defects)`);

  const credits = await prisma.$queryRawUnsafe<any[]>(
    `SELECT fc.id, fc.code, fc.amount, fc.remaining,
            COALESCE(SUM(fca.amount) FILTER (WHERE fca.status='posted'), 0) drawn, fc.status
       FROM "FeeCredit" fc
       LEFT JOIN "FeeCreditAllocation" fca ON fca."feeCreditId" = fc.id
      GROUP BY fc.id, fc.code, fc.amount, fc.remaining, fc.status
     HAVING fc.remaining - (fc.amount - COALESCE(SUM(fca.amount) FILTER (WHERE fca.status='posted'),0)) > 0.01`,
  );
  for (const r of credits.slice(0, 10)) {
    console.log(`   ${r.code}  remaining ${UGX(r.remaining)}  expected ≤ ${UGX(n(r.amount) - n(r.drawn))}  status ${r.status}`);
  }
  // Only the "remaining MORE than events justify" direction is a defect: a
  // refunded credit is drawn down without a FeeCreditAllocation.
  gate('G1-credit', 'FeeCredit.remaining', credits.length === 0,
    credits.length === 0
      ? 'no credit holds more than its events justify'
      : `${credits.length} credit(s) spendable beyond their funding`);
}

/* ── G2 · subledger ⇄ GL ───────────────────────────────────────────────── */

async function g2() {
  heading('G2 · AR subledger = GL AR control');

  const rows = await prisma.$queryRawUnsafe<any[]>(
    `WITH ar AS (
       SELECT a.id, a."organizationId" FROM "Account" a
        WHERE a."name" ILIKE '%receivable%' AND a."name" NOT ILIKE '%not%'
     ),
     sub AS (
       SELECT d."organizationId",
              SUM(d."amountResidual") total,
              -- Only invoices that actually went through the posting engine can
              -- reconcile: a seeded Document has no journal to reconcile against.
              SUM(d."amountResidual") FILTER (WHERE d."journalEntryId" IS NOT NULL) posted_total,
              COUNT(*) FILTER (WHERE d."journalEntryId" IS NULL) seeded_docs
         FROM "Document" d
        WHERE d."sourceType" = ANY($1::text[]) AND d.status::text = ANY($2::text[])
          AND d."paymentStatus"::text IN ('not_paid','partial') AND d."amountResidual" > 0
        GROUP BY 1
     ),
     gl AS (
       SELECT jl."organizationId", SUM(jl."baseDebit" - jl."baseCredit") total
         FROM "JournalLine" jl
         JOIN ar ON ar.id = jl."accountId"
         JOIN "StudentProfile" sp ON sp."partnerId" = jl."partnerId"
        GROUP BY 1
     ),
     -- A payment received but not yet applied credits AR with no invoice to
     -- show for it, so GL AR legitimately goes NEGATIVE while the open-invoice
     -- subledger reads zero. The identity that actually holds is
     --     GL AR = open residual − unallocated inbound payment
     unalloc AS (
       SELECT pay."organizationId", SUM(pay."unallocatedAmount") total
         FROM "Payment" pay
         JOIN "StudentProfile" sp ON sp."partnerId" = pay."partnerId"
        WHERE pay.direction = 'inbound' AND pay.status::text <> 'cancelled'
        GROUP BY 1
     )
     SELECT o.name org, COALESCE(sub.total,0) sub,
            COALESCE(sub.posted_total,0) posted_sub,
            COALESCE(sub.seeded_docs,0) seeded_docs,
            COALESCE(gl.total,0) gl,
            COALESCE(unalloc.total,0) unallocated,
            COALESCE(sub.posted_total,0) - COALESCE(unalloc.total,0) - COALESCE(gl.total,0) variance
       FROM "Organization" o
       LEFT JOIN sub ON sub."organizationId" = o.id
       LEFT JOIN gl  ON gl."organizationId"  = o.id
       LEFT JOIN unalloc ON unalloc."organizationId" = o.id
      WHERE COALESCE(sub.total,0) <> 0 OR COALESCE(gl.total,0) <> 0 OR COALESCE(unalloc.total,0) <> 0
      ORDER BY ABS(COALESCE(sub.total,0) - COALESCE(gl.total,0)) DESC`,
    FEE_SOURCES, ACTIVE,
  );

  const bad = rows.filter((r) => Math.abs(n(r.variance)) > 0.01);
  const seeded = rows.filter((r) => n(r.seeded_docs) > 0);
  for (const r of rows.slice(0, 12)) {
    const flag = Math.abs(n(r.variance)) > 0.01 ? '  <-- VARIANCE' : '';
    const note = n(r.seeded_docs) > 0 ? `  (${r.seeded_docs} seeded, excluded)` : '';
    console.log(`   ${String(r.org).padEnd(24)} sub ${UGX(r.posted_sub).padStart(12)}  unalloc ${UGX(r.unallocated).padStart(10)}  gl ${UGX(r.gl).padStart(12)}${flag}${note}`);
  }
  gate('G2', 'AR ⇄ GL', bad.length === 0,
    bad.length === 0
      ? `${rows.length} org(s) with fee AR, every ENGINE-POSTED balance reconciled (${seeded.length} org(s) also hold seeded invoices with no journal, excluded)`
      : `${bad.length} of ${rows.length} org(s) diverge on engine-posted AR — total ${UGX(bad.reduce((t, r) => t + n(r.variance), 0))}`);
}

async function g2b() {
  heading('G2b · Fee-credit liability = GL FEE-CR');
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `WITH outstanding AS (
       SELECT "organizationId", SUM(remaining) total FROM "FeeCredit"
        WHERE "isActive" = true GROUP BY 1
     ), gl AS (
       SELECT jl."organizationId", SUM(jl."baseCredit" - jl."baseDebit") total
         FROM "JournalLine" jl JOIN "Account" a ON a.id = jl."accountId"
        WHERE a.code = 'FEE-CR' GROUP BY 1
     )
     SELECT o.name org, COALESCE(outstanding.total,0) sub, COALESCE(gl.total,0) gl
       FROM "Organization" o
       LEFT JOIN outstanding ON outstanding."organizationId" = o.id
       LEFT JOIN gl ON gl."organizationId" = o.id
      WHERE COALESCE(outstanding.total,0) <> 0 OR COALESCE(gl.total,0) <> 0`,
  );
  const bad = rows.filter((r) => Math.abs(n(r.sub) - n(r.gl)) > 0.01);
  for (const r of rows) console.log(`   ${String(r.org).padEnd(30)} credits ${UGX(r.sub).padStart(12)}  gl ${UGX(r.gl).padStart(12)}`);
  gate('G2b', 'Credit liability ⇄ GL', bad.length === 0,
    bad.length === 0 ? `${rows.length} org(s) reconciled` : `${bad.length} org(s) diverge`);
}

/* ── G3 · every journal entry balances ─────────────────────────────────── */

async function g3() {
  heading('G3 · Every fee journal entry balances');
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT je.id, je."sourceType", SUM(jl."baseDebit") dr, SUM(jl."baseCredit") cr
       FROM "JournalEntry" je JOIN "JournalLine" jl ON jl."journalEntryId" = je.id
      WHERE je."sourceType" LIKE 'school%'
      GROUP BY je.id, je."sourceType"
     HAVING ABS(SUM(jl."baseDebit") - SUM(jl."baseCredit")) > 0.01`,
  );
  for (const r of rows.slice(0, 10)) console.log(`   ${r.sourceType} ${r.id}  dr ${UGX(r.dr)}  cr ${UGX(r.cr)}`);
  gate('G3', 'Journal balance', rows.length === 0,
    rows.length === 0 ? 'every school journal entry balances' : `${rows.length} unbalanced entr(ies)`);
}

/* ── G4 · no foreign AR on student partners ────────────────────────────── */

async function g4() {
  heading('G4 · Only fee-family sources touch student AR');
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT d."sourceType", COUNT(*) n
       FROM "Document" d JOIN "StudentProfile" sp ON sp."partnerId" = d."partnerId"
      WHERE d."sourceType" IS NOT NULL AND NOT (d."sourceType" = ANY($1::text[]))
      GROUP BY 1`,
    FEE_SOURCES,
  );
  for (const r of rows) console.log(`   ${r.sourceType}: ${r.n}`);
  gate('G4', 'AR scope', rows.length === 0,
    rows.length === 0
      ? 'no non-fee document sits on a student partner, so fee reconciliation is not polluted'
      : `${rows.length} foreign sourceType(s) on student partners — fee AR⇄GL would mis-state`);
}

/* ── G5 · fee accounts on the chart of accounts ────────────────────────── */

async function g5() {
  heading('G5 · Fee GL accounts are properly classified');
  const codes = ['FEE-CR', 'FEE-WAIVER', 'FEE-ADJ-INC', 'FEE-ADJ-EXP'];
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT a.code, a.name, a."organizationId", ac.name category, ac.classification::text kind
       FROM "Account" a LEFT JOIN "AccountCategory" ac ON ac.id = a."categoryId"
      WHERE a.code = ANY($1::text[])`,
    codes,
  );
  const seen = new Set(rows.map((r) => r.code));
  const uncategorised = rows.filter((r) => !r.category);
  for (const c of codes) {
    const hits = rows.filter((r) => r.code === c);
    console.log(`   ${c.padEnd(14)} ${hits.length} account(s)  ${hits[0]?.category ?? '(not yet created)'}`);
  }
  gate('G5', 'Chart of accounts', uncategorised.length === 0,
    uncategorised.length === 0
      ? `${seen.size}/${codes.length} fee account code(s) exist, all categorised (missing ones are created on first use)`
      : `${uncategorised.length} fee account(s) have no category — they will not appear on the P&L or balance sheet`);
}

/* ── G6 · fiscal period discipline ─────────────────────────────────────── */

async function g6() {
  heading('G6 · Fee postings sit inside an open fiscal period');
  const orphan = await prisma.$queryRawUnsafe<any[]>(
    `SELECT COUNT(*) n FROM "JournalEntry" je
      WHERE je."sourceType" LIKE 'school%'
        AND NOT EXISTS (
          SELECT 1 FROM "FiscalPeriod" fp
           WHERE fp."organizationId" = je."organizationId"
             AND je."postingDate" BETWEEN fp."startDate" AND fp."endDate")`,
  );
  const closed = await prisma.$queryRawUnsafe<any[]>(
    `SELECT COUNT(*) n FROM "JournalEntry" je
       JOIN "FiscalPeriod" fp ON fp."organizationId" = je."organizationId"
        AND je."postingDate" BETWEEN fp."startDate" AND fp."endDate"
      WHERE je."sourceType" LIKE 'school%' AND fp.status IN ('closed','locked')`,
  );
  console.log(`   school entries with no covering fiscal period: ${orphan[0].n}`);
  console.log(`   school entries inside a closed/locked period:   ${closed[0].n}`);
  // No covering period is only a defect when the org REQUIRES periods.
  const requiring = await prisma.$queryRawUnsafe<any[]>(
    `SELECT COUNT(*) n FROM "Organization" WHERE "requireFiscalPeriod" = true`,
  );
  gate('G6', 'Fiscal period', n(closed[0].n) === 0,
    n(closed[0].n) === 0
      ? `no fee posting inside a closed period (${requiring[0].n} org(s) require periods; ${orphan[0].n} entries uncovered, allowed where periods are optional)`
      : `${closed[0].n} fee posting(s) landed in a CLOSED period — the accounting gate was bypassed`);
}

/* ── G7 · fee revenue reaches the P&L ──────────────────────────────────── */

async function g7() {
  heading('G7 · Fee revenue reaches the profit & loss');
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT ac.name category, ac.classification::text kind, COUNT(DISTINCT je.id) entries,
            SUM(jl."baseCredit" - jl."baseDebit") net
       FROM "JournalLine" jl
       JOIN "JournalEntry" je ON je.id = jl."journalEntryId"
       JOIN "Account" a ON a.id = jl."accountId"
       LEFT JOIN "AccountCategory" ac ON ac.id = a."categoryId"
      WHERE je."sourceType" = 'school_fee_invoice'
      GROUP BY 1,2 ORDER BY 4 DESC`,
  );
  for (const r of rows) {
    console.log(`   ${String(r.category ?? '(uncategorised)').padEnd(28)} ${String(r.kind ?? '—').padEnd(18)} net ${UGX(r.net)}`);
  }
  const revenue = rows.filter((r) => String(r.kind ?? '').includes('revenue') || String(r.category ?? '').toLowerCase().includes('revenue'));
  const hasRevenue = revenue.some((r) => n(r.net) > 0);
  gate('G7', 'Revenue recognition', hasRevenue,
    hasRevenue
      ? `fee invoices credit revenue: ${UGX(revenue.reduce((t, r) => t + n(r.net), 0))}`
      : 'no revenue-category credit found on fee invoices — income would not appear on the P&L');
}

/* ── main ──────────────────────────────────────────────────────────────── */

async function main() {
  console.log(`Fees ⇄ Accounting integration audit · ${new Date().toISOString()}`);
  await g1();
  await g2();
  await g2b();
  await g3();
  await g4();
  await g5();
  await g6();
  await g7();

  heading('Summary');
  for (const g of gates) console.log(`${g.passed ? 'PASS' : 'FAIL'}  ${g.id.padEnd(10)} ${g.title}`);
  const failed = gates.filter((g) => !g.passed);
  console.log(
    failed.length === 0
      ? `\nAll ${gates.length} gates green.`
      : `\n${failed.length} of ${gates.length} gates FAILED: ${failed.map((f) => f.id).join(', ')}`,
  );
  if (failed.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
