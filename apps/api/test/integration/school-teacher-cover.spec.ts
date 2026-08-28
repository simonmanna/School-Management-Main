/**
 * Integration — teacher cover for approved leave (Phase 7).
 *
 * Leave lives in HR; the timetable lives in the school vertical; neither may
 * import the other (ADR-011). HR publishes `hr.leave.approved` and the school
 * subscribes.
 *
 * What must hold:
 *   - an absence lists exactly the lessons it breaks;
 *   - booking a substitute is a DATED override, not an edit to the recurring
 *     weekly grid (which has no dates and would apply forever);
 *   - a substitute who is already busy in that period is rejected — cover used
 *     to be booked with no clash checking at all.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';
import { KernelModule } from '../../src/kernel/kernel.module';
import { CoreModule } from '../../src/modules/core/core.module';
import { AccountingModule } from '../../src/modules/accounting/accounting.module';
import { InventoryModule } from '../../src/modules/inventory/inventory.module';
import { InvoicingModule } from '../../src/modules/invoicing/invoicing.module';
import { DocumentsModule } from '../../src/modules/documents/documents.module';
import { SchoolModule } from '../../src/modules/school/school.module';
import { TeacherCoverService } from '../../src/modules/school/academics/teacher-cover.service';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';

describeDb('integration: teacher cover', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let cover: TeacherCoverService;

  const organizationId = `org_cover_${Date.now()}`;
  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);

  let absentTeacherId = '';
  let freeTeacherId = '';
  let busyTeacherId = '';
  let mondaySlotId = '';
  let periodId = '';

  const asAdmin = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run(
      { organizationId, userId: 'admin_cover', permissions: ['school:read', 'school:foundation:write'] },
      fn,
    );

  const makeTeacher = async (name: string, no: string) => {
    const partner = await raw.partner.create({
      data: { organizationId, code: `P-${no}`, name, isEmployee: true },
    });
    const profile = await raw.staffProfile.create({
      data: { organizationId, partnerId: partner.id, employeeNo: no, joinDate: new Date(), staffCategory: 'teaching' },
    });
    return profile.id;
  };

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({ where: { code: 'UGX' }, update: {}, create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 } });
    await setOrg(organizationId);
    await raw.organization.create({ data: { id: organizationId, code: organizationId, name: 'Cover Test', currencyCode: 'UGX' } });

    absentTeacherId = await makeTeacher('Absent Teacher', 'CV-1');
    freeTeacherId = await makeTeacher('Free Teacher', 'CV-2');
    busyTeacherId = await makeTeacher('Busy Teacher', 'CV-3');

    const grade = await raw.gradeLevel.create({ data: { organizationId, name: 'S1-CV', order: 1 } });
    const classA = await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'S1 A CV' } });
    const classB = await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'S1 B CV' } });
    const subject = await raw.subject.create({ data: { organizationId, code: 'PHY-CV', name: 'Physics' } });
    const period = await raw.period.create({
      data: { organizationId, name: 'P1-CV', order: 1, startTime: '08:00', endTime: '08:40' },
    });
    periodId = period.id;

    // The absent teacher teaches class A on Monday P1 …
    const slot = await raw.timetableSlot.create({
      data: {
        organizationId, classId: classA.id, dayOfWeek: 1, periodId: period.id,
        subjectId: subject.id, teacherPartnerId: absentTeacherId, type: 'lesson',
      },
    });
    mondaySlotId = slot.id;

    // … and on Wednesday, which a Monday-only absence must NOT touch.
    await raw.timetableSlot.create({
      data: {
        organizationId, classId: classA.id, dayOfWeek: 3, periodId: period.id,
        subjectId: subject.id, teacherPartnerId: absentTeacherId, type: 'lesson',
      },
    });

    // The "busy" teacher already has class B on Monday P1.
    await raw.timetableSlot.create({
      data: {
        organizationId, classId: classB.id, dayOfWeek: 1, periodId: period.id,
        subjectId: subject.id, teacherPartnerId: busyTeacherId, type: 'lesson',
      },
    });

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    cover = moduleRef.get(TeacherCoverService);
  });

  afterAll(async () => {
    if (moduleRef) await moduleRef.close();
    await raw.timetableOverride.deleteMany({ where: { organizationId } });
    await raw.timetableSlot.deleteMany({ where: { organizationId } });
    await raw.period.deleteMany({ where: { organizationId } });
    await raw.subject.deleteMany({ where: { organizationId } });
    await raw.schoolClass.deleteMany({ where: { organizationId } });
    await raw.gradeLevel.deleteMany({ where: { organizationId } });
    await raw.staffProfile.deleteMany({ where: { organizationId } });
    await raw.partner.deleteMany({ where: { organizationId } });
    await raw.auditLog.deleteMany({ where: { organizationId } });
    await raw.eventOutbox.deleteMany({ where: { organizationId } });
    await raw.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
    await raw.$disconnect();
  });

  it('lists only the lessons an absence actually breaks', async () => {
    // Monday 2026-06-01 only.
    const monday = new Date('2026-06-01');
    const affected = await asAdmin(() => cover.affectedLessons(absentTeacherId, monday, monday));
    expect(affected).toHaveLength(1);
    expect(affected[0].id).toBe(mondaySlotId);
    // The Wednesday lesson is untouched by a Monday absence.
    expect(affected.map((a: any) => a.dayOfWeek)).not.toContain(3);
  });

  it('includes every weekday covered by a longer absence', async () => {
    // Mon 1st → Fri 5th June 2026 covers both the Monday and Wednesday lessons.
    const affected = await asAdmin(() =>
      cover.affectedLessons(absentTeacherId, new Date('2026-06-01'), new Date('2026-06-05')),
    );
    expect(affected.map((a: any) => a.dayOfWeek).sort()).toEqual([1, 3]);
  });

  it('books a substitute as a DATED override, leaving the base grid untouched', async () => {
    const override = await asAdmin(() =>
      cover.assignSubstitute({
        timetableSlotId: mondaySlotId,
        substituteTeacherId: freeTeacherId,
        effectiveFrom: '2026-06-01',
        effectiveTo: '2026-06-01',
        reason: 'Approved leave',
      }),
    );
    expect(override.teacherPartnerId).toBe(freeTeacherId);
    expect(override.dayOfWeek).toBe(1);

    // Crucially, the recurring slot still names the original teacher — the
    // override is dated, so next Monday reverts automatically.
    const slot = await raw.timetableSlot.findUniqueOrThrow({ where: { id: mondaySlotId } });
    expect(slot.teacherPartnerId).toBe(absentTeacherId);
  });

  it('refuses a substitute who already teaches in that period (the missing clash check)', async () => {
    await expect(
      asAdmin(() =>
        cover.assignSubstitute({
          timetableSlotId: mondaySlotId,
          substituteTeacherId: busyTeacherId,
          effectiveFrom: '2026-06-08',
          effectiveTo: '2026-06-08',
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses a substitute already covering another class in an overlapping window', async () => {
    // freeTeacher is now covering class A on Monday P1 for 2026-06-01.
    // Booking them for a DIFFERENT class in an overlapping window must fail.
    const otherClass = await raw.schoolClass.findFirstOrThrow({
      where: { organizationId, name: 'S1 B CV' },
    });
    const otherSlot = await raw.timetableSlot.findFirstOrThrow({
      where: { organizationId, classId: otherClass.id, dayOfWeek: 1, periodId },
    });
    await expect(
      asAdmin(() =>
        cover.assignSubstitute({
          timetableSlotId: otherSlot.id,
          substituteTeacherId: freeTeacherId,
          effectiveFrom: '2026-06-01',
          effectiveTo: '2026-06-01',
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses to name the absent teacher as their own substitute', async () => {
    await expect(
      asAdmin(() =>
        cover.assignSubstitute({
          timetableSlotId: mondaySlotId,
          substituteTeacherId: absentTeacherId,
          effectiveFrom: '2026-06-15',
          effectiveTo: '2026-06-15',
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an inverted date window', async () => {
    await expect(
      asAdmin(() =>
        cover.assignSubstitute({
          timetableSlotId: mondaySlotId,
          substituteTeacherId: freeTeacherId,
          effectiveFrom: '2026-06-20',
          effectiveTo: '2026-06-10',
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
