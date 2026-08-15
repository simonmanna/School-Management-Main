/**
 * A5 CBT engine — integration proof.
 *
 *  - A5-attempt:  start → save responses → submit → auto-marked total; the
 *                 student view never leaks answer keys.
 *  - A5-idem:     a duplicate clientEventId is a no-op; an out-of-order
 *                 (lower) sequence number is discarded (highest valid wins).
 *  - A5-expiry:   a save after expiry is refused and the attempt auto-submits.
 *  - A5-spine:    a linked attempt posts its auto score onto the StudentAssessment.
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
import { QuestionBankService, QuestionService, PaperService, CbtAttemptService } from '../../src/modules/school/cbt/cbt.service';
import { AssessmentService } from '../../src/modules/school/assessment/assessment.service';
import { MarkingService } from '../../src/modules/school/assessment/marking.service';

describeDb('integration: A5 CBT engine', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let banks: QuestionBankService;
  let questions: QuestionService;
  let papers: PaperService;
  let cbt: CbtAttemptService;

  const organizationId = `org_a5_${Date.now()}`;
  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);
  const perms = ['school:questionbank:write', 'school:cbt:author', 'school:cbt:take'];
  const asUser = <T>(fn: () => Promise<T>): Promise<T> => tenant.run({ organizationId, userId: 'cbt', permissions: perms }, fn);

  // A 2-question paper: one mcq_single (2 marks), one numeric (3 marks).
  async function makePaper(durationMinutes = 60) {
    const bank: any = await asUser(() => banks.create({ name: `Bank ${Date.now()}` } as any));
    const q1: any = await asUser(() => questions.createFull({ bankId: bank.id, type: 'mcq_single', prompt: '2+2?', marks: 2, options: [{ label: '3' }, { label: '4', isCorrect: true }, { label: '5' }] } as any));
    const q2: any = await asUser(() => questions.createFull({ bankId: bank.id, type: 'numeric', prompt: 'sqrt(9)?', marks: 3, answerKey: { value: 3 } } as any));
    const paper: any = await asUser(() => papers.create({ name: `Paper ${Date.now()}`, durationMinutes } as any));
    await asUser(() => papers.addQuestion(paper.id, q1.id));
    await asUser(() => papers.addQuestion(paper.id, q2.id));
    return { paper, q1, q2 };
  }

  beforeAll(async () => {
    await raw.$connect();
    await setOrg(organizationId);
    await raw.organization.create({ data: { id: organizationId, code: `A5-${Date.now()}`, name: 'A5 School', currencyCode: 'UGX' } });
    await raw.currency.upsert({ where: { code: 'UGX' }, update: {}, create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 } });

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    banks = moduleRef.get(QuestionBankService);
    questions = moduleRef.get(QuestionService);
    papers = moduleRef.get(PaperService);
    cbt = moduleRef.get(CbtAttemptService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  it('A5-attempt: start → answer → submit → auto-marked; view hides keys', async () => {
    const { paper, q1, q2 } = await makePaper();
    const view: any = await asUser(() => cbt.start({ paperId: paper.id, studentProfileId: 'stud-1' } as any));
    expect(view.questions.length).toBe(2);
    // Student view must not carry option correctness or answer keys.
    expect(JSON.stringify(view)).not.toContain('isCorrect');
    expect(JSON.stringify(view)).not.toContain('answerKey');
    const correctOpt = view.questions.find((q: any) => q.questionId === q1.id).options.find((o: any) => o.label === '4');

    await asUser(() => cbt.saveResponse({ attemptId: view.id, questionId: q1.id, sequenceNumber: 1, response: { optionId: correctOpt.id } } as any));
    await asUser(() => cbt.saveResponse({ attemptId: view.id, questionId: q2.id, sequenceNumber: 1, response: { value: 3 } } as any));

    const submitted: any = await asUser(() => cbt.submit({ attemptId: view.id } as any));
    expect(submitted.status).toBe('submitted');
    expect(Number(submitted.autoScore)).toBe(5); // 2 + 3
    expect(submitted.manualPending).toBe(0);
  });

  it('A5-idem: duplicate clientEventId no-ops; lower sequence discarded', async () => {
    const { paper, q1 } = await makePaper();
    const view: any = await asUser(() => cbt.start({ paperId: paper.id, studentProfileId: 'stud-2' } as any));
    const opts = view.questions.find((q: any) => q.questionId === q1.id).options;
    const wrong = opts.find((o: any) => o.label === '3');
    const right = opts.find((o: any) => o.label === '4');

    // Seq 2 sets the right answer.
    await asUser(() => cbt.saveResponse({ attemptId: view.id, questionId: q1.id, clientEventId: 'ev-2', sequenceNumber: 2, response: { optionId: right.id } } as any));
    // A late-arriving seq 1 (wrong) must be discarded.
    await asUser(() => cbt.saveResponse({ attemptId: view.id, questionId: q1.id, clientEventId: 'ev-1', sequenceNumber: 1, response: { optionId: wrong.id } } as any));
    // A duplicate of ev-2 is a no-op.
    await asUser(() => cbt.saveResponse({ attemptId: view.id, questionId: q1.id, clientEventId: 'ev-2', sequenceNumber: 2, response: { optionId: wrong.id } } as any));

    const resp = await raw.quizResponse.findFirst({ where: { attemptId: view.id, questionId: q1.id } });
    expect(resp?.response).toEqual({ optionId: right.id }); // right answer preserved
    expect(resp?.isCorrect).toBe(true);
  });

  it('A5-expiry: a save after expiry is refused and the attempt auto-submits', async () => {
    const { paper, q1 } = await makePaper();
    const view: any = await asUser(() => cbt.start({ paperId: paper.id, studentProfileId: 'stud-3' } as any));
    // Force expiry in the past (keeping expiresAt > startedAt per the CHECK).
    await raw.quizAttempt.updateMany({ where: { id: view.id }, data: { startedAt: new Date(Date.now() - 7200_000), expiresAt: new Date(Date.now() - 3600_000) } });

    let err: any;
    await asUser(() => cbt.saveResponse({ attemptId: view.id, questionId: q1.id, sequenceNumber: 1, response: {} } as any)).catch((e) => { err = e; });
    expect(err).toBeInstanceOf(BadRequestException);
    const after = await raw.quizAttempt.findFirst({ where: { id: view.id } });
    expect(after?.status).toBe('auto_submitted');
  });

  it('A5-spine: a linked attempt posts its auto score to the StudentAssessment', async () => {
    const assessments = moduleRef.get(AssessmentService);
    const marking = moduleRef.get(MarkingService);
    const { paper, q1, q2 } = await makePaper();

    // A manual assessment (maxScore 5) + a student assessment to receive the mark.
    const a: any = await asUser(() => tenant.run({ organizationId, userId: 'teacher', permissions: ['school:assessments:write', 'school:grades:write', 'school:cbt:take'] }, () => assessments.create({ subjectId: 'subj-x', classId: 'cls-x', termId: 'term-x', title: 'Quiz', maxScore: 5 } as any)));
    const sa: any = await asUser(() => tenant.run({ organizationId, userId: 'teacher', permissions: ['school:grades:write'] }, () => marking.setParticipation({ assessmentId: a.id, studentProfileId: 'stud-4', participation: 'present' } as any)));

    const view: any = await asUser(() => cbt.start({ paperId: paper.id, studentProfileId: 'stud-4', studentAssessmentId: sa.id } as any));
    const right = view.questions.find((q: any) => q.questionId === q1.id).options.find((o: any) => o.label === '4');
    await asUser(() => cbt.saveResponse({ attemptId: view.id, questionId: q1.id, sequenceNumber: 1, response: { optionId: right.id } } as any));
    await asUser(() => cbt.saveResponse({ attemptId: view.id, questionId: q2.id, sequenceNumber: 1, response: { value: 3 } } as any));
    await asUser(() => cbt.submit({ attemptId: view.id } as any));

    const updated = await raw.studentAssessment.findFirst({ where: { id: sa.id } });
    expect(Number(updated?.effectiveScore)).toBe(5);
    expect(updated?.status).toBe('graded');
  });
});
