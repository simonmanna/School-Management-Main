/**
 * Integration — the two spine-corruption bugs, against a real DB.
 *
 * 1. SCORE NULLING. `LmsGradeBridgeService.setScore` used to write
 *    `effectiveScore` straight onto the StudentAssessment with no MarkEntry
 *    behind it. `computeEffective` returns all-null for a row with an empty
 *    ledger, so the next `recompute()` DELETED the mark. The first test here
 *    fails on the pre-fix code — that is its whole purpose.
 *
 * 2. QUIZ DOUBLE-COUNT. One CBT attempt could mint two spine rows: a
 *    `quiz`-sourced assessment from `finalize`, and an `lms_activity`-sourced
 *    one from the mod_quiz grade sync. Both then counted toward the term
 *    aggregate, so a student's quiz was worth double.
 *
 * Same DB requirement as the other school integration specs.
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
import { MarkingService } from '../../src/modules/school/assessment/marking.service';
import { LmsGradeBridgeService } from '../../src/modules/school/lms/moodle/grade/grade-bridge.service';
import { QuestionBankService, QuestionService, PaperService, CbtAttemptService } from '../../src/modules/school/cbt/cbt.service';

describeDb('integration: LMS grade bridge — marks survive recompute, quizzes count once', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let marking: MarkingService;
  let bridge: LmsGradeBridgeService;
  let banks: QuestionBankService;
  let questions: QuestionService;
  let papers: PaperService;
  let cbt: CbtAttemptService;

  const organizationId = `org_bridge_${Date.now()}`;
  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);

  let academicYearId = '';
  let termId = '';
  let classId = '';
  let subjectId = '';
  let studentProfileId = '';

  const perms = ['school:read', 'school:grades:write', 'school:questionbank:write', 'school:cbt:author', 'school:cbt:take'];
  const asUser = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId: 'lms_teacher', permissions: perms }, fn);

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await setOrg(organizationId);
    await raw.organization.create({
      data: { id: organizationId, code: `BR-${Date.now()}`, name: 'Bridge School', currencyCode: 'UGX' },
    });

    const year = await raw.academicYear.create({
      data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
    });
    academicYearId = year.id;
    const term = await raw.term.create({
      data: {
        organizationId, academicYearId: year.id, name: 'Term 1',
        startDate: new Date('2026-01-15'), endDate: new Date('2026-04-15'), isCurrent: true,
      },
    });
    termId = term.id;
    const grade = await raw.gradeLevel.create({ data: { organizationId, name: 'S2', order: 9 } });
    const cls = await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'S2 Bridge' } });
    classId = cls.id;
    subjectId = (await raw.subject.create({ data: { organizationId, code: 'SCI', name: 'Science' } })).id;

    const partner = await raw.partner.create({
      data: { organizationId, name: 'Okello Brian', code: `P-BR-${Date.now()}` },
    });
    studentProfileId = (await raw.studentProfile.create({
      data: {
        organizationId, partnerId: partner.id, admissionNo: `ADM-BR-${Date.now()}`,
        currentClassId: classId, enrollmentDate: new Date('2026-01-15'), status: 'active',
      },
    })).id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();

    tenant = moduleRef.get(TenantContextService);
    marking = moduleRef.get(MarkingService);
    bridge = moduleRef.get(LmsGradeBridgeService);
    banks = moduleRef.get(QuestionBankService);
    questions = moduleRef.get(QuestionService);
    papers = moduleRef.get(PaperService);
    cbt = moduleRef.get(CbtAttemptService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  /** A gradable LMS activity's assessment, with one student fanned into it. */
  async function makeLmsGradeItem(title: string, maxScore = 100) {
    const assessment = await raw.assessment.create({
      data: {
        organizationId, subjectId, classId, termId, title, maxScore, kind: 'classwork',
        sourceType: 'lms_activity', sourceRef: `cm-${Date.now()}-${Math.random()}`, status: 'draft',
      },
    });
    const sa = await raw.studentAssessment.create({
      data: { organizationId, assessmentId: assessment.id, studentProfileId, classId, termId, maxScore },
    });
    return { assessment, sa };
  }

  it('a bridge-written score survives a later recompute', async () => {
    const { sa } = await makeLmsGradeItem('Bridge activity');

    await asUser(() =>
      raw.$transaction(async (tx: any) =>
        bridge.setScore({ studentAssessmentId: sa.id, score: 80, source: 'plugin' }, tx)),
    );

    // The score must be backed by a ledger row, not just written to the column.
    const entries = await raw.markEntry.findMany({ where: { studentAssessmentId: sa.id } });
    expect(entries).toHaveLength(1);
    expect(Number(entries[0].score)).toBe(80);

    const afterWrite = await raw.studentAssessment.findFirst({ where: { id: sa.id } });
    expect(Number(afterWrite!.effectiveScore)).toBe(80);

    // THE REGRESSION: recomputing used to blank this row.
    await asUser(() => raw.$transaction(async (tx: any) => marking.recompute(tx, sa.id)));

    const afterRecompute = await raw.studentAssessment.findFirst({ where: { id: sa.id } });
    expect(afterRecompute!.effectiveScore).not.toBeNull();
    expect(Number(afterRecompute!.effectiveScore)).toBe(80);
    expect(Number(afterRecompute!.percentage)).toBe(80);
  });

  it('clamps an out-of-range plugin score rather than rejecting the sync', async () => {
    const { sa } = await makeLmsGradeItem('Clamp activity', 50);

    await asUser(() =>
      raw.$transaction(async (tx: any) =>
        bridge.setScore({ studentAssessmentId: sa.id, score: 999, source: 'plugin' }, tx)),
    );

    const row = await raw.studentAssessment.findFirst({ where: { id: sa.id } });
    expect(Number(row!.effectiveScore)).toBe(50);
  });

  it('refuses to write into a locked grade item', async () => {
    const { assessment, sa } = await makeLmsGradeItem('Locked activity');
    await raw.assessment.update({ where: { id: assessment.id }, data: { lockedAt: new Date() } });

    await expect(
      asUser(() =>
        raw.$transaction(async (tx: any) =>
          bridge.setScore({ studentAssessmentId: sa.id, score: 40, source: 'plugin' }, tx)),
      ),
    ).rejects.toThrow(/locked/i);
  });

  it('records every score change in the history trail', async () => {
    const { sa } = await makeLmsGradeItem('History activity');

    await asUser(() => raw.$transaction(async (tx: any) => bridge.setScore({ studentAssessmentId: sa.id, score: 30, source: 'plugin' }, tx)));
    await asUser(() => raw.$transaction(async (tx: any) => bridge.setScore({ studentAssessmentId: sa.id, score: 45, source: 'manual' }, tx)));

    const history = await raw.studentAssessmentHistory.findMany({
      where: { studentAssessmentId: sa.id },
      orderBy: { changedAt: 'asc' },
    });
    expect(history.length).toBe(2);
    expect(Number(history[1].oldScore)).toBe(30);
    expect(Number(history[1].newScore)).toBe(45);
  });

  it('a quiz sat as an LMS activity produces exactly ONE spine row', async () => {
    // A 2-question paper worth 5 marks, wired up as a mod_quiz activity.
    const bank: any = await asUser(() => banks.create({ name: `Bank ${Date.now()}` } as any));
    const q1: any = await asUser(() => questions.createFull({ bankId: bank.id, type: 'mcq_single', prompt: '2+2?', marks: 2, options: [{ label: '3' }, { label: '4', isCorrect: true }] } as any));
    const q2: any = await asUser(() => questions.createFull({ bankId: bank.id, type: 'numeric', prompt: 'sqrt(9)?', marks: 3, answerKey: { value: 3 } } as any));
    const paper: any = await asUser(() => papers.create({ name: `Paper ${Date.now()}`, durationMinutes: 60, subjectId } as any));
    await asUser(() => papers.addQuestion(paper.id, q1.id));
    await asUser(() => papers.addQuestion(paper.id, q2.id));

    const modQuiz = await raw.modQuiz.create({
      data: { organizationId, name: 'Science quiz', questionPaperId: paper.id, maxScore: 5 },
    });
    const assessment = await raw.assessment.create({
      data: {
        organizationId, subjectId, classId, termId, title: 'Science quiz', maxScore: 5, kind: 'cat',
        sourceType: 'lms_activity', sourceRef: `cm-quiz-${Date.now()}`, status: 'draft',
      },
    });
    const curriculum = await raw.curriculum.create({
      data: { organizationId, classId, academicYearId, name: 'Science curriculum', status: 'published' },
    });
    const offering = await raw.courseOffering.create({
      data: { organizationId, academicYearId, subjectId, classId, termId, curriculumId: curriculum.id },
    });
    const section = await raw.courseSection.create({
      data: { organizationId, courseOfferingId: offering.id, sectionNo: 0, name: 'Topic 1' },
    });
    await raw.courseModule.create({
      data: {
        organizationId, courseOfferingId: offering.id, sectionId: section.id,
        activityType: 'quiz', instanceId: modQuiz.id, assessmentId: assessment.id, sequence: 0,
      },
    });

    // Sit and submit the quiz.
    const view: any = await asUser(() => cbt.start({ paperId: paper.id, studentProfileId } as any));
    const right = view.questions.find((q: any) => q.questionId === q1.id).options.find((o: any) => o.label === '4');
    await asUser(() => cbt.saveResponse({ attemptId: view.id, questionId: q1.id, sequenceNumber: 1, response: { optionId: right.id } } as any));
    await asUser(() => cbt.saveResponse({ attemptId: view.id, questionId: q2.id, sequenceNumber: 1, response: { value: 3 } } as any));
    const submitted: any = await asUser(() => cbt.submit({ attemptId: view.id } as any));
    expect(Number(submitted.autoScore)).toBe(5);

    // ONE row, on the LMS activity — no parallel `quiz`-sourced assessment.
    const rows = await raw.studentAssessment.findMany({
      where: { studentProfileId, termId, deletedAt: null },
      include: { assessment: true },
    });
    const forThisQuiz = rows.filter(
      (r) => r.assessment.subjectId === subjectId && Number(r.assessment.maxScore) === 5,
    );
    expect(forThisQuiz).toHaveLength(1);
    expect(forThisQuiz[0].assessment.sourceType).toBe('lms_activity');
    expect(forThisQuiz[0].assessmentId).toBe(assessment.id);
    expect(Number(forThisQuiz[0].effectiveScore)).toBe(5);

    // And it went through the ledger, so it too survives a recompute.
    const entries = await raw.markEntry.findMany({ where: { studentAssessmentId: forThisQuiz[0].id } });
    expect(entries).toHaveLength(1);
  });
});
