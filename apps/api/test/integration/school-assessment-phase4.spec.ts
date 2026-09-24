import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { describeDb } from './_setup';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';
import { PrismaService } from '../../src/kernel/prisma/prisma.service';
import { MarkingService } from '../../src/modules/school/assessment/marking.service';
import { AssessmentWorkflowService } from '../../src/modules/school/assessment/assessment-workflow.service';
import { AssessmentPolicyService } from '../../src/modules/school/assessment/assessment-config.service';
import { ASSESSMENT_KINDS } from '../../src/modules/school/assessment/assessment-board.dto';
import { AssignmentService } from '../../src/modules/school/assessment/assignment.service';
import { PortalIdentityService } from '../../src/kernel/auth/portal-identity.service';
import { TeachingWorkspaceService } from '../../src/modules/school/teaching/teaching-workspace.service';
import { placeInClass, upsertEnrollment } from './_placement';

/** Real Postgres transactions and triggers; no web server, Redis, or mocked grade store. */
describeDb('Phase 4 canonical assessment workflow', () => {
  const tenant = new TenantContextService();
  const prisma = new PrismaService(tenant);
  const audit = { recordInTx: jest.fn(async () => undefined) } as any;
  const identity = { staffProfileIdForCaller: jest.fn(async () => 'not-allocated') } as any;
  const marking = new MarkingService(prisma, tenant, audit, { publish: jest.fn() } as any, identity, { assertOwnsStaffRecord: jest.fn() } as any);
  const workflow = new AssessmentWorkflowService(prisma, tenant, audit, marking);
  const policies = new AssessmentPolicyService(prisma, tenant, audit);
  const assignments = new AssignmentService(prisma, tenant, audit, { publish: jest.fn() } as any, marking, new PortalIdentityService(prisma, tenant));
  const organizationId = `phase4-${randomUUID()}`;
  const db: any = prisma.raw;
  let course: any;
  let roster: any;
  let examId: string;
  const learners: string[] = [];
  const run = <T>(fn: () => Promise<T>, userId = 'phase4-marker') => tenant.run({ organizationId, userId, permissions: ['*'] }, fn);
  const draft = async (kind = 'assignment') => (await run(() => workflow.create({ kind, title: `Test ${kind}`, courseOfferingId: course.id, rosterId: roster.id, classId: course.classId, subjectId: course.subjectId, termId: course.termId, maxScore: 100, ...(kind === 'exam' ? { examId } : {}) }))).assessment;
  const published = async () => { const a = await draft(); return run(() => workflow.transition(a.id, { action: 'publish', expectedVersion: a.version })); };
  const marks = (score = 75, expectedVersion = 0) => ({ rows: learners.map((studentProfileId) => ({ studentProfileId, marks: score, participation: 'present', comment: 'Evidence recorded', expectedVersion })) });
  const historyCount = async (assessmentId: string) => db.studentAssessmentHistory.count({ where: { studentAssessmentId: { in: (await db.studentAssessment.findMany({ where: { assessmentId }, select: { id: true } })).map((r: any) => r.id) } } });

  beforeAll(async () => {
    await prisma.onModuleInit();
    await db.currency.upsert({ where: { code: 'UGX' }, update: {}, create: { code: 'UGX', name: 'Ugandan Shilling', symbol: 'USh', decimalPlaces: 0 } });
    await db.organization.create({ data: { id: organizationId, code: organizationId, name: 'Phase 4 verification', currencyCode: 'UGX' } });
    const year = await db.academicYear.create({ data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') } });
    const term = await db.term.create({ data: { organizationId, academicYearId: year.id, name: 'Term', startDate: year.startDate, endDate: year.endDate } });
    const grade = await db.gradeLevel.create({ data: { organizationId, name: 'S2', order: 9 } });
    const cls = await db.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'S2' } });
    const subject = await db.subject.create({ data: { organizationId, name: 'Mathematics', code: 'MATH' } });
    const programme = await db.academicProgramme.create({ data: { organizationId, code: 'SEC', name: 'Secondary', effectiveFrom: year.startDate } });
    const teacher = await db.partner.create({ data: { organizationId, name: 'Teacher', code: 'T' } });
    const staff = await db.staffProfile.create({ data: { organizationId, partnerId: teacher.id, employeeNo: 'T', joinDate: year.startDate } });
    course = await db.courseOffering.create({ data: { organizationId, name: 'S2 Mathematics', academicYearId: year.id, termId: term.id, classId: cls.id, subjectId: subject.id, status: 'ACTIVE' } });
    await db.courseOfferingTeacher.create({ data: { organizationId, courseOfferingId: course.id, teacherPartnerId: staff.id, isResponsible: true, effectiveFrom: year.startDate } });
    for (let i = 0; i < 3; i++) {
      const p = await db.partner.create({ data: { organizationId, name: `Learner ${i}`, code: `S${i}` } });
      const s = await db.studentProfile.create({ data: { organizationId, partnerId: p.id, admissionNo: `S${i}`, enrollmentDate: year.startDate } });
      await placeInClass(db, { organizationId: organizationId, studentProfileId: s.id, classId: cls.id });
      learners.push(s.id);
      const e = await upsertEnrollment(db, { data: { organizationId, studentProfileId: s.id, academicYearId: year.id, programmeId: programme.id, gradeLevelId: grade.id, admissionDate: year.startDate } });
      await db.courseEnrollment.create({ data: { organizationId, courseOfferingId: course.id, studentEnrollmentId: e.id, source: 'MANUAL', startDate: year.startDate } });
    }
    const type = await db.examType.create({ data: { organizationId, name: 'Term exam', weight: 100 } });
    examId = (await db.exam.create({ data: { organizationId, name: 'Term exam', examTypeId: type.id, termId: term.id, startDate: year.startDate, endDate: year.endDate } })).id;
    roster = await run(() => workflow.captureRoster(course.id));
  });
  afterAll(async () => { await prisma.onModuleDestroy(); });

  it('captures official enrollment and freezes membership at the database boundary', async () => {
    expect(roster.memberCount).toBe(3);
    await expect(db.academicRosterMember.deleteMany({ where: { rosterId: roster.id } })).rejects.toThrow('Frozen academic roster');
    // Leaving the class = the placement ends (history kept), not a profile edit.
    await db.enrollmentPlacement.updateMany({
      where: { enrollment: { studentProfileId: learners[0] }, effectiveTo: null },
      data: { effectiveTo: new Date(), endReason: 'WITHDRAWAL' },
    });
    expect(await db.academicRosterMember.count({ where: { rosterId: roster.id } })).toBe(3);
  });
  it.each(ASSESSMENT_KINDS)('creates %s through the same draft workflow', async (kind) => {
    const a = await draft(kind);
    expect(a).toMatchObject({ kind, status: 'draft', hiddenFromStudents: true, courseOfferingId: course.id, rosterId: roster.id });
    expect(await db.homeworkAssignment.count({ where: { assessmentId: a.id } })).toBe(0);
    expect(await db.assignment.count({ where: { assessmentId: a.id } })).toBe(kind === 'exam' ? 0 : 1);
  });
  it('rejects wrong course context and unallocated staff', async () => {
    await expect(run(() => workflow.create({ kind: 'cat', title: 'Bad', courseOfferingId: course.id, rosterId: roster.id, classId: 'other', subjectId: course.subjectId, termId: course.termId }))).rejects.toThrow('selected course');
    await expect(tenant.run({ organizationId, userId: 'intruder', permissions: ['school:grades:own'] }, () => workflow.captureRoster(course.id))).rejects.toThrow('currently teach');
    await expect(tenant.run({ organizationId: 'other-tenant', permissions: ['*'] }, () => workflow.captureRoster(course.id))).rejects.toThrow('not found');
  });
  it('requires publication, fans exactly the frozen roster, rejects outsiders', async () => {
    const a = await draft();
    await expect(run(() => workflow.saveBulk(a.id, marks(), randomUUID()))).rejects.toThrow(ConflictException);
    await run(() => workflow.transition(a.id, { action: 'publish', expectedVersion: a.version }));
    expect(await db.studentAssessment.count({ where: { assessmentId: a.id } })).toBe(3);
    await expect(run(() => workflow.saveBulk(a.id, { rows: [{ ...marks().rows[0], studentProfileId: 'outsider' }] }, randomUUID()))).rejects.toThrow('not on');
    await expect(run(() => workflow.transition(a.id, { action: 'publish', expectedVersion: a.version }))).rejects.toThrow(ConflictException);
  });
  it('rolls back the whole batch when a later score is invalid', async () => {
    const a = await published(); const payload = marks(); payload.rows[2].marks = 101;
    await expect(run(() => workflow.saveBulk(a.id, payload, randomUUID()))).rejects.toThrow(BadRequestException);
    const rows = await db.studentAssessment.findMany({ where: { assessmentId: a.id } });
    expect(rows.every((r: any) => r.effectiveScore === null && r.version === 0)).toBe(true);
    expect(await db.markEntry.count({ where: { studentAssessment: { assessmentId: a.id } } })).toBe(0);
  });
  it('replays an exact idempotent response, never duplicates history, refuses key reuse', async () => {
    const a = await published(); const key = randomUUID(); const payload = marks();
    const first = await run(() => workflow.saveBulk(a.id, payload, key));
    expect(await run(() => workflow.saveBulk(a.id, payload, key))).toEqual(first);
    expect(await historyCount(a.id)).toBe(3);
    await expect(run(() => workflow.saveBulk(a.id, marks(80), key))).rejects.toThrow('different draft');
  });
  it('rejects stale versions with actionable server values and prevents simultaneous overwrite', async () => {
    const a = await published();
    const attempts = await Promise.allSettled([run(() => workflow.saveBulk(a.id, marks(70), randomUUID())), run(() => workflow.saveBulk(a.id, marks(80), randomUUID()))]);
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((r) => r.status === 'rejected')).toHaveLength(1);
    try { await run(() => workflow.saveBulk(a.id, marks(90), randomUUID())); throw new Error('Expected conflict'); }
    catch (error: any) { expect(error.getResponse()).toMatchObject({ code: 'MARK_VERSION_CONFLICT', conflicts: expect.arrayContaining([expect.objectContaining({ studentProfileId: learners[0], version: expect.any(Number) })]) }); }
    expect(await historyCount(a.id)).toBe(3);
  });
  it('supports return/correct/resubmit, maker-checker and separate release', async () => {
    const a = await published();
    await expect(run(() => marking.markingApproval({ assessmentId: a.id, action: 'submit' }))).rejects.toThrow('Every learner');
    const saved = await run(() => workflow.saveBulk(a.id, marks(), randomUUID()));
    await run(() => marking.markingApproval({ assessmentId: a.id, action: 'submit' }));
    await expect(run(() => workflow.saveBulk(a.id, marks(80, saved.rows[0].version + 1), randomUUID()))).rejects.toThrow('read-only');
    await expect(run(() => marking.markingApproval({ assessmentId: a.id, action: 'approve' }))).rejects.toThrow('cannot approve');
    await expect(run(() => marking.markingApproval({ assessmentId: a.id, action: 'reject' }), 'checker')).rejects.toThrow('reason');
    await run(() => marking.markingApproval({ assessmentId: a.id, action: 'reject', reason: 'Check evidence' }), 'checker');
    await run(() => workflow.saveBulk(a.id, marks(80, saved.rows[0].version + 2), randomUUID()));
    await run(() => marking.markingApproval({ assessmentId: a.id, action: 'resubmit' }));
    await run(() => marking.markingApproval({ assessmentId: a.id, action: 'approve' }), 'checker');
    const approved = await db.assessment.findUnique({ where: { id: a.id } }); expect(approved.marksReleaseAt).toBeNull();
    const feedback = await run(() => workflow.transition(a.id, { action: 'release_feedback', expectedVersion: approved.version }), 'checker');
    expect(feedback.feedbackReleaseAt).not.toBeNull(); expect(feedback.marksReleaseAt).toBeNull();
    const released = await run(() => workflow.transition(a.id, { action: 'release_marks', expectedVersion: feedback.version }), 'checker');
    expect(released.hiddenFromStudents).toBe(false); expect(released.marksReleaseAt).not.toBeNull();
  });
  it('publishes immutable policy revisions and forks without moving old assessments', async () => {
    const p = await db.assessmentPolicy.create({ data: { organizationId, name: 'Weights', termId: course.termId } });
    await expect(run(() => policies.publish(p.id))).rejects.toThrow('100%');
    const component = await db.assessmentComponent.create({ data: { organizationId, policyId: p.id, name: 'Coursework', kind: 'cat', weight: 100 } });
    await run(() => policies.publish(p.id));
    await expect(db.assessmentComponent.update({ where: { id: component.id }, data: { weight: 90 } })).rejects.toThrow('immutable');
    await expect(run(() => policies.update(p.id, { name: 'Mutated' }))).rejects.toThrow('immutable');
    const next = await run(() => policies.fork(p.id)); expect(next.revision).toBe(2); expect(next.supersedesId).toBe(p.id); expect(next.publishedAt).toBeNull();
    expect((await run(() => policies.fork(p.id))).id).toBe(next.id);
  });
  it('supports non-subject observations without inventing academic context', async () => {
    const wide = await db.courseOffering.create({ data: { organizationId, academicYearId: course.academicYearId, termId: course.termId, offeringType: 'SCHOOL_WIDE', audienceScope: 'SCHOOL', name: 'School teamwork', status: 'ACTIVE' } });
    const teacher = await db.courseOfferingTeacher.findFirst({ where: { courseOfferingId: course.id } });
    await db.courseOfferingTeacher.create({ data: { organizationId, courseOfferingId: wide.id, teacherPartnerId: teacher.teacherPartnerId, effectiveFrom: new Date('2026-01-01'), isResponsible: true } });
    const enrollments = await db.courseEnrollment.findMany({ where: { courseOfferingId: course.id } });
    for (const e of enrollments) await db.courseEnrollment.create({ data: { organizationId, courseOfferingId: wide.id, studentEnrollmentId: e.studentEnrollmentId, source: 'MANUAL', startDate: e.startDate } });
    const snapshot = await run(() => workflow.captureRoster(wide.id));
    const result = await run(() => workflow.create({ kind: 'observation', title: 'Teamwork', courseOfferingId: wide.id, rosterId: snapshot.id, termId: wide.termId, gradingMode: 'complete_incomplete' }));
    expect(result.assessment.subjectId).toBeNull(); expect(result.assessment.classId).toBeNull();
    await run(() => workflow.transition(result.assessment.id, { action: 'publish', expectedVersion: 0 }));
    expect((await run(() => workflow.saveBulk(result.assessment.id, marks(), randomUUID()))).saved).toBe(3);
  });
  it('enforces learner identity, submission attempts, rubric criteria, versions and evidence', async () => {
    const rubric = await db.rubric.create({ data: { organizationId, name: 'Observation checklist' } });
    const criterion = await db.rubricCriterion.create({ data: { organizationId, rubricId: rubric.id, name: 'Demonstrates skill', maxScore: 10, weight: 1, order: 0 } });
    const result = await run(() => workflow.create({ kind: 'observation', title: 'Practical evidence', courseOfferingId: course.id, rosterId: roster.id, termId: course.termId, classId: course.classId, subjectId: course.subjectId, gradingMode: 'rubric', rubricId: rubric.id, maxAttempts: 1 }));
    await run(() => workflow.transition(result.assessment.id, { action: 'publish', expectedVersion: 0 }));
    const assignment = await db.assignment.findFirst({ where: { assessmentId: result.assessment.id } });
    const learner = <T>(fn: () => Promise<T>) => tenant.run({ organizationId, userId: 'learner', portal: { kind: 'student', studentProfileId: learners[0] } }, fn);
    await expect(learner(() => assignments.submit({ assignmentId: assignment.id, studentProfileId: learners[1] }))).rejects.toThrow('cannot submit');
    await learner(() => assignments.submit({ assignmentId: assignment.id, studentProfileId: learners[0], content: 'Observed demonstration' }));
    await expect(learner(() => assignments.submit({ assignmentId: assignment.id, studentProfileId: learners[0] }))).rejects.toThrow('Maximum');
    const base = { assignmentId: assignment.id, studentProfileId: learners[0], expectedVersion: 1 };
    await expect(run(() => assignments.grade({ ...base, rubricScores: [{ criterionId: criterion.id, score: 11 }] }))).rejects.toThrow('outside');
    const graded = await run(() => assignments.grade({ ...base, rubricScores: [{ criterionId: criterion.id, score: 8 }], feedback: 'Clear demonstration' }));
    expect(Number(graded.effectiveScore)).toBe(80); expect(graded.feedback).toBe('Clear demonstration');
    await expect(run(() => assignments.grade({ ...base, rubricScores: [{ criterionId: criterion.id, score: 9 }] }))).rejects.toThrow(ConflictException);
    const evidence = await run(() => workflow.evidence(result.assessment.id, learners[0])); expect(evidence.assignmentSubmissions).toHaveLength(1); expect(evidence.rubricScores).toHaveLength(1); expect(evidence.history).toHaveLength(1);
  });
  it('reconciles missing historical binding without losing a learner or changing marks', async () => {
    const a = await db.assessment.create({ data: { organizationId, kind: 'cat', title: 'Legacy', classId: course.classId, subjectId: course.subjectId, termId: course.termId, status: 'published' } });
    await db.studentAssessment.create({ data: { organizationId, assessmentId: a.id, studentProfileId: learners[0], maxScore: 100 } });
    const fixed = await run(() => workflow.reconcileContext(a.id, { courseOfferingId: course.id, rosterId: roster.id, expectedVersion: 0, reason: 'Verified original enrollment' }));
    expect(fixed.rosterId).toBe(roster.id); expect(await db.studentAssessment.count({ where: { assessmentId: a.id } })).toBe(3);
    await expect(run(() => workflow.reconcileContext(a.id, { courseOfferingId: course.id, rosterId: roster.id, expectedVersion: 1, reason: 'Replace' }))).rejects.toThrow('immutable');
  });
  it('reconciles orphaned homework once, preserving score and submission provenance', async () => {
    const a = await published();
    const teacher = await db.courseOfferingTeacher.findFirst({ where: { courseOfferingId: course.id } });
    const h = await db.homeworkAssignment.create({ data: { organizationId, teacherPartnerId: teacher.teacherPartnerId, classId: course.classId, subjectId: course.subjectId, termId: course.termId, title: 'Orphaned work', dueDate: new Date(), maxScore: 100 } });
    const legacy = await db.homeworkSubmission.create({ data: { organizationId, assignmentId: h.id, studentProfileId: learners[0], content: 'Original work', score: 42, feedback: 'Original feedback', submittedAt: new Date() } });
    const dto = { assessmentId: a.id, reason: 'Verified against archived teacher register' };
    await run(() => workflow.reconcileHomework(h.id, dto)); await run(() => workflow.reconcileHomework(h.id, dto));
    const sa = await db.studentAssessment.findFirst({ where: { assessmentId: a.id, studentProfileId: learners[0] } });
    expect(Number(sa.effectiveScore)).toBe(42); expect(sa.participation).toBe('present');
    expect(await db.assignmentSubmission.count({ where: { legacyHomeworkSubmissionId: legacy.id } })).toBe(1);
    expect(await historyCount(a.id)).toBe(1);
    expect(await db.homeworkSubmission.findUnique({ where: { id: legacy.id } })).toMatchObject({ content: 'Original work', feedback: 'Original feedback' });
  });
  it('feeds assessed outcomes back into Phase 3 coverage for the correct course', async () => {
    const outcome = await db.learningOutcome.create({ data: { organizationId, subjectId: course.subjectId, title: 'Solve linear equations' } });
    const result = await run(() => workflow.create({ kind: 'cat', title: 'Coverage bridge', courseOfferingId: course.id, rosterId: roster.id, termId: course.termId, classId: course.classId, subjectId: course.subjectId, learningOutcomeIds: [outcome.id] }));
    const teaching = new TeachingWorkspaceService(prisma, tenant, { assertMayView: jest.fn(), offering: async () => course } as any, { forOffering: async () => null } as any);
    expect((await run(() => teaching.coverage(course.id))).outcomes.find((o: any) => o.id === outcome.id)?.assessed).toBe(false);
    await run(() => workflow.transition(result.assessment.id, { action: 'publish', expectedVersion: 0 }));
    await run(() => workflow.saveBulk(result.assessment.id, marks(), randomUUID()));
    expect((await run(() => teaching.coverage(course.id))).outcomes.find((o: any) => o.id === outcome.id)?.assessed).toBe(true);
    expect((await run(() => teaching.coverage('another-course'))).outcomes.find((o: any) => o.id === outcome.id)?.assessed).toBe(false);
  });
  it('invalidates a prior draft grade when a learner submits a new attempt', async () => {
    const result = await run(() => workflow.create({ kind: 'assignment', title: 'Two attempts', courseOfferingId: course.id, rosterId: roster.id, classId: course.classId, subjectId: course.subjectId, termId: course.termId, maxAttempts: 2 }));
    await run(() => workflow.transition(result.assessment.id, { action: 'publish', expectedVersion: 0 }));
    const assignment = await db.assignment.findFirst({ where: { assessmentId: result.assessment.id } });
    const submit = () => tenant.run({ organizationId, userId: 'learner', portal: { kind: 'student', studentProfileId: learners[0] } }, () => assignments.submit({ assignmentId: assignment.id, studentProfileId: learners[0], content: 'Learner work' }));
    await submit();
    await run(() => assignments.grade({ assignmentId: assignment.id, studentProfileId: learners[0], rawScore: 60, expectedVersion: 1 }));
    await submit();
    const sa = await db.studentAssessment.findFirst({ where: { assessmentId: result.assessment.id, studentProfileId: learners[0] } });
    expect(sa.effectiveScore).toBeNull(); expect(sa.status).toBe('resubmitted');
    const attempts = await db.assignmentSubmission.findMany({ where: { assignmentId: assignment.id }, orderBy: { attemptNo: 'asc' } });
    expect(attempts).toHaveLength(2); expect(Number(attempts[0].rawScore)).toBe(60); expect(attempts[1].rawScore).toBeNull();
  });
});
