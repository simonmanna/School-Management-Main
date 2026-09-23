/**
 * Phase 5 — examination and result integrity, proven against real Postgres.
 *
 * The exit gate for this phase is a complete simulated term-end: an examination
 * run through its lifecycle produces reproducible reports, and a correction
 * produces revision 2 without changing revision 1. That is what this spec walks,
 * end to end, with no mocked grade store and the real database triggers in play.
 */
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
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
import { ExamRegistrationService } from '../../src/modules/school/examinations/exam-ops.service';
import { ExamSessionService } from '../../src/modules/school/examinations/exam-session.service';
import { ExamMarkingService } from '../../src/modules/school/examinations/exam-marking.service';
import { QuestionPaperCustodyService } from '../../src/modules/school/examinations/question-paper-custody.service';
import { ReportDocumentService } from '../../src/modules/school/examinations/report-document.service';
import { AssessmentWorkflowService } from '../../src/modules/school/assessment/assessment-workflow.service';
import { MarkingService } from '../../src/modules/school/assessment/marking.service';
import { ResultRunService } from '../../src/modules/school/assessment/result-run.service';
import { ResultIntegrityService } from '../../src/modules/school/assessment/result-integrity.service';
import { PromotionDecisionService } from '../../src/modules/school/assessment/promotion-decision.service';
import { placeInClass } from './_placement';

describeDb('Phase 5 examination and result integrity', () => {
  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let prisma: PrismaService;
  let ops: ExamOperationsService;
  let registrations: ExamRegistrationService;
  let session: ExamSessionService;
  let marking: ExamMarkingService;
  let custody: QuestionPaperCustodyService;
  let documents: ReportDocumentService;
  let workflow: AssessmentWorkflowService;
  let marks: MarkingService;
  let results: ResultRunService;
  let integrity: ResultIntegrityService;
  let promotion: PromotionDecisionService;
  let db: any;

  const organizationId = `phase5-${randomUUID()}`;
  const run = <T>(fn: () => Promise<T>, userId = 'exam-officer') =>
    tenant.run({ organizationId, userId, permissions: ['*'] }, fn);

  const learners: string[] = [];
  let yearId = '';
  let termId = '';
  let nextTermId = '';
  let classId = '';
  let gradeLevelId = '';
  let subjectId = '';
  let course: any;
  let roster: any;
  let examId = '';
  let paperId = '';
  let questionPaperId = '';
  let venueId = '';
  let policyId = '';

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    prisma = moduleRef.get(PrismaService);
    ops = moduleRef.get(ExamOperationsService);
    registrations = moduleRef.get(ExamRegistrationService);
    session = moduleRef.get(ExamSessionService);
    marking = moduleRef.get(ExamMarkingService);
    custody = moduleRef.get(QuestionPaperCustodyService);
    documents = moduleRef.get(ReportDocumentService);
    workflow = moduleRef.get(AssessmentWorkflowService);
    marks = moduleRef.get(MarkingService);
    results = moduleRef.get(ResultRunService);
    integrity = moduleRef.get(ResultIntegrityService);
    promotion = moduleRef.get(PromotionDecisionService);
    db = prisma.raw;

    await db.currency.upsert({ where: { code: 'UGX' }, update: {}, create: { code: 'UGX', name: 'Ugandan Shilling', symbol: 'USh', decimalPlaces: 0 } });
    await db.organization.create({ data: { id: organizationId, code: organizationId, name: 'Phase 5 verification', currencyCode: 'UGX' } });
    await db.schoolProfile.create({ data: { organizationId, name: 'Phase 5 School', gradingSystem: 'generic' } }).catch(() => undefined);

    const year = await db.academicYear.create({ data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') } });
    yearId = year.id;
    termId = (await db.term.create({ data: { organizationId, academicYearId: year.id, name: 'Term 1', startDate: new Date('2026-01-10'), endDate: new Date('2026-04-10') } })).id;
    nextTermId = (await db.term.create({ data: { organizationId, academicYearId: year.id, name: 'Term 2', startDate: new Date('2026-05-01'), endDate: new Date('2026-08-01') } })).id;
    const grade = await db.gradeLevel.create({ data: { organizationId, name: 'S3', order: 11 } });
    gradeLevelId = grade.id;
    classId = (await db.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'S3 East' } })).id;
    const nextYearClass = await db.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'S4 East' } });
    // The target class is organised into sections, so a promotion decision has
    // to name the grouping the learner takes up — not leave it to be guessed.
    await db.section.create({ data: { organizationId, classId: nextYearClass.id, name: 'North' } });
    subjectId = (await db.subject.create({ data: { organizationId, code: 'MATH', name: 'Mathematics', isCore: true } })).id;
    const programme = await db.academicProgramme.create({ data: { organizationId, code: 'SEC', name: 'Secondary', effectiveFrom: year.startDate } });

    const teacherPartner = await db.partner.create({ data: { organizationId, name: 'Responsible teacher', code: 'T1' } });
    const staff = await db.staffProfile.create({ data: { organizationId, partnerId: teacherPartner.id, employeeNo: 'T1', joinDate: year.startDate } });
    course = await db.courseOffering.create({
      data: { organizationId, name: 'S3 Mathematics', academicYearId: year.id, termId, classId, subjectId, status: 'ACTIVE' },
    });
    await db.courseOfferingTeacher.create({ data: { organizationId, courseOfferingId: course.id, teacherPartnerId: staff.id, isResponsible: true, effectiveFrom: year.startDate } });

    for (let i = 0; i < 4; i += 1) {
      const p = await db.partner.create({ data: { organizationId, name: `Candidate ${i}`, code: `C${i}` } });
      const s = await db.studentProfile.create({ data: { organizationId, partnerId: p.id, admissionNo: `P5-${i}`, enrollmentDate: year.startDate } });
      await placeInClass(db, { organizationId: organizationId, studentProfileId: s.id, classId: classId });
      learners.push(s.id);
      const e = await db.studentEnrollment.create({ data: { organizationId, studentProfileId: s.id, academicYearId: year.id, programmeId: programme.id, gradeLevelId: grade.id, admissionDate: year.startDate } });
      await db.courseEnrollment.create({ data: { organizationId, courseOfferingId: course.id, studentEnrollmentId: e.id, source: 'MANUAL', startDate: year.startDate } });
    }

    // One published weighting policy, so the Phase 5 publish gate has something
    // valid to check rather than failing on missing configuration.
    const policy = await db.assessmentPolicy.create({ data: { organizationId, name: 'S3 Maths', subjectId, termId, passMark: 50 } });
    policyId = policy.id;
    await db.assessmentComponent.create({ data: { organizationId, policyId: policy.id, name: 'Exam', kind: 'exam', weight: 100, aggregation: 'mean' } });
    await db.assessmentPolicy.update({ where: { id: policy.id }, data: { publishedAt: new Date() } });

    const examType = await db.examType.create({ data: { organizationId, name: 'End of term', weight: 100, isFinal: true } });
    examId = (await db.exam.create({
      data: { organizationId, name: 'End of Term 1', examTypeId: examType.id, termId, startDate: new Date('2026-03-01'), endDate: new Date('2026-03-10') },
    })).id;

    roster = await run(() => workflow.captureRoster(course.id));
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  // ── lifecycle + candidate snapshot ────────────────────────────────────────

  it('refuses to move an examination on while its gate is unmet, and names what is missing', async () => {
    const gate = await run(() => ops.gate(examId, 'scheduled'));
    expect(gate.ready).toBe(false);
    expect(gate.conflicts.map((c) => c.code)).toContain('NO_PAPERS');
    await expect(run(() => ops.transition(examId, { target: 'scheduled' }))).rejects.toThrow(BadRequestException);
    // And an illegal edge is refused outright, gate or no gate.
    await expect(run(() => ops.transition(examId, { target: 'results_ready' }))).rejects.toThrow('cannot move');
  });

  it('walks draft → setup → scheduled once the papers exist', async () => {
    await run(() => ops.transition(examId, { target: 'setup' }));

    // The exam paper is created through the canonical assessment workflow, so
    // the paper and the assessment behind it are the same act.
    const created: any = await run(() => workflow.create({
      kind: 'exam', title: 'Mathematics Paper 1', courseOfferingId: course.id, rosterId: roster.id,
      classId, subjectId, termId, maxScore: 100, examId,
    } as any));
    paperId = (await db.examSchedule.findFirst({ where: { examId } })).id;
    expect(created.assessment.sourceRef).toBe(paperId);

    const venue = await db.examVenue.create({ data: { organizationId, name: 'Main hall', capacity: 40 } });
    venueId = venue.id;
    await db.examSchedule.update({ where: { id: paperId }, data: { venueId: venue.id, maxMarks: 100 } });

    const moved: any = await run(() => ops.transition(examId, { target: 'scheduled' }));
    expect(moved.lifecycleState).toBe('scheduled');
    // The legacy flag the older screens read is kept in step, not left to drift.
    expect(moved.status).toBe('scheduled');
  });

  it('freezes the candidate list with a verifiable checksum and refuses to lock a stale one', async () => {
    for (const studentProfileId of learners) {
      await db.examRegistration.create({ data: { organizationId, examId, studentProfileId, classId, status: 'registered' } });
    }
    // A paper with a room means candidates need seats before the list locks.
    await run(() => registrations.allocateSeats({ examId, venueId }));

    const snapshot: any = await run(() => ops.freezeCandidates(examId, {}));
    expect(snapshot.revision).toBe(1);
    expect(snapshot.candidateCount).toBe(4);

    const read: any = await run(() => ops.snapshot(snapshot.id));
    expect(read.checksumVerified).toBe(true);
    expect(read.entries).toHaveLength(4);

    // Registering a fifth candidate after the freeze must not silently join the
    // sitting: the gate sees the drift and says so.
    const extraPartner = await db.partner.create({ data: { organizationId, name: 'Late candidate', code: 'CLATE' } });
    const extra = await db.studentProfile.create({ data: { organizationId, partnerId: extraPartner.id, admissionNo: 'P5-LATE', enrollmentDate: new Date('2026-01-10') } });
    await placeInClass(db, { organizationId: organizationId, studentProfileId: extra.id, classId: classId });
    await db.examRegistration.create({ data: { organizationId, examId, studentProfileId: extra.id, classId, status: 'registered' } });
    const stale = await run(() => ops.gate(examId, 'candidates_locked'));
    expect(stale.conflicts.map((c) => c.code)).toContain('SNAPSHOT_STALE');

    // Withdraw the late candidate and re-freeze; a re-freeze needs a reason.
    await db.examRegistration.updateMany({ where: { examId, studentProfileId: extra.id }, data: { status: 'withheld' } });
    await run(() => registrations.allocateSeats({ examId, venueId }));
    const again: any = await run(() => ops.freezeCandidates(examId, { reason: 'Late registration withdrawn' }));
    expect(again.revision).toBe(2);
    expect(again.candidateCount).toBe(4);
    expect(await run(() => ops.gate(examId, 'candidates_locked'))).toMatchObject({ ready: true });
  });

  it('records question-paper custody as an append-only, verifiable chain', async () => {
    questionPaperId = (await db.questionPaper.create({
      data: { organizationId, examScheduleId: paperId, title: 'Mathematics Paper 1', paperKind: 'theory', totalMarks: 100 },
    })).id;

    // Papers cannot move before they are sealed, and sealing needs a seal number.
    await expect(run(() => custody.record(questionPaperId, { action: 'dispatched', custodianName: 'Courier' }))).rejects.toThrow('sealing');
    await expect(run(() => custody.record(questionPaperId, { action: 'sealed' }))).rejects.toThrow('seal number');

    await run(() => custody.record(questionPaperId, { action: 'authored', actorName: 'Setter' }));
    await run(() => custody.record(questionPaperId, { action: 'printed', copies: 50 }));
    await run(() => custody.record(questionPaperId, { action: 'sealed', sealNumber: 'SEAL-001', copies: 50 }));
    await run(() => custody.record(questionPaperId, { action: 'dispatched', custodianName: 'Head of centre', location: 'Strong room' }));

    const chain: any = await run(() => custody.chain(questionPaperId));
    expect(chain.chainIntact).toBe(true);
    expect(chain.events).toHaveLength(4);
    expect(chain.currentCustodian.name).toBe('Head of centre');
    // Going backwards in the custody order is refused rather than silently logged.
    await expect(run(() => custody.record(questionPaperId, { action: 'printed' }))).rejects.toThrow('cannot come after');

    // The log is evidence: the database itself refuses an edit or a deletion.
    await expect(db.questionPaperCustodyEvent.update({ where: { id: chain.events[0].id }, data: { note: 'tampered' } })).rejects.toThrow('append-only');
    await expect(db.questionPaperCustodyEvent.deleteMany({ where: { id: chain.events[0].id } })).rejects.toThrow('append-only');
  });

  // ── the sitting ───────────────────────────────────────────────────────────

  it('records the register, and an absence becomes a recorded absence rather than a zero', async () => {
    await run(() => ops.transition(examId, { target: 'candidates_locked' }));
    const invigilatorStaff = await db.invigilator.create({ data: { organizationId, name: 'Invigilator One' } });
    await db.invigilatorAssignment.create({ data: { organizationId, examScheduleId: paperId, invigilatorId: invigilatorStaff.id } });
    await run(() => ops.transition(examId, { target: 'in_progress' }));

    const register: any = await run(() => session.register(paperId));
    expect(register.rows).toHaveLength(4);
    expect(register.summary.recorded).toBe(0);

    await run(() => session.recordAttendance(paperId, {
      rows: [
        { studentProfileId: learners[0], status: 'present' },
        { studentProfileId: learners[1], status: 'present' },
        { studentProfileId: learners[2], status: 'present' },
        { studentProfileId: learners[3], status: 'absent', note: 'Did not attend' },
      ],
    }));

    const assessment = await db.assessment.findFirst({ where: { sourceType: 'exam_session', sourceRef: paperId } });
    const absent = await db.studentAssessment.findFirst({ where: { assessmentId: assessment.id, studentProfileId: learners[3] } });
    expect(absent.participation).toBe('absent');
    expect(absent.effectiveScore).toBeNull();

    // A learner who is not a candidate cannot be added through the register.
    await expect(run(() => session.recordAttendance(paperId, { rows: [{ studentProfileId: 'stranger', status: 'present' }] })))
      .rejects.toThrow('not candidates');
  });

  it('approves an access arrangement only from a second person, and an exemption excludes the paper', async () => {
    const request: any = await run(() => session.requestConsideration({
      examId, studentProfileId: learners[3], examScheduleId: paperId,
      type: 'aegrotat', reason: 'Admitted to hospital', exemptsFromResult: true,
    }), 'welfare-officer');

    await expect(run(() => session.decideConsideration(request.id, { status: 'approved' }), 'welfare-officer'))
      .rejects.toThrow('other than whoever requested');
    await expect(run(() => session.decideConsideration(request.id, { status: 'rejected' }), 'head-teacher'))
      .rejects.toThrow('reason');

    const decided: any = await run(() => session.decideConsideration(request.id, { status: 'approved', decisionNote: 'Medical evidence seen' }), 'head-teacher');
    expect(decided.papersExempted).toBe(1);

    const assessment = await db.assessment.findFirst({ where: { sourceType: 'exam_session', sourceRef: paperId } });
    const row = await db.studentAssessment.findFirst({ where: { assessmentId: assessment.id, studentProfileId: learners[3] } });
    expect(row.participation).toBe('exempt');
  });

  // ── marking ───────────────────────────────────────────────────────────────

  it('double-marks blind, withholds identity from the marker, and refuses two reads by one marker', async () => {
    await run(() => ops.configurePaper(paperId, { markingMode: 'blind_double', markToleranceMarks: 5 }));

    // A draft assessment cannot receive a mark, and the gate says so by name
    // rather than failing later inside the mark writer.
    const blocked = await run(() => ops.gate(examId, 'marking'));
    expect(blocked.conflicts.map((c) => c.code)).toContain('PAPER_ASSESSMENT_NOT_PUBLISHED');

    const draft = await db.assessment.findFirst({ where: { sourceType: 'exam_session', sourceRef: paperId } });
    await run(() => workflow.transition(draft.id, { action: 'publish', expectedVersion: draft.version }));
    await run(() => ops.transition(examId, { target: 'marking' }));

    await expect(run(() => marking.allocate(paperId, { markerIds: ['marker-a'] }))).rejects.toThrow('at least 2');
    const allocation: any = await run(() => marking.allocate(paperId, { markerIds: ['marker-a', 'marker-b'] }));
    expect(allocation.created).toBe(6); // 3 candidates who sat, two reads each

    // The database refuses the same person as both readers of one script.
    const first = await db.scriptAllocation.findFirst({ where: { examScheduleId: paperId, role: 'first' } });
    await expect(db.scriptAllocation.update({ where: { id: first.id }, data: { markerId: 'marker-b' } })).rejects.toThrow('twice by the same marker');

    // A marker sees a code, not a candidate — and only their own scripts.
    const worklist: any = await tenant.run(
      { organizationId, userId: 'marker-a', permissions: ['school:exams:mark'] },
      () => marking.worklist(paperId),
    );
    expect(worklist.blind).toBe(true);
    expect(worklist.rows.length).toBe(3);
    expect(worklist.rows.every((r: any) => r.studentProfileId === undefined && r.studentName === undefined)).toBe(true);
    expect(worklist.rows.every((r: any) => /^[0-9A-F]{8}$/.test(r.anonymousCode))).toBe(true);

    // A marker may not write another marker's script.
    const someoneElses = await db.scriptAllocation.findFirst({ where: { examScheduleId: paperId, markerId: 'marker-b' } });
    await expect(tenant.run(
      { organizationId, userId: 'marker-a', permissions: ['school:exams:mark'] },
      () => marking.submitScriptMark(someoneElses.id, { score: 50 }),
    )).rejects.toThrow('allocated to you');
  });

  it('agrees marks within tolerance, demands a third read outside it, and posts only the agreed mark', async () => {
    const scriptsOf = async (studentProfileId: string) =>
      db.scriptAllocation.findMany({ where: { examScheduleId: paperId, studentProfileId }, orderBy: { role: 'asc' } });

    // Two learners agree; the third is far apart.
    const pairs: Array<[string, number, number]> = [
      [learners[0], 70, 72],
      [learners[1], 55, 55],
      [learners[2], 40, 80],
    ];
    for (const [studentProfileId, a, b] of pairs) {
      const rows = await scriptsOf(studentProfileId);
      for (const row of rows) {
        await tenant.run(
          { organizationId, userId: row.markerId, permissions: ['school:exams:mark'] },
          () => marking.submitScriptMark(row.id, { score: row.role === 'first' ? a : b, expectedVersion: row.version }),
        );
      }
    }

    const board: any = await run(() => marking.reconciliationBoard(paperId));
    expect(board.summary.needsThirdRead).toBe(1);

    const outcome: any = await run(() => marking.reconcile(paperId, {}));
    expect(outcome.agreed).toBe(2);
    expect(outcome.blocked).toEqual([expect.objectContaining({ studentProfileId: learners[2], code: 'OUT_OF_TOLERANCE' })]);

    const assessment = await db.assessment.findFirst({ where: { sourceType: 'exam_session', sourceRef: paperId } });
    const agreed = await db.studentAssessment.findFirst({ where: { assessmentId: assessment.id, studentProfileId: learners[0] } });
    expect(Number(agreed.effectiveScore)).toBe(71); // the mean of 70 and 72
    // Both independent reads survive on the ledger behind the agreed mark.
    const rounds = await db.markEntry.findMany({ where: { studentAssessmentId: agreed.id } });
    expect(rounds.map((r: any) => r.round).sort()).toEqual(['first', 'reconciliation', 'second_blind']);

    // A third read settles the disputed script.
    const third = await db.scriptAllocation.create({
      data: {
        organizationId, examScheduleId: paperId, studentProfileId: learners[2],
        anonymousCode: (await scriptsOf(learners[2]))[0].anonymousCode,
        markerId: 'chief-examiner', role: 'reconciliation', maxScore: 100, score: 62, status: 'submitted',
      },
    });
    expect(third.id).toBeTruthy();
    const settled: any = await run(() => marking.reconcile(paperId, { studentProfileIds: [learners[2]], note: 'Third read' }));
    expect(settled.agreed).toBe(1);
    const disputed = await db.studentAssessment.findFirst({ where: { assessmentId: assessment.id, studentProfileId: learners[2] } });
    expect(Number(disputed.effectiveScore)).toBe(62);
  });

  it('draws a reproducible moderation sample and applies an out-of-tolerance re-mark as an adjustment', async () => {
    await run(() => ops.transition(examId, { target: 'moderation' }));
    const first: any = await run(() => marking.drawSample(paperId, { method: 'stratified', sampleSize: 2, seed: 'fixed-seed', toleranceMarks: 2 }));
    const second: any = await run(() => marking.drawSample(paperId, { method: 'stratified', sampleSize: 2, seed: 'fixed-seed', toleranceMarks: 2 }));
    expect(first.items.map((i: any) => i.studentProfileId).sort()).toEqual(second.items.map((i: any) => i.studentProfileId).sort());

    const target = first.items[0];
    const original = Number(target.originalScore);
    const recorded: any = await run(() => marking.recordModeration(first.id, {
      items: [{ studentProfileId: target.studentProfileId, moderatedScore: original + 10, comment: 'Question 4 under-credited' }],
      note: 'Moderated by HOD',
    }), 'moderator');
    expect(recorded.status).toBe('adjusted');
    expect(recorded.adjusted).toBe(1);

    const assessment = await db.assessment.findFirst({ where: { sourceType: 'exam_session', sourceRef: paperId } });
    const row = await db.studentAssessment.findFirst({ where: { assessmentId: assessment.id, studentProfileId: target.studentProfileId } });
    expect(Number(row.effectiveScore)).toBe(original + 10);
    // The marker's original score is preserved; the change is a ledger entry.
    expect(Number(row.originalScore)).toBe(original);
    const adjustments = await db.markAdjustment.findMany({ where: { studentAssessmentId: row.id } });
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].kind).toBe('moderation');
  });

  // ── results ───────────────────────────────────────────────────────────────

  it('blocks a result publish while the exam paper is still open, and explains why', async () => {
    // Marks must be approved before results can be published at all.
    const assessment = await db.assessment.findFirst({ where: { sourceType: 'exam_session', sourceRef: paperId } });
    await run(() => marks.markingApproval({ assessmentId: assessment.id, action: 'submit' }), 'marker-a');
    await run(() => marks.markingApproval({ assessmentId: assessment.id, action: 'approve' }), 'head-teacher');

    const set: any = await run(() => results.compute({ termId, rosterId: roster.id }));
    const readiness: any = await run(() => results.readiness(set.id));
    expect(readiness.ready).toBe(false);
    expect(readiness.conflicts.map((c: any) => c.code)).toContain('EXAM_PAPER_UNLOCKED');
    expect(readiness.summary.examPapersLocked).toBe(false);
    expect(readiness.summary.weightingValid).toBe(true);
  });

  it('closes the examination, which locks every paper, and then the results publish', async () => {
    await run(() => ops.transition(examId, { target: 'results_ready' }));
    const closed: any = await run(() => ops.transition(examId, { target: 'closed' }));
    expect(closed.lifecycleState).toBe('closed');
    const paper = await db.examSchedule.findFirst({ where: { id: paperId } });
    expect(paper.marksLockedAt).not.toBeNull();

    const set: any = await run(() => results.compute({ termId, rosterId: roster.id }));
    const readiness: any = await run(() => results.readiness(set.id));
    expect(readiness.conflicts).toEqual([]);
    expect(readiness.ready).toBe(true);
    expect(readiness.summary.participationUnresolved).toBe(0);

    const published: any = await run(() => results.publish(set.id));
    expect(published.status).toBe('published');
    (globalThis as any).__p5set = set.id;
  });

  it('explains a published number from the frozen breakdown the run recorded', async () => {
    const setId = (globalThis as any).__p5set;
    const explanation: any = await run(() => integrity.explain(setId, learners[0]));
    expect(explanation.resultSet.outputChecksum).toBeTruthy();
    const maths = explanation.subjects.find((s: any) => s.subjectId === subjectId);
    expect(maths.subjectName).toBe('Mathematics');
    expect(maths.componentBreakdown.length).toBeGreaterThan(0);
    expect(maths.evidence.some((e: any) => e.kind === 'exam' && e.counted)).toBe(true);

    // An exempted candidate's paper is shown as left out — never as a zero.
    const exempt: any = await run(() => integrity.explain(setId, learners[3]));
    const exemptSubject = exempt.subjects.find((s: any) => s.subjectId === subjectId);
    expect(exemptSubject?.evidence?.every((e: any) => !e.counted) ?? true).toBe(true);
  });

  it('issues reproducible report documents that pin the result set and template version', async () => {
    const setId = (globalThis as any).__p5set;
    const issued: any = await run(() => documents.generate({ resultSetId: setId }));
    expect(issued.issued).toBeGreaterThan(0);
    expect(issued.templateVersionId).toHaveLength(24);

    // Running it again issues nothing new — a document is not silently duplicated.
    const rerun: any = await run(() => documents.generate({ resultSetId: setId }));
    expect(rerun.issued).toBe(0);

    const list: any = await run(() => documents.list({ resultSetId: setId }));
    const detail: any = await run(() => documents.detail(list[0].id));
    expect(detail.checksumVerified).toBe(true);
    expect(detail.resultSetRevision).toBe(detail.resultSet.revision);

    await run(() => documents.publish({ documentIds: [list[0].id] }));
    const afterPublish: any = await run(() => documents.detail(list[0].id));
    expect(afterPublish.status).toBe('published');
    // A published document is frozen at the database boundary.
    await expect(db.reportDocument.update({ where: { id: list[0].id }, data: { payload: { tampered: true } } }))
      .rejects.toThrow('immutable');
  });

  it('a correction produces revision 2 without changing revision 1', async () => {
    const setId = (globalThis as any).__p5set;
    const before = await db.resultSet.findFirst({ where: { id: setId }, include: { termResults: true } });
    const beforeChecksum = before.outputChecksum;

    const amendment: any = await run(() => results.requestAmendment({ resultSetId: setId, reason: 'Question 7 re-credited' }), 'class-teacher');
    await expect(run(() => integrity.rejectAmendment(amendment.id, ''), 'head-teacher')).rejects.toThrow('reason');

    // The requester cannot decide their own amendment.
    await expect(run(() => integrity.rejectAmendment(amendment.id, 'No'), 'class-teacher')).rejects.toThrow('other than whoever requested');

    const next: any = await run(() => results.approveAmendment(amendment.id), 'head-teacher');
    expect(next.revision).toBe(before.revision + 1);

    const original = await db.resultSet.findFirst({ where: { id: setId }, include: { termResults: true } });
    expect(original.status).toBe('archived');
    expect(original.outputChecksum).toBe(beforeChecksum);
    expect(original.termResults).toHaveLength(before.termResults.length);
    // Revision 1's published report document still reproduces exactly.
    const documentsForOne: any = await run(() => documents.list({ resultSetId: setId }));
    const stillGood: any = await run(() => documents.detail(documentsForOne[0].id));
    expect(stillGood.checksumVerified).toBe(true);
    (globalThis as any).__p5set2 = next.id;
  });

  // ── promotion ─────────────────────────────────────────────────────────────

  it('proposes, decides and applies a promotion as three separate acts', async () => {
    const setId = (globalThis as any).__p5set2;
    await expect(run(() => promotion.propose({ resultSetId: setId }))).rejects.toThrow('published result set');

    await run(() => results.publish(setId));
    const proposal: any = await run(() => promotion.propose({ resultSetId: setId }));
    expect(proposal.proposed).toBeGreaterThan(0);

    const board: any = await run(() => promotion.board(setId));
    expect(board.rows.every((r: any) => r.status === 'proposed')).toBe(true);

    const nextClass = await db.schoolClass.findFirst({ where: { organizationId, name: 'S4 East' } });
    const one = board.rows[0];

    // Departing from the recommendation needs a reason, and a promotion needs
    // somewhere to go. Both are refused before anything is written.
    await expect(run(() => promotion.decide({ rows: [{ id: one.id, status: 'approved', decision: 'promote', toClassId: nextClass.id }] })))
      .rejects.toThrow('needs a reason');
    await expect(run(() => promotion.decide({ rows: [{ id: one.id, status: 'approved', decision: 'promote', reason: 'Board decision' }] })))
      .rejects.toThrow('class the learner moves into');
    expect((await db.promotionDecision.findFirst({ where: { id: one.id } })).status).toBe('proposed');

    const section = await db.section.findFirst({ where: { organizationId, classId: nextClass.id } });
    await run(() => promotion.decide({
      rows: [{ id: one.id, status: 'approved', decision: 'promote', toClassId: nextClass.id, toSectionId: section.id, reason: 'Board decision' }],
    }));

    // Applying is the only act that moves a learner, and it appends to history.
    const applied: any = await run(() => promotion.apply({ resultSetId: setId, toTermId: nextTermId }));
    expect(applied.skipped).toEqual([]);
    expect(applied.applied).toBe(1);
    const decision = await db.promotionDecision.findFirst({ where: { id: one.id } });
    expect(decision.status).toBe('applied');
    expect(decision.enrollmentPlacementId).toBeTruthy();
    const placement = await db.enrollmentPlacement.findFirst({ where: { id: decision.enrollmentPlacementId } });
    expect(placement.movementReason).toBe('PROMOTION');
    expect(placement.sectionId).toBe(section.id);
    expect(placement.termId).toBe(nextTermId);
    // A decision already applied cannot be quietly re-decided.
    await expect(run(() => promotion.decide({ rows: [{ id: one.id, status: 'rejected', reason: 'Changed our minds' }] })))
      .rejects.toThrow('already been applied');
  });

  it('keeps every Phase 5 table inside its own tenant', async () => {
    const other = `phase5-other-${randomUUID()}`;
    await expect(tenant.run({ organizationId: other, permissions: ['*'] }, () => ops.overview(examId))).rejects.toThrow('not found');
    await expect(tenant.run({ organizationId: other, permissions: ['*'] }, () => custody.chain(questionPaperId))).rejects.toThrow('not found');
    await expect(tenant.run({ organizationId: other, permissions: ['*'] }, () => marking.reconciliationBoard(paperId))).rejects.toThrow('not found');
    const documentsElsewhere = await tenant.run({ organizationId: other, permissions: ['*'] }, () => documents.list({ termId }));
    expect(documentsElsewhere).toHaveLength(0);
    expect(policyId).toBeTruthy();
    expect(yearId).toBeTruthy();
    expect(gradeLevelId).toBeTruthy();
  });

  it('refuses an optimistic-concurrency clash on the lifecycle', async () => {
    const exam = await db.exam.findFirst({ where: { id: examId } });
    await expect(run(() => ops.transition(examId, { target: 'archived', expectedVersion: exam.version - 1 })))
      .rejects.toThrow(ConflictException);
  });
});
