/**
 * Unit tests for AdmissionsService state machine (P0-7, C7 + C8).
 *
 * Bug:
 *  - The old `review()` method blindly wrote whatever status the
 *    caller asked for, regardless of the application's current
 *    status. This let a rejected or withdrawn application be
 *    re-accepted, an `accepted` application be `rejected` after
 *    enrollment, and `schedule_exam` be repeated indefinitely.
 *  - `create()` had no duplicate-application guard. A parent could
 *    submit the same child N times in a year and get N sequential
 *    application numbers, each with its own waiting-list slot.
 *
 * Fix:
 *  - Hand-rolled state machine. `review()` looks up the current
 *    status, checks the action is in the allowed set, and throws
 *    BadRequestException otherwise.
 *  - `create()` queries for an existing application with the same
 *    (academicYearId, normalizedFirstName, normalizedLastName,
 *    applicantDob) and rejects duplicates.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdmissionsService } from '../../src/modules/school/admissions/admissions.service';

interface Mocks {
  applicationCreate: jest.Mock;
  applicationFindFirst: jest.Mock;
  applicationUpdateMany: jest.Mock;
  applicationFindMany: jest.Mock;
  studentProfileFindFirst: jest.Mock;
  auditRecordInTx: jest.Mock;
  events: { publish: jest.Mock };
  sequence: { next: jest.Mock };
  $transaction: jest.Mock;
}

function makeService() {
  const tenant = { organizationId: 'org_test' };
  const events = { publish: jest.fn() };
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

  const tx = {
    admissionApplication: {
      create: applicationCreate,
      findFirst: applicationFindFirst,
      updateMany: applicationUpdateMany,
      findMany: applicationFindMany,
    },
    interview: { upsert: upsertable(), findFirst: jest.fn().mockResolvedValue(null) },
    applicantScore: { upsert: upsertable() },
    offerLetter: { upsert: upsertable(), updateMany: jest.fn().mockReturnValue({ count: 1 }) },
    entranceExam: { findMany: jest.fn().mockResolvedValue([]) },
    applicationDocument: { findMany: jest.fn().mockResolvedValue([]) },
    admissionFee: { upsert: upsertable() },
    studentProfile: { findFirst: jest.fn().mockResolvedValue({ id: 'sp_1', status: 'active', organizationId: 'org_test' }), create: jest.fn().mockImplementation((a: any) => ({ id: 'sp_1', ...a.data })), updateMany: jest.fn().mockReturnValue({ count: 1 }) },
    enrollment: { create: jest.fn().mockImplementation((a: any) => ({ id: 'enr_1', ...a.data })), findFirst: jest.fn().mockResolvedValue(null), updateMany: jest.fn().mockReturnValue({ count: 1 }) },
    studentStatusHistory: { create: jest.fn().mockResolvedValue(undefined) },
    partner: { create: jest.fn().mockImplementation((a: any) => ({ id: 'partner_1', ...a.data })) },
    document: { create: jest.fn().mockImplementation((a: any) => ({ id: 'doc_1', ...a.data })) },
    documentTypeDef: { findFirst: jest.fn().mockResolvedValue({ id: 'dt_1' }) },
  };

  const prisma = {
    client: {
      $transaction: jest.fn(async (cb: any) => cb(tx)),
      admissionApplication: {
        findFirst: applicationFindFirst,
        findMany: applicationFindMany,
      },
    },
  };

  const service = new AdmissionsService(
    prisma as any,
    tenant as any,
    { recordInTx: auditRecordInTx } as any,
    events as any,
    sequence as any,
  );

  return {
    service,
    mocks: {
      applicationCreate,
      applicationFindFirst,
      applicationUpdateMany,
      applicationFindMany,
      studentProfileFindFirst: tx.studentProfile.findFirst as jest.Mock,
      auditRecordInTx,
      events,
      sequence,
      $transaction: prisma.client.$transaction,
    } as Mocks,
  };
}

describe('AdmissionsService.review — state machine (P0-7, C8)', () => {
  it('rejects unknown actions', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue({ id: 'app_1', status: 'submitted' });
    await expect(
      service.review('app_1', 'foobar' as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('submitted → review → under_review (valid)', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst
      .mockResolvedValueOnce({ id: 'app_1', status: 'submitted' })  // initial read
      .mockResolvedValueOnce({ id: 'app_1', status: 'under_review' });  // post-update read
    const result = await service.review('app_1', 'review');
    expect(result.status).toBe('under_review');
    expect(mocks.applicationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'app_1' },
        data: expect.objectContaining({ status: 'under_review' }),
      }),
    );
  });

  it('submitted → withdraw → withdrawn (valid)', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst
      .mockResolvedValueOnce({ id: 'app_1', status: 'submitted' })
      .mockResolvedValueOnce({ id: 'app_1', status: 'withdrawn' });
    const result = await service.review('app_1', 'withdraw');
    expect(result.status).toBe('withdrawn');
  });

  it('submitted → accept → accepted (INVALID — must review first)', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue({ id: 'app_1', status: 'submitted' });
    await expect(
      service.review('app_1', 'accept'),
    ).rejects.toThrow(BadRequestException);
    // No update should have been issued.
    expect(mocks.applicationUpdateMany).not.toHaveBeenCalled();
  });

  it('submitted → reject → rejected (INVALID — must review first)', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue({ id: 'app_1', status: 'submitted' });
    await expect(
      service.review('app_1', 'reject'),
    ).rejects.toThrow(BadRequestException);
  });

  it('submitted → schedule_exam → exam_scheduled (INVALID — must review first)', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue({ id: 'app_1', status: 'submitted' });
    await expect(
      service.review('app_1', 'schedule_exam'),
    ).rejects.toThrow(BadRequestException);
  });

  it('under_review → schedule_exam → exam_scheduled (valid)', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst
      .mockResolvedValueOnce({ id: 'app_1', status: 'under_review' })
      .mockResolvedValueOnce({ id: 'app_1', status: 'exam_scheduled' });
    const result = await service.review('app_1', 'schedule_exam');
    expect(result.status).toBe('exam_scheduled');
  });

  it('under_review → accept → accepted (valid)', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst
      .mockResolvedValueOnce({ id: 'app_1', status: 'under_review' })
      .mockResolvedValueOnce({ id: 'app_1', status: 'accepted' });
    const result = await service.review('app_1', 'accept');
    expect(result.status).toBe('accepted');
  });

  it('exam_scheduled → accept → accepted (valid)', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst
      .mockResolvedValueOnce({ id: 'app_1', status: 'exam_scheduled' })
      .mockResolvedValueOnce({ id: 'app_1', status: 'accepted' });
    const result = await service.review('app_1', 'accept');
    expect(result.status).toBe('accepted');
  });

  it('exam_scheduled → schedule_exam → exam_scheduled (INVALID — already scheduled)', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue({ id: 'app_1', status: 'exam_scheduled' });
    await expect(
      service.review('app_1', 'schedule_exam'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejected → review (INVALID — rejected is terminal)', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue({ id: 'app_1', status: 'rejected' });
    await expect(
      service.review('app_1', 'review'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejected → accept (INVALID — rejected is terminal)', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue({ id: 'app_1', status: 'rejected' });
    await expect(
      service.review('app_1', 'accept'),
    ).rejects.toThrow(BadRequestException);
  });

  it('withdrawn → review (INVALID — withdrawn is terminal)', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue({ id: 'app_1', status: 'withdrawn' });
    await expect(
      service.review('app_1', 'review'),
    ).rejects.toThrow(BadRequestException);
  });

  it('enrolled → review (INVALID — enrolled is terminal)', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue({ id: 'app_1', status: 'enrolled' });
    await expect(
      service.review('app_1', 'review'),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepted → withdraw (valid — accepted applications may still be withdrawn before enrollment)', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst
      .mockResolvedValueOnce({ id: 'app_1', status: 'accepted' })
      .mockResolvedValueOnce({ id: 'app_1', status: 'withdrawn' });
    const result = await service.review('app_1', 'withdraw');
    expect(result.status).toBe('withdrawn');
  });

  it('rejected → withdraw (INVALID — already terminal)', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue({ id: 'app_1', status: 'rejected' });
    await expect(
      service.review('app_1', 'withdraw'),
    ).rejects.toThrow(BadRequestException);
  });

  it('enrolled → withdraw (INVALID — terminal)', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue({ id: 'app_1', status: 'enrolled' });
    await expect(
      service.review('app_1', 'withdraw'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects when the application does not exist', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue(null);
    await expect(
      service.review('app_missing', 'review'),
    ).rejects.toThrow(NotFoundException);
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

describe('AdmissionsService.create — duplicate guard (P0-7, C7)', () => {
  it('creates a fresh application when no prior record exists', async () => {
    const { service, mocks } = makeService();
    // First findFirst (for dedupe) returns null.
    mocks.applicationFindFirst.mockResolvedValueOnce(null);
    const result = await service.create({
      academicYearId: 'ay_1',
      applicantFirstName: 'Alice',
      applicantLastName: 'Nakimuli',
      applicantDob: '2018-04-15',
    });
    expect(result.status).toBe('submitted');
    expect(mocks.applicationCreate).toHaveBeenCalled();
  });

  it('rejects a duplicate application for the same (year, name, dob)', async () => {
    const { service, mocks } = makeService();
    // findFirst returns an existing record.
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
        applicantFirstName: 'Alice',
        applicantLastName: 'Nakimuli',
        applicantDob: '2018-04-15',
      }),
    ).rejects.toThrow(BadRequestException);
    // No new application should have been created.
    expect(mocks.applicationCreate).not.toHaveBeenCalled();
  });

  it('matches case-insensitively (Alice vs ALICE)', async () => {
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
        applicantFirstName: 'ALICE',
        applicantLastName: 'nakimuli',
        applicantDob: '2018-04-15',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows a new application for a different academic year', async () => {
    const { service, mocks } = makeService();
    // findFirst for ay_1 finds nothing.
    mocks.applicationFindFirst.mockResolvedValueOnce(null);
    const result = await service.create({
      academicYearId: 'ay_2',  // different year
      applicantFirstName: 'Alice',
      applicantLastName: 'Nakimuli',
      applicantDob: '2018-04-15',
    });
    expect(result.status).toBe('submitted');
  });

  it('allows a new application for a different DOB', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValueOnce(null);
    const result = await service.create({
      academicYearId: 'ay_1',
      applicantFirstName: 'Alice',
      applicantLastName: 'Nakimuli',
      applicantDob: '2019-01-01',  // different DOB
    });
    expect(result.status).toBe('submitted');
  });
});

describe('AdmissionsService extended lifecycle — FSM + new methods (P0/P2/P3)', () => {
  /** Drive a review() action and assert the resulting status. */
  async function driveReview(service: any, mocks: any, from: string, action: string) {
    mocks.applicationFindFirst
      .mockResolvedValueOnce({ id: 'app_1', status: from, organizationId: 'org_test' })
      .mockResolvedValueOnce({ id: 'app_1', status: targetOf[action] });
    return service.review('app_1', action);
  }
  const targetOf: Record<string, string> = {
    review: 'under_review', screen: 'screening', schedule_interview: 'interview_scheduled',
    complete_interview: 'interviewed', reschedule: 'interview_scheduled', schedule_exam: 'exam_scheduled',
    exam_done: 'interviewed', score: 'scored', accept: 'accepted', reject: 'rejected',
    waitlist: 'waitlisted', issue_offer: 'offer_issued', accept_offer: 'offer_accepted',
    decline_offer: 'waitlisted', withdraw: 'withdrawn',
  };

  it('submitted → review → under_review → screen → screening (valid)', async () => {
    const { service, mocks } = makeService();
    await driveReview(service, mocks, 'submitted', 'review');
    const r = await driveReview(service, mocks, 'under_review', 'screen');
    expect(r.status).toBe('screening');
  });

  it('screening → schedule_interview → interview_scheduled (valid)', async () => {
    const { service, mocks } = makeService();
    const r = await driveReview(service, mocks, 'screening', 'schedule_interview');
    expect(r.status).toBe('interview_scheduled');
  });

  it('interview_scheduled → complete_interview → interviewed (valid)', async () => {
    const { service, mocks } = makeService();
    const r = await driveReview(service, mocks, 'interview_scheduled', 'complete_interview');
    expect(r.status).toBe('interviewed');
  });

  it('submitted → accept (INVALID — must review/screen first)', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue({ id: 'app_1', status: 'submitted' });
    await expect(service.review('app_1', 'accept')).rejects.toThrow(BadRequestException);
  });

  it('screening → accept (INVALID — must interview/score first)', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue({ id: 'app_1', status: 'screening' });
    await expect(service.review('app_1', 'accept')).rejects.toThrow(BadRequestException);
  });

  it('interviewed → score → scored → accept → accepted (valid)', async () => {
    const { service, mocks } = makeService();
    await driveReview(service, mocks, 'interviewed', 'score');
    const r = await driveReview(service, mocks, 'scored', 'accept');
    expect(r.status).toBe('accepted');
  });

  it('accepted → issue_offer → offer_issued → accept_offer → offer_accepted (valid)', async () => {
    const { service, mocks } = makeService();
    await driveReview(service, mocks, 'accepted', 'issue_offer');
    const r = await driveReview(service, mocks, 'offer_issued', 'accept_offer');
    expect(r.status).toBe('offer_accepted');
  });

  it('offer_issued → decline_offer → waitlisted (valid)', async () => {
    const { service, mocks } = makeService();
    const r = await driveReview(service, mocks, 'offer_issued', 'decline_offer');
    expect(r.status).toBe('waitlisted');
  });

  it('exam_scheduled → reschedule → interview_scheduled (INVALID as repeated; must reject)', async () => {
    const { service, mocks } = makeService();
    // reschedule is allowed from interview_scheduled, NOT exam_scheduled.
    mocks.applicationFindFirst.mockResolvedValue({ id: 'app_1', status: 'exam_scheduled' });
    await expect(service.review('app_1', 'reschedule')).rejects.toThrow(BadRequestException);
  });

  it('scheduleInterview persists an Interview row and advances status (no rating)', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst
      .mockResolvedValueOnce({ id: 'app_1', status: 'screening', organizationId: 'org_test' })
      .mockResolvedValueOnce({ id: 'app_1', status: 'screening', organizationId: 'org_test' });
    const interview = await service.scheduleInterview('app_1', { interviewerId: 'staff_1' });
    expect(interview.applicationId).toBe('app_1');
    expect(mocks.applicationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'interview_scheduled' }) }),
    );
  });

  it('scheduleInterview with rating marks interview completed → interviewed', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst
      .mockResolvedValueOnce({ id: 'app_1', status: 'interview_scheduled', organizationId: 'org_test' })
      .mockResolvedValueOnce({ id: 'app_1', status: 'interview_scheduled', organizationId: 'org_test' });
    const interview = await service.scheduleInterview('app_1', { rating: 5, recommendation: 'strong' });
    expect(interview.completedAt).not.toBeNull();
    expect(mocks.applicationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'interviewed' }) }),
    );
  });

  it('scoreApplication computes aggregate and moves to scored', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst
      .mockResolvedValueOnce({ id: 'app_1', status: 'interviewed', organizationId: 'org_test' })
      .mockResolvedValueOnce({ id: 'app_1', status: 'interviewed', organizationId: 'org_test' });
    const score = await service.scoreApplication('app_1', { examScore: 80, interviewScore: 90, documentScore: 100 });
    expect(score.totalScore).toBeGreaterThan(0);
    expect(mocks.applicationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'scored' }) }),
    );
  });

  it('issueOffer creates an OfferLetter and moves to offer_issued', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst
      .mockResolvedValueOnce({ id: 'app_1', status: 'accepted', organizationId: 'org_test' })
      .mockResolvedValueOnce({ id: 'app_1', status: 'accepted', organizationId: 'org_test' });
    const offer = await service.issueOffer('app_1', { body: 'Welcome!' });
    expect(offer.status).toBe('issued');
    expect(mocks.applicationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'offer_issued' }) }),
    );
  });

  it('chargeApplicationFee issues a sales_invoice Document and sets feeStatus=pending', async () => {
    const { service, mocks } = makeService();
    mocks.applicationFindFirst.mockResolvedValue({ id: 'app_1', status: 'submitted', organizationId: 'org_test', applicationNumber: 'APP-1', applicantFirstName: 'A', applicantLastName: 'B', parentContactId: 'p_1', feeStatus: 'unpaid' });
    const res = await service.chargeApplicationFee('app_1', { amount: 50000 });
    expect(res.invoiceId).toBeDefined();
    expect(mocks.applicationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ feeStatus: 'pending' }) }),
    );
  });

  it('transferIn creates a student profile with active status', async () => {
    const { service, mocks } = makeService();
    const res = await service.transferIn({
      name: 'Incoming Student', classId: 'c_1', termId: 't_1', rollNumber: 'R1',
      transferredFrom: 'Other School',
    });
    expect(res.studentProfile.id).toBeDefined();
    expect(res.studentProfile.currentClassId).toBe('c_1');
    expect(res.enrollment.id).toBeDefined();
  });

  it('withdrawStudent rejects a non-withdrawable (already withdrawn) student', async () => {
    const { service, mocks } = makeService();
    mocks.studentProfileFindFirst.mockResolvedValue({ id: 'sp_1', status: 'withdrawn', organizationId: 'org_test' });
    await expect(
      service.withdrawStudent('sp_1', { reason: 'moved away' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('reEnroll rejects an active student (must be withdrawn/alumni first)', async () => {
    const { service } = makeService();
    // default studentProfile.findFirst returns an active profile → should be rejected.
    await expect(
      service.reEnroll('sp_1', { classId: 'c_1', termId: 't_1', rollNumber: 'R1' }),
    ).rejects.toThrow(BadRequestException);
  });
});

