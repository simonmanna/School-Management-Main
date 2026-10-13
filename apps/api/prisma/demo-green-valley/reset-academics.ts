/**
 * Clear a demo school's academic and pupil data so the demo pipeline can
 * rebuild it as a nursery-and-primary school.
 *
 * Written for Sunrise Academy, which was first seeded by `scripts/seed-school.ts`
 * as a mixed primary/secondary school (P.1 A … S.6, 243 pupils, invoices). The
 * academic structure is greenfield — no backfill — so the old rows are removed,
 * not migrated.
 *
 * KEPT: the organization, users and roles, campuses, school profile, academic
 * years and terms, chart of accounts, journals, fee categories/products/fee
 * structures and schedules, HR departments and positions, messaging and audit
 * logs, module toggles. Grade levels whose code the new structure reuses
 * (P1–P7) are kept too, because fee structures target them by id.
 *
 * DELETED (this organization only): pupils, guardians and their partners,
 * staff profiles and their HR records, enrolments, classes, streams, cohorts,
 * subjects, curricula, offerings, timetable, assessments, marks, exams,
 * results, report cards, LMS and planning rows, attendance, admissions, and the
 * pupils' invoices, payments and the journal entries those posted.
 *
 * Dry run by default — prints what would go. Deletes only with `--apply`.
 *
 *   tsx prisma/demo-green-valley/reset-academics.ts --school=sunrise
 *   tsx prisma/demo-green-valley/reset-academics.ts --school=sunrise --apply
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { activeSchool } from './schools';

const prisma = new PrismaClient();
const SCHOOL = activeSchool();
const APPLY = process.argv.includes('--apply');

/**
 * Where the deletion starts. Every table that references one of these through a
 * RESTRICT or CASCADE foreign key is found from the catalog and cleared first,
 * so a table added later is picked up without editing this list. SET NULL
 * references (a complaint, a library loan) are left for Postgres to detach.
 */
const ROOTS = [
  'StudentProfile', 'StaffProfile', 'HrEmployee', 'SchoolClass', 'Subject', 'AcademicProgramme',
  'CourseOffering', 'Discussion', 'LearningOutcome', 'Competency', 'TimetableOverride',
  // Academic rows with no FK to the roots.
  'Exam', 'ExamType', 'GradingScale', 'AssessmentPolicy', 'ResultSet', 'ReportCard',
  'StudentTermResult', 'StudentSubjectResult', 'ResultProcessingRun', 'StudentAssessmentHistory',
  'AcademicRoster', 'Curriculum', 'Period', 'SubjectCategory', 'Department', 'QuestionBank',
  'AdmissionApplication', 'PortalIdentity',
  // What the demo stages build that hangs off no root: LMS instances and
  // contexts, question banks, planning, mastery, exams admin, school life.
  'LmsContext', 'LmsRoleAssignment', 'LmsRole', 'LmsBadge', 'LmsBadgeAward', 'LearningActivity',
  'ModAssign', 'ModAssignSubmission', 'ModForum', 'ModLabel', 'ModPage', 'ModQuiz', 'ModResource', 'ModUrl',
  'Paper', 'Question', 'QuestionBank', 'QuizAttempt', 'SchemeOfWork', 'LessonPlan', 'ScheduledLesson',
  'StudentAttendance', 'LearningObjectiveEvidence', 'LearningObjectiveProgress', 'StudentCourseProgress',
  'ExamVenue', 'Invigilator', 'StudentExamReference', 'TeachingRoom', 'SchoolCalendarEvent',
  'StudentCategory', 'SchoolPolicy', 'Announcement', 'Rubric', 'TimetableSlot', 'Certificate', 'ExamType',
  // The pupils' finance: invoices, payments and what they posted.
  'Document', 'Payment', 'JournalEntry', 'BillingRun', 'SchoolFeeInvoice', 'FeeCredit',
  'ApprovalRequest', 'ReportTieoutSnapshot',
  // People records behind pupils, guardians and staff.
  'Partner', 'Contact',
];

/** Never deleted, even when a FK chain reaches them. */
const KEEP = new Set([
  'Organization', 'User', 'Role', '_UserRoles', 'Campus', 'SchoolProfile', 'AcademicYear', 'Term',
  'Account', 'AccountMapping', 'Journal', 'FiscalPeriod', 'FeeCategory', 'Product',
  'FeeStructure', 'FeeStructureVersion', 'FeeItem', 'FeeSchedule', 'Discount',
  'HrDepartment', 'HrPosition', 'HrJobGrade', 'Position', 'OrganizationModule',
  'AuditLog', 'EventOutbox', 'DomainEventLog', 'CommunicationChannel', 'ReportCardSettings',
  'AdmissionWorkflow', 'AttendanceStatusConfig', 'GradeLevel', 'AcademicLevel',
]);

type Edge = { child: string; parent: string; del: string };

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to reset in production.');

  const org = await prisma.organization.findUnique({ where: { code: SCHOOL.orgCode } });
  if (!org) throw new Error(`Organization ${SCHOOL.orgCode} not found.`);
  const O = org.id;
  console.log(`\n=== Reset academics: ${org.name} (${O}) — ${APPLY ? 'APPLY' : 'dry run'} ===\n`);

  const strip = (t: string) => t.replace(/^"|"$/g, '');
  const edges: Edge[] = (
    await prisma.$queryRawUnsafe<Array<{ child: string; parent: string; del: string }>>(
      `select conrelid::regclass::text as child, confrelid::regclass::text as parent, confdeltype as del
         from pg_constraint where contype = 'f'`,
    )
  ).map((e) => ({ child: strip(e.child), parent: strip(e.parent), del: e.del }));
  // a = no action, r = restrict, c = cascade: the child must go first (or goes anyway).
  const blocks = (e: Edge) => e.del === 'a' || e.del === 'r' || e.del === 'c';
  const orgScoped = new Set(
    (
      await prisma.$queryRawUnsafe<Array<{ t: string }>>(
        `select table_name as t from information_schema.columns
          where table_schema = 'public' and column_name = 'organizationId'`,
      )
    ).map((r) => r.t),
  );

  // Everything reachable from the roots through "references", minus KEEP.
  const targets = new Set<string>();
  const queue = [...ROOTS];
  while (queue.length) {
    const t = queue.shift()!;
    if (targets.has(t) || KEEP.has(t)) continue;
    targets.add(t);
    for (const e of edges) if (e.parent === t && e.child !== t && blocks(e)) queue.push(e.child);
  }

  // Children before parents.
  const order: string[] = [];
  const done = new Set<string>();
  const visit = (t: string, stack: Set<string>) => {
    if (done.has(t) || stack.has(t)) return;
    stack.add(t);
    for (const e of edges) if (e.parent === t && e.child !== t && targets.has(e.child)) visit(e.child, stack);
    stack.delete(t);
    done.add(t);
    order.push(t);
  };
  for (const t of targets) visit(t, new Set());

  const keptGradeCodes = SCHOOL.structure.flatMap((l) => l.grades.map((g) => g.code));
  const count = async (t: string) =>
    (await prisma.$queryRawUnsafe<Array<{ n: number }>>(`select count(*)::int n from "${t}" where "organizationId" = $1`, O))[0].n;

  const plan: Array<[string, number]> = [];
  for (const t of order) if (orgScoped.has(t)) plan.push([t, await count(t)]);
  const fileIds = await prisma.$queryRawUnsafe<Array<{ fileId: string }>>(
    `select "fileId" from "StudentDocument" where "organizationId" = $1`, O,
  );
  const staleGrades = await prisma.gradeLevel.count({ where: { organizationId: O, OR: [{ code: null }, { code: { notIn: keptGradeCodes } }] } });
  const levels = await prisma.academicLevel.count({ where: { organizationId: O } });

  const nonEmpty = plan.filter(([, n]) => n > 0);
  for (const [t, n] of nonEmpty) console.log(`  ${t.padEnd(32)} ${n}`);

  // Append-only and immutability guards (published results, frozen rosters,
  // mark adjustments) refuse DELETE by design. A demo reset is the one caller
  // allowed past them: they are switched off for these tables inside the
  // transaction and back on before it commits — DDL in Postgres is
  // transactional, so a failure leaves them exactly as they were.
  const guards = await prisma.$queryRawUnsafe<Array<{ t: string; name: string }>>(
    `select c.relname as t, tg.tgname as name
       from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
      where not tg.tgisinternal and (tg.tgtype & 8) <> 0 and c.relname = any($1::text[])`,
    plan.map(([t]) => t),
  );
  if (guards.length) console.log(`
  guards lifted for the reset: ${guards.map((g) => `${g.t}.${g.name}`).join(', ')}`);
  console.log(`  ${'File (pupil documents)'.padEnd(32)} ${fileIds.length}`);
  console.log(`  ${'GradeLevel (not in new structure)'.padEnd(32)} ${staleGrades}`);
  console.log(`  ${'AcademicLevel'.padEnd(32)} ${levels}`);

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to delete.\n');
    return;
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, true)`, O);
      for (const g of guards) await tx.$executeRawUnsafe(`alter table "${g.t}" disable trigger "${g.name}"`);
      // Empty tables are skipped: some guards fire per statement, not per row.
      for (const [t] of nonEmpty) {
        await tx.$executeRawUnsafe(`delete from "${t}" where "organizationId" = $1`, O);
      }
      for (const g of guards) await tx.$executeRawUnsafe(`alter table "${g.t}" enable trigger "${g.name}"`);
      if (fileIds.length) {
        await tx.$executeRawUnsafe(
          `delete from "File" where "organizationId" = $1 and id = any($2::text[])`,
          O, fileIds.map((f) => f.fileId),
        );
      }
      // Kept grades are re-attached to their level by the structure seed.
      await tx.gradeLevel.updateMany({ where: { organizationId: O }, data: { academicLevelId: null, nextGradeLevelId: null } });
      await tx.lmsCourseTemplate.deleteMany({ where: { organizationId: O } });
      await tx.gradeLevel.deleteMany({ where: { organizationId: O, OR: [{ code: null }, { code: { notIn: keptGradeCodes } }] } });
      await tx.academicLevel.deleteMany({ where: { organizationId: O } });
    },
    { timeout: 600_000, maxWait: 30_000 },
  );

  console.log(`\nDone. Next:\n  tsx prisma/seed-green-valley.ts --school=${SCHOOL.key}\n  tsx prisma/demo-green-valley/index.ts --school=${SCHOOL.key}\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
