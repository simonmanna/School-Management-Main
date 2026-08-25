/**
 * Phase 0 — pre-migration data audit for the Fees integrity constraints.
 *
 * STRICTLY READ-ONLY. This is a HARD GATE: the constraints in
 * `20260824120000_fees_integrity_constraints` must not be applied until every
 * check here passes. A unique index created over data that already violates it
 * fails at CREATE time; worse, one created over data that *narrowly* passes can
 * still leave historical rows that violate the model the index is meant to
 * express (checks 4–6 exist precisely for that case).
 *
 * Run:  pnpm --filter @erp/api exec tsx prisma/audit-fees-preconstraint.ts
 * Exit: 0 = every check PASSED. 1 = at least one FAILED.
 *
 * Checks
 *   1  No duplicate Document(organizationId, partnerId, sourceType, sourceId,
 *      reference) among school-fee and school-penalty charges.  → P0-A index
 *      partnerId is load-bearing: the key is one invoice per STUDENT per
 *      schedule per term. Omitting it would permit only one invoice per
 *      schedule for the whole school and break every billing run.
 *   2  No duplicate genuine external payment references.   → P0-B index
 *   3  No duplicate posted FeeCreditAllocation(credit, doc).→ P1-F index
 *   4  No NULL feeStructureVersionId on posted SchoolFeeInvoice.
 *      EXPECTED TO FAIL before the Phase 1c backfill — the column has never
 *      been written. This is a backfill requirement, not merely a gate.
 *   5  Every posted invoice resolves to an immutable pricing version.
 *   6  Every Payment.reference the new constraint would cover is semantically
 *      safe — a machine-issued external key, not bursar narration. Reports the
 *      distribution by paymentMethod so the Phase 1a classification rule is
 *      chosen from real data rather than assumption.
 *
 * Anything failing 1–3 is remediated through a FinancialRemediationBatch
 * (human-approved), per FINANCIAL_INVARIANTS §Immutability — never auto-fixed,
 * and never worked around by skipping the index.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** School-fee document source types the P0-A index will cover. */
const FEE_SOURCE_TYPES = ['school_fee', 'school_penalty'];

/**
 * Methods whose `reference` is expected to carry a provider-issued transaction
 * id. Cash is deliberately absent: a bursar may legitimately type the same
 * narration on every receipt, which is exactly why the constraint keys on
 * `externalReference` instead (Phase 1a).
 */
const MACHINE_KEY_METHODS = ['mobile_money', 'bank', 'card'];

type Check = { id: string; title: string; passed: boolean; detail: string };
const results: Check[] = [];

const UGX = (v: unknown) =>
  Number(v ?? 0).toLocaleString('en-UG', { maximumFractionDigits: 0 });

function heading(title: string) {
  console.log(`\n${'─'.repeat(78)}\n${title}\n${'─'.repeat(78)}`);
}

function record(id: string, title: string, passed: boolean, detail: string) {
  results.push({ id, title, passed, detail });
  console.log(`\n${passed ? 'PASS' : 'FAIL'} · ${id} — ${detail}`);
}

/* ── 1 · duplicate school-fee charge business keys ─────────────────────── */

async function check1() {
  heading('1 · Duplicate Document(organizationId, partnerId, sourceType, sourceId, reference)');

  // partnerId mirrors the application guard at billing.service.ts:391. The key
  // is one invoice per STUDENT per schedule per term — twenty students sharing
  // one schedule and reference is the NORMAL shape of a billing run, not a
  // duplicate.
  const dupes = await prisma.$queryRawUnsafe<
    Array<{ organizationId: string; partnerId: string; sourceType: string; sourceId: string; reference: string; n: bigint; total: unknown }>
  >(
    `SELECT "organizationId", "partnerId", "sourceType", "sourceId", "reference",
            COUNT(*) AS "n", SUM("totalAmount") AS "total"
       FROM "Document"
      WHERE "sourceType" = ANY($1::text[])
        AND "reference" IS NOT NULL
      GROUP BY "organizationId", "partnerId", "sourceType", "sourceId", "reference"
     HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC`,
    FEE_SOURCE_TYPES,
  );

  if (dupes.length === 0) {
    record('CHECK-1', 'Document business key', true, 'no duplicate school-fee charge keys');
    return;
  }

  const excess = dupes.reduce((s, d) => s + (Number(d.n) - 1), 0);
  const value = dupes.reduce((s, d) => s + Number(d.total ?? 0), 0);
  for (const d of dupes.slice(0, 25)) {
    console.log(`   ${String(d.n).padStart(3)}×  ${d.sourceType}/${d.reference}  partner=${d.partnerId}  UGX ${UGX(d.total)}`);
  }
  if (dupes.length > 25) console.log(`   … and ${dupes.length - 25} more key(s)`);
  record(
    'CHECK-1',
    'Document business key',
    false,
    `${dupes.length} duplicated key(s), ${excess} excess document(s), UGX ${UGX(value)} of doubled charges — ` +
      'remediate via FinancialRemediationBatch before creating the index',
  );
}

/* ── 2 · duplicate external payment references ─────────────────────────── */

async function check2() {
  heading('2 · Duplicate machine-issued payment references');

  const dupes = await prisma.$queryRawUnsafe<
    Array<{ organizationId: string; reference: string; direction: string; paymentMethod: string; n: bigint; total: unknown }>
  >(
    `SELECT "organizationId", "reference", "direction", "paymentMethod",
            COUNT(*) AS "n", SUM("amount") AS "total"
       FROM "Payment"
      WHERE "reference" IS NOT NULL
        AND "paymentMethod" = ANY($1::text[])
      GROUP BY "organizationId", "reference", "direction", "paymentMethod"
     HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC`,
    MACHINE_KEY_METHODS,
  );

  if (dupes.length === 0) {
    record('CHECK-2', 'External payment reference', true, 'no duplicate machine-issued references');
    return;
  }

  const value = dupes.reduce((s, d) => s + Number(d.total ?? 0), 0);
  for (const d of dupes.slice(0, 25)) {
    console.log(`   ${String(d.n).padStart(3)}×  ${d.paymentMethod}/${d.direction}  ref=${d.reference}  UGX ${UGX(d.total)}`);
  }
  if (dupes.length > 25) console.log(`   … and ${dupes.length - 25} more reference(s)`);
  record(
    'CHECK-2',
    'External payment reference',
    false,
    `${dupes.length} duplicated reference(s), UGX ${UGX(value)} — these are candidate double-collections. ` +
      'Investigate each before the Phase 1a backfill moves them onto externalReference',
  );
}

/* ── 3 · duplicate credit drawdowns ────────────────────────────────────── */

async function check3() {
  heading('3 · Duplicate posted FeeCreditAllocation(feeCreditId, documentId)');

  const dupes = await prisma.$queryRawUnsafe<
    Array<{ feeCreditId: string; documentId: string; n: bigint; total: unknown }>
  >(
    `SELECT "feeCreditId", "documentId", COUNT(*) AS "n", SUM("amount") AS "total"
       FROM "FeeCreditAllocation"
      WHERE "status" = 'posted'
      GROUP BY "feeCreditId", "documentId"
     HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC`,
  );

  if (dupes.length === 0) {
    record('CHECK-3', 'Credit drawdown uniqueness', true, 'no duplicate posted drawdowns');
    return;
  }

  const value = dupes.reduce((s, d) => s + Number(d.total ?? 0), 0);
  for (const d of dupes.slice(0, 25)) {
    console.log(`   ${String(d.n).padStart(3)}×  credit=${d.feeCreditId}  doc=${d.documentId}  UGX ${UGX(d.total)}`);
  }
  record(
    'CHECK-3',
    'Credit drawdown uniqueness',
    false,
    `${dupes.length} duplicated drawdown(s), UGX ${UGX(value)} of double-applied credit`,
  );
}

/* ── 4 · SchoolFeeInvoice pricing-version stamp ────────────────────────── */

async function check4() {
  heading('4 · Posted SchoolFeeInvoice rows missing feeStructureVersionId');

  const [total, missing] = await Promise.all([
    prisma.schoolFeeInvoice.count({ where: { status: { not: 'draft' } } }),
    prisma.schoolFeeInvoice.count({ where: { status: { not: 'draft' }, feeStructureVersionId: null } }),
  ]);

  console.log(`   Posted invoices:            ${total}`);
  console.log(`   ...missing version stamp:   ${missing}`);

  if (missing === 0) {
    record('CHECK-4', 'Invoice pricing-version stamp', true, `all ${total} posted invoice(s) carry a version`);
    return;
  }

  record(
    'CHECK-4',
    'Invoice pricing-version stamp',
    false,
    `${missing} of ${total} posted invoice(s) have NULL feeStructureVersionId. Expected before Phase 1c: the ` +
      'column has never been written, which is why the SchoolFeeInvoice business key currently constrains ' +
      'nothing (Postgres treats NULLs as distinct). Run backfill-fee-structure-versions.ts, then re-run this check',
  );
}

/* ── 5 · every posted invoice resolves to an immutable version ─────────── */

async function check5() {
  heading('5 · Pricing-version resolvability');

  const structures = await prisma.feeStructure.findMany({
    select: { id: true, name: true, status: true, currentVersionId: true },
  });
  const versionCounts = await prisma.feeStructureVersion.groupBy({
    by: ['feeStructureId'],
    _count: { _all: true },
  });
  const versionedIds = new Set(versionCounts.map((v) => v.feeStructureId));

  const unversioned = structures.filter((s) => !versionedIds.has(s.id));
  const publishedNoCurrent = structures.filter(
    (s) => s.status === 'published' && !s.currentVersionId,
  );

  console.log(`   Fee structures:                 ${structures.length}`);
  console.log(`   ...with >= 1 immutable version: ${structures.length - unversioned.length}`);
  console.log(`   ...with NO version at all:      ${unversioned.length}`);
  console.log(`   Published w/o currentVersionId: ${publishedNoCurrent.length}`);
  for (const s of unversioned.slice(0, 25)) {
    console.log(`      no version · ${s.status.padEnd(10)} ${s.name}`);
  }

  if (unversioned.length === 0 && publishedNoCurrent.length === 0) {
    record('CHECK-5', 'Pricing-version resolvability', true, 'every structure has an immutable version');
    return;
  }

  record(
    'CHECK-5',
    'Pricing-version resolvability',
    false,
    `${unversioned.length} structure(s) have no version and ${publishedNoCurrent.length} published structure(s) ` +
      'have no currentVersionId. Phase 1c synthesizes versionNo=0 ("legacy pricing as of backfill") for these — ' +
      'an explicit provenance record, not a fabricated publication',
  );
}

/* ── 6 · reference semantics ───────────────────────────────────────────── */

async function check6() {
  heading('6 · Payment.reference semantics by method');

  const rows = await prisma.$queryRawUnsafe<
    Array<{ paymentMethod: string; total: bigint; withRef: bigint; distinctRefs: bigint; maxRepeat: bigint }>
  >(
    `SELECT "paymentMethod",
            COUNT(*)                                        AS "total",
            COUNT("reference")                              AS "withRef",
            COUNT(DISTINCT ("organizationId", "reference")) AS "distinctRefs",
            COALESCE(MAX("c"), 0)                           AS "maxRepeat"
       FROM "Payment" p
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS "c" FROM "Payment" q
          WHERE q."organizationId" = p."organizationId"
            AND q."reference" = p."reference"
            AND q."reference" IS NOT NULL
       ) x ON TRUE
      GROUP BY "paymentMethod"
      ORDER BY COUNT(*) DESC`,
  );

  // distinct is over (org, reference): the same string in two organizations is
  // two distinct keys, and the constraint is per-org.
  console.log(`   ${'method'.padEnd(14)} ${'payments'.padStart(9)} ${'w/ ref'.padStart(8)} ${'distinct'.padStart(9)} ${'max repeat'.padStart(11)}`);
  for (const r of rows) {
    console.log(
      `   ${String(r.paymentMethod ?? '—').padEnd(14)} ${String(r.total).padStart(9)} ` +
        `${String(r.withRef).padStart(8)} ${String(r.distinctRefs).padStart(9)} ${String(r.maxRepeat).padStart(11)}`,
    );
  }

  // A repeated reference on a machine-key method is a genuine integrity concern
  // (check 2 quantifies it). A repeated reference on cash is EXPECTED — it is
  // narration — and is the reason the constraint must key on externalReference.
  const machineRepeat = rows.filter(
    (r) => MACHINE_KEY_METHODS.includes(r.paymentMethod) && Number(r.maxRepeat) > 1,
  );
  const cashRepeat = rows.filter(
    (r) => !MACHINE_KEY_METHODS.includes(r.paymentMethod) && Number(r.maxRepeat) > 1,
  );

  if (cashRepeat.length > 0) {
    console.log(
      `\n   Note: ${cashRepeat.map((r) => r.paymentMethod).join(', ')} repeat references — expected narration. ` +
        'Confirms the constraint must key on externalReference, not reference.',
    );
  }

  if (machineRepeat.length === 0) {
    record('CHECK-6', 'Reference semantics', true, 'no machine-key method carries a repeated reference');
    return;
  }

  record(
    'CHECK-6',
    'Reference semantics',
    false,
    `${machineRepeat.map((r) => `${r.paymentMethod} (max ${r.maxRepeat}×)`).join(', ')} — resolve via check 2 ` +
      'before the Phase 1a backfill promotes these to externalReference',
  );
}

/* ── main ──────────────────────────────────────────────────────────────── */

async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  console.log(`Fees pre-constraint audit · ${new Date().toISOString()}`);
  console.log(`Organizations: ${orgs.length}`);

  await check1();
  await check2();
  await check3();
  await check4();
  await check5();
  await check6();

  heading('Summary');
  for (const r of results) {
    console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${r.id.padEnd(9)} ${r.title}`);
  }

  const failed = results.filter((r) => !r.passed);
  if (failed.length === 0) {
    console.log(`\nAll ${results.length} checks passed. Safe to apply 20260824120000_fees_integrity_constraints.`);
    return;
  }

  console.log(
    `\n${failed.length} of ${results.length} checks FAILED: ${failed.map((f) => f.id).join(', ')}.\n` +
      'Do NOT apply the integrity migration until each is resolved.',
  );
  process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
