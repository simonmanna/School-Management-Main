/**
 * Phase 1c — backfill immutable pricing versions and stamp them onto invoices.
 *
 * DRY-RUN BY DEFAULT. Pass `--apply` to write.
 *   pnpm --filter @erp/api exec tsx prisma/backfill-fee-structure-versions.ts
 *   pnpm --filter @erp/api exec tsx prisma/backfill-fee-structure-versions.ts --apply
 *
 * Why this exists
 * ───────────────
 * `SchoolFeeInvoice.@@unique([organizationId, studentProfileId, termId,
 * feeStructureVersionId])` is meant to be the school-side half of the billing
 * idempotency guarantee. It constrains nothing today: `feeStructureVersionId`
 * has never been written, and Postgres treats NULL as distinct in a unique
 * index — so every row's key is unique by virtue of being unknown. Stamping the
 * column is what makes the constraint real (P0-A).
 *
 * `FeeStructureVersion` rows are created by `catalog.publish()` and read by
 * nothing, so most structures have none at all. Rather than invent a
 * publication that never happened, this synthesizes **versionNo = 0** with
 * `publishedById = null` — an explicit "legacy pricing as of backfill" record.
 * Version 1 remains the first genuine publication.
 *
 * What it does NOT do
 * ───────────────────
 * It never edits a posted financial amount, a journal line, or a document
 * total. Per FINANCIAL_INVARIANTS §Immutability, those are corrected only
 * through compensating transactions. This fills a NULL provenance pointer and
 * creates the records it points at — nothing more.
 *
 * Invoice → structure resolution runs through the accounting Document:
 *     SchoolFeeInvoice.documentId → Document.sourceId → FeeSchedule.feeStructureId
 * `SchoolFeeInvoice` carries no `feeStructureId` of its own, and the Document's
 * `sourceId` is the schedule the billing run charged from.
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

function heading(title: string) {
  console.log(`\n${'─'.repeat(78)}\n${title}\n${'─'.repeat(78)}`);
}

type Component = {
  code?: string;
  name?: string;
  productId?: string | null;
  amount?: number | string;
  isOptional?: boolean;
  frequency?: string;
  appliesTo?: unknown;
};

/**
 * Create versionNo=0 for every structure that has no version at all, copying
 * the current components JSON into FeeItem rows. Returns structureId → versionId
 * for every structure, whether pre-existing or synthesized.
 */
async function synthesizeLegacyVersions(): Promise<Map<string, string>> {
  heading('1 · Synthesize versionNo=0 for unversioned fee structures');

  const structures = await prisma.feeStructure.findMany({
    select: { id: true, organizationId: true, name: true, status: true, components: true, currentVersionId: true },
  });
  const existing = await prisma.feeStructureVersion.findMany({
    select: { id: true, feeStructureId: true, versionNo: true },
    orderBy: { versionNo: 'asc' },
  });

  // Lowest version per structure — what a historical invoice priced from if it
  // predates any later publication.
  const earliestByStructure = new Map<string, string>();
  for (const v of existing) {
    if (!earliestByStructure.has(v.feeStructureId)) earliestByStructure.set(v.feeStructureId, v.id);
  }

  const needsVersion = structures.filter((s) => !earliestByStructure.has(s.id));
  console.log(`   Fee structures:                 ${structures.length}`);
  console.log(`   ...already versioned:           ${structures.length - needsVersion.length}`);
  console.log(`   ...needing a synthesized v0:    ${needsVersion.length}`);

  let itemCount = 0;
  for (const s of needsVersion) {
    const components = (Array.isArray(s.components) ? s.components : []) as Component[];
    itemCount += components.length;
    if (!APPLY) {
      earliestByStructure.set(s.id, `DRY-RUN:${s.id}`);
      continue;
    }

    const version = await prisma.$transaction(async (tx) => {
      const v = await tx.feeStructureVersion.create({
        data: {
          organizationId: s.organizationId,
          feeStructureId: s.id,
          versionNo: 0,
          isImmutable: true,
          // Deliberately null: nobody published this. It is a provenance record
          // for pricing that predates versioning, not a fabricated publication.
          publishedAt: null,
          publishedById: null,
        },
      });
      for (const c of components) {
        await tx.feeItem.create({
          data: {
            organizationId: s.organizationId,
            feeStructureVersionId: v.id,
            code: c.code ?? 'FEE',
            name: c.name ?? c.code ?? 'Fee',
            productId: c.productId ?? null,
            amount: new Prisma.Decimal(c.amount ?? 0),
            isOptional: c.isOptional ?? false,
            frequency: c.frequency ?? 'per_term',
            appliesTo: (c.appliesTo ?? {}) as Prisma.InputJsonValue,
          },
        });
      }
      // Point the structure at v0 only if it has no current version. A
      // structure that was genuinely published keeps its real pointer.
      if (!s.currentVersionId) {
        await tx.feeStructure.update({ where: { id: s.id }, data: { currentVersionId: v.id } });
      }
      return v;
    });
    earliestByStructure.set(s.id, version.id);
  }

  console.log(`   FeeItem rows ${APPLY ? 'created' : 'that would be created'}:  ${itemCount}`);
  return earliestByStructure;
}

/**
 * Stamp feeStructureVersionId on every SchoolFeeInvoice that lacks one, using
 * the version in effect at the invoice's issueDate (falling back to the
 * earliest / v0).
 */
async function stampInvoices(versionByStructure: Map<string, string>) {
  heading('2 · Stamp feeStructureVersionId onto posted SchoolFeeInvoice rows');

  const invoices = await prisma.schoolFeeInvoice.findMany({
    where: { feeStructureVersionId: null },
    select: { id: true, invoiceNumber: true, documentId: true, issueDate: true, organizationId: true },
  });
  console.log(`   Invoices missing a version stamp: ${invoices.length}`);
  if (invoices.length === 0) return;

  const docs = await prisma.document.findMany({
    where: { id: { in: invoices.map((i) => i.documentId) } },
    select: { id: true, sourceId: true },
  });
  const scheduleByDoc = new Map(docs.map((d) => [d.id, d.sourceId]));

  const schedules = await prisma.feeSchedule.findMany({
    select: { id: true, feeStructureId: true },
  });
  const structureBySchedule = new Map(schedules.map((s) => [s.id, s.feeStructureId]));

  // Versions per structure, newest-first, so "in effect at issueDate" is the
  // first one published at or before that date.
  const allVersions = await prisma.feeStructureVersion.findMany({
    select: { id: true, feeStructureId: true, versionNo: true, publishedAt: true },
    orderBy: [{ feeStructureId: 'asc' }, { versionNo: 'desc' }],
  });
  const versionsByStructure = new Map<string, typeof allVersions>();
  for (const v of allVersions) {
    const arr = versionsByStructure.get(v.feeStructureId) ?? [];
    arr.push(v);
    versionsByStructure.set(v.feeStructureId, arr);
  }

  let stamped = 0;
  const unresolved: string[] = [];

  for (const inv of invoices) {
    const scheduleId = scheduleByDoc.get(inv.documentId);
    const structureId = scheduleId ? structureBySchedule.get(scheduleId) : undefined;
    if (!structureId) {
      unresolved.push(inv.invoiceNumber);
      continue;
    }

    const candidates = versionsByStructure.get(structureId) ?? [];
    const inEffect =
      candidates.find((v) => v.publishedAt && v.publishedAt <= inv.issueDate) ??
      candidates[candidates.length - 1];
    const versionId = inEffect?.id ?? versionByStructure.get(structureId);
    if (!versionId || versionId.startsWith('DRY-RUN:')) {
      if (!APPLY) stamped++;
      else unresolved.push(inv.invoiceNumber);
      continue;
    }

    if (APPLY) {
      await prisma.schoolFeeInvoice.update({
        where: { id: inv.id },
        data: { feeStructureVersionId: versionId },
      });
    }
    stamped++;
  }

  console.log(`   ${APPLY ? 'Stamped' : 'Would stamp'}:                     ${stamped}`);
  if (unresolved.length) {
    console.log(`   UNRESOLVED (no structure reachable):  ${unresolved.length}`);
    for (const n of unresolved.slice(0, 20)) console.log(`      ${n}`);
    console.log(
      '\n   An unresolved invoice cannot be stamped automatically — its Document has no\n' +
        '   sourceId, or that schedule no longer exists. Resolve manually; do not guess a\n' +
        '   pricing version onto a posted invoice.',
    );
  }
}

async function main() {
  console.log(`Fee structure version backfill · ${new Date().toISOString()}`);
  console.log(APPLY ? 'MODE: APPLY (writing)' : 'MODE: DRY RUN (no writes — pass --apply to commit)');

  const versionByStructure = await synthesizeLegacyVersions();
  await stampInvoices(versionByStructure);

  heading('Next');
  console.log(
    APPLY
      ? 'Re-run prisma/audit-fees-preconstraint.ts — CHECK-4 and CHECK-5 should now pass.'
      : 'Re-run with --apply to commit, then re-run prisma/audit-fees-preconstraint.ts.',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
