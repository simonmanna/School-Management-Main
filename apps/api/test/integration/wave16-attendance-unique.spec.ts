/**
 * Wave 16 (audit P0-3) — the daily register is one row per pupil per date, and
 * the DATABASE says so. The partial index `StudentAttendance_daily_unique` is
 * raw SQL Prisma cannot declare; the CI preflight proves it exists, this proves
 * it bites under concurrency, including across two classes on the same day.
 */
import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';

describeDb('integration: daily attendance uniqueness (audit P0-3)', () => {
  const raw = new PrismaClient();
  const stamp = Date.now();
  const organizationId = `org_att_uniq_${stamp}`;
  let studentProfileId = '';
  let classA = '';
  let classB = '';

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, organizationId);
    await raw.organization.create({ data: { id: organizationId, code: `ATTU-${stamp}`, name: 'Attendance School', currencyCode: 'UGX' } });
    const grade = await raw.gradeLevel.create({ data: { organizationId, name: 'P1', order: 1 } });
    classA = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'P1 A' } })).id;
    classB = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'P1 B' } })).id;
    const partner = await raw.partner.create({ data: { organizationId, code: 'STU-AU-1', name: 'Unique Pupil', isCustomer: true } });
    studentProfileId = (
      await raw.studentProfile.create({
        data: { organizationId, partnerId: partner.id, admissionNo: 'ADM-AU-1', enrollmentDate: new Date('2026-01-10'), status: 'active' },
      })
    ).id;
  });

  afterAll(async () => {
    await raw.$disconnect();
  });

  const mark = (classId: string, status: string) =>
    raw.studentAttendance.create({
      data: { organizationId, studentProfileId, classId, date: new Date('2026-03-02'), status },
    });

  it('two concurrent daily marks for the same pupil and date leave exactly one row', async () => {
    const results = await Promise.allSettled([mark(classA, 'present'), mark(classA, 'absent')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason?.code).toBe('P2002');
    expect(await raw.studentAttendance.count({ where: { organizationId, studentProfileId, periodId: null } })).toBe(1);
  });

  it('a second class cannot add another daily row for the same pupil and date', async () => {
    await expect(mark(classB, 'present')).rejects.toMatchObject({ code: 'P2002' });
  });
});
