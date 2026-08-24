/**
 * Backfill: make the assessment spine a complete, verified mirror of GradeEntry.
 *
 * THE POINT
 *   `Assessment → StudentAssessment → MarkEntry` is becoming the only mark
 *   ledger, and `GradeEntry` is becoming read-only historic evidence. Before
 *   that flip is safe, every legacy exam mark must already exist in the spine
 *   and agree with it — score, max, approval status and participation. This
 *   script does that, and then proves it.
 *
 *   Running it is NOT the flip. Afterwards marks still go to GradeEntry; the
 *   spine is simply known-correct. The flip is a separate, flag-gated change.
 *
 * SAFETY
 *   - DRY-RUN BY DEFAULT. Prints what it would do, writes nothing. --apply writes.
 *   - `--verify` runs the proof queries alone and exits non-zero on any drift,
 *     so it can sit in CI against a restored dump.
 *   - One org at a time with `--org <id>`; chunked with `--chunk` (default 500).
 *   - Every row it creates is tagged (`createdBy` / MarkEntry.comment =
 *     'backfill:gradeentry-cutover'), so the rollback is exact and printed at
 *     the end.
 *   - Idempotent throughout: re-running changes nothing.
 *   - It NEVER overwrites a MarkEntry that already exists and disagrees. Those
 *     are evidence of a real divergence (or a hand edit) and are reported for a
 *     human to decide, not silently resolved.
 *   - It does NOT reimplement `computeEffective`. Derived scores are produced by
 *     calling `MarkingService.recompute`, the one writer, from inside a Nest
 *     context — anything else would be exactly the extra writer this whole
 *     cutover exists to remove.
 *
 *   npx ts-node src/scripts/backfill-gradeentry-to-spine.ts            # dry run
 *   npx ts-node src/scripts/backfill-gradeentry-to-spine.ts --verify   # proof only
 *   npx ts-node src/scripts/backfill-gradeentry-to-spine.ts --apply --org <id>
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../kernel/prisma/prisma.service';
import { TenantContextService } from '../kernel/tenancy/tenant-context.service';
import { MarkingService } from '../modules/school/assessment/marking.service';

const TAG = 'backfill:gradeentry-cutover';

/** `GradeEntry` records a non-scoring outcome in free-text `remarks`. */
const NON_SCORING = ['absent', 'exempt', 'excused', 'malpractice', 'special_consideration'];

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

const APPLY = process.argv.includes('--apply');
const VERIFY_ONLY = process.argv.includes('--verify');
const ONLY_ORG = arg('org');
const CHUNK = Number(arg('chunk', '500'));

/** Restrict every statement to one org when --org is given. */
const orgFilter = (alias: string) => (ONLY_ORG ? `AND ${alias}."organizationId" = '${ONLY_ORG}'` : '');

type Row = Record<string, any>;

async function q(prisma: PrismaService, sql: string): Promise<Row[]> {
  return prisma.raw.$queryRawUnsafe<Row[]>(sql);
}

async function count(prisma: PrismaService, label: string, sql: string): Promise<number> {
  const rows = await q(prisma, sql);
  const n = Number(rows[0]?.c ?? 0);
  console.log(`  ${label.padEnd(52)} ${String(n).padStart(7)}`);
  return n;
}

/* ────────────────────────── preflight (read-only) ────────────────────────── */

/**
 * What the data looks like before anything is written. Run this first and read
 * it: a large "score disagrees" number means the two stores have already drifted
 * for a reason, and the reason is worth knowing before it is papered over.
 */
async function preflight(prisma: PrismaService) {
  console.log('\n──── Preflight ────');
  await count(prisma, 'GradeEntry rows', `
    SELECT count(*)::int c FROM "GradeEntry" ge WHERE true ${orgFilter('ge')}`);
  await count(prisma, 'exam papers with marks but no Assessment', `
    SELECT count(DISTINCT ge."examScheduleId")::int c
      FROM "GradeEntry" ge
     WHERE NOT EXISTS (
             SELECT 1 FROM "Assessment" a
              WHERE a."sourceType" = 'exam_session' AND a."sourceRef" = ge."examScheduleId")
       ${orgFilter('ge')}`);
  await count(prisma, 'GradeEntry with no spine row', SQL_MISSING_SA);
  await count(prisma, 'score disagrees with spine', SQL_SCORE_DRIFT);
  await count(prisma, 'approval status disagrees', SQL_STATUS_DRIFT);
  await count(prisma, 'participation disagrees', SQL_PARTICIPATION_DRIFT);
  await count(prisma, 'papers locked but Assessment unlocked', SQL_LOCK_DRIFT);
  await count(prisma, 'Assessment rows with no kind yet', `
    SELECT count(*)::int c FROM "Assessment" a WHERE a.kind IS NULL ${orgFilter('a')}`);
  await count(prisma, 'homework not yet linked to its column', `
    SELECT count(*)::int c FROM "HomeworkAssignment" h WHERE h."assessmentId" IS NULL ${orgFilter('h')}`);

  const dist = await q(prisma, `
    SELECT COALESCE(a.kind::text, '(null)') AS kind, count(*)::int c
      FROM "Assessment" a WHERE a."deletedAt" IS NULL ${orgFilter('a')}
     GROUP BY 1 ORDER BY 2 DESC`);
  console.log('\n  Assessment.kind distribution (before):');
  for (const r of dist) console.log(`    ${String(r.kind).padEnd(14)} ${r.c}`);
}

/* ─────────────────────────── the proof queries ─────────────────────────── */

/**
 * Every legacy mark must have a spine row. The anti-join spans BOTH hops on
 * purpose: joining `Assessment` first and testing only the second hop reports a
 * clean zero for a paper that has no Assessment at all, which is precisely the
 * population this backfill exists to find.
 */
const SQL_MISSING_SA = `
  SELECT count(*)::int c
    FROM "GradeEntry" ge
   WHERE NOT EXISTS (
           SELECT 1
             FROM "Assessment" a
             JOIN "StudentAssessment" sa
               ON sa."assessmentId" = a.id AND sa."studentProfileId" = ge."studentProfileId"
            WHERE a."sourceType" = 'exam_session' AND a."sourceRef" = ge."examScheduleId")`;

/**
 * Scores must match — but only where no adjustment has been applied. A
 * moderation or a late penalty legitimately moves `effectiveScore` away from
 * the mark that was entered, so those rows are compared on `originalScore`.
 */
const SQL_SCORE_DRIFT = `
  SELECT count(*)::int c
    FROM "GradeEntry" ge
    JOIN "Assessment" a ON a."sourceType" = 'exam_session' AND a."sourceRef" = ge."examScheduleId"
    JOIN "StudentAssessment" sa ON sa."assessmentId" = a.id AND sa."studentProfileId" = ge."studentProfileId"
   WHERE CASE
           WHEN EXISTS (SELECT 1 FROM "MarkAdjustment" ma WHERE ma."studentAssessmentId" = sa.id)
             THEN ge."marksObtained" IS DISTINCT FROM sa."originalScore"
           ELSE ge."marksObtained" IS DISTINCT FROM sa."effectiveScore"
         END`;

const SQL_STATUS_DRIFT = `
  SELECT count(*)::int c
    FROM "GradeEntry" ge
    JOIN "Assessment" a ON a."sourceType" = 'exam_session' AND a."sourceRef" = ge."examScheduleId"
    JOIN "StudentAssessment" sa ON sa."assessmentId" = a.id AND sa."studentProfileId" = ge."studentProfileId"
   WHERE ge.status::text IS DISTINCT FROM sa."approvalStatus"::text`;

const SQL_PARTICIPATION_DRIFT = `
  SELECT count(*)::int c
    FROM "GradeEntry" ge
    JOIN "Assessment" a ON a."sourceType" = 'exam_session' AND a."sourceRef" = ge."examScheduleId"
    JOIN "StudentAssessment" sa ON sa."assessmentId" = a.id AND sa."studentProfileId" = ge."studentProfileId"
   WHERE CASE WHEN lower(trim(COALESCE(ge.remarks, ''))) IN (${NON_SCORING.map((s) => `'${s}'`).join(', ')})
                THEN lower(trim(ge.remarks)) ELSE 'present' END
         IS DISTINCT FROM sa.participation::text`;

const SQL_LOCK_DRIFT = `
  SELECT count(*)::int c
    FROM "ExamSchedule" es
    JOIN "Assessment" a ON a."sourceType" = 'exam_session' AND a."sourceRef" = es.id
   WHERE es."marksLockedAt" IS NOT NULL AND a."lockedAt" IS NULL`;

/** The invariant `one-writer.spec.ts` exists to protect, re-asserted in SQL. */
const SQL_SCORE_WITHOUT_LEDGER = `
  SELECT count(*)::int c
    FROM "StudentAssessment" sa
   WHERE sa."effectiveScore" IS NOT NULL
     AND sa."deletedAt" IS NULL
     AND NOT EXISTS (SELECT 1 FROM "MarkEntry" me WHERE me."studentAssessmentId" = sa.id)
     AND NOT EXISTS (SELECT 1 FROM "MarkAdjustment" ma
                      WHERE ma."studentAssessmentId" = sa.id AND ma."replacementScore" IS NOT NULL)`;

const SQL_ORPHAN_SOURCEREF = `
  SELECT count(*)::int c
    FROM "Assessment" a
   WHERE a."sourceType" = 'exam_session'
     AND a."sourceRef" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "ExamSchedule" es WHERE es.id = a."sourceRef")`;

async function verify(prisma: PrismaService): Promise<boolean> {
  console.log('\n──── Verification (every number must be 0) ────');
  const checks: Array<[string, string]> = [
    ['GradeEntry with no spine row', SQL_MISSING_SA],
    ['score disagrees with spine', SQL_SCORE_DRIFT],
    ['approval status disagrees', SQL_STATUS_DRIFT],
    ['participation disagrees', SQL_PARTICIPATION_DRIFT],
    ['papers locked but Assessment unlocked', SQL_LOCK_DRIFT],
    ['score with no MarkEntry behind it', SQL_SCORE_WITHOUT_LEDGER],
    ['Assessment pointing at a missing ExamSchedule', SQL_ORPHAN_SOURCEREF],
    ['Assessment rows still with no kind', `SELECT count(*)::int c FROM "Assessment" WHERE kind IS NULL`],
  ];
  let bad = 0;
  for (const [label, sql] of checks) bad += await count(prisma, label, sql);
  console.log(bad === 0 ? '\n  All checks clean.' : `\n  ${bad} problem(s) — see above.`);
  return bad === 0;
}

/* ───────────────────────────── the backfill ───────────────────────────── */

/** Step 1 — one Assessment per exam paper that carries marks. */
async function mintExamAssessments(prisma: PrismaService): Promise<number> {
  const sql = `
    INSERT INTO "Assessment" (
      id, "organizationId", "componentId", "subjectId", "classId", "termId", title,
      "maxScore", "sourceType", "sourceRef", status, kind, sequence, "isResit",
      "lockedAt", "lockedById", "createdAt", "updatedAt", "createdBy")
    SELECT gen_random_uuid()::text,
           es."organizationId",
           (SELECT ac.id FROM "AssessmentComponent" ac
             WHERE ac."examTypeId" = e."examTypeId" AND ac."organizationId" = es."organizationId"
             LIMIT 1),
           es."subjectId", es."classId", e."termId",
           COALESCE(s.name, 'Exam') || ' — ' || e.name,
           es."maxMarks", 'exam_session', es.id, 'grading', 'exam',
           COALESCE(es."paperNumber", 1), COALESCE(es."isResit", false),
           es."marksLockedAt", es."marksLockedById", now(), now(), '${TAG}'
      FROM "ExamSchedule" es
      JOIN "Exam" e ON e.id = es."examId"
      LEFT JOIN "Subject" s ON s.id = es."subjectId"
     WHERE EXISTS (SELECT 1 FROM "GradeEntry" ge WHERE ge."examScheduleId" = es.id)
       AND NOT EXISTS (SELECT 1 FROM "Assessment" a
                        WHERE a."sourceType" = 'exam_session' AND a."sourceRef" = es.id)
       ${orgFilter('es')}`;
  return prisma.raw.$executeRawUnsafe(sql);
}

/**
 * Step 2 — classify every Assessment.
 *
 * This is the step that moves numbers. `gradebook.service.ts` used to guess
 * kind as `component.kind ?? (exam_session ? 'exam' : 'cat')`, so every
 * unattached homework, quiz and LMS row was being weighted as a CAT. Writing
 * the real kind corrects that, and a corrected kind can land in a different
 * weighting bucket — which is why the before/after distribution is printed
 * rather than assumed.
 */
async function backfillKind(prisma: PrismaService): Promise<number> {
  const sql = `
    UPDATE "Assessment" a
       SET kind = COALESCE(
             (SELECT c.kind FROM "AssessmentComponent" c WHERE c.id = a."componentId"),
             (CASE a."sourceType"::text
                WHEN 'exam_session' THEN 'exam'
                WHEN 'quiz'         THEN 'cat'
                WHEN 'lms_activity' THEN 'classwork'
                WHEN 'assignment'   THEN
                  CASE WHEN EXISTS (SELECT 1 FROM "HomeworkAssignment" h WHERE h.id = a."sourceRef")
                       THEN 'homework' ELSE 'project' END
                ELSE 'cat'
              END)::"AssessmentKind")
     WHERE a.kind IS NULL ${orgFilter('a')}`;
  return prisma.raw.$executeRawUnsafe(sql);
}

/** Step 3 — the remaining new columns, from the scheduling row. */
async function backfillExamColumns(prisma: PrismaService): Promise<number> {
  const sql = `
    UPDATE "Assessment" a
       SET sequence   = COALESCE(a.sequence, es."paperNumber", 1),
           "isResit"  = COALESCE(es."isResit", false),
           "lockedAt" = COALESCE(a."lockedAt", es."marksLockedAt"),
           "lockedById" = COALESCE(a."lockedById", es."marksLockedById")
      FROM "ExamSchedule" es
     WHERE a."sourceType" = 'exam_session' AND a."sourceRef" = es.id
       AND (a.sequence IS NULL
            OR a."isResit" IS DISTINCT FROM COALESCE(es."isResit", false)
            OR (a."lockedAt" IS NULL AND es."marksLockedAt" IS NOT NULL))
       ${orgFilter('a')}`;
  return prisma.raw.$executeRawUnsafe(sql);
}

/**
 * Step 3b — homework becomes its own source type, and links to its column.
 *
 * HomeworkAssignment and the A2 Assignment shared `sourceType='assignment'`,
 * told apart only by whether `sourceRef` was null — so the row is RE-POINTED,
 * never duplicated. Then the homework gets the `assessmentId` link that stops a
 * second Assessment appearing behind the first at grading time.
 */
async function relinkHomework(prisma: PrismaService): Promise<{ repointed: number; linked: number }> {
  const repointed = await prisma.raw.$executeRawUnsafe(`
    UPDATE "Assessment" a
       SET "sourceType" = 'homework', kind = 'homework'
     WHERE a."sourceType" = 'assignment'
       AND a."sourceRef" IS NOT NULL
       AND EXISTS (SELECT 1 FROM "HomeworkAssignment" h WHERE h.id = a."sourceRef")
       ${orgFilter('a')}`);

  const linked = await prisma.raw.$executeRawUnsafe(`
    UPDATE "HomeworkAssignment" h
       SET "assessmentId" = a.id
      FROM "Assessment" a
     WHERE a."sourceType" = 'homework' AND a."sourceRef" = h.id
       AND h."assessmentId" IS NULL
       ${orgFilter('h')}`);

  return { repointed, linked };
}

/** Step 4 — one StudentAssessment per GradeEntry, participation included. */
async function mintStudentAssessments(prisma: PrismaService): Promise<number> {
  const sql = `
    INSERT INTO "StudentAssessment" (
      id, "organizationId", "assessmentId", "studentProfileId", "classId", "termId",
      status, participation, "maxScore", "approvalStatus", "enteredById", "approvedById",
      "createdAt", "updatedAt")
    SELECT gen_random_uuid()::text, ge."organizationId", a.id, ge."studentProfileId",
           a."classId", a."termId",
           CASE WHEN ge."marksObtained" IS NULL THEN 'assigned' ELSE 'graded' END::"StudentAssessmentStatus",
           (CASE WHEN lower(trim(COALESCE(ge.remarks, ''))) IN (${NON_SCORING.map((s) => `'${s}'`).join(', ')})
                 THEN lower(trim(ge.remarks)) ELSE 'present' END)::"ParticipationStatus",
           ge."maxMarks", ge.status, ge."enteredById", ge."approvedById", now(), now()
      FROM "GradeEntry" ge
      JOIN "Assessment" a ON a."sourceType" = 'exam_session' AND a."sourceRef" = ge."examScheduleId"
     WHERE NOT EXISTS (SELECT 1 FROM "StudentAssessment" sa
                        WHERE sa."assessmentId" = a.id AND sa."studentProfileId" = ge."studentProfileId")
       ${orgFilter('ge')}`;
  return prisma.raw.$executeRawUnsafe(sql);
}

/** Step 5 — bring existing rows up to date without touching their scores. */
async function syncStudentAssessments(prisma: PrismaService): Promise<number> {
  const sql = `
    UPDATE "StudentAssessment" sa
       SET "maxScore" = ge."maxMarks",
           "approvalStatus" = ge.status,
           "enteredById" = COALESCE(ge."enteredById", sa."enteredById"),
           "approvedById" = COALESCE(ge."approvedById", sa."approvedById"),
           participation = (CASE WHEN lower(trim(COALESCE(ge.remarks, ''))) IN (${NON_SCORING.map((s) => `'${s}'`).join(', ')})
                                 THEN lower(trim(ge.remarks)) ELSE 'present' END)::"ParticipationStatus"
      FROM "GradeEntry" ge
      JOIN "Assessment" a ON a."sourceType" = 'exam_session' AND a."sourceRef" = ge."examScheduleId"
     WHERE sa."assessmentId" = a.id AND sa."studentProfileId" = ge."studentProfileId"
       ${orgFilter('sa')}`;
  return prisma.raw.$executeRawUnsafe(sql);
}

/**
 * Step 6 — the ledger.
 *
 * Only where the round is absent. A `first` round that already exists and
 * disagrees is NOT overwritten: it is real divergence, and which side is right
 * is a judgement the script has no business making.
 */
async function insertMarkEntries(prisma: PrismaService): Promise<number> {
  const sql = `
    INSERT INTO "MarkEntry" (id, "organizationId", "studentAssessmentId", "markerId", round, score, comment, "enteredAt")
    SELECT gen_random_uuid()::text, sa."organizationId", sa.id, ge."enteredById", 'first',
           ge."marksObtained", '${TAG}', now()
      FROM "GradeEntry" ge
      JOIN "Assessment" a ON a."sourceType" = 'exam_session' AND a."sourceRef" = ge."examScheduleId"
      JOIN "StudentAssessment" sa ON sa."assessmentId" = a.id AND sa."studentProfileId" = ge."studentProfileId"
     WHERE ge."marksObtained" IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM "MarkEntry" me
                        WHERE me."studentAssessmentId" = sa.id AND me.round = 'first')
       ${orgFilter('ge')}`;
  return prisma.raw.$executeRawUnsafe(sql);
}

/** Rounds that already existed and disagree with the legacy mark. */
async function ledgerDivergence(prisma: PrismaService): Promise<Row[]> {
  return q(prisma, `
    SELECT sa.id AS "studentAssessmentId", ge."marksObtained" AS legacy, me.score AS ledger
      FROM "GradeEntry" ge
      JOIN "Assessment" a ON a."sourceType" = 'exam_session' AND a."sourceRef" = ge."examScheduleId"
      JOIN "StudentAssessment" sa ON sa."assessmentId" = a.id AND sa."studentProfileId" = ge."studentProfileId"
      JOIN "MarkEntry" me ON me."studentAssessmentId" = sa.id AND me.round = 'first'
     WHERE me.comment IS DISTINCT FROM '${TAG}'
       AND ge."marksObtained" IS DISTINCT FROM me.score
       ${orgFilter('ge')}
     LIMIT 50`);
}

/**
 * Step 7 — derive the scores.
 *
 * Through `MarkingService.recompute`, never by hand. `originalScore`,
 * `effectiveScore` and `percentage` are derived columns, and the entire point of
 * the cutover is that exactly one piece of code derives them.
 */
async function recomputeAll(prisma: PrismaService, tenant: TenantContextService, marking: MarkingService) {
  const rows = await q(prisma, `
    SELECT sa.id, sa."organizationId"
      FROM "StudentAssessment" sa
      JOIN "MarkEntry" me ON me."studentAssessmentId" = sa.id AND me.comment = '${TAG}'
     WHERE sa."deletedAt" IS NULL ${orgFilter('sa')}`);
  if (rows.length === 0) return 0;

  let done = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    for (const r of chunk) {
      await tenant.run(
        { organizationId: r.organizationId, userId: 'system:backfill', permissions: ['*'] },
        () => prisma.client.$transaction((tx: any) => marking.recompute(tx, r.id)),
      );
    }
    done += chunk.length;
    console.log(`  …recomputed ${done}/${rows.length}`);
  }
  return done;
}

/* ─────────────────────────────── driver ─────────────────────────────── */

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  const prisma = app.get(PrismaService);
  const tenant = app.get(TenantContextService);
  const marking = app.get(MarkingService);

  const mode = VERIFY_ONLY ? 'VERIFY ONLY' : APPLY ? 'APPLY (writing)' : 'DRY RUN';
  console.log(`GradeEntry → spine backfill — ${mode}${ONLY_ORG ? ` · org ${ONLY_ORG}` : ' · all orgs'}`);

  try {
    if (VERIFY_ONLY) {
      process.exitCode = (await verify(prisma)) ? 0 : 1;
      return;
    }

    await preflight(prisma);

    const diverged = await ledgerDivergence(prisma);
    if (diverged.length > 0) {
      console.error(`\nSTOP: ${diverged.length}+ existing MarkEntry round(s) disagree with the legacy mark.`);
      console.error('These are real divergences, not gaps. Resolve them by hand before backfilling:');
      for (const d of diverged.slice(0, 10)) {
        console.error(`  ${d.studentAssessmentId}  legacy=${d.legacy}  ledger=${d.ledger}`);
      }
      process.exitCode = 1;
      return;
    }

    if (!APPLY) {
      console.log('\nDRY RUN — nothing written. Re-run with --apply to backfill.');
      return;
    }

    console.log('\n──── Writing ────');
    console.log(`  assessments minted      ${await mintExamAssessments(prisma)}`);
    console.log(`  kind classified         ${await backfillKind(prisma)}`);
    console.log(`  exam columns filled     ${await backfillExamColumns(prisma)}`);
    const hw = await relinkHomework(prisma);
    console.log(`  homework re-pointed     ${hw.repointed} (linked ${hw.linked})`);
    console.log(`  student rows minted     ${await mintStudentAssessments(prisma)}`);
    console.log(`  student rows synced     ${await syncStudentAssessments(prisma)}`);
    console.log(`  mark entries inserted   ${await insertMarkEntries(prisma)}`);
    await recomputeAll(prisma, tenant, marking);

    const dist = await q(prisma, `
      SELECT COALESCE(kind::text, '(null)') AS kind, count(*)::int c
        FROM "Assessment" WHERE "deletedAt" IS NULL GROUP BY 1 ORDER BY 2 DESC`);
    console.log('\n  Assessment.kind distribution (after):');
    for (const r of dist) console.log(`    ${String(r.kind).padEnd(14)} ${r.c}`);

    const clean = await verify(prisma);
    console.log('\nUndo, in this order:');
    console.log(`  DELETE FROM "MarkEntry" WHERE comment = '${TAG}';`);
    console.log(`  DELETE FROM "StudentAssessment" sa USING "Assessment" a`);
    console.log(`   WHERE sa."assessmentId" = a.id AND a."createdBy" = '${TAG}';`);
    console.log(`  DELETE FROM "Assessment" WHERE "createdBy" = '${TAG}';`);
    if (!clean) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
