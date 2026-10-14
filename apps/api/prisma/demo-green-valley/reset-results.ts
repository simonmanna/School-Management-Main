/**
 * Clear ONLY a demo school's seeded term results and report cards, so stage 6
 * can rebuild them through the real result kernel (academics Phase 0.8).
 *
 * The full academic reset also removes pupils, enrolments and the fees, ops and
 * admissions data built on them; this touches nothing but what stage 6 wrote:
 * the result runs it keyed `demo:<term>:<grade>`, their result sets (subject
 * and term results and promotion decisions cascade), report documents pinned
 * to those sets, and the report cards for those terms.
 *
 * Dry run by default; deletes only with `--apply`. Then re-run the demo:
 *
 *   tsx prisma/demo-green-valley/reset-results.ts --school=sunrise --apply
 *   pnpm db:seed:sunrise-demo
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { activeSchool } from './schools';

const prisma = new PrismaClient();
const SCHOOL = activeSchool();
const APPLY = process.argv.includes('--apply');

async function main() {
  const org = await prisma.organization.findFirst({ where: { code: SCHOOL.orgCode }, select: { id: true } });
  if (!org) throw new Error(`No organization with code ${SCHOOL.orgCode}.`);
  const O = org.id;

  const runs = await prisma.resultProcessingRun.findMany({
    where: { organizationId: O, idempotencyKey: { startsWith: 'demo:' } },
    select: { id: true, termId: true },
  });
  const sets = await prisma.resultSet.findMany({
    where: { organizationId: O, runId: { in: runs.map((r) => r.id) } },
    select: { id: true },
  });
  const termIds = [...new Set(runs.map((r) => r.termId))];
  const setIds = sets.map((s) => s.id);
  const [docs, cards] = await Promise.all([
    prisma.reportDocument.count({ where: { organizationId: O, resultSetId: { in: setIds } } }),
    prisma.reportCard.count({ where: { organizationId: O, termId: { in: termIds } } }),
  ]);
  console.log(`${SCHOOL.orgName}: ${runs.length} demo result runs, ${sets.length} result sets, ${docs} report documents, ${cards} report cards over ${termIds.length} terms.`);
  if (!APPLY) {
    console.log('Dry run — nothing deleted. Re-run with --apply.');
    return;
  }
  // Published results refuse DELETE by design (a DB trigger). A demo reset is
  // the one caller allowed past it: the guards on these tables are switched off
  // inside the transaction and back on before it commits — DDL in Postgres is
  // transactional, so a failure leaves them exactly as they were. Same approach
  // as reset-academics.ts.
  const tables = ['ResultSet', 'StudentSubjectResult', 'StudentTermResult', 'PromotionDecision', 'AmendmentRequest', 'ReportCard', 'ReportDocument', 'ResultProcessingRun'];
  const guards = await prisma.$queryRawUnsafe<Array<{ t: string; name: string }>>(
    `select c.relname as t, tg.tgname as name
       from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
      where not tg.tgisinternal and (tg.tgtype & 8) <> 0 and c.relname = any($1::text[])`,
    tables,
  );
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, true)`, O);
    for (const g of guards) await tx.$executeRawUnsafe(`alter table "${g.t}" disable trigger "${g.name}"`);
    await tx.reportDocument.deleteMany({ where: { organizationId: O, resultSetId: { in: setIds } } });
    await tx.reportCard.deleteMany({ where: { organizationId: O, termId: { in: termIds } } });
    await tx.resultSet.deleteMany({ where: { id: { in: setIds } } });
    await tx.resultProcessingRun.deleteMany({ where: { id: { in: runs.map((r) => r.id) } } });
    for (const g of guards) await tx.$executeRawUnsafe(`alter table "${g.t}" enable trigger "${g.name}"`);
  }, { timeout: 120_000 });
  console.log('Deleted. Now run the demo seed again to rebuild results through the result kernel.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
