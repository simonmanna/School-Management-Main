/**
 * school-demo seed — populates a full, realistic Ugandan secondary-school
 * academic dataset across every A0–A8 module so the system can be demonstrated
 * to a client school as production-ready.
 *
 * Design notes (why it is safe + reproducible):
 *  - Drives a standalone PrismaClient (no tenancy extension) and sets
 *    organizationId explicitly on every row — RLS is off on schooldb-planet by
 *    design, so a plain client can write freely.
 *  - IDEMPOTENT: if a SchoolProfile already exists for the DEMO org it bails out,
 *    so re-running never duplicates. Delete the SchoolProfile (and cascade rows)
 *    to reseed.
 *  - Certificate serials come from the SAME native Postgres sequence the app uses
 *    (seq_<orgShort>_certificate), and verification codes are crypto-random hex,
 *    exactly like SequenceService / CertService. Re-running the app won't collide.
 *  - ResultSets are inserted with status='published'. The immutability trigger
 *    only blocks UPDATE/DELETE of published rows, not INSERT — so this is the
 *    legitimate "already published" state, not a bypass.
 *
 * Run (from apps/api, with DATABASE_URL / .env present):
 *   npx ts-node prisma/seed-school-demo.ts
 *   # or:  node -r ts-node/register prisma/seed-school-demo.ts
 */
import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();
const ORG_CODE = 'DEMO';
const D = (v: number | string) => new Prisma.Decimal(v);

const log = (m: string) => console.log(`  • ${m}`);
const ok = (m: string) => console.log(`\x1b[32m✓\x1b[0m ${m}`);

/** Replicates SequenceService.next() numbering (prefix + padding on a PG sequence). */
async function nextSerial(key: string, prefix: string, padding: number): Promise<string> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { code: ORG_CODE } });
  const orgShort = org.id.replace(/-/g, '').slice(0, 8);
  const seqName = `seq_${orgShort}_${key.replace(/[^a-zA-Z0-9_]/g, '_')}`;
  await prisma.$executeRawUnsafe(
    `CREATE SEQUENCE IF NOT EXISTS "${seqName}" INCREMENT BY 1 START WITH 1`,
  );
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT nextval('"${seqName}"') AS n`,
  )) as Array<{ n: string | number }>;
  return `${prefix}${String(Number(rows[0].n)).padStart(padding, '0')}`;
}

async function main() {
  console.log('\n=== School demo seed (A0–A8) ===\n');
  const org = await prisma.organization.findUnique({ where: { code: ORG_CODE } });
  if (!org) throw new Error(`Org ${ORG_CODE} not found — run 'pnpm db:seed' first.`);
  const O = org.id;

  const existing = await prisma.schoolProfile.findUnique({ where: { organizationId: O } });
  if (existing) {
    console.log('\x1b[33mSchoolProfile already exists for DEMO — seed skipped (idempotent). Delete it to reseed.\x1b[0m');
    return;
  }

  // ── Foundation ────────────────────────────────────────────────────────────
  const school = await prisma.schoolProfile.create({
    data: {
      organizationId: O,
      name: 'Hilltop High School',
      motto: 'Knowledge · Character · Service',
      country: 'UG',
      currencyCode: 'UGX',
      educationLevel: 'secondary',
      gradingSystem: 'UCE',
      attendanceMode: 'period',
      address: 'Plot 14, Nakasero Road, Kampala',
      phone: '+256-414-123456',
      email: 'admin@hilltop.ac.ug',
      website: 'https://hilltop.ac.ug',
    },
  });
  log('school profile: Hilltop High School');

  // ── P-att-status: default attendance status catalog (Absent / Present / Late) ──
  const statusDefs = [
    { code: 'present', label: 'Present', color: '#16a34a', isDefault: true, isPresent: true, sortOrder: 1 },
    { code: 'absent', label: 'Absent', color: '#dc2626', isAbsent: true, sortOrder: 2 },
    { code: 'late', label: 'Late', color: '#f59e0b', isLate: true, sortOrder: 3 },
  ];
  await prisma.attendanceStatusConfig.createMany({
    data: statusDefs.map((s) => ({ organizationId: O, ...s })),
  });
  log(`attendance statuses: ${statusDefs.map((s) => s.label).join(' / ')}`);

  const year = await prisma.academicYear.create({
    data: { organizationId: O, name: '2026', startDate: new Date('2026-02-02'), endDate: new Date('2026-11-27'), isCurrent: true },
  });
  const term = await prisma.term.create({
    data: { organizationId: O, academicYearId: year.id, name: 'Term 2', startDate: new Date('2026-05-04'), endDate: new Date('2026-08-07'), isCurrent: true },
  });
  log('academic year 2026 / Term 2 (current)');

  const campus = await prisma.campus.create({
    data: { organizationId: O, name: 'Main Campus', code: 'MAIN', isActive: true },
  });

  const depts = await Promise.all([
    prisma.department.create({ data: { organizationId: O, name: 'Sciences' } }),
    prisma.department.create({ data: { organizationId: O, name: 'Languages' } }),
    prisma.department.create({ data: { organizationId: O, name: 'Humanities' } }),
  ]);
  const deptOf = (n: string) => depts.find((d) => d.name === n)!.id;

  const gl = await prisma.gradeLevel.create({ data: { organizationId: O, name: 'S3', order: 10 } });

  // Two parallel S3 classes (the cohort the result spine will split on).
  const classEast = await prisma.schoolClass.create({ data: { organizationId: O, campusId: campus.id, gradeLevelId: gl.id, name: 'S3 East' } });
  const classWest = await prisma.schoolClass.create({ data: { organizationId: O, campusId: campus.id, gradeLevelId: gl.id, name: 'S3 West' } });
  const secA = await prisma.section.create({ data: { organizationId: O, classId: classEast.id, name: 'A' } });

  // Subjects (UCE core).
  const subjectDefs = [
    { code: 'MAT', name: 'Mathematics', dept: 'Sciences' },
    { code: 'ENG', name: 'English', dept: 'Languages' },
    { code: 'PHY', name: 'Physics', dept: 'Sciences' },
    { code: 'BIO', name: 'Biology', dept: 'Sciences' },
    { code: 'CHEM', name: 'Chemistry', dept: 'Sciences' },
    { code: 'HIS', name: 'History', dept: 'Humanities' },
    { code: 'GEO', name: 'Geography', dept: 'Humanities' },
    { code: 'LUG', name: 'Luganda', dept: 'Languages' },
  ];
  const subjects = await Promise.all(
    subjectDefs.map((s) => prisma.subject.create({ data: { organizationId: O, code: s.code, name: s.name, departmentId: deptOf(s.dept), isCore: true } })),
  );
  const subj = (c: string) => subjects.find((s) => s.code === c)!;
  log(`subjects: ${subjects.map((s) => s.code).join(', ')}`);

  // Grading scale (UCE bands).
  const gradingScale = await prisma.gradingScale.create({
    data: {
      organizationId: O, name: 'UCE Default', isDefault: true,
      bands: [
        { min: 80, max: 100, grade: 'A', gpa: 4.0, remark: 'Distinction' },
        { min: 75, max: 79.99, grade: 'B', gpa: 3.5, remark: 'Credit' },
        { min: 65, max: 74.99, grade: 'C', gpa: 3.0, remark: 'Credit' },
        { min: 50, max: 64.99, grade: 'D', gpa: 2.0, remark: 'Pass' },
        { min: 0, max: 49.99, grade: 'F', gpa: 0.0, remark: 'Fail' },
      ],
    },
  });
  log('grading scale: UCE Default');

  const examType = await prisma.examType.create({ data: { organizationId: O, name: 'End-of-Term', weight: new Prisma.Decimal(60), isFinal: true } });

  // Teachers (StaffProfile + Partner).
  const teacherDefs = [
    { name: 'Mr. Okello Samuel', subj: 'MAT' },
    { name: 'Ms. Namuli Grace', subj: 'ENG' },
    { name: 'Mr. Kato David', subj: 'PHY' },
    { name: 'Mrs. Achiro Linda', subj: 'BIO' },
  ];
  const teachers: any[] = [];
  for (const t of teacherDefs) {
    const partner = await prisma.partner.create({ data: { organizationId: O, code: 'TCH-' + Math.floor(Math.random()*9000+1000), name: t.name, email: t.name.toLowerCase().replace(/[^a-z]/g, '.').slice(0, 30) + '@hilltop.ac.ug' } });
    const staff = await prisma.staffProfile.create({ data: { organizationId: O, partnerId: partner.id, employeeNo: 'T' + Math.floor(Math.random() * 9000 + 1000), joinDate: new Date('2024-01-15') } });
    teachers.push({ ...t, id: staff.id, partnerId: partner.id });
  }
  const teacherOf = (s: string) => teachers.find((t) => t.subj === s)!.id;
  const teacherPartnerOf = (s: string) => teachers.find((t) => t.subj === s)!.partnerId;
  log(`teachers: ${teachers.length} (Math/Eng/Phy/Bio)`);

  // Students (24 in S3 East, 20 in S3 West).
  const students: { id: string; name: string; classId: string; no: string }[] = [];
  const classes = [
    { id: classEast.id, n: 24, prefix: 'E' },
    { id: classWest.id, n: 20, prefix: 'W' },
  ];
  let counter = 0;
  for (const c of classes) {
    for (let i = 1; i <= c.n; i++) {
      counter++;
      const firstNames = ['John', 'Mary', 'Peter', 'Sarah', 'David', 'Agnes', 'Simon', 'Faith', 'Joseph', 'Rose', 'Daniel', 'Joy', 'Emmanuel', 'Patricia', 'Andrew', 'Esther', 'Moses', 'Grace', 'Robert', 'Naomi'];
      const lastNames = ['Mukasa', 'Nabbanja', 'Kiggundu', 'Nakato', 'Ssebudde', 'Nalubega', 'Wasswa', 'Namatovu', 'Kasule', 'Nakimuli'];
      const name = `${firstNames[counter % firstNames.length]} ${lastNames[(counter * 3) % lastNames.length]}`;
      const partner = await prisma.partner.create({ data: { organizationId: O, code: 'STU-' + String(counter).padStart(4, '0'), name, email: `s${counter}@hilltop.ac.ug` } });
      const sp = await prisma.studentProfile.create({
        data: {
          organizationId: O, partnerId: partner.id, admissionNo: `HTS/S3/${String(counter).padStart(3, '0')}`,
          currentClassId: c.id, currentSectionId: c.id === classEast.id ? secA.id : null,
          enrollmentDate: new Date('2025-02-03'), status: 'active', gender: counter % 2 ? 'M' : 'F',
          nationality: 'UG', residenceType: counter % 5 ? 'day' : 'boarder', house: counter % 2 ? 'Red' : 'Blue',
        },
      });
      students.push({ id: sp.id, name, classId: c.id, no: sp.admissionNo });
    }
  }
  ok(`students: ${students.length} across S3 East (24) + S3 West (20)`);

  // Enrollment rows (so promotion/rollover has history).
  await Promise.all(students.map((s) => prisma.enrollment.create({
    data: { organizationId: O, studentProfileId: s.id, termId: term.id, classId: s.classId, rollNumber: s.no.split('/').pop()!, enrolledAt: new Date('2026-05-04') },
  })));

  // ── SIS-10: the canonical enrollment spine ─────────────────────────────────
  //
  // The rows above are the LEGACY membership model, and for a long time they
  // were all this seed wrote — along with `StudentProfile.currentClassId`. That
  // left every freshly seeded database in the drifted state the enrollment work
  // exists to remove: `CourseOfferingService.syncRoster` resolves learners
  // through `EnrollmentPlacement` only, so a demo database produced empty
  // course rosters and any QA run exercised the legacy path alone.
  //
  // A seed has no Nest container, so it cannot call StudentEnrollmentService.
  // It writes the same rows that service would.
  const programme = await prisma.academicProgramme.create({
    data: {
      organizationId: O,
      code: 'SEC-O',
      name: 'Lower Secondary',
      stage: 'LOWER_SECONDARY',
      effectiveFrom: year.startDate,
    },
  });
  await prisma.programmeGradeLevel.create({
    // Unique on (organizationId, gradeLevelId): a grade level belongs to exactly
    // one programme, which is what makes programme resolution deterministic.
    data: { organizationId: O, programmeId: programme.id, gradeLevelId: gl.id },
  });

  const cohortByClassId = new Map<string, string>();
  for (const c of [classEast, classWest]) {
    const cohort = await prisma.classCohort.create({
      data: {
        organizationId: O,
        academicYearId: year.id,
        classId: c.id,
        programmeId: programme.id,
        capacity: 45,
      },
    });
    cohortByClassId.set(c.id, cohort.id);
  }

  for (const s of students) {
    const enrollment = await prisma.studentEnrollment.create({
      data: {
        organizationId: O,
        studentProfileId: s.id,
        academicYearId: year.id,
        programmeId: programme.id,
        gradeLevelId: gl.id,
        admissionDate: new Date('2025-02-03'),
        status: 'ACTIVE',
        enrollmentType: 'NEW',
      },
    });
    await prisma.enrollmentPlacement.create({
      data: {
        organizationId: O,
        enrollmentId: enrollment.id,
        termId: term.id,
        classCohortId: cohortByClassId.get(s.classId)!,
        sectionId: s.classId === classEast.id ? secA.id : null,
        rollNumber: s.no.split('/').pop()!,
        effectiveFrom: new Date('2026-05-04'),
        effectiveTo: null,
        movementReason: 'INITIAL_PLACEMENT',
      },
    });
  }
  ok(`canonical spine: 1 programme, ${cohortByClassId.size} cohorts, ${students.length} enrollments + placements`);

  // ── A2: Frozen academic roster for S3 East ──────────────────────────────────
  const roster = await prisma.academicRoster.create({
    data: { organizationId: O, termId: term.id, scopeType: 'class', classId: classEast.id, name: 'S3 East — Term 2 (frozen)', source: 'derived_current_class', capturedAt: new Date('2026-05-06'), frozenAt: new Date('2026-05-06'), frozenById: teacherPartnerOf('MAT') },
  });
  const eastStudents = students.filter((s) => s.classId === classEast.id);
  await Promise.all(eastStudents.map((s) => prisma.academicRosterMember.create({
    data: { organizationId: O, rosterId: roster.id, studentProfileId: s.id, classId: classEast.id, sectionId: secA.id, gradeLevelId: gl.id },
  })));
  log(`roster: S3 East frozen with ${eastStudents.length} members`);

  // ── A1: Assessment policy (40% CA / 60% exam) + 2 assessments w/ SoD marks ──
  const policy = await prisma.assessmentPolicy.create({
    data: {
      organizationId: O, name: 'S3 Default (40/60)', gradeLevelId: gl.id, passMark: D(50),
      roundingMode: 'half_up', decimalPlaces: 2, rankingPolicy: { tie: 'higher_grade_first', rankOn: 'meanPercent' }, aggregationPolicy: { ca: 'mean', exam: 'mean' },
    },
  });
  const compCA = await prisma.assessmentComponent.create({ data: { organizationId: O, policyId: policy.id, name: 'Continuous Assessment', kind: 'cat', weight: D(40), aggregation: 'mean' } });
  const compEX = await prisma.assessmentComponent.create({ data: { organizationId: O, policyId: policy.id, name: 'Final Exam', kind: 'exam', weight: D(60), aggregation: 'mean' } });

  const assessDefs = [
    { title: 'Mathematics CAT 2', subj: 'MAT', comp: compCA.id, teacher: 'MAT', max: 30, kind: 'cat' as const },
    { title: 'Physics Test 1', subj: 'PHY', comp: compCA.id, teacher: 'PHY', max: 30, kind: 'cat' as const },
    { title: 'English Composition', subj: 'ENG', comp: compCA.id, teacher: 'ENG', max: 30, kind: 'cat' as const },
  ];
  for (const a of assessDefs) {
    const assessment = await prisma.assessment.create({
      data: { organizationId: O, componentId: a.comp, subjectId: subj(a.subj).id, classId: classEast.id, termId: term.id, title: a.title, maxScore: D(a.max), kind: a.kind, status: 'graded' },
    });
    const klass = eastStudents;
    for (const st of klass) {
      const sa = await prisma.studentAssessment.create({
        data: { organizationId: O, assessmentId: assessment.id, studentProfileId: st.id, classId: classEast.id, sectionId: secA.id, gradeLevelId: gl.id, termId: term.id, status: 'graded', participation: 'present', maxScore: D(a.max), approvalStatus: 'approved' },
      });
      // Two markers → reconciliation (blind double-marking), then SoD approve.
      const m1 = Math.round(a.max * (0.55 + Math.random() * 0.4));
      const m2 = Math.min(a.max, Math.max(0, m1 + (Math.random() > 0.5 ? 2 : -2)));
      await prisma.markEntry.create({ data: { organizationId: O, studentAssessmentId: sa.id, markerId: teacherPartnerOf(a.teacher), round: 'first', score: D(m1) } });
      await prisma.markEntry.create({ data: { organizationId: O, studentAssessmentId: sa.id, markerId: teacherPartnerOf('BIO'), round: 'reconciliation', score: D(m2) } });
      await prisma.studentAssessment.update({ where: { id: sa.id }, data: { originalScore: D(m2), effectiveScore: D(m2), percentage: D((m2 / a.max) * 100).toDecimalPlaces(3) } });
    }
    log(`assessment: ${a.title} (${klass.length} marks, double-marked + approved)`);
  }

  // ── A2: Rubric + Assignment (publish fans out to StudentAssessment) ─────────
  const rubric = await prisma.rubric.create({ data: { organizationId: O, name: 'Essay Rubric v1', version: 1, description: '4-point analytic rubric' } });
  const crit = await prisma.rubricCriterion.create({ data: { organizationId: O, rubricId: rubric.id, name: 'Content', weight: D(50), maxScore: D(20) } });
  await prisma.rubricLevel.create({ data: { organizationId: O, criterionId: crit.id, label: 'Excellent', score: D(20), descriptor: 'Thorough, accurate' } });
  await prisma.rubricLevel.create({ data: { organizationId: O, criterionId: crit.id, label: 'Good', score: D(14), descriptor: 'Mostly accurate' } });
  await prisma.rubricLevel.create({ data: { organizationId: O, criterionId: crit.id, label: 'Weak', score: D(8), descriptor: 'Partial' } });

  const assignmentAssessment = await prisma.assessment.create({
    data: { organizationId: O, componentId: compCA.id, subjectId: subj('ENG').id, classId: classEast.id, termId: term.id, title: 'English Homework — Essay', maxScore: D(20), kind: 'project', sourceType: 'assignment', status: 'graded' },
  });
  const assignment = await prisma.assignment.create({
    data: { organizationId: O, assessmentId: assignmentAssessment.id, rosterId: roster.id, instructions: 'Write a 300-word essay on "My Community".', allowLate: true, latePenaltyPercent: D(10), maxAttempts: 1, gradingMode: 'rubric', rubricId: rubric.id, rubricVersion: 1 },
  });
  // Fan-out (mimics publish): StudentAssessment + a submission artefact per member.
  let submitted = 0, late = 0, missing = 0;
  for (const st of eastStudents) {
    const present = Math.random() > 0.12; // ~12% missing
    const sa = await prisma.studentAssessment.create({
      data: { organizationId: O, assessmentId: assignmentAssessment.id, studentProfileId: st.id, classId: classEast.id, sectionId: secA.id, gradeLevelId: gl.id, termId: term.id, status: present ? 'graded' : 'assigned', participation: present ? 'present' : 'absent', maxScore: D(20), approvalStatus: 'approved' },
    });
    if (present) {
      const isLate = Math.random() > 0.8; if (isLate) late++;
      const raw = Math.round(20 * (0.5 + Math.random() * 0.45));
      await prisma.assignmentSubmission.create({
        data: { organizationId: O, assignmentId: assignment.id, studentAssessmentId: sa.id, attemptNo: 1, submittedAt: isLate ? new Date('2026-05-30') : new Date('2026-05-20'), isLate, content: 'My community essay...', rawScore: D(raw), penaltyApplied: isLate ? D(Math.round(raw * 0.1)) : D(0), rubricSnapshot: { content: raw } },
      });
      await prisma.studentAssessment.update({ where: { id: sa.id }, data: { effectiveScore: D(raw), percentage: D((raw / 20) * 100).toDecimalPlaces(3) } });
      submitted++;
    } else missing++;
  }
  ok(`assignment: English Essay — ${submitted} submitted (${late} late), ${missing} missing`);

  // Legacy homework module (parallel module) for the demo.
  const hw = await prisma.homeworkAssignment.create({
    data: { organizationId: O, teacherPartnerId: teacherOf('MAT'), classId: classEast.id, sectionId: secA.id, subjectId: subj('MAT').id, termId: term.id, title: 'Algebra Set 3', description: 'Quadratics', dueDate: new Date('2026-05-25'), maxScore: D(20) },
  });
  const hwDone = eastStudents.slice(0, 18);
  for (const st of hwDone) {
    await prisma.homeworkSubmission.create({ data: { organizationId: O, assignmentId: hw.id, studentProfileId: st.id, submittedAt: new Date('2026-05-24'), content: 'Solutions attached', score: D(Math.round(20 * (0.6 + Math.random() * 0.35))), status: 'graded', feedback: 'Good work' } });
  }
  log(`homework (legacy): Algebra Set 3 — ${hwDone.length} submissions`);

  // ── A3: Published ResultSet + child results + report cards ──────────────────
  const run = await prisma.resultProcessingRun.create({
    data: { organizationId: O, termId: term.id, scopeType: 'class', scopeId: classEast.id, rosterId: roster.id, status: 'succeeded', calculationVersion: 'v1', inputChecksum: 'demo-seed', outputChecksum: 'demo-seed', completedAt: new Date() },
  });
  const resultSet = await prisma.resultSet.create({
    data: {
      organizationId: O, runId: run.id, termId: term.id, scopeType: 'class', scopeId: classEast.id, rosterId: roster.id,
      revision: 1, status: 'published', calculationVersion: 'v1', gradingSystem: 'UCE',
      policySnapshot: { passMark: 50, weights: { ca: 40, exam: 60 } } as any, gradingScaleSnapshot: gradingScale.bands as any,
      rankingPolicySnapshot: { rankOn: 'meanPercent' }, aggregationSnapshot: { ca: 'mean', exam: 'mean' },
      studentCount: eastStudents.length, publishedAt: new Date(), publishedById: teacherPartnerOf('MAT'),
    },
  });

  // Per-student: 6 subject results + a term result (computed-ish).
  for (const st of eastStudents) {
    let total = D(0); let count = 0; let subjectsPassed = 0;
    const subjCodes = ['MAT', 'ENG', 'PHY', 'BIO', 'HIS', 'GEO'];
    for (const code of subjCodes) {
      const ca = D(40 * (0.5 + Math.random() * 0.45));
      const ex = D(60 * (0.45 + Math.random() * 0.5));
      const final = ca.add(ex);
      const pct = final.toDecimalPlaces(2);
      const grade = final.gte(80) ? 'A' : final.gte(75) ? 'B' : final.gte(65) ? 'C' : final.gte(50) ? 'D' : 'F';
      const passed = final.gte(50); if (passed) subjectsPassed++;
      await prisma.studentSubjectResult.create({
        data: { organizationId: O, resultSetId: resultSet.id, studentProfileId: st.id, subjectId: subj(code).id, classId: classEast.id, sectionId: secA.id, gradeLevelId: gl.id, termId: term.id, caScore: ca.toDecimalPlaces(3), examScore: ex.toDecimalPlaces(3), finalPercent: final.toDecimalPlaces(3), grade, gradePoint: D(final.gte(80) ? 4 : final.gte(75) ? 3.5 : final.gte(65) ? 3 : final.gte(50) ? 2 : 0), points: null, subjectRank: null, componentBreakdown: [{ ca: +ca.toFixed(2), exam: +ex.toFixed(2) }] },
      });
      total = total.add(final); count++;
    }
    const mean = total.div(count).toDecimalPlaces(3);
    const eligible = subjectsPassed >= 5;
    const rec = subjectsPassed === 6 ? 'promote' : subjectsPassed >= 5 ? 'promote' : subjectsPassed >= 3 ? 'repeat' : 'review';
    await prisma.studentTermResult.create({
      data: { organizationId: O, resultSetId: resultSet.id, studentProfileId: st.id, classId: classEast.id, sectionId: secA.id, gradeLevelId: gl.id, termId: term.id, meanPercent: mean, gpa: mean.div(25).toDecimalPlaces(2), subjectsCount: count, eligible, promotionRecommendation: rec, classRank: null },
    });
    // Report card (payload mirrors what the report-card generator emits).
    await prisma.reportCard.create({
      data: { organizationId: O, studentProfileId: st.id, termId: term.id, generatedAt: new Date(), publishedAt: new Date(), payload: { student: st.name, admissionNo: st.no, class: 'S3 East', meanPercent: +mean.toString(), grade: rec, subjectResults: subjCodes.length } },
    });
  }
  // Class ranks (after means known).
  const termResults = await prisma.studentTermResult.findMany({ where: { resultSetId: resultSet.id }, orderBy: { meanPercent: 'desc' } });
  for (let i = 0; i < termResults.length; i++) {
    await prisma.studentTermResult.update({ where: { id: termResults[i].id }, data: { classRank: i + 1 } });
  }
  ok(`result spine: published ResultSet rev 1 — ${eastStudents.length} students, report cards generated, ranks assigned`);

  // ── A4: Exam + venue + registrations + seating ─────────────────────────────
  const exam = await prisma.exam.create({
    data: { organizationId: O, termId: term.id, examTypeId: examType.id, name: 'End-of-Term 2 Examination', startDate: new Date('2026-07-20'), endDate: new Date('2026-08-05'), status: 'scheduled' },
  });
  const venue = await prisma.examVenue.create({ data: { organizationId: O, campusId: campus.id, name: 'Hall A', code: 'HALL-A', capacity: 60 } });
  // ExamSchedule + GradeEntry-style coverage (paper per subject/class).
  for (const code of ['MAT', 'ENG', 'PHY']) {
    await prisma.examSchedule.create({
      data: { organizationId: O, examId: exam.id, classId: classEast.id, subjectId: subj(code).id, date: new Date('2026-07-22'), startTime: '09:00', durationMinutes: 120, maxMarks: D(100), paperNumber: 1, sitting: 'morning', venueId: venue.id },
    });
  }
  // Registrations + seat allocation.
  let seat = 1;
  for (const st of eastStudents) {
    const status = Math.random() > 0.96 ? 'absent' : 'sat';
    await prisma.examRegistration.create({
      data: { organizationId: O, examId: exam.id, studentProfileId: st.id, classId: classEast.id, venueId: venue.id, seatNumber: `A${String(seat++).padStart(2, '0')}`, status },
    });
  }
  ok(`exam ops: End-of-Term 2 — venue Hall A, ${eastStudents.length} registrations seated`);

  // ── A5: CBT question bank + paper + attempt (server-authoritative) ──────────
  const bank = await prisma.questionBank.create({ data: { organizationId: O, name: 'Mathematics Formative Bank', subjectId: subj('MAT').id } });
  const qText = [
    { prompt: 'What is 7 × 8?', type: 'numeric' as const, answerKey: { value: 56, tolerance: 0 }, marks: 2 },
    { prompt: 'Which is a prime number?', type: 'mcq_single' as const, answerKey: {}, marks: 2, options: [{ label: '9', isCorrect: false }, { label: '11', isCorrect: true }, { label: '15', isCorrect: false }, { label: '21', isCorrect: false }] },
    { prompt: 'State the Pythagorean theorem.', type: 'short_answer' as const, answerKey: {}, marks: 3 },
  ];
  const questions = [];
  for (const q of qText) {
    const question = await prisma.question.create({ data: { organizationId: O, bankId: bank.id, type: q.type, prompt: q.prompt, marks: D(q.marks), answerKey: q.answerKey ?? {} , tags: ['formative'], difficulty: 'easy' } });
    if (q.options) {
      for (const o of q.options) await prisma.questionOption.create({ data: { organizationId: O, questionId: question.id, label: o.label, isCorrect: o.isCorrect } });
    }
    questions.push({ id: question.id, marks: q.marks });
  }
  const paper = await prisma.paper.create({ data: { organizationId: O, name: 'Math Quick Quiz 1', subjectId: subj('MAT').id, totalMarks: D(7), durationMinutes: 20 } });
  for (let i = 0; i < questions.length; i++) {
    await prisma.paperQuestion.create({ data: { organizationId: O, paperId: paper.id, questionId: questions[i].id, order: i, marks: D(questions[i].marks) } });
  }
  // One submitted attempt with frozen realised set + responses + proctoring event.
  const attemptStudent = eastStudents[0];
  const realised = questions.map((q, i) => ({ questionId: q.id, order: i, marks: q.marks }));
  const attempt = await prisma.quizAttempt.create({
    data: { organizationId: O, paperId: paper.id, studentProfileId: attemptStudent.id, attemptNumber: 1, status: 'submitted', startedAt: new Date(Date.now() - 600000), expiresAt: new Date(Date.now() + 1140000), submittedAt: new Date(), realisedQuestions: realised, autoScore: D(4), manualPending: 1, maxScore: D(7), serverSequence: 1 },
  });
  await prisma.quizResponse.create({ data: { organizationId: O, attemptId: attempt.id, questionId: questions[0].id, clientEventId: 'q0-1', sequenceNumber: 1, response: { value: 56 }, autoScore: D(2), isCorrect: true } });
  await prisma.quizResponse.create({ data: { organizationId: O, attemptId: attempt.id, questionId: questions[1].id, clientEventId: 'q1-1', sequenceNumber: 1, response: { optionId: (await prisma.questionOption.findFirstOrThrow({ where: { questionId: questions[1].id, isCorrect: true } })).id }, autoScore: D(2), isCorrect: true } });
  await prisma.attemptEvent.create({ data: { organizationId: O, attemptId: attempt.id, type: 'start', payload: { at: new Date(Date.now() - 600000) } } });
  await prisma.attemptEvent.create({ data: { organizationId: O, attemptId: attempt.id, type: 'submit', payload: { at: new Date() } } });
  ok(`CBT: ${questions.length}-question bank, fixed paper, 1 attempt auto-marked (4/7)`);

  // ── A6: Transcript + UNEB external result + certificate(s) ─────────────────
  await prisma.academicTranscript.create({
    data: { organizationId: O, studentProfileId: attemptStudent.id, generatedAt: new Date(), payload: { holderName: attemptStudent.name, cumulativeGpa: 3.1, terms: ['Term 1', 'Term 2'] } },
  });
  const leaver = eastStudents[eastStudents.length - 1];
  await prisma.externalExamResult.create({
    data: { organizationId: O, studentProfileId: leaver.id, board: 'UNEB', level: 'UCE', indexNumber: 'UCE' + Math.floor(Math.random() * 900000 + 100000), year: 2025, aggregate: 18, division: 'I', verified: true, importedPayload: { source: 'UNEB' },
      subjects: { create: [{ organizationId: O, subject: 'Mathematics', grade: '1', mark: '78', result: 'DIST' }, { organizationId: O, subject: 'English', grade: '2', mark: '71', result: 'CRED' }] } },
  });
  // Issued certificate (serial via the app's PG sequence + crypto verification code).
  const serial = await nextSerial('certificate', 'CERT-', 6);
  const code = randomBytes(8).toString('hex');
  const cert = await prisma.certificate.create({
    data: { organizationId: O, studentProfileId: attemptStudent.id, type: 'completion', status: 'issued', serialNumber: serial, verificationCode: code, title: 'Certificate of Completion — S3 Term 2', payload: { holderName: attemptStudent.name, term: 'Term 2', year: '2026' }, issuedAt: new Date() },
  });
  // A revoked certificate (demonstrates lifecycle).
  const serial2 = await nextSerial('certificate', 'CERT-', 6);
  await prisma.certificate.create({
    data: { organizationId: O, studentProfileId: leaver.id, type: 'merit', status: 'revoked', serialNumber: serial2, verificationCode: randomBytes(8).toString('hex'), title: 'Merit Award (superseded)', payload: { holderName: leaver.name }, issuedAt: new Date(Date.now() - 86400000), revokedAt: new Date(), revokeReason: 'Error in issuing authority' },
  });
  ok(`certification: transcript + UNEB UCE (agg 18, Div I) + cert ${serial} [verify ${code.slice(0, 8)}…] + 1 revoked`);

  // ── Library (real Borrowing rows) ──────────────────────────────────────────
  const books = [
    { isbn: '9780195737872', title: 'New Progressive Mathematics S3', author: 'K. M. Mutumba', category: 'textbook', shelf: 'MATH-03' },
    { isbn: '9780195737889', title: 'Understanding English Grammar', author: 'J. A. Odongo', category: 'textbook', shelf: 'ENG-02' },
    { isbn: '9780195737896', title: 'Integrated Science for Uganda', author: 'P. K. Ssali', category: 'reference', shelf: 'SCI-01' },
  ];
  const bookMetas = [];
  for (const b of books) {
    const product = await prisma.product.create({ data: { organizationId: O, code: 'BK-' + b.isbn.slice(-6), name: b.title, sku: 'BK-' + b.isbn.slice(-6), productType: 'stockable', salesPrice: D(25000) } });
    const meta = await prisma.bookMetadata.create({ data: { organizationId: O, productId: product.id, author: b.author, isbn: b.isbn, category: b.category, shelfLocation: b.shelf } });
    const copy = await prisma.bookCopy.create({ data: { organizationId: O, bookMetadataId: meta.id, copyNumber: 'C1', status: 'available' } });
    bookMetas.push({ meta, copy, title: b.title });
  }
  // Give ~10 students a borrowing each (mix returned / borrowed / overdue).
  const borrowers = students.slice(0, 10);
  for (let i = 0; i < borrowers.length; i++) {
    const { meta, copy, title } = bookMetas[i % bookMetas.length];
    const borrowedAt = new Date(Date.now() - (10 + i * 3) * 86400000);
    const dueAt = new Date(borrowedAt.getTime() + 14 * 86400000);
    const returned = i % 3 !== 0; // ~3 overdue
    const status = returned ? 'returned' : (dueAt < new Date() ? 'overdue' : 'borrowed');
    const copyStatus = returned ? 'available' : 'borrowed';
    await prisma.bookCopy.updateMany({ where: { id: copy.id }, data: { status: copyStatus } });
    await prisma.borrowing.create({
      data: {
        organizationId: O, bookMetadataId: meta.id, bookCopyId: copy.id, studentProfileId: borrowers[i].id,
        borrowedAt, dueAt, returnedAt: returned ? new Date(dueAt.getTime() - 2 * 86400000) : null, status,
        fineAmount: status === 'overdue' ? D(Math.ceil((Date.now() - dueAt.getTime()) / 86400000) * 200) : D(0),
        notes: `${title} borrowed`,
      },
    });
  }
  ok(`library: ${books.length} books + ${borrowers.length} borrowings (some returned, some overdue)`);

  // ── Meals (real MealAccount + ledger) ───────────────────────────────────────
  const mealPlan = await prisma.mealPlan.create({
    data: { organizationId: O, name: 'Term Meal Plan (Full Board)', type: 'full', pricePerTerm: D(450000) },
  });
  // Give every boarder a wallet; top up + a few purchases → realistic balance.
  const boarders = students.filter((s) => s.classId && true).slice(0, 12);
  for (const st of boarders) {
    const account = await prisma.mealAccount.create({ data: { organizationId: O, studentProfileId: st.id, mealPlanId: mealPlan.id, balance: D(0) } });
    const topUp = D(200000);
    const balanceAfter = topUp;
    await prisma.mealAccountTransaction.create({ data: { organizationId: O, mealAccountId: account.id, type: 'top_up', amount: topUp, balanceAfter, recordedById: teacherPartnerOf('MAT') } });
    // 3 purchases of varying size.
    let bal = balanceAfter;
    for (const amt of [8000, 6500, 9000]) {
      const a = D(amt); bal = bal.minus(a);
      await prisma.mealAccountTransaction.create({ data: { organizationId: O, mealAccountId: account.id, type: 'purchase', amount: a.negated(), balanceAfter: bal, notes: 'Cafeteria meal', recordedById: teacherPartnerOf('MAT') } });
    }
    await prisma.mealAccount.updateMany({ where: { id: account.id }, data: { balance: bal } });
  }
  ok(`meals: meal plan + ${boarders.length} student wallets funded & spent`);

  // ── Transport (real StudentTransportAssignment) ────────────────────────────
  const route = await prisma.route.create({ data: { organizationId: O, name: 'Kampala–Nakasero', monthlyFee: D(120000) } });
  // A Stop is now a standalone place (T1): ordering/timing live on TransportRouteStop.
  const stop = await prisma.stop.create({ data: { organizationId: O, code: 'NAKASERO-STAGE', name: 'Nakasero Stage' } });
  const transporters = students.slice(12, 24); // a different cohort
  for (const st of transporters) {
    await prisma.studentTransportAssignment.create({
      data: { organizationId: O, studentProfileId: st.id, routeId: route.id, stopId: stop.id, pickupStopId: stop.id, dropoffStopId: stop.id, termId: term.id, startDate: new Date('2026-05-04'), monthlyFee: D(120000), status: 'active' },
    });
  }
  ok(`transport: route + ${transporters.length} student bus assignments`);

  // ── Behavior / Communication / Activities via Activity (subjectType='student') ─
  let behaviorCount = 0, commsCount = 0, activityCount = 0;
  for (const st of students) {
    // Behavior: 1-2 merit/demerit notes per student.
    const notes = [
      { type: 'note' as const, title: 'Consistent class participation', body: 'Praised for answering questions in Mathematics.' },
      ...(Math.random() > 0.7 ? [{ type: 'note' as const, title: 'Late to class', body: 'Arrived 10 minutes late to Period 1.' }] : []),
    ];
    for (const n of notes) {
      await prisma.activity.create({ data: { organizationId: O, type: n.type, subjectType: 'student', subjectId: st.id, title: n.title, body: n.body, occurredAt: new Date(Date.now() - Math.floor(Math.random() * 30) * 86400000) } });
      behaviorCount++;
    }
    // Communication: an SMS + a call log to the guardian.
    await prisma.activity.create({ data: { organizationId: O, type: 'email', subjectType: 'student', subjectId: st.id, title: 'Fee reminder SMS sent', body: 'Automated balance reminder dispatched to guardian.', occurredAt: new Date(Date.now() - 5 * 86400000) } });
    await prisma.activity.create({ data: { organizationId: O, type: 'call', subjectType: 'student', subjectId: st.id, title: 'Guardian call — academic progress', body: 'Discussed Term 2 performance.', duration: 8, occurredAt: new Date(Date.now() - 12 * 86400000) } });
    commsCount += 2;
    // Activities: club + sport participation.
    const clubs = ['Debate Club', 'Science Club', 'Music Society', 'Drama Club'];
    const club = clubs[Math.floor(Math.random() * clubs.length)];
    await prisma.activity.create({ data: { organizationId: O, type: 'task', subjectType: 'student', subjectId: st.id, title: `Joined ${club}`, body: `Active member of ${club}.`, occurredAt: new Date('2026-05-10'), completed: true } });
    activityCount++;
  }
  ok(`activities log: ${behaviorCount} behavior notes, ${commsCount} comms, ${activityCount} co-curricular (shared Activity store)`);

  // ── Per-student sample data so EVERY Student 360 tab shows content ──────────
  const currency = await prisma.currency.findUniqueOrThrow({ where: { code: 'UGX' } });
  const feeDocType = await prisma.documentTypeDef.upsert({
    where: { code: 'SCHOOL_FEE_INV' },
    update: { name: 'School Fee Invoice', category: 'school' },
    create: { code: 'SCHOOL_FEE_INV', name: 'School Fee Invoice', category: 'school', isSystem: false },
  });

  const firstNamesG = ['James', 'Florence', 'Robert', 'Gladys', 'William', 'Aida', 'Charles', 'Rose', 'George', 'Beatrice'];
  const rels = ['father', 'mother', 'uncle', 'aunt', 'guardian', 'grandparent'];

  for (const st of students) {
    const sp = await prisma.studentProfile.findUniqueOrThrow({ where: { id: st.id }, include: { partner: true } });
    const last = (sp.partner.name.split(' ')[1] ?? 'Parent');

    // Profile customFields (DOB, nationality, religion, emergency, siblings).
    await prisma.studentProfile.update({
      where: { id: st.id },
      data: {
        customFields: {
          dateOfBirth: '2009-' + String(1 + (counter % 12)).padStart(2, '0') + '-' + String(1 + (counter % 27)).padStart(2, '0'),
          nationality: 'Ugandan',
          religion: ['Christianity', 'Islam', 'Christianity'][counter % 3],
          emergencyContact: `+256-7${String(10000000 + counter * 12345).slice(0, 8)} (${last} Family)`,
          siblings: String(counter % 4),
          house: sp.house,
        } as any,
      },
    });

    // Guardians: 1 primary + a second ~50% of the time.
    const g1Rel = counter % 2 ? 'mother' : 'father';
    const g1FirstName = counter % 2 ? firstNamesG[counter % firstNamesG.length] : 'Mr. ' + last;
    const contact1 = await prisma.contact.create({
      data: { organizationId: O, partnerId: sp.partnerId, firstName: g1FirstName, lastName: last, email: `guardian${counter}@hilltop.ac.ug`, phone: `+256-7${String(20000000 + counter * 321).slice(0, 8)}` },
    });
    await prisma.studentGuardian.create({ data: { organizationId: O, studentProfileId: st.id, guardianContactId: contact1.id, relationship: g1Rel, isPrimary: true, canPickup: true, receivesStatements: true } });
    if (counter % 2 === 0) {
      const contact2 = await prisma.contact.create({
        data: { organizationId: O, partnerId: sp.partnerId, firstName: 'Mr. ' + last, lastName: last, email: `guardian2_${counter}@hilltop.ac.ug`, phone: `+256-7${String(30000000 + counter * 211).slice(0, 8)}` },
      });
      await prisma.studentGuardian.create({ data: { organizationId: O, studentProfileId: st.id, guardianContactId: contact2.id, relationship: rels[counter % rels.length], isPrimary: false, canPickup: true, receivesStatements: false } });
    }

    // Attendance: ~40 school days up to today (mostly present, some late/absent).
    for (let d = 0; d < 40; d++) {
      const date = new Date(Date.now() - d * 86400000);
      if (date.getDay() === 0 || date.getDay() === 6) continue; // skip weekends
      const r = Math.random();
      const status = r > 0.9 ? 'absent' : r > 0.82 ? 'late' : 'present';
      await prisma.studentAttendance.create({
        data: { organizationId: O, studentProfileId: st.id, classId: st.classId, sectionId: st.classId === classEast.id ? secA.id : null, date, status, minutesLate: status === 'late' ? 5 + (counter % 10) : 0, markedById: teacherPartnerOf('MAT') },
      });
    }

    // Health: medical record.
    const bg = ['O+', 'A+', 'B+', 'AB+', 'O-'][counter % 5];
    await prisma.medicalRecord.create({
      data: {
        organizationId: O, studentProfileId: st.id, bloodGroup: bg,
        allergies: (counter % 5 === 0 ? ['Peanuts'] : []) as any,
        conditions: (counter % 7 === 0 ? ['Mild asthma'] : []) as any,
        medications: [] as any,
        emergencyNotes: `Carry inhaler if needed. Emergency: ${last} Family.`,
        doctorName: 'Dr. Okello', doctorPhone: '+256-414-555001',
      },
    });

    // Documents: birth certificate + report card (each needs a File row).
    for (const doc of [
      { type: 'birth_cert', title: 'Birth Certificate' },
      { type: 'report_card', title: 'Term 1 Report Card' },
    ]) {
      const file = await prisma.file.create({
        data: { organizationId: O, filename: doc.title + '.pdf', contentType: 'application/pdf', byteSize: 12345, storageKey: `doc-${st.id}-${doc.type}-${counter}` },
      });
      await prisma.studentDocument.create({
        data: { organizationId: O, studentProfileId: st.id, type: doc.type, title: doc.title, fileId: file.id, verified: counter % 3 !== 0, verifiedAt: counter % 3 !== 0 ? new Date() : null },
      });
    }

    // Fees: a school-fee invoice (partial) + a payment.
    const total = D(450000);
    const paid = D(300000);
    const invNo = `FEE-${String(counter).padStart(4, '0')}`;
    await prisma.document.create({
      data: {
        organizationId: O, documentTypeId: feeDocType.id, documentType: 'sales_invoice', documentNumber: invNo,
        partnerId: sp.partnerId, currencyId: currency.id, issueDate: new Date('2026-02-05'), dueDate: new Date('2026-03-05'),
        status: 'posted', subtotal: total, totalAmount: total, amountPaid: paid, amountResidual: total.minus(paid),
        paymentStatus: 'partial', sourceType: 'school_fee', notes: 'Term 2 school fees', version: 1,
      },
    });
    await prisma.payment.create({
      data: { organizationId: O, paymentNumber: `PAY-${String(counter).padStart(4, '0')}`, direction: 'inbound', partnerId: sp.partnerId, paymentDate: new Date('2026-02-10'), paymentMethod: 'mobile_money', currencyId: currency.id, amount: paid, allocatedAmount: paid, unallocatedAmount: D(0), status: 'posted', reference: 'MTN-' + String(counter) },
    });
  }
  ok(`per-student: guardians, 40-day attendance, medical, 2 documents, fee invoice + payment (×${students.length})`);

  // ── Extend result spine + homework to S3 West so Academics/Assessments fill for all ──
  const westStudents = students.filter((s) => s.classId === classWest.id);
  const rosterWest = await prisma.academicRoster.create({
    data: { organizationId: O, termId: term.id, scopeType: 'class', classId: classWest.id, name: 'S3 West — Term 2 (frozen)', source: 'derived_current_class', capturedAt: new Date('2026-05-06'), frozenAt: new Date('2026-05-06'), frozenById: teacherPartnerOf('ENG') },
  });
  await Promise.all(westStudents.map((s) => prisma.academicRosterMember.create({
    data: { organizationId: O, rosterId: rosterWest.id, studentProfileId: s.id, classId: classWest.id, gradeLevelId: gl.id },
  })));
  const resultSetWest = await prisma.resultSet.create({
    data: {
      organizationId: O, runId: run.id, termId: term.id, scopeType: 'class', scopeId: classWest.id, rosterId: rosterWest.id,
      revision: 1, status: 'published', calculationVersion: 'v1', gradingSystem: 'UCE',
      policySnapshot: { passMark: 50, weights: { ca: 40, exam: 60 } } as any, gradingScaleSnapshot: gradingScale.bands as any,
      rankingPolicySnapshot: { rankOn: 'meanPercent' }, aggregationSnapshot: { ca: 'mean', exam: 'mean' },
      studentCount: westStudents.length, publishedAt: new Date(), publishedById: teacherPartnerOf('ENG'),
    },
  });
  for (const st of westStudents) {
    let total = D(0); let count = 0; let passed = 0;
    for (const code of ['MAT', 'ENG', 'PHY', 'BIO', 'HIS', 'GEO']) {
      const ca = D(40 * (0.5 + Math.random() * 0.45));
      const ex = D(60 * (0.45 + Math.random() * 0.5));
      const final = ca.add(ex);
      const grade = final.gte(80) ? 'A' : final.gte(75) ? 'B' : final.gte(65) ? 'C' : final.gte(50) ? 'D' : 'F';
      if (final.gte(50)) passed++;
      await prisma.studentSubjectResult.create({
        data: { organizationId: O, resultSetId: resultSetWest.id, studentProfileId: st.id, subjectId: subj(code).id, classId: classWest.id, gradeLevelId: gl.id, termId: term.id, caScore: ca.toDecimalPlaces(3), examScore: ex.toDecimalPlaces(3), finalPercent: final.toDecimalPlaces(3), grade, gradePoint: D(final.gte(80) ? 4 : final.gte(75) ? 3.5 : final.gte(65) ? 3 : final.gte(50) ? 2 : 0), componentBreakdown: [{ ca: +ca.toFixed(2), exam: +ex.toFixed(2) }] },
      });
      total = total.add(final); count++;
    }
    const mean = total.div(count).toDecimalPlaces(3);
    await prisma.studentTermResult.create({
      data: { organizationId: O, resultSetId: resultSetWest.id, studentProfileId: st.id, classId: classWest.id, gradeLevelId: gl.id, termId: term.id, meanPercent: mean, gpa: mean.div(25).toDecimalPlaces(2), subjectsCount: count, eligible: passed >= 5, promotionRecommendation: passed >= 5 ? 'promote' : 'repeat', classRank: null },
    });
    await prisma.reportCard.create({
      data: { organizationId: O, studentProfileId: st.id, termId: term.id, generatedAt: new Date(), publishedAt: new Date(), payload: { student: st.name, admissionNo: st.no, class: 'S3 West', meanPercent: +mean.toString(), grade: passed >= 5 ? 'promote' : 'repeat', subjectResults: 6 } },
    });
  }
  const westResults = await prisma.studentTermResult.findMany({ where: { resultSetId: resultSetWest.id }, orderBy: { meanPercent: 'desc' } });
  for (let i = 0; i < westResults.length; i++) await prisma.studentTermResult.update({ where: { id: westResults[i].id }, data: { classRank: i + 1 } });
  // Homework assignment for S3 West (feeds the Assessments tab).
  const hwWest = await prisma.homeworkAssignment.create({
    data: { organizationId: O, teacherPartnerId: teacherOf('ENG'), classId: classWest.id, subjectId: subj('ENG').id, termId: term.id, title: 'Essay — My Community (West)', description: '300 words', dueDate: new Date('2026-05-25'), maxScore: D(20) },
  });
  for (const st of westStudents.slice(0, 16)) {
    await prisma.homeworkSubmission.create({ data: { organizationId: O, assignmentId: hwWest.id, studentProfileId: st.id, submittedAt: new Date('2026-05-24'), content: 'Submitted', score: D(Math.round(20 * (0.6 + Math.random() * 0.35))), status: 'graded', feedback: 'Good' } });
  }
  ok(`result spine + homework extended to S3 West (${westStudents.length} students) → Academics/Assessments populate for all`);

  console.log('\n\x1b[32m✅ School demo seed complete (A0–A8 + full Student 360 sample data for every student).\x1b[0m');
  console.log('   Open the web app → School → Students → click a student → 360° profile (all 14 tabs populated).\n');
}

main()
  .catch((e) => { console.error('\x1b[31mSeed failed:\x1b[0m', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
