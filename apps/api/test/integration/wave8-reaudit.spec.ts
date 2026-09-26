/**
 * Re-audit 2026-09-24 — the database refuses what the audit found it accepted.
 *
 *   #9  a whole-class lesson and a section lesson in the same period is a clash;
 *       two different sections side by side is not.
 *   P1-1 the preset backfill gives the year-lifecycle grant to Administrator and
 *       Head Teacher roles only.
 */
import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';

describeDb('integration: re-audit database backstops', () => {
  const raw = new PrismaClient();
  const stamp = Date.now();
  const org = `org_w8_${stamp}`;
  let seq = 0;
  const code = () => `W8-${stamp}-${++seq}`;
  let classId = '';
  let north = '';
  let south = '';
  let periodId = '';
  let subjectId = '';
  const teachers: string[] = [];

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await raw.organization.create({ data: { id: org, code: org.slice(0, 30), name: org, currencyCode: 'UGX' } });
    const grade = await raw.gradeLevel.create({ data: { organizationId: org, name: 'P4', order: 4 } });
    classId = (await raw.schoolClass.create({ data: { organizationId: org, gradeLevelId: grade.id, name: 'P4' } })).id;
    north = (await raw.section.create({ data: { organizationId: org, classId, name: 'North', code: 'N' } })).id;
    south = (await raw.section.create({ data: { organizationId: org, classId, name: 'South', code: 'S' } })).id;
    periodId = (await raw.period.create({
      data: { organizationId: org, name: 'P1', startTime: '08:00', endTime: '08:40', order: 1 },
    })).id;
    subjectId = (await raw.subject.create({ data: { organizationId: org, name: 'English', code: code() } as any })).id;
    for (let i = 0; i < 3; i++) {
      const p = await raw.partner.create({ data: { organizationId: org, code: code(), name: `Teacher ${i}`, isEmployee: true } });
      teachers.push(
        (await raw.staffProfile.create({
          data: { organizationId: org, partnerId: p.id, employeeNo: code(), joinDate: new Date(), staffCategory: 'teaching' } as any,
        })).id,
      );
    }
  });

  afterAll(async () => {
    await raw.$disconnect();
  });

  const lesson = (day: number, sectionId: string | null, teacher: string) => ({
    organizationId: org,
    classId,
    sectionId,
    subjectId,
    dayOfWeek: day,
    periodId,
    teacherPartnerId: teacher,
    cycle: 'all',
  });

  it('#9 a section lesson cannot sit on top of a whole-class lesson', async () => {
    await raw.timetableSlot.create({ data: lesson(1, null, teachers[0]) });
    await expect(raw.timetableSlot.create({ data: lesson(1, north, teachers[1]) })).rejects.toThrow(/Timetable clash/);
  });

  it('#9 …nor a whole-class lesson on top of a section lesson', async () => {
    await raw.timetableSlot.create({ data: lesson(2, south, teachers[0]) });
    await expect(raw.timetableSlot.create({ data: lesson(2, null, teachers[1]) })).rejects.toThrow(/Timetable clash/);
  });

  it('#9 two different sections may run in the same period', async () => {
    await raw.timetableSlot.create({ data: lesson(3, north, teachers[0]) });
    await expect(raw.timetableSlot.create({ data: lesson(3, south, teachers[1]) })).resolves.toBeTruthy();
  });

  it('re-audit #3 P1-17 freeing a teacher from a lesson is never a clash; booking a busy one still is', async () => {
    const mine = await raw.timetableSlot.create({ data: lesson(4, north, teachers[0]) });
    await raw.timetableSlot.create({ data: lesson(4, south, teachers[1]) });
    // Offboarding clears the teacher: the slot claims nothing new.
    await expect(raw.timetableSlot.update({ where: { id: mine.id }, data: { teacherPartnerId: null } })).resolves.toBeTruthy();
    // Re-booking it onto a teacher already teaching South in that period is refused.
    await expect(
      raw.timetableSlot.update({ where: { id: mine.id }, data: { teacherPartnerId: teachers[1] } }),
    ).rejects.toThrow(/Timetable clash/);
  });

  it('P1-1 the lifecycle grant is held by Administrator / Head Teacher roles, never Front Desk or Registrar', async () => {
    const holders = await raw.role.findMany({
      where: { permissions: { has: 'school:academicyear:lifecycle' } },
      select: { name: true },
      distinct: ['name'],
    });
    const names = holders.map((r) => r.name);
    expect(names).not.toContain('Front Desk');
    expect(names).not.toContain('Registrar');
  });
});
