/**
 * Unit tests for AdmissionsService — the admission state machine and the
 * guards that hang off it.
 *
 * History:
 *  - `review()` once wrote whatever status the caller asked for, so a rejected or
 *    withdrawn application could be re-accepted and an enrolled one rejected.
 *    Fixed by ADMISSION_TRANSITIONS + assertTransition.
 *  - `create()` had no duplicate guard, so a parent could submit the same child N
 *    times in a year.
 *  - This file then stopped compiling: `EnrollmentService` was added as the sixth
 *    constructor parameter and the spec still passed five, so every assertion
 *    below silently stopped running (TS2554). That is why the newer bypasses —
 *    `recordDecision` and `scoreApplicationWeighted` writing `status` directly,
 *    `acceptOffer` ignoring `expiresAt`, `enroll` never consulting the eligibility
 *    gate — were not caught. The regression tests for those are at the bottom.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdmissionsService } from '../../src/modules/school/admissions/admissions.service';
import { AdmissionsWorkflowService } from '../../src/modules/school/admissions/admissions-workflow.service';
import { makePlacementLookupStub } from './_placement-stub';

function makeService() {
  // The admissions office in these tests may decide and enrol (both are separately
  // delegable grants; the service checks them itself).
  const tenant = {
    organizationId: 'org_test',
    userId: 'user_1',
    permissions: ['school:admissions:write', 'school:admissions:decide', 'school:enrollment:write'],
  };
  const events = { publish: jest.fn(), publishInTx: jest.fn(async () => undefined) };
  const sequence = { next: jest.fn().mockResolvedValue('APP-2026-000001') };
  const auditRecordInTx = jest.fn().mockResolvedValue(undefined);

  const applicationCreate = jest.fn().mockImplementation((args: any) => ({
    id: 'app_1',
    status: 'submitted',
    applicationNumber: 'APP-2026-000001',
    ...args.data,
  }));
  const applicationFindFirst = jest.fn().mockResolvedValue(null);
  const applicationUpdateMany = jest.fn().mockReturnValue({ count: 1 });
  const applicationFindMany = jest.fn().mockResolvedValue([]);

  const upsertable = () =>
    jest.fn().mockImplementation((args: any) => ({ id: 'row_1', ...args.create, ...(args.update ?? {}) }));

  const offerLetterFindFirst = jest.fn().mockResolvedValue({
    id: 'offer_1',
    applicationId: 'app_1',
    status: 'issued',
    expiresAt: null,
  });
  const occupiedCount = jest.fn().mockResolvedValue(0);
  const enrollmentFindFirst = jest.fn().mockResolvedValue(null);
  const capacityUpdateMany = jest.fn().mockReturnValue({ count: 1 });

  const tx = {
    admissionApplication: {
      create: applicationCreate,
      findFirst: applicationFindFirst,
      updateMany: applicationUpdateMany,
      findMany: applicationFindMany,
    },
    interview: { upsert: upsertable(), findFirst: jest.fn().mockResolvedValue(null) },
    applicantScore: { upsert: upsertable(), findFirst: jest.fn().mockResolvedValue(null) },
    offerLetter: {
      upsert: upsertable(),
      updateMany: jest.fn().mockReturnValue({ count: 1 }),
      findFirst: offerLetterFindFirst,
    },
    entranceExam: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null), upsert: upsertable() },
    applicationDocument: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((a: any) => ({ id: 'apdoc_1', ...a.data })),
      updateMany: jest.fn().mockReturnValue({ count: 1 }),
    },
    admissionFee: { upsert: upsertable(), updateMany: jest.fn().mockReturnValue({ count: 1 }) },
    admissionDecision: { upsert: upsertable() },
    // `updateMany` is the atomic seat claim: enroll() reserves a seat with a
    // conditional update, so the mock has to report how many rows it affected.
    // count:1 = the claim succeeded. (The release lives in EnrollmentService, because
    // `enrolled` is a terminal admission status.)
    admissionCapacity: {
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: capacityUpdateMany,
    },
    admissionCycle: { findFirst: jest.fn().mockResolvedValue({ id: 'cyc_1', academicYearId: 'ay_1', workflowId: null }) },
    // AD2: enroll() checks the term belongs to the application's year.
    term: { findFirst: jest.fn().mockResolvedValue({ id: 'term_1', academicYearId: 'ay_1', name: 'Term 1' }) },
    // Workflow resolution on create(): with no rows the snapshot falls back to the
    // built-in Standard workflow, i.e. pre-workflow behaviour.
    admissionWorkflow: { findFirst: jest.fn().mockResolvedValue(null) },
    waitingList: { findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0), create: jest.fn().mockImplementation((a: any) => ({ id: 'wl_1', ...a.data })) },
    applicantIdentityMatch: { create: jest.fn().mockResolvedValue(undefined), findMany: jest.fn().mockResolvedValue([]) },
    contact: { findFirst: jest.fn().mockResolvedValue({ partnerId: 'partner_9' }), create: jest.fn().mockImplementation((a: any) => ({ id: 'contact_new', ...a.data })) },
    file: { findFirst: jest.fn().mockResolvedValue({ id: 'file_1' }) },
    // Occupancy is counted from open placements; `enrollment` is kept as an alias
    // of the same mock so older assertions keep reading naturally.
    enrollment: { findFirst: enrollmentFindFirst, count: occupiedCount },
    enrollmentPlacement: { count: occupiedCount },
    studentEnrollment: { findFirst: enrollmentFindFirst, count: jest.fn().mockResolvedValue(0) },
    studentProfile: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
    studentGuardian: { create: jest.fn().mockImplementation((a: any) => ({ id: 'sg_1', ...a.data })) },
    admissionGuardian: { create: jest.fn().mockImplementation((a: any) => ({ id: 'ag_1', ...a.data })), findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockReturnValue({ count: 1 }) },
    admissionStatusHistory: { create: jest.fn().mockResolvedValue(undefined) },
    admissionRequirement: { findMany: jest.fn().mockResolvedValue([]) },
    document: { create: jest.fn().mockImplementation((a: any) => ({ id: 'doc_1', ...a.data })) },
    documentTypeDef: { findFirst: jest.fn().mockResolvedValue({ id: 'dt_1' }) },
  };

  const prisma = {
    client: {
      $transaction: jest.fn(async (cb: any) => cb(tx)),
      admissionApplication: { findFirst: applicationFindFirst, findMany: applicationFindMany, updateMany: applicationUpdateMany },
      applicantScore: { findFirst: jest.fn().mockResolvedValue(null), upsert: upsertable() },
      applicantIdentityMatch: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
      admissionCriteriaSet: { findFirst: jest.fn().mockResolvedValue(null) },
      admissionCycle: { findFirst: jest.fn().mockResolvedValue({ id: 'cyc_1', academicYearId: 'ay_1' }) },
      admissionCapacity: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null), updateMany: capacityUpdateMany },
      admissionWorkflow: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      offerLetter: { updateMany: jest.fn().mockReturnValue({ count: 2 }) },
      enrollment: { findFirst: enrollmentFindFirst, count: occupiedCount },
      enrollmentPlacement: { count: occupiedCount },
      studentEnrollment: { findFirst: enrollmentFindFirst },
      term: { findFirst: jest.fn().mockResolvedValue({ id: 'term_1', academicYearId: 'ay_1' }) },
      waitingList: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    },
  };

  // The sixth constructor argument. Omitting it is what stopped this file from
  // compiling, which in turn stopped every test below from ever running.
  // StudentAdmissionService.admit (6th) creates the learner and seats them;
  // StudentEnrollmentService (7th) owns every later membership change.
  const enrollmentSvc = {
    admit: jest.fn().mockImplementation(async (input: any) => ({
      partner: { id: 'partner_1', name: input.name },
      profile: { id: 'sp_1', partnerId: 'partner_1', admissionNo: 'STU-000001' },
      enrollment: { id: 'enr_1', classId: input.placement?.classId, termId: input.placement?.termId },
    })),
    withdraw: jest.fn().mockResolvedValue({ id: 'enr_1', status: 'WITHDRAWN' }),
    changeStatus: jest.fn().mockResolvedValue({ id: 'enr_1', status: 'ACTIVE' }),
    create: jest.fn().mockResolvedValue({ enrollment: { id: 'enr_2' } }),
  };

  // EncryptionService — the seventh constructor argument. Round-trips through a
  // pass-through fake so create()/reveal paths exercise the real call shape.
  const encryption = {
    encrypt: jest.fn((s: string | null | undefined) => (s ? { ciphertext: `ct(${s})`, iv: 'iv', tag: 'tag' } : null)),
    decrypt: jest.fn((p: any) => (p ? String(p.ciphertext).replace(/^ct\((.*)\)$/, '$1') : null)),
  };

  // AdmissionsWorkflowService — the eighth constructor argument. The REAL service, not
  // a stub: its resolver is pure logic over the application's workflow snapshot, so
  // wiring it in means these tests exercise the actual stage rules. Applications in
  // this suite carry no snapshot, which resolves to the built-in Standard workflow —
  // i.e. exactly the behaviour that existed before workflows were configurable.
  const workflowSvc = new AdmissionsWorkflowService(
    prisma as any,
    tenant as any,
    { recordInTx: auditRecordInTx, record: jest.fn() } as any,
  );

  const service = new AdmissionsService(
    prisma as any,
    tenant as any,
    { recordInTx: auditRecordInTx } as any,
    events as any,
    sequence as any,
    enrollmentSvc as any,
    enrollmentSvc as any,
    encryption as any,
    workflowSvc,
    makePlacementLookupStub() as any,
    // AdmissionFeeService — settlement is read from the fee invoice; covered in admission-fee.spec.ts.
    { isSettled: jest.fn(async (_c: any, app: any) => app?.feeStatus !== 'pending') } as any,
  );

  return {
    service,
    mocks: {
      applicationCreate,
      applicationFindFirst,
      applicationUpdateMany,
      applicationFindMany,
      offerLetterFindFirst,
      offerLetterUpdateMany: tx.offerLetter.updateMany,
      enrollmentFindFirst,
      enrollmentSvc,
      auditRecordInTx,
      events,
      sequence,
      tx,
      $transaction: prisma.client.$transaction,
    },
  };
}

/** An application shaped the way checkEligibility's include expects it. */
function eligibleApp(overrides: Record<string, unknown> = {}) {
  return {
    id: 'app_1',
    organizationId: 'org_test',
    academicYearId: 'ay_1',
    admissionCycleId: null,
    applyingForClassId: 'c_1',
    status: 'offer_accepted',
    documents: [],
    offerLetter: { id: 'offer_1', status: 'accepted', expiresAt: null },
    fee: null,
    feeStatus: 'unpaid',
    ...overrides,
  };
}

describe('AdmissionsService.review — state machine', () => {
  it('rejects unknown actions', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue({ id: 'app_1', status: 'submitted' });
    await expect(service.review('app_1', 'foobar' as any)).rejects.toThrow(BadRequestException);
  });

  it('submitted → review → under_review (valid)', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst
      .mockResolvedValueOnce({ id: 'app_1', status: 'submitted' })
      .mockResolvedValueOnce({ id: 'app_1', status: 'under_review' });
    const result: any = await service.review('app_1', 'review');
    expect(result.status).toBe('under_review');
    expect(mocks.applicationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // AD1: compare-and-set on the status the transition was validated against.
        where: { id: 'app_1', status: 'submitted' },
        data: expect.objectContaining({ status: 'under_review' }),
      }),
    );
  });

  it('submitted → withdraw → withdrawn (valid)', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst
      .mockResolvedValueOnce({ id: 'app_1', status: 'submitted' })
      .mockResolvedValueOnce({ id: 'app_1', status: 'withdrawn' });
    const result: any = await service.review('app_1', 'withdraw', 'applicant relocated');
    expect(result.status).toBe('withdrawn');
  });

  it.each([
    ['accept', 'submitted'],
    ['reject', 'submitted'],
    ['schedule_exam', 'submitted'],
    ['accept', 'screening'],
  ])('%s from %s is refused', async (action, from) => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue({ id: 'app_1', status: from });
    await expect(service.review('app_1', action as any)).rejects.toThrow(BadRequestException);
    expect(mocks.applicationUpdateMany).not.toHaveBeenCalled();
  });

  it.each(['rejected', 'withdrawn', 'enrolled'])('%s is terminal', async (status) => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue({ id: 'app_1', status });
    await expect(service.review('app_1', 'review')).rejects.toThrow(BadRequestException);
    await expect(service.review('app_1', 'accept')).rejects.toThrow(BadRequestException);
    await expect(service.review('app_1', 'withdraw')).rejects.toThrow(BadRequestException);
  });

  it('accepted → withdraw (valid — may still be withdrawn before enrollment)', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst
      .mockResolvedValueOnce({ id: 'app_1', status: 'accepted' })
      .mockResolvedValueOnce({ id: 'app_1', status: 'withdrawn' });
    const result: any = await service.review('app_1', 'withdraw', 'applicant relocated');
    expect(result.status).toBe('withdrawn');
  });

  it('exam_scheduled → schedule_exam is refused (already scheduled)', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue({ id: 'app_1', status: 'exam_scheduled' });
    await expect(service.review('app_1', 'schedule_exam')).rejects.toThrow(BadRequestException);
  });

  it('rejects when the application does not exist', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue(null);
    await expect(service.review('app_missing', 'review')).rejects.toThrow(NotFoundException);
  });

  it('persists the decision notes when provided', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst
      .mockResolvedValueOnce({ id: 'app_1', status: 'under_review' })
      .mockResolvedValueOnce({ id: 'app_1', status: 'accepted' });
    await service.review('app_1', 'accept', 'Strong interview, accept for P.1');
    expect(mocks.applicationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'accepted',
          decisionNotes: 'Strong interview, accept for P.1',
        }),
      }),
    );
  });
});

describe('AdmissionsService.create — duplicate guard', () => {
  it('creates a fresh application when no prior record exists', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValueOnce(null);
    const result: any = await service.create({
      academicYearId: 'ay_1',
      applicantFirstName: 'Alice',
      applicantLastName: 'Nakimuli',
      applicantDob: '2018-04-15',
    });
    expect(result.status).toBe('submitted');
    expect(mocks.applicationCreate).toHaveBeenCalled();
  });

  it.each([
    ['exact', 'Alice', 'Nakimuli'],
    ['case-insensitively', 'ALICE', 'nakimuli'],
  ])('rejects a duplicate %s', async (_label, first, last) => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValueOnce({
      id: 'app_existing',
      applicationNumber: 'APP-2026-000001',
      academicYearId: 'ay_1',
      applicantFirstName: 'Alice',
      applicantLastName: 'Nakimuli',
      applicantDob: new Date('2018-04-15'),
    });
    await expect(
      service.create({
        academicYearId: 'ay_1',
        applicantFirstName: first,
        applicantLastName: last,
        applicantDob: '2018-04-15',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(mocks.applicationCreate).not.toHaveBeenCalled();
  });

  it('allows a re-application in a different academic year', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValueOnce(null);
    const result: any = await service.create({
      academicYearId: 'ay_2',
      applicantFirstName: 'Alice',
      applicantLastName: 'Nakimuli',
      applicantDob: '2018-04-15',
    });
    expect(result.status).toBe('submitted');
  });
});

describe('AdmissionsService — extended lifecycle', () => {
  const targetOf: Record<string, string> = {
    review: 'under_review', screen: 'screening', schedule_interview: 'interview_scheduled',
    complete_interview: 'interviewed', reschedule: 'interview_scheduled', schedule_exam: 'exam_scheduled',
    exam_done: 'interviewed', score: 'scored', accept: 'accepted', reject: 'rejected',
    waitlist: 'waitlisted', issue_offer: 'offer_issued', accept_offer: 'offer_accepted',
    decline_offer: 'offer_declined', withdraw: 'withdrawn',
  };

  /**
   * Decision-grade actions (accept/reject/waitlist/withdraw) are refused without a
   * reason — enforced in applyReview, not just in the UI, so the rule holds when the
   * web client is bypassed. Supply one here so these tests exercise the transition
   * rather than the reason guard, which has its own tests.
   */
  const REASON_REQUIRED = ['accept', 'reject', 'waitlist', 'withdraw'];

  async function driveReview(service: any, mocks: any, from: string, action: string) {
    mocks.applicationFindFirst
      .mockResolvedValueOnce({ id: 'app_1', status: from, organizationId: 'org_test' })
      .mockResolvedValueOnce({ id: 'app_1', status: targetOf[action] });
    return service.review('app_1', action, REASON_REQUIRED.includes(action) ? 'test reason' : undefined);
  }

  it.each([
    ['submitted', 'review', 'under_review'],
    ['under_review', 'screen', 'screening'],
    ['screening', 'schedule_interview', 'interview_scheduled'],
    ['interview_scheduled', 'complete_interview', 'interviewed'],
    ['interviewed', 'score', 'scored'],
    ['scored', 'accept', 'accepted'],
    ['accepted', 'issue_offer', 'offer_issued'],
    ['offer_issued', 'accept_offer', 'offer_accepted'],
    ['offer_issued', 'decline_offer', 'offer_declined'],
    ['waitlisted', 'issue_offer', 'offer_issued'],
  ])('%s --%s--> %s', async (from, action, expected) => {
    const { service, mocks } = makeService();
    const r: any = await driveReview(service, mocks, from, action);
    expect(r.status).toBe(expected);
  });

  it('exam_scheduled → reschedule is refused (reschedule belongs to interviews)', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue({ id: 'app_1', status: 'exam_scheduled' });
    await expect(service.review('app_1', 'reschedule')).rejects.toThrow(BadRequestException);
  });

  it('scheduleInterview persists an Interview row and advances status (no rating)', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue({ id: 'app_1', status: 'screening', organizationId: 'org_test' });
    const interview: any = await service.scheduleInterview('app_1', { interviewerId: 'staff_1' });
    expect(interview.applicationId).toBe('app_1');
    expect(mocks.applicationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'interview_scheduled' }) }),
    );
  });

  it('scheduleInterview with a rating records completion → interviewed', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue({ id: 'app_1', status: 'interview_scheduled', organizationId: 'org_test' });
    const interview: any = await service.scheduleInterview('app_1', { rating: 5, recommendation: 'strong' });
    expect(interview.completedAt).not.toBeNull();
    expect(mocks.applicationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'interviewed' }) }),
    );
  });

  it('scoreApplication computes an aggregate and moves to scored', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue({ id: 'app_1', status: 'interviewed', organizationId: 'org_test' });
    const score: any = await service.scoreApplication('app_1', { examScore: 80, interviewScore: 90, documentScore: 100 });
    expect(Number(score.totalScore)).toBeGreaterThan(0);
    expect(mocks.applicationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'scored' }) }),
    );
  });

  it('issueOffer creates an OfferLetter and moves to offer_issued', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue({ id: 'app_1', status: 'accepted', organizationId: 'org_test' });
    const offer: any = await service.issueOffer('app_1', { body: 'Welcome!' });
    expect(offer.status).toBe('issued');
    expect(mocks.applicationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'offer_issued' }) }),
    );
  });
});

describe('AdmissionsService — regressions for the FSM bypasses', () => {
  it('recordDecision refuses a decision on a terminal application', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue({ id: 'app_1', status: 'enrolled', organizationId: 'org_test' });
    // Used to write `status: 'rejected'` straight through updateMany, orphaning a
    // live Enrollment behind a rejected application.
    await expect(service.recordDecision('app_1', 'rejected', 'changed our mind')).rejects.toThrow(BadRequestException);
    expect(mocks.applicationUpdateMany).not.toHaveBeenCalled();
  });

  it('recordDecision accepts from scored and audits the transition', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue({ id: 'app_1', status: 'scored', organizationId: 'org_test', applyingForClassId: 'c_1' });
    const res: any = await service.recordDecision('app_1', 'accepted', 'top of the cohort');
    expect(res.decision).toBe('accepted');
    expect(mocks.auditRecordInTx).toHaveBeenCalled();
    expect(mocks.applicationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'accepted' }) }),
    );
  });

  it('recordDecision places a waitlisted applicant on the waiting list', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue({ id: 'app_1', status: 'scored', organizationId: 'org_test', applyingForClassId: 'c_1' });
    await service.recordDecision('app_1', 'waitlisted', 'strong but oversubscribed');
    expect(mocks.tx.waitingList.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ classId: 'c_1', position: 1 }) }),
    );
  });

  it('acceptOffer refuses an expired offer and marks it expired', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue({ id: 'app_1', status: 'offer_issued', organizationId: 'org_test' });
    mocks.offerLetterFindFirst.mockResolvedValue({
      id: 'offer_1', applicationId: 'app_1', status: 'issued',
      expiresAt: new Date(Date.now() - 86_400_000),
    });
    await expect(service.acceptOffer('app_1')).rejects.toThrow(BadRequestException);
    expect(mocks.offerLetterUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'expired' }) }),
    );
  });

  it('acceptOffer marks the OfferLetter accepted, not just the application', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue({ id: 'app_1', status: 'offer_issued', organizationId: 'org_test' });
    mocks.offerLetterFindFirst.mockResolvedValue({
      id: 'offer_1', applicationId: 'app_1', status: 'issued',
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const res: any = await service.acceptOffer('app_1');
    expect(res.status).toBe('offer_accepted');
    expect(mocks.offerLetterUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'accepted' }) }),
    );
  });

  it('acceptOffer refuses when there is no offer on file', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue({ id: 'app_1', status: 'offer_issued', organizationId: 'org_test' });
    mocks.offerLetterFindFirst.mockResolvedValue(null);
    await expect(service.acceptOffer('app_1')).rejects.toThrow(BadRequestException);
  });

  it('addExamScore refuses once the decision has been taken', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue({ id: 'app_1', status: 'accepted', organizationId: 'org_test' });
    await expect(
      service.addExamScore({ applicationId: 'app_1', subjectId: 'sub_1', score: 99 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('addExamScore refuses a score above maxScore', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue({ id: 'app_1', status: 'exam_scheduled', organizationId: 'org_test' });
    await expect(
      service.addExamScore({ applicationId: 'app_1', subjectId: 'sub_1', score: 120, maxScore: 100 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('verifyDocument requires a reason when rejecting', async () => {
    const { service, mocks } = makeService();
    mocks.tx.applicationDocument.findFirst.mockResolvedValue({ id: 'apdoc_1', verified: false, rejectionReason: null });
    await expect(service.verifyDocument('apdoc_1', false)).rejects.toThrow(BadRequestException);
    await expect(service.verifyDocument('apdoc_1', false, 'illegible scan')).resolves.toBeDefined();
  });
});

describe('AdmissionsService.enroll — the eligibility gate', () => {
  const enrollDto = {
    applicationId: 'app_1',
    classId: 'c_1',
    termId: 't_1',
    rollNumber: '1',
    student: { name: 'Grace Nakato' },
  };

  it('enrolls a ready application atomically and marks it enrolled', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue(eligibleApp());
    const res: any = await service.enroll(enrollDto as any);
    expect(res.studentProfile.id).toBe('sp_1');
    // enrollNewStudent must receive the caller's tx so the student creation and
    // the status change commit together.
    expect(mocks.enrollmentSvc.admit).toHaveBeenCalledWith(expect.any(Object), mocks.tx);
    expect(mocks.applicationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'enrolled' }) }),
    );
  });

  /**
   * An `accepted` application is not enrollable under a workflow whose OFFER
   * stage is REQUIRED — and these applications carry no snapshot, so they
   * resolve to the built-in Standard workflow, where it is.
   *
   * The service used to exempt `accepted` from the OFFER and
   * APPLICANT_ACCEPTANCE stages unconditionally, which made a stage a school
   * had configured as required unenforceable. A school that runs no offer round
   * says so in configuration — the `simple` preset sets both to `skip` — rather
   * than relying on a hard-coded status check.
   */
  it('refuses to enroll an application whose offer round has not happened', async () => {
    const { service, mocks } = makeService();
    // No offer letter at all. Completeness is judged on the EVIDENCE — an offer
    // letter marked accepted completes both stages whatever `status` says — so
    // the fixture has to be a genuinely incomplete offer round, not merely an
    // application whose status lags its evidence.
    mocks.applicationFindFirst.mockResolvedValue(eligibleApp({ status: 'accepted', offerLetter: null }));
    await expect(service.enroll(enrollDto as any)).rejects.toThrow();
    expect(mocks.enrollmentSvc.admit).not.toHaveBeenCalled();
  });

  /**
   * These two are refused by the WORKFLOW guard rather than the eligibility
   * gate, because the enforcement order is workflow -> eligibility -> seat.
   * What matters to a school is that nothing was created, so that is what is
   * asserted; pinning the message would make the test a record of which guard
   * happened to fire first.
   */
  it('refuses to enroll an application that has not reached a decision', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue(eligibleApp({ status: 'submitted', offerLetter: null }));
    await expect(service.enroll(enrollDto as any)).rejects.toThrow();
    expect(mocks.enrollmentSvc.admit).not.toHaveBeenCalled();
  });

  it('refuses to enroll on a withdrawn offer', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue(
      eligibleApp({ offerLetter: { id: 'offer_1', status: 'withdrawn', expiresAt: null } }),
    );
    await expect(service.enroll(enrollDto as any)).rejects.toThrow();
    expect(mocks.enrollmentSvc.admit).not.toHaveBeenCalled();
  });

  it('refuses to enroll on an expired offer', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue(
      eligibleApp({ offerLetter: { id: 'offer_1', status: 'accepted', expiresAt: new Date(Date.now() - 86_400_000) } }),
    );
    await expect(service.enroll(enrollDto as any)).rejects.toThrow(/offer expired/);
    expect(mocks.enrollmentSvc.admit).not.toHaveBeenCalled();
  });

  it('refuses to enroll while a required document is unverified', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue(
      eligibleApp({ documents: [{ type: 'birth_cert', required: true, verified: false }] }),
    );
    await expect(service.enroll(enrollDto as any)).rejects.toThrow(/required documents not verified/);
    expect(mocks.enrollmentSvc.admit).not.toHaveBeenCalled();
  });

  it('ignores optional documents that are unverified', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue(
      eligibleApp({ documents: [{ type: 'photo', required: false, verified: false }] }),
    );
    await expect(service.enroll(enrollDto as any)).resolves.toBeDefined();
  });

  it('refuses to enroll while the application fee is outstanding', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue(eligibleApp({ fee: { paid: false }, feeStatus: 'pending' }));
    await expect(service.enroll(enrollDto as any)).rejects.toThrow(/fee outstanding/);
  });

  it('does not require a fee when none was ever charged', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue(eligibleApp({ fee: null, feeStatus: 'unpaid' }));
    await expect(service.enroll(enrollDto as any)).resolves.toBeDefined();
  });

  // `claimedSeats` is the seat ledger, so availability is capacity - reserved -
  // claimedSeats. `enrollment.count` (occupied) is reported for reconciliation but is
  // deliberately NOT an input: subtracting both double-counted every committed seat,
  // which capped a capacity-2 class at one student.
  it('refuses to enroll when the class is full', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue(eligibleApp({ admissionCycleId: 'cyc_1' }));
    mocks.tx.admissionCapacity.findFirst.mockResolvedValue({
      id: 'cap_1', classId: 'c_1', sectionId: null, streamId: null, capacity: 30, reservedCapacity: 0,
      claimedSeats: 30,
    });
    mocks.tx.enrollment.count.mockResolvedValue(30);
    await expect(service.enroll(enrollDto as any)).rejects.toThrow(/no seats available/);
  });

  it('does not double-count a committed seat against the ledger', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue(eligibleApp({ admissionCycleId: 'cyc_1' }));
    // One seat already taken: capacity 2, one enrollment committed, so claimedSeats
    // and occupied both read 1. The second enrollment must still succeed — the old
    // guard subtracted both and rejected it.
    mocks.tx.admissionCapacity.findFirst.mockResolvedValue({
      id: 'cap_1', classId: 'c_1', sectionId: null, streamId: null, capacity: 2, reservedCapacity: 0,
      claimedSeats: 1,
    });
    mocks.tx.enrollment.count.mockResolvedValue(1);
    await expect(service.enroll(enrollDto as any)).resolves.toBeDefined();
    // The claim is conditional on there being room: claimedSeats < capacity - reserved.
    expect(mocks.tx.admissionCapacity.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'cap_1', claimedSeats: { lt: 2 } }),
        data: { claimedSeats: { increment: 1 } },
      }),
    );
  });

  it('allows enrollment when capacity remains', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue(eligibleApp({ admissionCycleId: 'cyc_1' }));
    mocks.tx.admissionCapacity.findFirst.mockResolvedValue({
      id: 'cap_1', classId: 'c_1', sectionId: null, streamId: null, capacity: 30, reservedCapacity: 2,
      claimedSeats: 27,
    });
    mocks.tx.enrollment.count.mockResolvedValue(27);
    await expect(service.enroll(enrollDto as any)).resolves.toBeDefined();
  });

  it('treats an unconfigured capacity row as unconstrained', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue(eligibleApp({ admissionCycleId: 'cyc_1' }));
    mocks.tx.admissionCapacity.findFirst.mockResolvedValue(null);
    await expect(service.enroll(enrollDto as any)).resolves.toBeDefined();
  });

  it('reports the same gate through enrollmentEligibility without writing', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue(
      eligibleApp({ documents: [{ type: 'birth_cert', required: true, verified: false }] }),
    );
    const report: any = await service.enrollmentEligibility('app_1');
    expect(report.status).toBe('BLOCKED');
    expect(report.missing.join(' ')).toMatch(/required documents/);
    expect(mocks.applicationUpdateMany).not.toHaveBeenCalled();
  });
});

describe('AdmissionsService — student lifecycle delegation', () => {
  it('transferIn creates a student through the canonical enrollment service', async () => {
    const { service, mocks } = makeService();
    const res: any = await service.transferIn({
      name: 'Incoming Student', classId: 'c_1', termId: 't_1', rollNumber: 'R1',
      transferredFrom: 'Other School',
    });
    expect(res.studentProfile.id).toBe('sp_1');
    expect(mocks.enrollmentSvc.admit).toHaveBeenCalledWith(
      expect.objectContaining({ customFields: { transferredFrom: 'Other School' } }),
    );
  });

  it('withdrawStudent refuses when there is no active enrollment', async () => {
    const { service, mocks } = makeService();
    mocks.enrollmentFindFirst.mockResolvedValue(null);
    await expect(service.withdrawStudent('sp_1', { reason: 'moved away' })).rejects.toThrow(NotFoundException);
  });

  it('withdrawStudent delegates to the enrollment service', async () => {
    const { service, mocks } = makeService();
    mocks.enrollmentFindFirst.mockResolvedValue({ id: 'enr_1', studentProfileId: 'sp_1', status: 'enrolled' });
    await service.withdrawStudent('sp_1', { reason: 'moved away' });
    expect(mocks.enrollmentSvc.withdraw).toHaveBeenCalledWith('enr_1', expect.objectContaining({ reason: 'moved away' }));
  });

  it('reEnroll refuses when the student has no enrollment history', async () => {
    const { service, mocks } = makeService();
    mocks.enrollmentFindFirst.mockResolvedValue(null);
    await expect(
      service.reEnroll('sp_1', { classId: 'c_1', termId: 't_1', rollNumber: 'R1' }),
    ).rejects.toThrow(NotFoundException);
  });
});
