/**
 * A1 assessment core — integration proof against a real DB.
 *
 *  - A1-policy:     most-specific-first policy resolution.
 *  - A1-weights:    component weight-sum validation (100 vs not-100).
 *  - A1-marks:      record mark → reconcile → effective score → percentage,
 *                   with a blind second + reconciliation round.
 *  - A1-adjust:     append-only MarkAdjustment ledger recomputes effectiveScore,
 *                   and the DB trigger blocks UPDATE/DELETE of a ledger row.
 *  - A1-sod:        marker cannot approve their own assessment marks.
 *  - A1-adapter:    a GradeEntry bulk-upsert projects into Assessment +
 *                   StudentAssessment + MarkEntry atomically, and approval
 *                   mirrors onto the projected rows.
 *
 * Same DB requirements as the other school integration specs (RLS-inert target,
 * postgres superuser — see the working-database memory).
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
import { AssessmentPolicyService, AssessmentComponentService } from '../../src/modules/school/assessment/assessment-config.service';
import { AssessmentService } from '../../src/modules/school/assessment/assessment.service';
import { MarkingService } from '../../src/modules/school/assessment/marking.service';
import {
  ExamTypeService,
  ExamService,
  ExamScheduleService,
  GradeEntryService,
} from '../../src/modules/school/examinations/examinations.service';

describeDb('integration: A1 assessment core', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let students: StudentService;
  let policies: AssessmentPolicyService;
  let components: AssessmentComponentService;
  let assessments: AssessmentService;
  let marking: MarkingService;
  let examTypes: ExamTypeService;
  let exams: ExamService;
  let schedules: ExamScheduleService;
  let grades: GradeEntryService;

  const organizationId = `org_a1_${Date.now()}`;
  let termId = '';
  let classId = '';
  let gradeLevelId = '';
  let subjectId = '';

  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);
  const perms = ['school:assessments:write', 'school:grades:write', 'school:grades:approve', 'school:marks:moderate'];
  const asUser = <T>(userId: string, fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId, permissions: perms }, fn);

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({
      where: { code: 'UGX' }, update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await setOrg(organizationId);
    await raw.organization.create({ data: { id: organizationId, code: `A1-${Date.now()}`, name: 'A1 School', currencyCode: 'UGX' } });
    await raw.schoolProfile.create({ data: { organizationId, name: 'A1 School', gradingSystem: 'UCE' } });

    const year = await raw.academicYear.create({ data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') } });
    termId = (await raw.term.create({ data: { organizationId, academicYearId: year.id, name: 'Term 1', startDate: new Date('2026-01-15'), endDate: new Date('2026-04-15'), isCurrent: true } })).id;
    const grade = await raw.gradeLevel.create({ data: { organizationId, name: 'S1', order: 8 } });
    gradeLevelId = grade.id;
    classId = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId, name: 'S1 East' } })).id;
    subjectId = (await raw.subject.create({ data: { organizationId, code: 'MATH', name: 'Mathematics', isCore: true } })).id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();

    tenant = moduleRef.get(TenantContextService);
    students = moduleRef.get(StudentService);
    policies = moduleRef.get(AssessmentPolicyService);
    components = moduleRef.get(AssessmentComponentService);
    assessments = moduleRef.get(AssessmentService);
    marking = moduleRef.get(MarkingService);
    examTypes = moduleRef.get(ExamTypeService);
    exams = moduleRef.get(ExamService);
    schedules = moduleRef.get(ExamScheduleService);
    grades = moduleRef.get(GradeEntryService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  const makeStudent = (admissionNo: string) =>
    asUser('registrar', () => students.create({ name: `Student ${admissionNo}`, admissionNo, enrollmentDate: '2026-01-15', classId } as any)) as Promise<any>;

  it('A1-policy: resolves the most-specific matching policy', async () => {
    // Org-wide default + a subject+class specific one.
    await asUser('admin', () => policies.create({ name: 'Org default' } as any));
    const specific = await asUser('admin', () => policies.create({ name: 'S1 Math', subjectId, classId, termId } as any)) as any;

    const resolved = await asUser('admin', () => policies.resolve({ subjectId, classId, gradeLevelId, termId })) as any;
    expect(resolved.id).toBe(specific.id); // subject+class+term beats the org default

    // A query that doesn't match the specific policy falls back to the default.
    const other = await asUser('admin', () => policies.resolve({ subjectId: 'nope', classId: 'nope' })) as any;
    expect(other.name).toBe('Org default');
  });

  it('A1-weights: component weights validate against 100', async () => {
    const policy = await asUser('admin', () => policies.create({ name: `Weights ${Date.now()}` } as any)) as any;
    await asUser('admin', () => components.create({ policyId: policy.id, name: 'CA', kind: 'cat', weight: 40 } as any));
    let v = await asUser('admin', () => components.validateWeights(policy.id)) as any;
    expect(v.ok).toBe(false); // only 40 so far
    expect(v.sum).toBe('40');

    await asUser('admin', () => components.create({ policyId: policy.id, name: 'Exam', kind: 'exam', weight: 60 } as any));
    v = await asUser('admin', () => components.validateWeights(policy.id)) as any;
    expect(v.ok).toBe(true);
    expect(v.sum).toBe('100');
    expect(v.componentCount).toBe(2);
  });

  it('A1-marks: record → reconcile → effective, blind second then reconciliation', async () => {
    const s = await makeStudent(`MK-${Date.now()}`);
    const a = await asUser('admin', () => assessments.create({ subjectId, classId, termId, title: 'Practical 1', maxScore: 50 } as any)) as any;
    const sa = await asUser('teacher_a', () => marking.setParticipation({ assessmentId: a.id, studentProfileId: s.id, participation: 'present' } as any)) as any;

    await asUser('teacher_a', () => marking.recordMark({ studentAssessmentId: sa.id, round: 'first', score: 30 } as any));
    let row = await raw.studentAssessment.findFirst({ where: { id: sa.id } });
    expect(Number(row?.originalScore)).toBe(30);
    expect(Number(row?.effectiveScore)).toBe(30);
    expect(Number(row?.percentage)).toBe(60); // 30/50

    // A disagreeing blind second does not change the mark until reconciled.
    await asUser('teacher_b', () => marking.recordMark({ studentAssessmentId: sa.id, round: 'second_blind', score: 40 } as any));
    row = await raw.studentAssessment.findFirst({ where: { id: sa.id } });
    expect(Number(row?.originalScore)).toBe(30);

    // Reconciliation wins.
    await asUser('hod', () => marking.recordMark({ studentAssessmentId: sa.id, round: 'reconciliation', score: 35 } as any));
    row = await raw.studentAssessment.findFirst({ where: { id: sa.id } });
    expect(Number(row?.originalScore)).toBe(35);
    expect(Number(row?.percentage)).toBe(70);
  });

  it('A1-adjust: ledger recomputes effective and is append-only', async () => {
    const s = await makeStudent(`ADJ-${Date.now()}`);
    const a = await asUser('admin', () => assessments.create({ subjectId, classId, termId, title: 'Exam 1', maxScore: 100 } as any)) as any;
    const sa = await asUser('teacher_a', () => marking.setParticipation({ assessmentId: a.id, studentProfileId: s.id, participation: 'present' } as any)) as any;
    await asUser('teacher_a', () => marking.recordMark({ studentAssessmentId: sa.id, round: 'first', score: 48 } as any));

    // Moderation +3 → effective 51, original stays 48.
    await asUser('hod', () => marking.appendAdjustment({ studentAssessmentId: sa.id, kind: 'moderation', delta: 3, reason: 'Board moderation' } as any));
    const row = await raw.studentAssessment.findFirst({ where: { id: sa.id } });
    expect(Number(row?.originalScore)).toBe(48);
    expect(Number(row?.effectiveScore)).toBe(51);

    const adj = await raw.markAdjustment.findFirst({ where: { studentAssessmentId: sa.id } });
    // The DB trigger blocks any mutation of the ledger row.
    await expect(
      raw.$executeRawUnsafe(`UPDATE "MarkAdjustment" SET "delta" = 99 WHERE id = $1`, adj!.id),
    ).rejects.toThrow(/append-only/);
    await expect(
      raw.$executeRawUnsafe(`DELETE FROM "MarkAdjustment" WHERE id = $1`, adj!.id),
    ).rejects.toThrow(/append-only/);
  });

  it('A1-sod: marker cannot approve their own assessment marks', async () => {
    const s = await makeStudent(`SOD-${Date.now()}`);
    const a = await asUser('admin', () => assessments.create({ subjectId, classId, termId, title: 'Quiz 1', maxScore: 20 } as any)) as any;
    const sa = await asUser('teacher_a', () => marking.setParticipation({ assessmentId: a.id, studentProfileId: s.id, participation: 'present' } as any)) as any;
    await asUser('teacher_a', () => marking.recordMark({ studentAssessmentId: sa.id, round: 'first', score: 15 } as any));
    await asUser('teacher_a', () => marking.markingApproval({ assessmentId: a.id, action: 'submit' } as any));

    await expect(asUser('teacher_a', () => marking.markingApproval({ assessmentId: a.id, action: 'approve' } as any))).rejects.toBeInstanceOf(BadRequestException);
    const res = await asUser('hod', () => marking.markingApproval({ assessmentId: a.id, action: 'approve' } as any)) as any;
    expect(res.updated).toBe(1);
  });

  it('A1-adapter: a GradeEntry bulk-upsert projects into the spine and approval mirrors', async () => {
    const s = await makeStudent(`ADP-${Date.now()}`);
    const et = await asUser('setup', () => examTypes.create({ name: `Final ${Date.now()}`, weight: 100, isFinal: true } as any)) as any;
    const exam = await asUser('setup', () => exams.schedule({ termId, examTypeId: et.id, name: `Exam ${Date.now()}`, startDate: '2026-03-01T00:00:00.000Z', endDate: '2026-03-10T00:00:00.000Z', classes: [classId] } as any)) as any;
    const sched = await asUser('setup', () => schedules.create({ examId: exam.id, classId, subjectId, date: '2026-03-05T00:00:00.000Z', startTime: '09:00', maxMarks: 100 } as any)) as any;

    await asUser('teacher_a', () => grades.bulkUpsert({ examScheduleId: sched.id, entries: [{ studentProfileId: s.id, marksObtained: 72, maxMarks: 100 }] } as any));

    // Projected: one Assessment (exam_session), one StudentAssessment, one first-round MarkEntry.
    const a = await raw.assessment.findFirst({ where: { organizationId, sourceType: 'exam_session', sourceRef: sched.id } });
    expect(a).not.toBeNull();
    const sa = await raw.studentAssessment.findFirst({ where: { assessmentId: a!.id, studentProfileId: s.id } });
    expect(Number(sa?.originalScore)).toBe(72);
    expect(Number(sa?.effectiveScore)).toBe(72);
    expect(sa?.approvalStatus).toBe('draft');
    const me = await raw.markEntry.findFirst({ where: { studentAssessmentId: sa!.id, round: 'first' } });
    expect(Number(me?.score)).toBe(72);

    // Approve the legacy grade → projected approvalStatus mirrors.
    await asUser('teacher_a', () => grades.submit(sched.id));
    await asUser('hod_b', () => grades.approve(sched.id));
    const after = await raw.studentAssessment.findFirst({ where: { id: sa!.id } });
    expect(after?.approvalStatus).toBe('approved');
  });
});
