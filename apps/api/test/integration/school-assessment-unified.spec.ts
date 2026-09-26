/**
 * Integration — one front door for every kind of assessment.
 *
 * The claim under test is the whole point of the consolidation: a CAT, a piece
 * of homework, a project and an exam paper are the SAME thing to the system
 * once created. They land as `Assessment` rows carrying their kind, they are
 * marked through one path, they submit and approve through one workflow, and
 * they all reach the same weighted total.
 *
 * Before this, each kind had its own create form, its own store and its own
 * marking screen, and only exams and homework reached the gradebook at all.
 */
import { Test, TestingModule } from '@nestjs/testing';
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
import { AssessmentBoardService } from '../../src/modules/school/assessment/assessment-board.service';
import { GradebookService } from '../../src/modules/school/assessment/gradebook.service';
import { AssessmentWorkflowService } from '../../src/modules/school/assessment/assessment-workflow.service';
import { placeInClass, upsertEnrollment } from './_placement';

describeDb('integration: assessments — one door, every kind', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let board: AssessmentBoardService;
  let gradebook: GradebookService;
  let workflow: AssessmentWorkflowService;
  let courseOfferingId: string;
  let rosterId: string;

  const organizationId = `org_ub_${Date.now()}`;
  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);

  let termId = '';
  let classId = '';
  let subjectId = '';
  let teacherPartnerId = '';
  let examId = '';
  let catComponentId = '';
  let homeworkComponentId = '';
  let projectComponentId = '';
  const studentIds: string[] = [];

  const perms = [
    'school:read', 'school:grades:write', 'school:grades:approve',
    'school:assessments:write', 'school:exams:write', 'school:assignments:write',
  ];
  const asUser = <T>(userId: string, fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId, permissions: perms }, fn);

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({
      where: { code: 'UGX' }, update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await setOrg(organizationId);
    await raw.organization.create({ data: { id: organizationId, code: `UB-${Date.now()}`, name: 'Unified School', currencyCode: 'UGX' } });
    await raw.schoolProfile.create({ data: { organizationId, name: 'Unified School', gradingSystem: 'generic' } }).catch(() => undefined);

    const year = await raw.academicYear.create({ data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') } });
    termId = (await raw.term.create({ data: { organizationId, academicYearId: year.id, name: 'Term 1', startDate: new Date('2026-01-15'), endDate: new Date('2026-04-15'), isCurrent: true } })).id;
    const grade = await raw.gradeLevel.create({ data: { organizationId, name: 'S2', order: 9 } });
    classId = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'S2 Unified' } })).id;
    subjectId = (await raw.subject.create({ data: { organizationId, code: 'MTC', name: 'Mathematics' } })).id;

    const teacherPartner = await raw.partner.create({ data: { organizationId, name: 'Mr John', code: `P-UB-T-${Date.now()}` } });
    teacherPartnerId = (await raw.staffProfile.create({
      data: { organizationId, partnerId: teacherPartner.id, employeeNo: `EMP-UB-${Date.now()}`, joinDate: new Date('2020-01-01') },
    })).id;

    for (const name of ['Aine Grace', 'Byaruhanga Peter', 'Candiru Mary']) {
      const partner = await raw.partner.create({ data: { organizationId, name, code: `P-UB-${name.replace(/\s+/g, '')}-${Date.now()}` } });
      const sp = await raw.studentProfile.create({
        data: {
          organizationId, partnerId: partner.id,
          admissionNo: `ADM-UB-${studentIds.length}-${Date.now()}`,
          enrollmentDate: new Date('2026-01-15'), status: 'active',
        },
      });
      await placeInClass(raw, { organizationId: organizationId, studentProfileId: sp.id, classId: classId });
      studentIds.push(sp.id);
    }

    // A weighting policy that names each kind, so every kind has somewhere to land.
    const policy = await raw.assessmentPolicy.create({
      data: { organizationId, name: 'S2 Maths', subjectId, classId, gradeLevelId: grade.id, termId, passMark: 50 },
    });
    catComponentId = (await raw.assessmentComponent.create({ data: { organizationId, policyId: policy.id, name: 'CATs', kind: 'cat', weight: 30, aggregation: 'mean' } })).id;
    homeworkComponentId = (await raw.assessmentComponent.create({ data: { organizationId, policyId: policy.id, name: 'Homework', kind: 'homework', weight: 10, aggregation: 'mean' } })).id;
    projectComponentId = (await raw.assessmentComponent.create({ data: { organizationId, policyId: policy.id, name: 'Projects', kind: 'project', weight: 10, aggregation: 'mean' } })).id;
    await raw.assessmentComponent.create({ data: { organizationId, policyId: policy.id, name: 'Exams', kind: 'exam', weight: 50, aggregation: 'mean' } });
    await raw.assessmentPolicy.update({ where: { id: policy.id }, data: { publishedAt: new Date() } });
    const programme = await raw.academicProgramme.create({ data: { organizationId, code: 'SEC', name: 'Secondary', effectiveFrom: year.startDate } });
    const course = await raw.courseOffering.create({ data: { organizationId, name: 'S2 Mathematics', academicYearId: year.id, termId, classId, subjectId, status: 'ACTIVE' } });
    courseOfferingId = course.id;
    await raw.courseOfferingTeacher.create({ data: { organizationId, courseOfferingId, teacherPartnerId, effectiveFrom: year.startDate, isResponsible: true } });
    for (const studentProfileId of studentIds) {
      const e = await upsertEnrollment(raw, { data: { organizationId, studentProfileId, programmeId: programme.id, academicYearId: year.id, gradeLevelId: grade.id, admissionDate: year.startDate } });
      await raw.courseEnrollment.create({ data: { organizationId, courseOfferingId, studentEnrollmentId: e.id, source: 'MANUAL', startDate: year.startDate } });
    }

    const examType = await raw.examType.create({ data: { organizationId, name: 'End of Term', weight: 50, isFinal: true } });
    examId = (await raw.exam.create({
      data: { organizationId, termId, examTypeId: examType.id, name: 'End of Term 1', startDate: new Date('2026-04-01'), endDate: new Date('2026-04-10') },
    })).id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    board = moduleRef.get(AssessmentBoardService);
    gradebook = moduleRef.get(GradebookService);
    workflow = moduleRef.get(AssessmentWorkflowService);
    rosterId = (await asUser('teacher', () => workflow.captureRoster(courseOfferingId))).id;
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  const created: Record<string, string> = {};

  it('creates a CAT, a homework, a project and an exam paper through ONE form', async () => {
    const cat = await asUser('teacher', () => board.createUnified({
      kind: 'cat', courseOfferingId, rosterId, classId, subjectId, termId, title: 'CAT 1', maxScore: 20,
      componentId: catComponentId, teacherPartnerId,
    } as any));
    const homework = await asUser('teacher', () => board.createUnified({
      kind: 'homework', courseOfferingId, rosterId, classId, subjectId, termId, title: 'Algebra exercise', maxScore: 10,
      componentId: homeworkComponentId, teacherPartnerId, dueAt: '2026-02-20',
    } as any));
    const project = await asUser('teacher', () => board.createUnified({
      kind: 'project', courseOfferingId, rosterId, classId, subjectId, termId, title: 'Statistics project', maxScore: 25,
      componentId: projectComponentId, teacherPartnerId,
    } as any));
    const exam = await asUser('exams_officer', () => board.createUnified({
      kind: 'exam', courseOfferingId, rosterId, classId, subjectId, termId, title: 'Paper 1', maxScore: 100,
      examId, classIds: [classId],
    } as any));

    created.cat = (cat as any).assessment.id;
    created.homework = (homework as any).assessment.id;
    created.project = (project as any).assessment.id;
    created.exam = (exam as any).assessment.id;

    const rows = await raw.assessment.findMany({ where: { organizationId, termId } });
    const kinds = rows.map((r) => r.kind).sort();
    expect(kinds).toEqual(['cat', 'exam', 'homework', 'project']);

    // Homework carries a real HomeworkAssignment, and exactly one — the old
    // grade-time upsert could mint a second Assessment behind the first.
    const hw = await raw.assignment.findMany({ where: { organizationId, assessmentId: created.homework } });
    expect(hw).toHaveLength(1);
    expect(hw[0].assessmentId).toBe(created.homework);

    // The exam paper carries a real ExamSchedule, and the column exists BEFORE
    // any mark is entered.
    const schedules = await raw.examSchedule.findMany({ where: { examId } });
    expect(schedules).toHaveLength(1);
    const examAssessment = rows.find((r) => r.kind === 'exam')!;
    expect(examAssessment.sourceRef).toBe(schedules[0].id);
    for (const id of Object.values(created)) await asUser('teacher', () => workflow.transition(id, { action: 'publish', expectedVersion: 0 }));
  });

  it('lists all four in one board, with progress and the weighting policy', async () => {
    const view: any = await asUser('teacher', () => board.board({ termId, classId, subjectId } as any));
    expect(view.rows).toHaveLength(4);
    expect(view.policy.totalWeight).toBe(100);
    expect(view.policy.valid).toBe(true);
    // Nothing marked yet: every row is 0 of the class roster, not 0 of 0.
    for (const r of view.rows) expect(r.total).toBe(3);
    expect(view.counts.all).toBe(4);
  });

  it('marks every kind through the same path, and each mark reaches the ledger', async () => {
    const marks: Record<string, number[]> = {
      cat: [18, 15, 12], homework: [9, 8, 7], project: [22, 20, 18], exam: [80, 65, 50],
    };
    for (const [kind, scores] of Object.entries(marks)) {
      for (let i = 0; i < studentIds.length; i += 1) {
        await asUser('teacher', () => board.saveMark({
          assessmentId: created[kind], studentProfileId: studentIds[i], marks: scores[i],
        }));
      }
    }

    // One MarkEntry per student per assessment — the ledger, not a derived column.
    const entries = await raw.markEntry.count({ where: { organizationId } });
    expect(entries).toBe(4 * studentIds.length);

    const sheet: any = await asUser('teacher', () => board.sheet(created.cat));
    expect(sheet.total).toBe(3);
    expect(sheet.marked).toBe(3);
    expect(sheet.students.map((s: any) => s.marks).sort((a: number, b: number) => a - b)).toEqual([12, 15, 18]);
  });

  it('records an absence as an outcome, not as a zero, and clears any mark behind it', async () => {
    await asUser('teacher', () => board.saveMark({
      assessmentId: created.cat, studentProfileId: studentIds[2], marks: null, participation: 'absent',
    }));

    const sa = await raw.studentAssessment.findFirst({
      where: { assessmentId: created.cat, studentProfileId: studentIds[2] },
    });
    expect(sa!.participation).toBe('absent');
    expect(sa!.effectiveScore).toBeNull();
    // and the round is gone, so a later recompute cannot resurrect the 12
    const rounds = await raw.markEntry.count({ where: { studentAssessmentId: sa!.id } });
    expect(rounds).toBe(0);
  });

  it('submits and approves through one workflow, and refuses self-approval', async () => {
    await asUser('teacher', () => board.transitionMarks(created.cat, 'submit'));
    let rows = await raw.studentAssessment.findMany({ where: { assessmentId: created.cat } });
    expect(rows.every((r) => r.approvalStatus === 'submitted')).toBe(true);
    expect(rows.every((r) => r.enteredAt != null)).toBe(true);

    // The marker cannot approve their own marks.
    await expect(
      asUser('teacher', () => board.transitionMarks(created.cat, 'approve')),
    ).rejects.toThrow(/segregation of duty/i);

    await asUser('head_teacher', () => board.transitionMarks(created.cat, 'approve'));
    rows = await raw.studentAssessment.findMany({ where: { assessmentId: created.cat } });
    expect(rows.every((r) => r.approvalStatus === 'approved')).toBe(true);
    expect(rows.every((r) => r.approvedAt != null)).toBe(true);
  });

  it('returns marks with a reason, and lets the marker resubmit them', async () => {
    await asUser('teacher', () => board.transitionMarks(created.homework, 'submit'));
    await asUser('head_teacher', () => board.transitionMarks(created.homework, 'reject', 'Q3 mis-totalled'));

    let rows = await raw.studentAssessment.findMany({ where: { assessmentId: created.homework } });
    expect(rows.every((r) => r.approvalStatus === 'rejected')).toBe(true);
    // The reason is part of the record, not a toast the marker missed.
    expect(rows[0].rejectionReason).toBe('Q3 mis-totalled');

    await asUser('teacher', () => board.transitionMarks(created.homework, 'resubmit'));
    rows = await raw.studentAssessment.findMany({ where: { assessmentId: created.homework } });
    expect(rows.every((r) => r.approvalStatus === 'submitted')).toBe(true);
    expect(rows.every((r) => r.rejectionReason === null)).toBe(true);
  });

  it('shows the approval queue with the figures an approver decides on', async () => {
    const queue: any = await asUser('head_teacher', () => board.approvalQueue(termId, classId));
    const hw = queue.rows.find((r: any) => r.assessmentId === created.homework);
    expect(hw).toBeTruthy();
    expect(hw.students).toBe(3);
    expect(hw.missing).toBe(0);
    expect(hw.average).toBeGreaterThan(0);
    expect(hw.submittedBy).toBe('Mr John');
  });

  it('weights every kind into ONE total, homework and projects included', async () => {
    const sheet: any = await asUser('teacher', () => gradebook.sheet({ classId, termId, subjectId }));

    // Four columns, each in the component its KIND belongs to. Before the kind
    // column existed, homework and projects were bucketed as CATs.
    expect(sheet.columns).toHaveLength(4);
    const byKind = Object.fromEntries(sheet.columns.map((c: any) => [c.kind, c]));
    expect(Object.keys(byKind).sort()).toEqual(['cat', 'exam', 'homework', 'project']);
    for (const c of sheet.columns) expect(c.groupId).not.toBe('__unweighted__');

    // Aine Grace: CAT 18/20=90, HW 9/10=90, Project 22/25=88, Exam 80/100=80.
    // 90*.30 + 90*.10 + 88*.10 + 80*.50 = 27 + 9 + 8.8 + 40 = 84.8
    const grace = sheet.students.find((s: any) => s.name.startsWith('Aine'));
    expect(Number(grace.finalPercent)).toBeCloseTo(84.8, 1);
  });
});
