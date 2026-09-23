/**
 * A2 rosters + assignment evidence — integration proof against a real DB.
 *
 *  - A2-roster:   capture from currentClass → members snapshotted → freeze →
 *                 frozen roster is immutable (addMember rejected).
 *  - A2-fanout:   publishing an assignment fans the frozen roster out into
 *                 `assigned` StudentAssessment rows for every member.
 *  - A2-late:     on-time submit vs late submit (late detection from due date),
 *                 and a late submission is blocked when allowLate is false.
 *  - A2-grade:    points grading with a late penalty flows through to the
 *                 StudentAssessment effective score.
 *  - A2-rubric:   rubric grading writes canonical AssessmentRubricScore rows and
 *                 rolls up to the effective score.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';
import { KernelModule } from '../../src/kernel/kernel.module';
import { DocumentsModule } from '../../src/modules/documents/documents.module';
import { CoreModule } from '../../src/modules/core/core.module';
import { AccountingModule } from '../../src/modules/accounting/accounting.module';
import { InventoryModule } from '../../src/modules/inventory/inventory.module';
import { InvoicingModule } from '../../src/modules/invoicing/invoicing.module';
import { SchoolModule } from '../../src/modules/school/school.module';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';
import { StudentService } from '../../src/modules/school/people/student.service';
import { AcademicRosterService } from '../../src/modules/school/assessment/roster.service';
import { RubricService } from '../../src/modules/school/assessment/rubric.service';
import { AssignmentService } from '../../src/modules/school/assessment/assignment.service';

describeDb('integration: A2 rosters + assignments', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let students: StudentService;
  let rosters: AcademicRosterService;
  let rubrics: RubricService;
  let assignments: AssignmentService;

  const organizationId = `org_a2_${Date.now()}`;
  let termId = '';
  let classId = '';
  let subjectId = '';

  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);
  const perms = ['school:grades:write', 'school:assessments:write', 'school:assignments:write', 'school:assignments:grade', 'school:assignments:submit', 'school:students:write'];
  const asUser = <T>(userId: string, fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId, permissions: perms }, fn);
  const asStudent = <T>(studentProfileId: string, fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId: 'student', permissions: ['school:assignments:submit'], portal: { kind: 'student', studentProfileId } }, fn);

  const makeStudent = (n: string) =>
    asUser('registrar', () => students.create({ name: `Student ${n}`, admissionNo: n, enrollmentDate: '2026-01-15', classId } as any)) as Promise<any>;

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({ where: { code: 'UGX' }, update: {}, create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 } });
    await setOrg(organizationId);
    await raw.organization.create({ data: { id: organizationId, code: `A2-${Date.now()}`, name: 'A2 School', currencyCode: 'UGX' } });

    const year = await raw.academicYear.create({ data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') } });
    termId = (await raw.term.create({ data: { organizationId, academicYearId: year.id, name: 'Term 1', startDate: new Date('2026-01-15'), endDate: new Date('2026-04-15'), isCurrent: true } })).id;
    const grade = await raw.gradeLevel.create({ data: { organizationId, name: 'S2', order: 9 } });
    classId = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'S2 West' } })).id;
    subjectId = (await raw.subject.create({ data: { organizationId, code: 'ENG', name: 'English', isCore: true } })).id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();

    tenant = moduleRef.get(TenantContextService);
    students = moduleRef.get(StudentService);
    rosters = moduleRef.get(AcademicRosterService);
    rubrics = moduleRef.get(RubricService);
    assignments = moduleRef.get(AssignmentService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  it('A2-roster: capture → freeze → frozen is immutable', async () => {
    const s1 = await makeStudent(`R1-${Date.now()}`);
    const s2 = await makeStudent(`R2-${Date.now()}`);

    const roster = await asUser('admin', () => rosters.capture({ termId, classId, source: 'derived_current_class' } as any)) as any;
    expect(roster.members.length).toBe(2);
    const ids = roster.members.map((m: any) => m.studentProfileId).sort();
    expect(ids).toEqual([s1.id, s2.id].sort());

    const frozen = await asUser('admin', () => rosters.freeze(roster.id)) as any;
    expect(frozen.frozenAt).not.toBeNull();

    // Frozen roster rejects further membership changes.
    const s3 = await makeStudent(`R3-${Date.now()}`);
    await expect(asUser('admin', () => rosters.addMember(roster.id, { studentProfileId: s3.id } as any))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('A2-fanout: publish fans the frozen roster out into assigned rows', async () => {
    await makeStudent(`F1-${Date.now()}`);
    await makeStudent(`F2-${Date.now()}`);
    const roster = await asUser('admin', () => rosters.capture({ termId, classId, source: 'derived_current_class' } as any)) as any;
    await asUser('admin', () => rosters.freeze(roster.id));

    const a = await asUser('teacher', () => assignments.create({ subjectId, classId, termId, title: 'Essay 1', maxScore: 100, rosterId: roster.id } as any)) as any;
    const res = await asUser('teacher', () => assignments.publish(a.id)) as any;
    expect(res.fannedOut).toBe(roster.members.length);

    const assigned = await raw.studentAssessment.findMany({ where: { assessmentId: a.assessmentId, status: 'assigned' } });
    expect(assigned.length).toBe(roster.members.length);
  });

  it('A2-late: on-time vs late submit, and late blocked when not allowed', async () => {
    const s = await makeStudent(`L1-${Date.now()}`);
    const roster = await asUser('admin', () => rosters.capture({ termId, classId, name: 'late-test', source: 'manual_import' } as any)) as any;
    await asUser('admin', () => rosters.addMember(roster.id, { studentProfileId: s.id } as any));
    await asUser('admin', () => rosters.freeze(roster.id));

    // allowLate=false, due yesterday → late submit blocked.
    const strict = await asUser('teacher', () => assignments.create({ subjectId, classId, termId, title: 'Strict', maxScore: 100, rosterId: roster.id, dueAt: new Date(Date.now() - 86400000).toISOString(), allowLate: false } as any)) as any;
    await asUser('teacher', () => assignments.publish(strict.id));
    await expect(asStudent(s.id, () => assignments.submit({ assignmentId: strict.id, studentProfileId: s.id } as any))).rejects.toBeInstanceOf(BadRequestException);

    // allowLate=true, due yesterday → accepted and flagged late.
    const lenient = await asUser('teacher', () => assignments.create({ subjectId, classId, termId, title: 'Lenient', maxScore: 100, rosterId: roster.id, dueAt: new Date(Date.now() - 86400000).toISOString(), allowLate: true, latePenaltyPercent: 10 } as any)) as any;
    await asUser('teacher', () => assignments.publish(lenient.id));
    const sub = await asStudent(s.id, () => assignments.submit({ assignmentId: lenient.id, studentProfileId: s.id } as any)) as any;
    expect(sub.isLate).toBe(true);
  });

  it('A2-grade: points grade with late penalty reaches the effective score', async () => {
    const s = await makeStudent(`G1-${Date.now()}`);
    const roster = await asUser('admin', () => rosters.capture({ termId, classId, name: 'grade-test', source: 'manual_import' } as any)) as any;
    await asUser('admin', () => rosters.addMember(roster.id, { studentProfileId: s.id } as any));
    await asUser('admin', () => rosters.freeze(roster.id));

    const a = await asUser('teacher', () => assignments.create({ subjectId, classId, termId, title: 'HW', maxScore: 100, rosterId: roster.id, dueAt: new Date(Date.now() - 86400000).toISOString(), allowLate: true, latePenaltyPercent: 10 } as any)) as any;
    await asUser('teacher', () => assignments.publish(a.id));
    await asStudent(s.id, () => assignments.submit({ assignmentId: a.id, studentProfileId: s.id } as any));

    // rawScore 80, late 10% → penalty 8 → effective 72.
    await asUser('teacher', () => assignments.grade({ assignmentId: a.id, studentProfileId: s.id, rawScore: 80 } as any));
    const sa = await raw.studentAssessment.findFirst({ where: { assessmentId: a.assessmentId, studentProfileId: s.id } });
    expect(Number(sa?.effectiveScore)).toBe(72);
    expect(sa?.status).toBe('graded');
  });

  it('A2-rubric: rubric grade writes canonical scores and rolls up', async () => {
    const s = await makeStudent(`RB1-${Date.now()}`);
    const roster = await asUser('admin', () => rosters.capture({ termId, classId, name: 'rubric-test', source: 'manual_import' } as any)) as any;
    await asUser('admin', () => rosters.addMember(roster.id, { studentProfileId: s.id } as any));
    await asUser('admin', () => rosters.freeze(roster.id));

    const rubric = await asUser('admin', () => rubrics.createFull({
      name: 'Essay rubric',
      criteria: [
        { name: 'Content', weight: 1, maxScore: 10, levels: [{ label: 'Good', score: 8 }] },
        { name: 'Structure', weight: 1, maxScore: 10, levels: [{ label: 'Good', score: 8 }] },
      ],
    } as any)) as any;
    const [c1, c2] = rubric.criteria;

    const a = await asUser('teacher', () => assignments.create({ subjectId, classId, termId, title: 'Rubric essay', maxScore: 100, rosterId: roster.id, gradingMode: 'rubric', rubricId: rubric.id } as any)) as any;
    await asUser('teacher', () => assignments.publish(a.id));
    await asStudent(s.id, () => assignments.submit({ assignmentId: a.id, studentProfileId: s.id } as any));

    // Content 8/10, Structure 6/10 → weighted fraction 0.7 → 70/100.
    await asUser('teacher', () => assignments.grade({
      assignmentId: a.id, studentProfileId: s.id,
      rubricScores: [{ criterionId: c1.id, score: 8 }, { criterionId: c2.id, score: 6 }],
    } as any));

    const sa = await raw.studentAssessment.findFirst({ where: { assessmentId: a.assessmentId, studentProfileId: s.id } });
    expect(Number(sa?.effectiveScore)).toBe(70);
    const scores = await raw.assessmentRubricScore.findMany({ where: { studentAssessmentId: sa!.id } });
    expect(scores.length).toBe(2);
  });
});
