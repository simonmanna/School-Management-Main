/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DEMO DATA — FICTIONAL SCHOOL, FICTIONAL PEOPLE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Clears the admissions & enrollment demo for one demo school so
 * `admissions/run.cjs` can write a fresh intake.
 *
 * Two things go, and nothing else:
 *
 *  1. The admissions records themselves — enquiries, applications and everything
 *     hanging off them, plus the cycles, capacity, requirements, criteria,
 *     workflows and offer templates this demo configured.
 *
 *  2. The learners those applications admitted, and only those: a pupil is
 *     removed exactly when their enrollment carries an `admissionApplicationId`.
 *     Without this the next run would admit the same children a second time and
 *     the class rolls would quietly grow.
 *
 * The roll the academic demo built is untouched, and so is the operations demo —
 * except for the application-fee invoices and their journal entries, which belong
 * to the admissions story and go with it.
 *
 *   pnpm --filter @erp/api db:reset:sunrise-admissions -- --apply
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { SCHOOL, assertNotProduction } from '../shared';

/** Admissions tables, children first. Retry passes absorb any ordering we got wrong. */
const ADMISSION_TABLES = [
  'ApplicantIdentityMatch', 'ApplicantScore', 'AdmissionStatusHistory', 'AdmissionDecision',
  'AdmissionReviewerAssignment', 'AdmissionPortalToken', 'ApplicationDocument', 'EntranceExam',
  'Interview', 'WaitingList', 'OfferLetter', 'AdmissionFee', 'AdmissionGuardian',
  'AdmissionEnquiry', 'AdmissionApplication',
  'AdmissionCriterion', 'AdmissionCriteriaSet', 'AdmissionCapacity', 'AdmissionRequirement',
  'AdmissionOfferTemplate', 'AdmissionCycle', 'AdmissionWorkflow',
];

/** Rows that hang off a pupil this demo admitted. Children first. */
const PUPIL_TABLES = [
  'StudentStatusHistory', 'StudentGuardian', 'StudentDocument', 'EmergencyContact',
  'PickupAuthorization', 'ImmunisationRecord', 'MedicalRecord', 'PortalIdentity',
  'StudentFeeAssignment', 'StudentOptionalFee', 'InstallmentPlan', 'MealAccount',
  'MealPlanAssignment', 'StudentTransportAssignment', 'AcademicRosterMember',
  'CourseEnrolment', 'StudentAttendance', 'StudentAssessment',
];

async function main() {
  assertNotProduction();
  const apply = process.argv.includes('--apply');
  const prisma = new PrismaClient();
  try {
    const org = await prisma.organization.findUnique({ where: { code: SCHOOL.orgCode } });
    if (!org) throw new Error(`Organization ${SCHOOL.orgCode} not found`);
    const O = org.id;
    console.log(`\n${apply ? 'Clearing' : 'Would clear'} the admissions demo for ${SCHOOL.orgName} (${O})\n`);

    const existing = new Set(
      ((await prisma.$queryRawUnsafe(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
      )) as any[]).map((r) => r.table_name),
    );

    // The pupils this demo admitted, and the partners behind them.
    const admitted = (await prisma.$queryRawUnsafe(
      `SELECT se."studentProfileId" AS profile, sp."partnerId" AS partner
         FROM "StudentEnrollment" se
         JOIN "StudentProfile" sp ON sp.id = se."studentProfileId"
        WHERE se."organizationId" = $1 AND se."admissionApplicationId" IS NOT NULL`,
      O,
    )) as Array<{ profile: string; partner: string }>;
    const profiles = admitted.map((a) => a.profile);
    const partners = admitted.map((a) => a.partner);

    for (const t of ADMISSION_TABLES.filter((name) => existing.has(name))) {
      const [{ n }] = (await prisma.$queryRawUnsafe(
        `SELECT count(*)::int n FROM "${t}" WHERE "organizationId" = $1`,
        O,
      )) as any[];
      if (n > 0) console.log(`  ${t.padEnd(32)} ${n}`);
    }
    console.log(`  ${'pupils admitted by this demo'.padEnd(32)} ${profiles.length}`);
    const [{ n: feeDocs }] = (await prisma.$queryRawUnsafe(
      `SELECT count(*)::int n FROM "Document" WHERE "organizationId" = $1 AND "sourceType" = 'school_admission_fee'`,
      O,
    )) as any[];
    console.log(`  ${'application-fee invoices'.padEnd(32)} ${feeDocs}`);

    if (!apply) {
      console.log('\nDry run. Re-run with --apply to delete.');
      return;
    }

    // 1. The pupils, before the applications that admitted them — the enrollment
    //    FK is what identifies them.
    if (profiles.length) {
      await clear(prisma, existing, PUPIL_TABLES, (t) => [
        `DELETE FROM "${t}" WHERE "organizationId" = $1 AND "studentProfileId" = ANY($2::text[])`,
        [O, profiles],
      ]);
      // Rows that hang off the enrollment itself, not the pupil.
      await prisma.$executeRawUnsafe(
        `DELETE FROM "CourseEnrollment" WHERE "studentEnrollmentId" IN (
           SELECT id FROM "StudentEnrollment" WHERE "organizationId" = $1 AND "studentProfileId" = ANY($2::text[]))`,
        O,
        profiles,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM "EnrollmentPlacement" WHERE "enrollmentId" IN (
           SELECT id FROM "StudentEnrollment" WHERE "organizationId" = $1 AND "studentProfileId" = ANY($2::text[]))`,
        O,
        profiles,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM "StudentEnrollmentEvent" WHERE "enrollmentId" IN (
           SELECT id FROM "StudentEnrollment" WHERE "organizationId" = $1 AND "studentProfileId" = ANY($2::text[]))`,
        O,
        profiles,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM "StudentEnrollment" WHERE "organizationId" = $1 AND "studentProfileId" = ANY($2::text[])`,
        O,
        profiles,
      );
    }

    // 2. The money the admissions story wrote: application-fee invoices, their
    //    receipts and their journal entries.
    const FEE_SQL = [
      `DELETE FROM "PaymentAllocation" WHERE "organizationId" = $1 AND "documentId" IN (
         SELECT id FROM "Document" WHERE "organizationId" = $1 AND "sourceType" = 'school_admission_fee')`,
      `DELETE FROM "Payment" WHERE "organizationId" = $1 AND reference LIKE 'Application fee %'
         AND id NOT IN (SELECT "paymentId" FROM "PaymentAllocation" WHERE "organizationId" = $1)`,
      `DELETE FROM "DocumentLine" WHERE "organizationId" = $1 AND "documentId" IN (
         SELECT id FROM "Document" WHERE "organizationId" = $1 AND "sourceType" = 'school_admission_fee')`,
      `DELETE FROM "JournalLine" WHERE "organizationId" = $1 AND "journalEntryId" IN (
         SELECT id FROM "JournalEntry" WHERE "organizationId" = $1 AND "sourceType" LIKE 'school_admission_fee%')`,
      `UPDATE "Document" SET "journalEntryId" = NULL WHERE "organizationId" = $1 AND "sourceType" = 'school_admission_fee'`,
      `DELETE FROM "JournalEntry" WHERE "organizationId" = $1 AND "sourceType" LIKE 'school_admission_fee%'`,
      `DELETE FROM "Document" WHERE "organizationId" = $1 AND "sourceType" = 'school_admission_fee'`,
    ];
    for (const sql of FEE_SQL) await prisma.$executeRawUnsafe(sql, O);

    // 3. The admissions records and their configuration.
    await clear(prisma, existing, ADMISSION_TABLES, (t) => [
      `DELETE FROM "${t}" WHERE "organizationId" = $1`,
      [O],
    ]);

    // 4. Finally the pupil and partner rows themselves, and the demo file stubs.
    if (profiles.length) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM "StudentProfile" WHERE "organizationId" = $1 AND id = ANY($2::text[])`,
        O,
        profiles,
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM "Partner" WHERE "organizationId" = $1 AND id = ANY($2::text[])`,
        O,
        partners,
      );
    }
    await prisma.$executeRawUnsafe(
      `DELETE FROM "File" WHERE "organizationId" = $1 AND "ownerType" = 'AdmissionDemo'`,
      O,
    );

    console.log(
      `\nCleared (${profiles.length} admitted pupils removed with their applications).` +
        `\nNow: pnpm --filter @erp/api db:seed:${SCHOOL.key}-admissions\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

/** Delete from each table, retrying so FK ordering we got wrong resolves itself. */
async function clear(
  prisma: PrismaClient,
  existing: Set<string>,
  tables: string[],
  sqlFor: (table: string) => [string, unknown[]],
): Promise<void> {
  let pending = tables.filter((t) => existing.has(t));
  for (let pass = 1; pass <= 6 && pending.length; pass += 1) {
    const failed: string[] = [];
    for (const t of pending) {
      const [sql, params] = sqlFor(t);
      try {
        await prisma.$executeRawUnsafe(sql, ...params);
      } catch {
        failed.push(t);
      }
    }
    pending = failed;
  }
  if (pending.length) throw new Error(`Could not clear: ${pending.join(', ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
