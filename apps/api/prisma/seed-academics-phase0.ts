/**
 * Phase 0 mixed Uganda-school fixture.
 *
 * Adds deterministic edge cases to an existing organization without deleting
 * data. It intentionally uses today's schema; gaps (for example a school-wide
 * competency cannot yet own a typed offering) are recorded in the seed summary
 * and are inputs to Phase 1/2, not papered over with orphan assessments.
 *
 * Run after the base seed:
 *   pnpm --filter @erp/api db:seed:academics-phase0
 */
import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const D = (value: number) => new Prisma.Decimal(value);
const orgCode = process.env.ACADEMIC_SEED_ORG_CODE ?? 'DEMO';

async function main() {
  const org = await db.organization.findUnique({ where: { code: orgCode } });
  if (!org) throw new Error(`Organization ${orgCode} does not exist; run the base seed first.`);
  const organizationId = org.id;

  const year = await db.academicYear.upsert({
    where: { organizationId_name: { organizationId, name: '2026 Phase 0' } },
    update: {},
    create: { organizationId, name: '2026 Phase 0', startDate: new Date('2026-02-02'), endDate: new Date('2026-11-27') },
  });
  let term = await db.term.findFirst({ where: { organizationId, academicYearId: year.id, name: 'Term 2' } });
  term ??= await db.term.create({ data: { organizationId, academicYearId: year.id, name: 'Term 2', startDate: new Date('2026-05-04'), endDate: new Date('2026-08-07') } });

  const gradeNames = ['P1', 'P3', 'P5', 'P7', 'S1', 'S3', 'S4', 'S6'];
  const classes = new Map<string, { id: string }>();
  for (const [index, name] of gradeNames.entries()) {
    const grade = await db.gradeLevel.upsert({
      where: { organizationId_name: { organizationId, name } }, update: {},
      create: { organizationId, name, order: index + 1 },
    });
    const schoolClass = await db.schoolClass.upsert({
      where: { organizationId_name: { organizationId, name: `${name} Phase 0` } }, update: {},
      create: { organizationId, gradeLevelId: grade.id, name: `${name} Phase 0`, capacity: 45 },
    });
    classes.set(name, schoolClass);
    await db.section.upsert({
      where: { organizationId_classId_name: { organizationId, classId: schoolClass.id, name: 'A' } }, update: {},
      create: { organizationId, classId: schoolClass.id, name: 'A' },
    });
    if (['P5', 'S3'].includes(name)) {
      await db.stream.upsert({
        where: { organizationId_classId_name: { organizationId, classId: schoolClass.id, name: 'Blue' } }, update: {},
        create: { organizationId, classId: schoolClass.id, name: 'Blue' },
      });
    }
  }

  async function learner(key: string, name: string, grade: string, status: 'active' | 'withdrawn' = 'active', effectiveDate = '2026-05-04') {
    const code = `P0-${key}`;
    const partner = await db.partner.upsert({
      where: { organizationId_code: { organizationId, code } },
      update: { name }, create: { organizationId, code, name },
    });
    const classId = classes.get(grade)!.id;
    const profile = await db.studentProfile.upsert({
      where: { organizationId_admissionNo: { organizationId, admissionNo: code } },
      update: {},
      create: { organizationId, partnerId: partner.id, admissionNo: code, currentClassId: status === 'active' ? classId : null, enrollmentDate: new Date(effectiveDate), status, customFields: { phase0Scenario: key } },
    });
    const enrollment = await db.enrollment.upsert({
      where: { organizationId_studentProfileId_termId: { organizationId, studentProfileId: profile.id, termId: term!.id } },
      update: {},
      create: { organizationId, studentProfileId: profile.id, classId, termId: term!.id, rollNumber: key, effectiveDate: new Date(effectiveDate), status: status === 'withdrawn' ? 'withdrawn' : 'enrolled', endedAt: status === 'withdrawn' ? new Date('2026-06-20') : null, endReason: status === 'withdrawn' ? 'Phase 0 withdrawal scenario' : null },
    });
    return { profile, enrollment, classId };
  }

  const regular = await learner('REGULAR', 'Amina Nakato', 'P5');
  await learner('LATE', 'Brian Okello', 'P3', 'active', '2026-06-15');
  const transferred = await learner('TRANSFER', 'Claire Namusoke', 'S3');
  const repeater = await learner('REPEATER', 'Daniel Sserwanga', 'S4');
  await learner('WITHDRAWN', 'Esther Atim', 'S1', 'withdrawn');
  await db.enrollmentHistory.createMany({
    data: [
      { organizationId, enrollmentId: transferred.enrollment.id, fromStatus: 'enrolled', toStatus: 'enrolled', reason: 'Transferred into S3 Phase 0 mid-term' },
      { organizationId, enrollmentId: repeater.enrollment.id, fromStatus: 'completed', toStatus: 'enrolled', reason: 'Repeating S4 by promotion decision' },
    ],
    skipDuplicates: true,
  });

  const subject = await db.subject.upsert({
    where: { organizationId_code: { organizationId, code: 'P0-MAT' } }, update: {},
    create: { organizationId, code: 'P0-MAT', name: 'Phase 0 Mathematics', isCore: true },
  });
  const p5 = classes.get('P5')!;
  let curriculum = await db.curriculum.findFirst({ where: { organizationId, classId: p5.id, academicYearId: year.id, version: 1 } });
  curriculum ??= await db.curriculum.create({ data: { organizationId, classId: p5.id, academicYearId: year.id, name: 'P5 Phase 0 Curriculum', version: 1, status: 'published', publishedAt: new Date('2026-02-01') } });
  await db.curriculumSubject.upsert({
    where: { curriculumId_subjectId: { curriculumId: curriculum.id, subjectId: subject.id } }, update: {},
    create: { organizationId, curriculumId: curriculum.id, subjectId: subject.id, isCore: true },
  });

  async function teacher(key: string, name: string) {
    const partner = await db.partner.upsert({ where: { organizationId_code: { organizationId, code: `P0-T-${key}` } }, update: { name }, create: { organizationId, code: `P0-T-${key}`, name } });
    return db.staffProfile.upsert({ where: { partnerId: partner.id }, update: {}, create: { organizationId, partnerId: partner.id, employeeNo: `P0-T-${key}`, joinDate: new Date('2025-01-10') } });
  }
  const lead = await teacher('LEAD', 'Ms Grace Nanyonga');
  const assistant = await teacher('ASSIST', 'Mr Peter Ouma');
  let offering = await db.courseOffering.findFirst({ where: { organizationId, academicYearId: year.id, termId: term.id, subjectId: subject.id, classId: p5.id, sectionId: null } });
  offering ??= await db.courseOffering.create({ data: { organizationId, academicYearId: year.id, termId: term.id, subjectId: subject.id, classId: p5.id, curriculumId: curriculum.id } });
  await db.courseOfferingTeacher.createMany({ data: [
    { organizationId, courseOfferingId: offering.id, teacherPartnerId: lead.id, role: 'lead' },
    { organizationId, courseOfferingId: offering.id, teacherPartnerId: assistant.id, role: 'assistant' },
  ], skipDuplicates: true });

  await db.competency.upsert({
    where: { organizationId_code: { organizationId, code: 'P0-SCHOOL-LEADERSHIP' } }, update: {},
    create: { organizationId, code: 'P0-SCHOOL-LEADERSHIP', description: 'Whole-school leadership; awaiting typed offering support' },
  });

  let policy = await db.assessmentPolicy.findFirst({ where: { organizationId, name: 'Phase 0 Mixed Policy' } });
  policy ??= await db.assessmentPolicy.create({ data: { organizationId, name: 'Phase 0 Mixed Policy', passMark: D(50), isActive: true, version: 1 } });
  let component = await db.assessmentComponent.findFirst({ where: { organizationId, policyId: policy.id, name: 'Mixed evidence' } });
  component ??= await db.assessmentComponent.create({ data: { organizationId, policyId: policy.id, name: 'Mixed evidence', kind: 'cat', weight: D(100) } });
  const assessmentKinds = ['homework', 'project', 'practical', 'exam'] as const;
  for (const [index, kind] of assessmentKinds.entries()) {
    let assessment = await db.assessment.findFirst({ where: { organizationId, sourceType: 'manual', title: `Phase 0 ${kind}` } });
    assessment ??= await db.assessment.create({ data: { organizationId, componentId: component.id, subjectId: subject.id, classId: p5.id, termId: term.id, title: `Phase 0 ${kind}`, maxScore: D(20 + index * 10), kind, status: 'graded' } });
    await db.studentAssessment.upsert({
      where: { assessmentId_studentProfileId: { assessmentId: assessment.id, studentProfileId: regular.profile.id } },
      update: {}, create: { organizationId, assessmentId: assessment.id, studentProfileId: regular.profile.id, classId: p5.id, termId: term.id, participation: index === 0 ? 'absent' : index === 1 ? 'exempt' : 'present', status: index < 2 ? 'assigned' : 'graded', maxScore: assessment.maxScore, originalScore: index < 2 ? null : D(25), effectiveScore: index < 2 ? null : D(25), approvalStatus: 'approved', enteredById: lead.id, approvedById: assistant.id },
    });
  }

  let resultSet = await db.resultSet.findFirst({ where: { organizationId, termId: term.id, scopeId: p5.id, revision: 1 } });
  resultSet ??= await db.resultSet.create({ data: { organizationId, termId: term.id, scopeType: 'class', scopeId: p5.id, revision: 1, status: 'published', calculationVersion: 'phase0-fixture-v1', policySnapshot: { policyId: policy.id, version: 1 }, gradingScaleSnapshot: {}, rankingPolicySnapshot: {}, aggregationSnapshot: {}, inputChecksum: 'phase0-fixture-input-v1', outputChecksum: 'phase0-fixture-output-v1', studentCount: 1, publishedAt: new Date('2026-08-08'), publishedById: assistant.id } });
  const existingAmendment = await db.amendmentRequest.findFirst({ where: { organizationId, resultSetId: resultSet.id, reason: 'Phase 0 published-result amendment scenario' } });
  if (!existingAmendment) await db.amendmentRequest.create({ data: { organizationId, resultSetId: resultSet.id, reason: 'Phase 0 published-result amendment scenario', detail: { evidence: 'fixture' }, status: 'requested', requestedById: lead.id } });

  console.log(JSON.stringify({ organization: orgCode, grades: gradeNames, scenarios: ['late admission', 'transfer', 'repeater', 'withdrawn learner', 'absent assessment', 'exempt assessment', 'team-taught offering', 'school-wide competency', 'homework', 'project', 'practical', 'exam', 'published result amendment'], advancedLmsEnabled: false }, null, 2));
}

main().finally(() => db.$disconnect());
