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

  const tx = {
    admissionApplication: {
      create: applicationCreate,
      findFirst: applicationFindFirst,
      updateMany: applicationUpdateMany,
      findMany: applicationFindMany,
    },
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
