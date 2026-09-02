import { BadRequestException } from '@nestjs/common';
import { CourseOfferingService } from '../../src/modules/school/course-offerings/course-offering.service';

function makeService() {
  const tx = {
    courseOffering: { update: jest.fn(async ({ where, data }) => ({ id: where.id, ...data })) },
    courseOfferingTeacher: { upsert: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
    staffProfile: { findFirst: jest.fn(async () => ({ id: 'teacher-1' })) },
    learningActivity: { create: jest.fn() },
  };
  const client: any = {
    $transaction: jest.fn(async (cb: any) => cb(tx)),
    courseOffering: { findFirst: jest.fn(), findMany: jest.fn() },
    courseEnrollment: { findMany: jest.fn() },
    studentEnrollment: { findFirst: jest.fn() },
  };
  const audit = { recordInTx: jest.fn(async () => undefined) } as any;
  const service = new CourseOfferingService({ client } as any, { organizationId: 'org-1', userId: 'user-1' } as any, audit);
  return { service, client, tx, audit };
}

const ready = {
  programme: true, audience: true, responsibleStaff: true,
  curriculum: true, roster: true, timetable: true,
};

describe('CourseOffering Phase 2 lifecycle and readiness', () => {
  it('requires every publication gate', () => {
    const { service } = makeService();
    const result = (service as any).readiness({
      offeringType: 'SUBJECT', audienceScope: 'COHORT', programmeId: 'p1', classCohortId: 'c1',
      curriculum: { status: 'published' }, teachers: [{ isResponsible: true, effectiveTo: null }],
      _count: { courseEnrollments: 25, timetableSlots: 6 },
    });
    expect(result.readyToPublish).toBe(true);
    expect(result.checks).toEqual(ready);
  });

  it('does not require a timetable for a co-curricular offering', () => {
    const { service } = makeService();
    const result = (service as any).readiness({
      offeringType: 'CO_CURRICULAR', audienceScope: 'SCHOOL', programmeId: 'p1',
      teachers: [{ isResponsible: true, effectiveTo: null }], _count: { courseEnrollments: 100, timetableSlots: 0 },
    });
    expect(result.checks.curriculum).toBe(true);
    expect(result.checks.timetable).toBe(true);
    expect(result.readyToPublish).toBe(true);
  });

  it('blocks publishing when roster or timetable is missing', async () => {
    const { service } = makeService();
    jest.spyOn(service, 'get').mockResolvedValue({ status: 'ROSTER_READY', readiness: { checks: { ...ready, roster: false, timetable: false }, readyToPublish: false } } as any);
    await expect(service.transition('o1', { toStatus: 'PUBLISHED' })).rejects.toThrow('roster, timetable');
  });

  it('rejects lifecycle jumps', async () => {
    const { service } = makeService();
    jest.spyOn(service, 'get').mockResolvedValue({ status: 'DRAFT', readiness: { checks: ready, readyToPublish: true } } as any);
    await expect(service.transition('o1', { toStatus: 'ACTIVE' })).rejects.toThrow(BadRequestException);
  });

  it('moves a publish-ready offering through the next legal state and audits it', async () => {
    const { service, tx, audit } = makeService();
    jest.spyOn(service, 'get').mockResolvedValue({ status: 'ROSTER_READY', readiness: { checks: ready, readyToPublish: true } } as any);
    const result = await service.transition('o1', { toStatus: 'PUBLISHED' });
    expect(result.status).toBe('PUBLISHED');
    expect(tx.courseOffering.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { status: 'PUBLISHED', effectiveTo: undefined } });
    expect(audit.recordInTx).toHaveBeenCalled();
  });

  it('requires a replaced teacher and bounded dates for substitutes', async () => {
    const { service } = makeService();
    jest.spyOn(service, 'get').mockResolvedValue({ id: 'o1', teachers: [], status: 'DRAFT' } as any);
    await expect(service.allocateTeacher('o1', { teacherPartnerId: 'teacher-1', role: 'SUBSTITUTE' }))
      .rejects.toThrow('replaced teacher and an end date');
  });
});

describe('CourseOffering Phase 2 enrollment rules', () => {
  it('refuses a learner enrollment from another academic year', async () => {
    const { service, client } = makeService();
    jest.spyOn(service, 'get').mockResolvedValue({ id: 'o1', academicYearId: 'ay-1', effectiveFrom: new Date(), readiness: {} } as any);
    client.studentEnrollment.findFirst.mockResolvedValue(null);
    await expect(service.setEnrollment('o1', { studentEnrollmentId: 'e1', source: 'ELECTIVE' })).rejects.toThrow('academic year');
  });

  it('keeps custom rosters explicit instead of deriving them from class placement', async () => {
    const { service } = makeService();
    jest.spyOn(service, 'get').mockResolvedValue({ audienceScope: 'CUSTOM', _count: { courseEnrollments: 3 } } as any);
    await expect(service.syncRoster('o1')).resolves.toEqual({ created: 0, retained: 3, skipped: 'CUSTOM rosters are explicitly managed.' });
  });
});
