/**
 * Integration — the two exam paths meet in one result.
 *
 * An exam made in Exams & Papers (the workspace) must be able to run through
 * the Run-an-Examination lifecycle, and marks typed in the workspace must reach
 * term results only once approved. Before this:
 *
 *   - workspace papers had no class list, so they could never be submitted, and
 *     their marks never reached term results (G1);
 *   - the lifecycle's marking gate demanded a roster nothing could create, so a
 *     workspace exam stuck at 'in progress' (G2);
 *   - closing an exam locked the legacy schedule column, not the assessment
 *     lock that `postMark` actually checks.
 */
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { describeDb } from './_setup';
import { KernelModule } from '../../src/kernel/kernel.module';
import { DocumentsModule } from '../../src/modules/documents/documents.module';
import { CoreModule } from '../../src/modules/core/core.module';
import { AccountingModule } from '../../src/modules/accounting/accounting.module';
import { InventoryModule } from '../../src/modules/inventory/inventory.module';
import { InvoicingModule } from '../../src/modules/invoicing/invoicing.module';
import { SchoolModule } from '../../src/modules/school/school.module';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';
import { PrismaService } from '../../src/kernel/prisma/prisma.service';
import { ExamOperationsService } from '../../src/modules/school/examinations/exam-operations.service';
import { ExamSessionService } from '../../src/modules/school/examinations/exam-session.service';
import { MarksWorkspaceService } from '../../src/modules/school/examinations/marks-workspace.service';
import { MarkingService } from '../../src/modules/school/assessment/marking.service';
import { ResultRunService } from '../../src/modules/school/assessment/result-run.service';
import { ReportDocumentService } from '../../src/modules/school/examinations/report-document.service';
import { placeInClass } from './_placement';

describeDb('integration: a workspace exam runs the lifecycle and reaches term results', () => {
  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let db: any;
  let ops: ExamOperationsService;
  let session: ExamSessionService;
  let workspace: MarksWorkspaceService;
  let marking: MarkingService;
  let results: ResultRunService;
  let documents: ReportDocumentService;

  const organizationId = `paths-${randomUUID()}`;
  const office = <T>(fn: () => Promise<T>) => tenant.run({ organizationId, userId: 'exams-office', permissions: ['*'] }, fn);
  const approver = <T>(fn: () => Promise<T>) =>
    tenant.run({ organizationId, userId: 'dos', permissions: ['school:read', 'school:grades:approve'] }, fn);

  const learners: string[] = [];
  let termId = '';
  let classId = '';
  let subjectId = '';
  let examId = '';
  let paperId = '';
  let classRosterId = '';

  const paperAssessment = () =>
    db.assessment.findFirst({ where: { organizationId, sourceType: 'exam_session', sourceRef: paperId } });

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    db = moduleRef.get(PrismaService).raw;
    ops = moduleRef.get(ExamOperationsService);
    session = moduleRef.get(ExamSessionService);
    workspace = moduleRef.get(MarksWorkspaceService);
    marking = moduleRef.get(MarkingService);
    results = moduleRef.get(ResultRunService);
    documents = moduleRef.get(ReportDocumentService);

    await db.currency.upsert({ where: { code: 'UGX' }, update: {}, create: { code: 'UGX', name: 'Ugandan Shilling', symbol: 'USh', decimalPlaces: 0 } });
    await db.organization.create({ data: { id: organizationId, code: organizationId, name: 'Exam paths', currencyCode: 'UGX' } });
    await db.schoolProfile.create({ data: { organizationId, name: 'Exam Paths School', gradingSystem: 'generic' } }).catch(() => undefined);

    const year = await db.academicYear.create({ data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') } });
    termId = (await db.term.create({ data: { organizationId, academicYearId: year.id, name: 'Term 1', startDate: new Date('2026-01-10'), endDate: new Date('2026-04-10') } })).id;
    const grade = await db.gradeLevel.create({ data: { organizationId, name: 'S2', order: 9 } });
    classId = (await db.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'S2 West' } })).id;
    subjectId = (await db.subject.create({ data: { organizationId, code: 'BIO', name: 'Biology', isCore: true } })).id;

    for (let i = 0; i < 3; i += 1) {
      const p = await db.partner.create({ data: { organizationId, name: `Learner ${i}`, code: `L${i}` } });
      const s = await db.studentProfile.create({ data: { organizationId, partnerId: p.id, admissionNo: `PATH-${i}`, enrollmentDate: year.startDate } });
      await placeInClass(db, { organizationId, studentProfileId: s.id, classId });
      learners.push(s.id);
    }

    const examType = await db.examType.create({ data: { organizationId, name: 'End of term', weight: 0, isFinal: true } });
    // The weighting policy claims the exam through its exam type (the bridge
    // the workspace's New exam dialog relies on).
    const policy = await db.assessmentPolicy.create({ data: { organizationId, name: 'S2 Biology', subjectId, termId, passMark: 50 } });
    await db.assessmentComponent.create({
      data: { organizationId, policyId: policy.id, name: 'Exam', kind: 'exam', weight: 100, aggregation: 'mean', examTypeId: examType.id },
    });
    await db.assessmentPolicy.update({ where: { id: policy.id }, data: { publishedAt: new Date() } });

    examId = (await db.exam.create({
      data: { organizationId, name: 'End of Term 1', examTypeId: examType.id, termId, startDate: new Date('2026-03-01'), endDate: new Date('2026-03-10') },
    })).id;

    const classRoster = await db.academicRoster.create({ data: { organizationId, termId, scopeType: 'class', classId, name: 'S2 West — Term 1' } });
    await db.academicRosterMember.createMany({
      data: learners.map((studentProfileId) => ({ organizationId, rosterId: classRoster.id, studentProfileId, classId, gradeLevelId: grade.id })),
    });
    await db.academicRoster.update({ where: { id: classRoster.id }, data: { frozenAt: new Date() } });
    classRosterId = classRoster.id;
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('a workspace exam moves draft → setup → scheduled → candidates locked', async () => {
    await office(() => workspace.applyClasses({ examId, classIds: [classId], subjectIds: [subjectId] }));
    paperId = (await db.examSchedule.findFirst({ where: { examId } })).id;

    await office(() => ops.transition(examId, { target: 'setup' }));
    await office(() => ops.transition(examId, { target: 'scheduled' }));
    for (const studentProfileId of learners) {
      await db.examRegistration.create({ data: { organizationId, examId, studentProfileId, classId, status: 'registered' } });
    }
    await office(() => ops.freezeCandidates(examId, {}));
    const moved: any = await office(() => ops.transition(examId, { target: 'candidates_locked' }));
    expect(moved.lifecycleState).toBe('candidates_locked');
  });

  it('G2: starting the sitting binds the frozen candidate list to the paper, so marking can open', async () => {
    const invigilator = await db.invigilator.create({ data: { organizationId, name: 'Invigilator' } });
    await db.invigilatorAssignment.create({ data: { organizationId, examScheduleId: paperId, invigilatorId: invigilator.id } });
    await office(() => ops.transition(examId, { target: 'in_progress' }));

    const assessment = await paperAssessment();
    expect(assessment.rosterId).not.toBeNull();
    const roster = await db.academicRoster.findFirst({ where: { id: assessment.rosterId }, include: { members: true } });
    expect(roster.frozenAt).not.toBeNull();
    expect(roster.members.map((m: any) => m.studentProfileId).sort()).toEqual([...learners].sort());

    await office(() => session.recordAttendance(paperId, {
      rows: [
        { studentProfileId: learners[0], status: 'present' },
        { studentProfileId: learners[1], status: 'present' },
        { studentProfileId: learners[2], status: 'absent' },
      ],
    } as any));
    expect(await office(() => ops.gate(examId, 'marking'))).toMatchObject({ ready: true });
    await office(() => ops.transition(examId, { target: 'marking' }));
  });

  it('marks typed in the workspace do not reach term results until they are approved', async () => {
    await office(() => workspace.saveMark({ examId, classId, subjectId, studentProfileId: learners[0], marks: 80 }));
    await office(() => workspace.saveMark({ examId, classId, subjectId, studentProfileId: learners[1], marks: 45 }));

    const draft: any = await office(() => results.compute({ termId, rosterId: classRosterId }));
    const draftRows = await db.studentSubjectResult.findMany({ where: { resultSetId: draft.id, subjectId } });
    // The absent learner's outcome is terminal (it counts under the absence
    // policy), but neither typed mark is visible to the result run yet.
    const draftOf = (id: string) => draftRows.find((r: any) => r.studentProfileId === id) as any;
    for (const id of [learners[0], learners[1]]) {
      const row = draftOf(id);
      expect(row?.finalPercent == null || ![80, 45].includes(Number(row.finalPercent))).toBe(true);
    }
  });

  it('submitted (reusing the candidate list) and approved, they do', async () => {
    const before = await paperAssessment();
    const sent = await office(() => workspace.submitPaper({ examId, classId, subjectId }));
    expect(sent.rosterId).toBe(before.rosterId);
    expect(sent.submitted).toBe(3);

    const assessment = await paperAssessment();
    await approver(() => marking.markingApproval({ assessmentId: assessment.id, action: 'approve' } as any));

    const set: any = await office(() => results.compute({ termId, rosterId: classRosterId }));
    const rows = await db.studentSubjectResult.findMany({ where: { resultSetId: set.id, subjectId } });
    const byStudent = new Map(rows.map((r: any) => [r.studentProfileId, r]));
    expect(Number((byStudent.get(learners[0]) as any).finalPercent)).toBe(80);
    expect(Number((byStudent.get(learners[1]) as any).finalPercent)).toBe(45);
  });

  it('closing the exam locks the paper where it bites, and the workspace stops taking marks', async () => {
    await office(() => ops.transition(examId, { target: 'results_ready' }));
    await office(() => ops.transition(examId, { target: 'closed' }));
    const assessment = await paperAssessment();
    expect(assessment.lockedAt).not.toBeNull();
    await expect(
      office(() => workspace.saveMark({ examId, classId, subjectId, studentProfileId: learners[2], marks: 50 })),
    ).rejects.toThrow(/closed/);
  });

  it('G8: a released report document can be reissued (with a reason) from the same results', async () => {
    const set: any = await office(() => results.compute({ termId, rosterId: classRosterId }));
    const published: any = await office(() => results.publish(set.id));
    expect(published.status).toBe('published');

    const first: any = await office(() => documents.generate({ resultSetId: set.id, studentProfileIds: [learners[0]] } as any));
    expect(first.issued).toBe(1);
    await office(() => documents.publish({ documentIds: [first.documents[0].id] }));
    const card = await db.reportCard.findFirst({ where: { studentProfileId: learners[0], termId } });
    expect(card.publishedAt).not.toBeNull();

    // Used to fail: the card refused to regenerate because it was published.
    const again: any = await office(() =>
      documents.generate({ resultSetId: set.id, studentProfileIds: [learners[0]], reissue: true, reason: 'Head teacher comment corrected' } as any),
    );
    expect(again.skipped).toEqual([]);
    expect(again.issued).toBe(1);
    const old = await db.reportDocument.findFirst({ where: { id: first.documents[0].id } });
    expect(old.status).toBe('superseded');
    await office(() => documents.publish({ documentIds: [again.documents[0].id] }));
    expect((await db.reportCard.findFirst({ where: { studentProfileId: learners[0], termId } })).publishedAt).not.toBeNull();
  });
});
