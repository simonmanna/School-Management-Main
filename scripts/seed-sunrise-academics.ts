/**
 * scripts/seed-sunrise-academics.ts — the academic setup SUNRISE needs for the
 * end-to-end journey (application → enrolment → assessment → marks → results →
 * report card), using common Ugandan school defaults.
 *
 *   - Term 3 is the current term (it contains today).
 *   - Grading scales, one per system: UCE (the school default), PLE and ECD.
 *   - A school-wide weighting policy: continuous assessment 40%, end-of-term
 *     exam 60% — the usual split.
 *   - P.1 A Mathematics for Term 3: a published curriculum line (core) and a
 *     published course taught by a subject teacher, with every pupil placed in
 *     P.1 A this term on its roster.
 *   - A subject-teacher login, linked to HR and a staff profile, so marks are
 *     entered by one person and approved by another.
 *   - The Term 3 end-of-term examination, in its marking window.
 *
 * Idempotent: every row is found first and only created when missing.
 *
 * Usage (dev only):
 *   pnpm --filter @erp/api exec tsx ../../scripts/seed-sunrise-academics.ts
 *   SEED_TEACHER_PASSWORD=...   optional; defaults to Teacher@123 for the dev database
 *   SEED_STAFF_PASSWORD=...     optional; registrar/bursar/head logins, default Staff@123
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { defaultBands } from '../apps/api/src/modules/school/assessment/grade-bands';
import { reconcileCompulsoryRostersInTx } from '../apps/api/src/modules/school/course-offerings/course-roster-reconcile';

if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production.');

const ORG = process.env.SEED_ORG_ID ?? 'org_sunrise_academy';
const TEACHER_EMAIL = process.env.SEED_TEACHER_EMAIL ?? 'teacher@sunrise.test';
const TEACHER_PASSWORD = process.env.SEED_TEACHER_PASSWORD ?? 'Teacher@123';

const url = process.env.SYSTEM_DATABASE_URL ?? process.env.DATABASE_URL;
const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  await prisma.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, ORG);
  const log = (m: string) => console.log(`• ${m}`);

  // ── Term 3 is current ────────────────────────────────────────────────────
  const year = await prisma.academicYear.findFirstOrThrow({ where: { organizationId: ORG, name: '2026' } });
  const term3 = await prisma.term.findFirstOrThrow({ where: { organizationId: ORG, academicYearId: year.id, name: 'Term 3' } });
  if (!term3.isCurrent) {
    await prisma.term.updateMany({ where: { organizationId: ORG, isCurrent: true }, data: { isCurrent: false } });
    await prisma.term.update({ where: { id: term3.id }, data: { isCurrent: true } });
    log('Term 3 is now the current term');
  }

  // ── Grading scales, one per system ───────────────────────────────────────
  const scales = [
    { name: 'UCE (UNEB)', system: 'UCE', isDefault: true },
    { name: 'PLE (UNEB)', system: 'PLE', isDefault: false },
    { name: 'ECD nursery descriptors', system: 'ECD', isDefault: false },
  ];
  for (const s of scales) {
    const found = await prisma.gradingScale.findFirst({ where: { organizationId: ORG, name: s.name } });
    if (!found) {
      await prisma.gradingScale.create({ data: { organizationId: ORG, ...s, bands: defaultBands(s.system) as any } });
      log(`grading scale ${s.name}`);
    }
  }

  // ── The school-wide weighting: CA 40% / end-of-term exam 60% ─────────────
  const POLICY = 'Standard — continuous assessment 40%, end-of-term exam 60%';
  let policy = await prisma.assessmentPolicy.findFirst({ where: { organizationId: ORG, name: POLICY } });
  if (!policy) {
    policy = await prisma.assessmentPolicy.create({
      data: { organizationId: ORG, name: POLICY, passMark: 50, roundingMode: 'half_up', decimalPlaces: 2 },
    });
    await prisma.assessmentComponent.createMany({
      data: [
        { organizationId: ORG, policyId: policy.id, name: 'Continuous assessment', kind: 'cat', weight: 40, aggregation: 'mean', countsAbsentAsZero: true, order: 0 },
        { organizationId: ORG, policyId: policy.id, name: 'End-of-term exam', kind: 'exam', weight: 60, aggregation: 'mean', countsAbsentAsZero: true, order: 1 },
      ],
    });
    await prisma.assessmentPolicy.update({ where: { id: policy.id }, data: { publishedAt: new Date() } });
    log('weighting policy CA 40% / exam 60% (published)');
  }

  // ── Roles + administrator (what organization bootstrap provisions) ───────
  // seed-school.ts upserts the organization row directly, so the roles the
  // bootstrap endpoint would create are missing. Same presets, same scopes.
  const perms = await import('../packages/shared/src/permissions');
  const adminRole = await prisma.role.upsert({
    where: { organizationId_name: { organizationId: ORG, name: 'Administrator' } },
    update: {},
    create: { organizationId: ORG, name: 'Administrator', description: 'Full platform access', isSystem: true, permissions: [...perms.ALL_PERMISSIONS] },
  });
  for (const preset of perms.PORTAL_ROLE_PRESETS) {
    await prisma.role.upsert({
      where: { organizationId_name: { organizationId: ORG, name: preset.name } },
      update: {},
      create: { organizationId: ORG, name: preset.name, description: preset.description, isSystem: true, permissions: [...preset.permissions], dataScope: preset.dataScope ?? 'own' } as any,
    });
  }
  for (const preset of perms.SCHOOL_ROLE_PRESETS) {
    await prisma.role.upsert({
      where: { organizationId_name: { organizationId: ORG, name: preset.name } },
      update: {},
      create: { organizationId: ORG, name: preset.name, description: preset.description, isSystem: false, permissions: [...preset.permissions], dataScope: preset.dataScope ?? 'school' } as any,
    });
  }
  const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@sunrise.test';
  if (!(await prisma.user.findFirst({ where: { organizationId: ORG, email: ADMIN_EMAIL } }))) {
    await prisma.user.create({
      data: {
        organizationId: ORG, email: ADMIN_EMAIL,
        passwordHash: await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD ?? 'Admin@123', 12),
        firstName: 'School', lastName: 'Administrator', isActive: true, roles: { connect: { id: adminRole.id } },
      } as any,
    });
    log(`administrator login ${ADMIN_EMAIL}`);
  }

  // ── The subject teacher: login + HR + staff profile ──────────────────────
  let user = await prisma.user.findFirst({ where: { organizationId: ORG, email: TEACHER_EMAIL } });
  if (!user) {
    const role = await prisma.role.findFirstOrThrow({ where: { organizationId: ORG, name: 'Subject Teacher' } });
    user = await prisma.user.create({
      data: {
        organizationId: ORG,
        email: TEACHER_EMAIL,
        passwordHash: await bcrypt.hash(TEACHER_PASSWORD, 12),
        firstName: 'Grace',
        lastName: 'Akello',
        isActive: true,
        roles: { connect: { id: role.id } },
      } as any,
    });
    log(`teacher login ${TEACHER_EMAIL}`);
  }
  let employee = await prisma.hrEmployee.findFirst({ where: { organizationId: ORG, userId: user.id } });
  let staff: any;
  if (!employee) {
    const partner = await prisma.partner.create({
      data: { organizationId: ORG, code: 'STF-GAKELLO', name: 'Grace Akello', isEmployee: true, email: TEACHER_EMAIL },
    });
    staff = await prisma.staffProfile.create({
      data: { organizationId: ORG, partnerId: partner.id, employeeNo: 'STF-GAKELLO', joinDate: new Date('2026-01-05'), staffCategory: 'teaching', status: 'active' } as any,
    });
    employee = await prisma.hrEmployee.create({
      data: { organizationId: ORG, employeeCode: 'STF-GAKELLO', userId: user.id, partnerId: partner.id, firstName: 'Grace', lastName: 'Akello' } as any,
    });
    log('teacher linked to HR and a staff profile');
  } else {
    staff = await prisma.staffProfile.findFirstOrThrow({ where: { organizationId: ORG, partnerId: employee.partnerId! } });
  }

  // ── Acceptance staff: one login per office role (Wave 17 R07) ────────────
  // Distinct people so separation of duties is really exercised: the bursar
  // requests a fee correction, the head teacher approves it, the registrar
  // admits. Roles come from the shared presets, never a hand-written list.
  const { SCHOOL_ROLE_PRESETS } = await import('../packages/shared/src/permissions');
  const STAFF = [
    { email: 'registrar@sunrise.test', role: 'Registrar', first: 'Rose', last: 'Nansubuga' },
    { email: 'bursar@sunrise.test', role: 'Bursar', first: 'Peter', last: 'Ssempijja' },
    { email: 'head@sunrise.test', role: 'Head Teacher', first: 'Joseph', last: 'Okot' },
  ];
  const STAFF_PASSWORD = process.env.SEED_STAFF_PASSWORD ?? 'Staff@123';
  for (const s of STAFF) {
    const preset = SCHOOL_ROLE_PRESETS.find((p: { name: string }) => p.name === s.role);
    if (!preset) throw new Error(`No role preset ${s.role}`);
    const role = await prisma.role.upsert({
      where: { organizationId_name: { organizationId: ORG, name: s.role } },
      update: {},
      create: { organizationId: ORG, name: s.role, description: preset.description, isSystem: false, permissions: [...preset.permissions] },
    });
    const found = await prisma.user.findFirst({ where: { organizationId: ORG, email: s.email } });
    if (!found) {
      await prisma.user.create({
        data: {
          organizationId: ORG, email: s.email, passwordHash: await bcrypt.hash(STAFF_PASSWORD, 12),
          firstName: s.first, lastName: s.last, isActive: true, roles: { connect: { id: role.id } },
        } as any,
      });
      log(`${s.role} login ${s.email}`);
    }
  }

  // ── P.1 A Mathematics for Term 3 ─────────────────────────────────────────
  const klass = await prisma.schoolClass.findFirstOrThrow({ where: { organizationId: ORG, name: 'P.1 A' } });
  const cohort = await prisma.classCohort.findFirstOrThrow({ where: { organizationId: ORG, academicYearId: year.id, classId: klass.id } });
  const maths = await prisma.subject.findFirstOrThrow({ where: { organizationId: ORG, code: 'MTC' } });

  let curriculum = await prisma.curriculum.findFirst({ where: { organizationId: ORG, classId: klass.id, academicYearId: year.id } });
  if (!curriculum) {
    curriculum = await prisma.curriculum.create({
      data: { organizationId: ORG, classId: klass.id, academicYearId: year.id, name: 'P.1 curriculum 2026', status: 'published' } as any,
    });
    log('P.1 curriculum 2026');
  }
  if (!(await prisma.curriculumSubject.findFirst({ where: { curriculumId: curriculum.id, subjectId: maths.id } }))) {
    await prisma.curriculumSubject.create({ data: { organizationId: ORG, curriculumId: curriculum.id, subjectId: maths.id, isCore: true, periodsPerWeek: 7 } });
    log('Mathematics is a core P.1 subject');
  }

  let offering = await prisma.courseOffering.findFirst({
    where: { organizationId: ORG, termId: term3.id, classCohortId: cohort.id, subjectId: maths.id, deletedAt: null },
  });
  if (!offering) {
    offering = await prisma.courseOffering.create({
      data: {
        organizationId: ORG,
        code: 'P1A-MTC-T3-2026',
        name: 'P.1 A Mathematics — Term 3',
        academicYearId: year.id,
        termId: term3.id,
        programmeId: cohort.programmeId,
        classCohortId: cohort.id,
        classId: klass.id,
        subjectId: maths.id,
        curriculumId: curriculum.id,
        offeringType: 'SUBJECT',
        audienceScope: 'COHORT',
        status: 'PUBLISHED',
        effectiveFrom: term3.startDate,
        startDate: term3.startDate,
        endDate: term3.endDate,
      } as any,
    });
    log('course P.1 A Mathematics — Term 3 (published)');
  }
  if (!(await prisma.courseOfferingTeacher.findFirst({ where: { courseOfferingId: offering.id, teacherPartnerId: staff.id } }))) {
    await prisma.courseOfferingTeacher.create({
      data: { organizationId: ORG, courseOfferingId: offering.id, teacherPartnerId: staff.id, isResponsible: true, effectiveFrom: term3.startDate },
    });
    log('Grace Akello teaches P.1 A Mathematics');
  }
  if (!(await prisma.teacherAssignment.findFirst({ where: { organizationId: ORG, teacherPartnerId: staff.id, classId: klass.id, subjectId: maths.id, termId: term3.id } }))) {
    await prisma.teacherAssignment.create({
      data: { organizationId: ORG, teacherPartnerId: staff.id, classId: klass.id, subjectId: maths.id, termId: term3.id, periodsPerWeek: 7 },
    });
  }

  // Everyone seated in P.1 A this term joins the (core) course roster.
  const placements = await prisma.enrollmentPlacement.findMany({
    where: { organizationId: ORG, termId: term3.id, classCohortId: cohort.id, effectiveTo: null },
    select: { enrollmentId: true, classCohortId: true, sectionId: true, effectiveFrom: true },
  });
  let joined = 0;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, true)`, ORG);
    for (const p of placements) {
      const r = await reconcileCompulsoryRostersInTx(tx, {
        organizationId: ORG,
        enrollmentId: p.enrollmentId,
        termId: term3.id,
        classCohortId: p.classCohortId,
        sectionId: p.sectionId,
        effectiveFrom: p.effectiveFrom > term3.startDate ? p.effectiveFrom : term3.startDate,
      });
      joined += r.enrolled;
    }
  }, { timeout: 60_000 });
  log(`${placements.length} pupil(s) in P.1 A this term; ${joined} newly on the Mathematics roster`);

  // ── The Term 3 end-of-term examination, in its marking window ────────────
  let examType = await prisma.examType.findFirst({ where: { organizationId: ORG, name: 'End of term' } });
  if (!examType) examType = await prisma.examType.create({ data: { organizationId: ORG, name: 'End of term', weight: 100, isFinal: true } });
  // One sitting open for marking at a time. When the last one has been closed
  // (as the end-to-end journey does), the next run gets a fresh sitting.
  const sittings = await prisma.exam.count({ where: { organizationId: ORG, termId: term3.id, examTypeId: examType.id } });
  // "Free" = open for marking and not yet holding P.1 A's Mathematics paper.
  const free = await prisma.exam.findFirst({
    where: {
      organizationId: ORG, termId: term3.id, examTypeId: examType.id,
      lifecycleState: { notIn: ['results_ready', 'closed', 'archived'] },
      schedules: { none: { classId: klass.id, subjectId: maths.id } },
    } as any,
  });
  if (!free) {
    await prisma.exam.create({
      data: {
        organizationId: ORG,
        termId: term3.id,
        examTypeId: examType.id,
        name: sittings === 0 ? 'End of Term 3 Examination' : `End of Term 3 Examination — sitting ${sittings + 1}`,
        startDate: new Date('2026-11-23'),
        endDate: new Date('2026-12-04'),
        status: 'published',
        lifecycleState: 'marking',
      } as any,
    });
    log(`End of Term 3 Examination sitting ${sittings + 1} (marking)`);
  }

  console.log('\nSUNRISE academic setup complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
