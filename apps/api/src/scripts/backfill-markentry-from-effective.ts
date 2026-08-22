/**
 * Backfill: give every ledger-less StudentAssessment score the MarkEntry it
 * should always have had.
 *
 * THE PROBLEM
 *   `StudentAssessment.originalScore / effectiveScore / percentage` are DERIVED
 *   by `MarkingService.recompute` from the MarkEntry rounds and the
 *   MarkAdjustment ledger. Two producers used to write those columns directly
 *   with no MarkEntry behind them — the LMS grade bridge (`setScore`) and the
 *   homework bridge (`gradeHomework`). Because `computeEffective` returns
 *   all-null for a row with an empty ledger, the next recompute on such a row
 *   DELETED the score.
 *
 *   Both writers are fixed, and `recompute` now self-heals a row it finds in
 *   this state. This script does the same repair eagerly, so the damage window
 *   closes at deploy time rather than whenever each row is next touched — and
 *   so the count of affected rows is recorded rather than discovered.
 *
 * SAFETY
 *   - DRY-RUN BY DEFAULT. Prints counts and a sample. Pass --apply to write.
 *   - Only ever INSERTS MarkEntry rows. `effectiveScore` is never touched, so
 *     no score can move: the inserted round reproduces the score already there.
 *   - Skips rows carrying a replacement adjustment — those legitimately have a
 *     score with no marking round (e.g. special consideration), and healing
 *     them would let the adjustment compose on top of a phantom round.
 *   - Idempotent: a row that already has any MarkEntry is skipped.
 *   - Chunked, one transaction per chunk (--chunk, default 500).
 *   - EXACT ROLLBACK: every inserted row is tagged, so
 *       DELETE FROM "MarkEntry" WHERE comment = 'backfill:legacy-direct-write';
 *     restores the prior state precisely.
 *
 *   npx ts-node src/scripts/backfill-markentry-from-effective.ts           # dry run
 *   npx ts-node src/scripts/backfill-markentry-from-effective.ts --apply
 */
import { PrismaClient } from '@prisma/client';

const BACKFILL_COMMENT = 'backfill:legacy-direct-write';

type Candidate = {
  id: string;
  organizationId: string;
  assessmentId: string;
  effectiveScore: unknown;
  enteredById: string | null;
  sourceType: string;
};

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const chunkSize = Number(arg('chunk', '500'));
  const prisma = new PrismaClient();

  try {
    // Raw SQL: this runs outside a tenant context, so it must not go through
    // the org-scoping extension, and it needs the NOT EXISTS anti-join.
    const candidates = await prisma.$queryRaw<Candidate[]>`
      SELECT sa.id,
             sa."organizationId",
             sa."assessmentId",
             sa."effectiveScore",
             sa."enteredById",
             a."sourceType"::text AS "sourceType"
        FROM "StudentAssessment" sa
        JOIN "Assessment" a ON a.id = sa."assessmentId"
       WHERE sa."effectiveScore" IS NOT NULL
         AND sa."deletedAt" IS NULL
         AND NOT EXISTS (SELECT 1 FROM "MarkEntry" me WHERE me."studentAssessmentId" = sa.id)
         AND NOT EXISTS (
               SELECT 1 FROM "MarkAdjustment" ma
                WHERE ma."studentAssessmentId" = sa.id
                  AND ma."replacementScore" IS NOT NULL
             )
       ORDER BY sa."createdAt"
    `;

    if (candidates.length === 0) {
      console.log('Nothing to backfill — every scored StudentAssessment already has a MarkEntry.');
      return;
    }

    const bySource = candidates.reduce<Record<string, number>>((acc, c) => {
      acc[c.sourceType] = (acc[c.sourceType] ?? 0) + 1;
      return acc;
    }, {});

    console.log(`${candidates.length} StudentAssessment row(s) hold a score with no MarkEntry behind it.`);
    console.log('By assessment source:');
    for (const [source, n] of Object.entries(bySource)) console.log(`  ${source.padEnd(14)} ${n}`);
    console.log('\nSample (first 20):');
    for (const c of candidates.slice(0, 20)) {
      console.log(`  ${c.id}  score=${String(c.effectiveScore).padStart(7)}  source=${c.sourceType}`);
    }

    if (!apply) {
      console.log('\nDRY RUN — nothing written. Re-run with --apply to insert the MarkEntry rows.');
      return;
    }

    let written = 0;
    for (let i = 0; i < candidates.length; i += chunkSize) {
      const chunk = candidates.slice(i, i + chunkSize);
      await prisma.$transaction(async (tx) => {
        await tx.markEntry.createMany({
          data: chunk.map((c) => ({
            organizationId: c.organizationId,
            studentAssessmentId: c.id,
            markerId: c.enteredById,
            round: 'first' as const,
            score: c.effectiveScore as never,
            comment: BACKFILL_COMMENT,
          })),
          skipDuplicates: true,
        });
      });
      written += chunk.length;
      console.log(`  …${written}/${candidates.length}`);
    }

    // Prove the repair: every backfilled round must reproduce the score it came
    // from. If this reports anything, the rollback DELETE above is the undo.
    const drift = await prisma.$queryRaw<{ id: string }[]>`
      SELECT sa.id
        FROM "StudentAssessment" sa
        JOIN "MarkEntry" me ON me."studentAssessmentId" = sa.id AND me.comment = ${BACKFILL_COMMENT}
       WHERE me.score IS DISTINCT FROM sa."effectiveScore"
    `;
    if (drift.length > 0) {
      console.error(`\nFAILED: ${drift.length} backfilled round(s) do not match their score. Roll back with:`);
      console.error(`  DELETE FROM "MarkEntry" WHERE comment = '${BACKFILL_COMMENT}';`);
      process.exitCode = 1;
      return;
    }

    console.log(`\nDone. ${written} MarkEntry row(s) written, all matching their existing score.`);
    console.log(`Undo if needed:  DELETE FROM "MarkEntry" WHERE comment = '${BACKFILL_COMMENT}';`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
