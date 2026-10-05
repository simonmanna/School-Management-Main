/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DEMO DATA — FICTIONAL SCHOOL, FICTIONAL PEOPLE
 *
 *  Green Valley Primary School, Kampala does not exist. Every name, admission
 *  number, mark, guardian and phone number is invented for demonstration.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Fills Green Valley with a working year: ~900 pupils across nursery and
 * primary, their guardians, the staff who teach them, two years of enrolment
 * history, a full 2026 of assessment and published results, LMS courses with
 * real content, and the planning records a Ugandan inspector asks for.
 *
 * Runs in stages, each idempotent and each safe to re-run:
 *
 *   1  reference    programmes, NCDC subjects, bell schedule, grading scales
 *   2  people       staff, pupils, guardians, demo logins
 *   3  enrolment    2025 closed, 2026 active, effective-dated placements
 *   4  teaching     curricula, teacher assignments, timetable, offerings
 *   5  assessment   papers and marks: T1/T2 approved, T3 mid-marking
 *   6  results      published result sets and report cards
 *   7  lms          courses, activities, quizzes, submissions, badges
 *   8  planning     schemes of work, lesson plans, delivery, attendance
 *
 * Prerequisite — the structure, which this file deliberately does not invent:
 *   pnpm --filter @erp/api db:seed:green-valley
 *
 * Then:
 *   pnpm --filter @erp/api db:seed:green-valley-demo
 *
 * The same pipeline builds Sunrise Academy (schools.ts):
 *   pnpm --filter @erp/api db:reset:sunrise-academics -- --apply   (once: clears legacy data)
 *   pnpm --filter @erp/api db:seed:sunrise
 *   pnpm --filter @erp/api db:seed:sunrise-demo
 *
 * Environment:
 *   --school=<key>         greenvalley (default) | sunrise; or DEMO_SCHOOL
 *   DEMO_STAFF_PASSWORD    default per school (Staff@2026 / Staff@123)
 *   DEMO_PORTAL_PASSWORD   default per school (Portal@2026 / Portal@123)
 *   DEMO_ONLY              run one stage, e.g. DEMO_ONLY=7
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { SCHOOL, assertNotProduction, loadSchool, ok, log } from './shared';
import { showcaseStreamName } from './schools';
import { seedReference } from './01-reference';
import { seedPeople } from './02-people';
import { seedEnrollment } from './03-enrollment';
import { seedTeaching } from './04-teaching';
import { seedAssessment } from './05-assessment';
import { seedResults } from './06-results';
import { seedLms } from './07-lms';
import { seedPlanning } from './08-planning';
import { seedCurriculum } from './09-curriculum';
import { seedExams } from './10-exams';
import { seedSchoolLife } from './11-school-life';
import { seedAssessmentOps } from './12-assessment-ops';

/**
 * A plain client, with no tenancy extension.
 *
 * `organizationId` is set explicitly on every row here, which is what the other
 * school seeds do. The extension would be fighting a seed that legitimately
 * writes as one known tenant.
 */
const prisma = new PrismaClient();

async function main(): Promise<void> {
  assertNotProduction();

  const started = Date.now();
  console.log(`\n=== ${SCHOOL.orgName} — demo fill (FICTIONAL DATA) ===\n`);

  const school = await loadSchool(prisma);
  ok(`organization ${SCHOOL.orgCode} (${school.O})`);

  const only = process.env.DEMO_ONLY;
  const run = (stage: number) => !only || Number(only) === stage;

  console.log('\n── 1. Reference data ──');
  const ref = await seedReference(prisma, school);

  console.log('\n── 2. People ──');
  const people = await seedPeople(prisma, school);

  console.log('\n── 3. Enrolment ──');
  const enrol = await seedEnrollment(prisma, school, ref, people);

  console.log('\n── 4. Teaching contexts ──');
  const teaching = await seedTeaching(prisma, school, ref, people, enrol);

  console.log('\n── 5. Assessment and marks ──');
  const assessment = await seedAssessment(prisma, school, ref, people, enrol, teaching);

  if (run(6)) {
    console.log('\n── 6. Results and report cards ──');
    await seedResults(prisma, school, ref, people, enrol, teaching, assessment);
  }

  let lms: Awaited<ReturnType<typeof seedLms>> | null = null;
  if (run(7)) {
    console.log('\n── 7. LMS ──');
    lms = await seedLms(prisma, school, ref, people, enrol, teaching, assessment);
  }

  if (run(8) && lms) {
    console.log('\n── 8. Planning, delivery and attendance ──');
    await seedPlanning(prisma, school, ref, people, enrol, teaching, assessment, lms);
  }

  if (lms && (!only || Number(only) >= 9)) {
    console.log('\n── 9. Curriculum content, competencies and mastery ──');
    const curriculum = await seedCurriculum(prisma, school, ref, people, enrol, teaching, assessment, lms);

    console.log('\n── 10. Examinations and PLE registration ──');
    await seedExams(prisma, school, ref, people, enrol, teaching, assessment);

    console.log('\n── 11. Calendar, rooms, homework, quizzes, notices ──');
    await seedSchoolLife(prisma, school, ref, people, enrol, teaching, assessment, lms, curriculum);

    console.log('\n── 12. Teaching & assessment trail ──');
    await seedAssessmentOps(prisma, school, people, enrol, teaching, assessment, curriculum);
  }

  // ── What was built ────────────────────────────────────────────────────────
  const O = school.O;
  const counts = {
    pupils: await prisma.studentProfile.count({ where: { organizationId: O } }),
    staff: await prisma.staffProfile.count({ where: { organizationId: O } }),
    guardianLinks: await prisma.studentGuardian.count({ where: { organizationId: O } }),
    enrolments: await prisma.studentEnrollment.count({ where: { organizationId: O } }),
    placements: await prisma.enrollmentPlacement.count({ where: { organizationId: O } }),
    courseOfferings: await prisma.courseOffering.count({ where: { organizationId: O } }),
    timetableSlots: await prisma.timetableSlot.count({ where: { organizationId: O } }),
    assessments: await prisma.assessment.count({ where: { organizationId: O } }),
    marks: await prisma.studentAssessment.count({ where: { organizationId: O } }),
    publishedResultSets: await prisma.resultSet.count({ where: { organizationId: O, status: 'published' } }),
    reportCards: await prisma.reportCard.count({ where: { organizationId: O } }),
    courseSections: await prisma.courseSection.count({ where: { organizationId: O } }),
    activities: await prisma.courseModule.count({ where: { organizationId: O, deletedAt: null } }),
    quizQuestions: await prisma.question.count({ where: { organizationId: O } }),
    submissions: await prisma.modAssignSubmission.count({ where: { organizationId: O } }),
    lessonPlans: await prisma.lessonPlan.count({ where: { organizationId: O } }),
    schemesOfWork: await prisma.schemeOfWork.count({ where: { organizationId: O } }),
    scheduledLessons: await prisma.scheduledLesson.count({ where: { organizationId: O } }),
    attendanceEntries: await prisma.studentAttendance.count({ where: { organizationId: O } }),
    topics: await prisma.topic.count({ where: { organizationId: O } }),
    learningOutcomes: await prisma.learningOutcome.count({ where: { organizationId: O } }),
    competencyJudgements: await prisma.studentOutcomeAchievement.count({ where: { organizationId: O } }),
    exams: await prisma.exam.count({ where: { organizationId: O } }),
    examPapers: await prisma.examSchedule.count({ where: { organizationId: O } }),
    pleCandidates: await prisma.studentExamReference.count({ where: { organizationId: O } }),
    calendarEvents: await prisma.schoolCalendarEvent.count({ where: { organizationId: O } }),
    homework: await prisma.assessment.count({ where: { organizationId: O, kind: 'homework' } }),
    quizAttempts: await prisma.quizAttempt.count({ where: { organizationId: O } }),
    questionPapers: await prisma.questionPaper.count({ where: { organizationId: O } }),
    markEntries: await prisma.markEntry.count({ where: { organizationId: O } }),
    promotionDecisions: await prisma.promotionDecision.count({ where: { organizationId: O } }),
    certificates: await prisma.certificate.count({ where: { organizationId: O } }),
    staffLogins: await prisma.user.count({ where: { organizationId: O } }),
    portalLogins: await prisma.portalIdentity.count({ where: { organizationId: O } }),
  };

  console.log('\n' + JSON.stringify(counts, null, 2));

  console.log('\n── Demo logins ──');
  const d = SCHOOL.emailDomain;
  const logins: Array<[string, string, string]> = [
    [`head@${d}`, 'Head Teacher', people.passwords.staff],
    [`deputy@${d}`, 'Deputy Head', people.passwords.staff],
    [`dos@${d}`, 'Director of Studies', people.passwords.staff],
    [`bursar@${d}`, 'Bursar', people.passwords.staff],
    [`registrar@${d}`, 'Registrar', people.passwords.staff],
    [`teacher@${d}`, `P5 ${showcaseStreamName(SCHOOL)} class teacher`, people.passwords.staff],
    [`mtc@${d}`, 'Mathematics teacher', people.passwords.staff],
    [`pupil@${d}`, 'Pupil (portal)', people.passwords.portal],
    [`parent@${d}`, 'Guardian (portal)', people.passwords.portal],
  ];
  for (const [email, who, pw] of logins) log(`${email.padEnd(26)} ${who.padEnd(22)} ${pw}`);
  console.log(`\n  Organization code at the web login: ${SCHOOL.orgCode}`);
  console.log(`  The portal (apps/portal) needs VITE_ORG_CODE=${SCHOOL.orgCode}.`);
  console.log('  The LMS needs ENABLE_ADVANCED_LMS=true on the API and');
  console.log('  VITE_ENABLE_ADVANCED_LMS=true on the web and portal builds.');

  console.log(
    `\nDEMO DATA — fictional school. Done in ${Math.round((Date.now() - started) / 1000)}s.\n`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
