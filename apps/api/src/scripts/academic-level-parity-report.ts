/**
 * Academic level / programme resolution parity — whole-database report (ADR-028).
 *
 * `ProgrammeGradeLevel` owns "which programme is this grade under" today,
 * guaranteed unique by `@@unique([organizationId, gradeLevelId])`. ADR-028 moves
 * that to `gradeLevel → academicLevel → defaultProgramme` and drops the table.
 *
 * Dropping it is safe only when the two paths agree for every grade level in
 * every tenant. This script is that gate.
 *
 * It deliberately lives here and NOT in an integration spec. The specs share one
 * database and each seeds its own fixtures — including, in
 * `academic-level-parity.spec.ts`, a grade whose two paths disagree ON PURPOSE to
 * prove precedence. A whole-database sweep running inside that suite measures
 * test residue, not the tenants being migrated. The spec proves the logic; this
 * proves the data.
 *
 * Read-only. Exits non-zero when the drop would be unsafe, so it can gate a
 * release.
 *
 * Run (from apps/api, with DATABASE_URL present):
 *   npx ts-node src/scripts/academic-level-parity-report.ts
 *   npx ts-node src/scripts/academic-level-parity-report.ts --org <organizationId>
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface DivergentRow {
  organizationId: string;
  gradeName: string;
  viaLevel: string | null;
  viaLink: string | null;
}

interface CountRow {
  n: bigint;
}

async function main(): Promise<void> {
  const orgArg = process.argv.indexOf('--org');
  const orgFilter = orgArg !== -1 ? process.argv[orgArg + 1] : null;
  const scope = orgFilter ? `organization ${orgFilter}` : 'all organizations';
  const orgClause = orgFilter ? `AND gl."organizationId" = '${orgFilter.replace(/'/g, "''")}'` : '';

  console.log(`\n=== Academic level parity report — ${scope} ===\n`);

  // 1. The two paths answer, and disagree. Every one of these is a data fault.
  const divergent = await prisma.$queryRawUnsafe<DivergentRow[]>(`
    SELECT gl."organizationId", gl."name" AS "gradeName",
           pl."code" AS "viaLevel", pk."code" AS "viaLink"
      FROM "GradeLevel" gl
      JOIN "AcademicLevel" al ON al."id" = gl."academicLevelId"
      JOIN "ProgrammeGradeLevel" pgl ON pgl."gradeLevelId" = gl."id"
      LEFT JOIN "AcademicProgramme" pl ON pl."id" = al."defaultProgrammeId"
      LEFT JOIN "AcademicProgramme" pk ON pk."id" = pgl."programmeId"
     WHERE gl."deletedAt" IS NULL
       AND al."defaultProgrammeId" IS NOT NULL
       AND al."defaultProgrammeId" <> pgl."programmeId"
       ${orgClause}
     ORDER BY gl."organizationId", gl."name"
  `);

  // 2. Had banding, lost it. The backfill should have caught every one of these.
  const missed = await prisma.$queryRawUnsafe<CountRow[]>(`
    SELECT count(*)::bigint AS n
      FROM "GradeLevel" gl
      JOIN "ProgrammeGradeLevel" pgl ON pgl."gradeLevelId" = gl."id"
     WHERE gl."deletedAt" IS NULL AND gl."academicLevelId" IS NULL ${orgClause}
  `);

  // 3. Unbanded overall, and whether each is visible in the exception queue.
  //    An unbanded grade nobody has queued is work nobody knows about.
  const unbanded = await prisma.$queryRawUnsafe<CountRow[]>(`
    SELECT count(*)::bigint AS n FROM "GradeLevel" gl
     WHERE gl."deletedAt" IS NULL AND gl."academicLevelId" IS NULL ${orgClause}
  `);
  const unqueued = await prisma.$queryRawUnsafe<CountRow[]>(`
    SELECT count(*)::bigint AS n FROM "GradeLevel" gl
     WHERE gl."deletedAt" IS NULL AND gl."academicLevelId" IS NULL ${orgClause}
       AND NOT EXISTS (
         SELECT 1 FROM "AcademicMigrationException" e
          WHERE e."sourceEntity" = 'GradeLevel' AND e."sourceId" = gl."id"
            AND e."resolvedAt" IS NULL)
  `);

  const totals = await prisma.$queryRawUnsafe<
    Array<{ grades: bigint; banded: bigint; levels: bigint }>
  >(`
    SELECT
      (SELECT count(*)::bigint FROM "GradeLevel" gl WHERE gl."deletedAt" IS NULL ${orgClause}) AS grades,
      (SELECT count(*)::bigint FROM "GradeLevel" gl WHERE gl."deletedAt" IS NULL
         AND gl."academicLevelId" IS NOT NULL ${orgClause}) AS banded,
      (SELECT count(*)::bigint FROM "AcademicLevel") AS levels
  `);

  const t = totals[0];
  const grades = Number(t.grades);
  const banded = Number(t.banded);
  const pct = grades === 0 ? 100 : (100 * banded) / grades;

  console.log(`grade levels          ${grades}`);
  console.log(`  banded              ${banded} (${pct.toFixed(1)}%)`);
  console.log(`  unbanded            ${Number(unbanded[0].n)}`);
  console.log(`    of which unqueued ${Number(unqueued[0].n)}`);
  console.log(`academic levels       ${Number(t.levels)}`);
  console.log(`divergent resolution  ${divergent.length}`);
  console.log(`lost banding          ${Number(missed[0].n)}`);

  if (divergent.length > 0) {
    console.log('\nGrades whose two resolution paths disagree:');
    for (const d of divergent.slice(0, 40)) {
      console.log(`  ${d.organizationId} / ${d.gradeName}: level=${d.viaLevel} link=${d.viaLink}`);
    }
    if (divergent.length > 40) console.log(`  ... and ${divergent.length - 40} more`);
  }

  const blockers: string[] = [];
  if (divergent.length > 0) blockers.push(`${divergent.length} divergent resolution(s)`);
  if (Number(missed[0].n) > 0) blockers.push(`${Number(missed[0].n)} grade(s) lost their banding`);
  if (Number(unqueued[0].n) > 0) {
    blockers.push(`${Number(unqueued[0].n)} unbanded grade(s) missing from the exception queue`);
  }

  if (blockers.length > 0) {
    console.log(
      `\nNOT SAFE to drop ProgrammeGradeLevel or to make ` +
        `GradeLevel.academicLevelId NOT NULL:\n  - ${blockers.join('\n  - ')}\n`,
    );
    process.exitCode = 1;
    return;
  }

  if (Number(unbanded[0].n) > 0) {
    console.log(
      `\nResolution is consistent, but ${Number(unbanded[0].n)} grade level(s) still have no ` +
        'band and are waiting in the exception queue. ProgrammeGradeLevel may be dropped; ' +
        'academicLevelId cannot become NOT NULL until the queue is cleared.\n',
    );
    return;
  }

  console.log('\nSafe: both paths agree everywhere and every grade has a band.\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
