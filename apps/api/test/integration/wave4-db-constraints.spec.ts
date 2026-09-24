/**
 * Wave 4 — the database itself refuses invalid rows (one case per constraint).
 * Each assertion goes straight through Prisma with no service in front, so it
 * proves the backstop holds even when application code is bypassed or racing.
 */
import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';

describeDb('integration: wave 4 database constraints', () => {
  const raw = new PrismaClient();
  const stamp = Date.now();
  const org = `org_w4_${stamp}`;
  const otherOrg = `org_w4b_${stamp}`;
  let yearId = '';
  let termId = '';
  let classId = '';
  let periodId = '';
  let teacherA = '';
  let seq = 0;
  const code = () => `W4-${stamp}-${++seq}`;

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    for (const id of [org, otherOrg]) {
      await raw.organization.create({ data: { id, code: `${id}`.slice(0, 30), name: id, currencyCode: 'UGX' } });
    }
    yearId = (await raw.academicYear.create({
      data: { organizationId: org, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'), isCurrent: true },
    })).id;
    termId = (await raw.term.create({
      data: { organizationId: org, academicYearId: yearId, name: 'T1', startDate: new Date('2026-02-01'), endDate: new Date('2026-04-30'), isCurrent: true },
    })).id;
    const grade = await raw.gradeLevel.create({ data: { organizationId: org, name: 'P1', order: 1 } });
    classId = (await raw.schoolClass.create({ data: { organizationId: org, gradeLevelId: grade.id, name: 'P1 A' } })).id;
    const tPartner = await raw.partner.create({ data: { organizationId: org, code: code(), name: 'Teacher A', isEmployee: true } });
    // TimetableSlot.teacherPartnerId holds a StaffProfile id.
    teacherA = (await raw.staffProfile.create({
      data: { organizationId: org, partnerId: tPartner.id, employeeNo: code(), joinDate: new Date(), staffCategory: 'teaching' } as any,
    })).id;
    periodId = (await raw.period.create({
      data: { organizationId: org, name: 'P1', startTime: '08:00', endTime: '08:40', order: 1 },
    })).id;
  });

  afterAll(async () => {
    await raw.$disconnect();
  });

  it('one current academic year and one current term per school', async () => {
    await expect(
      raw.academicYear.create({
        data: { organizationId: org, name: '2027', startDate: new Date('2027-01-01'), endDate: new Date('2027-12-31'), isCurrent: true },
      }),
    ).rejects.toThrow();
    await expect(
      raw.term.create({
        data: { organizationId: org, academicYearId: yearId, name: 'T2', startDate: new Date('2026-05-01'), endDate: new Date('2026-07-30'), isCurrent: true },
      }),
    ).rejects.toThrow();
  });

  it('dates are ordered, and a term lies inside its year', async () => {
    await expect(
      raw.academicYear.create({
        data: { organizationId: org, name: 'bad', startDate: new Date('2028-12-31'), endDate: new Date('2028-01-01') },
      }),
    ).rejects.toThrow();
    await expect(
      raw.term.create({
        data: { organizationId: org, academicYearId: yearId, name: 'Outside', startDate: new Date('2026-11-01'), endDate: new Date('2027-02-01') },
      }),
    ).rejects.toThrow(/outside its academic year/);
    // Shrinking the year under its terms is refused too.
    await expect(
      raw.academicYear.update({ where: { id: yearId }, data: { endDate: new Date('2026-03-01') } }),
    ).rejects.toThrow(/no longer contain/);
  });

  it('a pupil holds at most one ACTIVE enrollment', async () => {
    const partner = await raw.partner.create({ data: { organizationId: org, code: code(), name: 'Pupil', isCustomer: true } });
    const sp = await raw.studentProfile.create({
      data: { organizationId: org, partnerId: partner.id, admissionNo: code(), enrollmentDate: new Date('2026-02-01') },
    });
    const programme = await raw.academicProgramme.create({
      data: { organizationId: org, code: code(), name: 'Prog', isActive: true, effectiveFrom: new Date('2000-01-01') },
    });
    const grade = await raw.gradeLevel.findFirstOrThrow({ where: { organizationId: org } });
    const y2 = await raw.academicYear.create({
      data: { organizationId: org, name: '2030', startDate: new Date('2030-01-01'), endDate: new Date('2030-12-31') },
    });
    await raw.studentEnrollment.create({
      data: { organizationId: org, studentProfileId: sp.id, academicYearId: yearId, programmeId: programme.id, gradeLevelId: grade.id, admissionDate: new Date('2026-02-01'), status: 'ACTIVE' },
    });
    await expect(
      raw.studentEnrollment.create({
        data: { organizationId: org, studentProfileId: sp.id, academicYearId: y2.id, programmeId: programme.id, gradeLevelId: grade.id, admissionDate: new Date('2030-02-01'), status: 'ACTIVE' },
      }),
    ).rejects.toThrow();
  });

  it('seat counters cannot go negative', async () => {
    const cycle = await raw.admissionCycle.create({ data: { organizationId: org, academicYearId: yearId, name: code() } });
    await expect(
      raw.admissionCapacity.create({
        data: { organizationId: org, admissionCycleId: cycle.id, classId, sectionId: '__none__', capacity: 10, claimedSeats: -1 },
      }),
    ).rejects.toThrow();
  });

  it('loose ids are real foreign keys, and same-organization', async () => {
    const cycle = await raw.admissionCycle.create({ data: { organizationId: org, academicYearId: yearId, name: code() } });
    await expect(
      raw.admissionCapacity.create({
        data: { organizationId: org, admissionCycleId: cycle.id, classId: 'no-such-class', sectionId: '__none__', capacity: 5 },
      }),
    ).rejects.toThrow();
    await expect(
      raw.admissionApplication.create({
        data: {
          organizationId: org, academicYearId: yearId, applicationNumber: code(),
          applicantFirstName: 'A', applicantLastName: 'B', parentContactId: 'no-such-contact',
        } as any,
      }),
    ).rejects.toThrow();
    // A contact from ANOTHER school is refused by the same-org guard.
    const foreignPartner = await raw.partner.create({ data: { organizationId: otherOrg, code: code(), name: 'Other' } });
    const foreign = await raw.contact.create({ data: { organizationId: otherOrg, partnerId: foreignPartner.id, firstName: 'X' } });
    await expect(
      raw.admissionApplication.create({
        data: {
          organizationId: org, academicYearId: yearId, applicationNumber: code(),
          applicantFirstName: 'C', applicantLastName: 'D', parentContactId: foreign.id,
        } as any,
      }),
    ).rejects.toThrow(/Cross-tenant|Foreign key/);
  });

  it('a role of one school cannot be attached to a user of another', async () => {
    const foreignRole = await raw.role.create({ data: { organizationId: otherOrg, name: `R-${stamp}`, permissions: ['*'] } });
    const user = await raw.user.create({
      data: { organizationId: org, email: `u.${stamp}@w4.test`, passwordHash: 'x', firstName: 'U', isActive: true },
    });
    await expect(
      raw.user.update({ where: { id: user.id }, data: { roles: { connect: { id: foreignRole.id } } } }),
    ).rejects.toThrow();
  });

  it('the same child cannot be entered twice for a year unless confirmed different', async () => {
    const base = {
      organizationId: org, academicYearId: yearId,
      applicantFirstName: 'Twin', applicantLastName: `Okello${stamp}`, applicantDob: new Date('2019-05-05'),
    };
    await raw.admissionApplication.create({ data: { ...base, applicationNumber: code() } as any });
    await expect(
      raw.admissionApplication.create({ data: { ...base, applicantFirstName: 'TWIN', applicationNumber: code() } as any }),
    ).rejects.toThrow();
    await expect(
      raw.admissionApplication.create({ data: { ...base, applicationNumber: code(), allowDuplicate: true } as any }),
    ).resolves.toBeTruthy();
  });

  it('a teacher cannot be double-booked in one period', async () => {
    const subject = await raw.subject.create({ data: { organizationId: org, name: 'Maths', code: code() } as any });
    const slot = { organizationId: org, classId, subjectId: subject.id, dayOfWeek: 1, periodId, teacherPartnerId: teacherA, cycle: 'all' };
    await raw.timetableSlot.create({ data: slot });
    const grade = await raw.gradeLevel.findFirstOrThrow({ where: { organizationId: org } });
    const other = await raw.schoolClass.create({ data: { organizationId: org, gradeLevelId: grade.id, name: `P1 B ${stamp}` } });
    await expect(raw.timetableSlot.create({ data: { ...slot, classId: other.id } })).rejects.toThrow(/Timetable clash/);
  });

  void termId;
});
