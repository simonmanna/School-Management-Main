/**
 * Wave 14 — audit 2026-09-27 F07 and F08, against a real database.
 *
 * D07: the same child registered twice (quick register, admit form, transfer
 *      in, concurrently) is refused with the match; a genuinely different
 *      child needs the override grant and a reason, and is audited.
 * D08: one session contributes once; the school's late policy decides what a
 *      late mark is worth; no rate exceeds 100; every consumer agrees.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PERMISSIONS } from '@erp/shared';
import { describeDb } from './_setup';
import { KernelModule } from '../../src/kernel/kernel.module';
import { DocumentsModule } from '../../src/modules/documents/documents.module';
import { CoreModule } from '../../src/modules/core/core.module';
import { AccountingModule } from '../../src/modules/accounting/accounting.module';
import { InventoryModule } from '../../src/modules/inventory/inventory.module';
import { InvoicingModule } from '../../src/modules/invoicing/invoicing.module';
import { SchoolModule } from '../../src/modules/school/school.module';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';
import { StudentAdmissionService } from '../../src/modules/school/people/student-admission.service';
import { StudentService } from '../../src/modules/school/people/student.service';
import { StudentAttendanceService } from '../../src/modules/school/attendance/student-attendance.service';
import { summarizeAttendance } from '../../src/modules/school/attendance/attendance-rate';
import { ensureAcademicSpine, type AcademicSpine } from './_placement';

describeDb('integration: wave 14 identity and attendance (F07/F08)', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let admission: StudentAdmissionService;
  let students: StudentService;
  let attendance: StudentAttendanceService;

  const stamp = Date.now();
  const organizationId = `org_w14i_${stamp}`;
  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);
  const REGISTRAR = ['school:read', 'school:students:write', 'school:enrollment:write'];
  const REGISTRAR_OVERRIDE = [...REGISTRAR, PERMISSIONS.school.overrideDuplicate];
  const as = <T>(permissions: string[], fn: () => Promise<T>, userId = 'registrar_1'): Promise<T> =>
    tenant.run({ organizationId, userId, permissions }, fn);

  let spine: AcademicSpine;
  let roll = 0;
  const reg = (name: string, extra: Record<string, unknown> = {}) => {
    roll += 1;
    return admission.register({
      name,
      dateOfBirth: '2022-03-14',
      classId: spine.classId,
      termId: spine.termId,
      rollNumber: `R-${roll}`,
      ...extra,
    } as any);
  };
  const countNamed = (name: string) => raw.studentProfile.count({ where: { organizationId, partner: { name } } });

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({ where: { code: 'UGX' }, update: {}, create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 } });
    await setOrg(organizationId);
    await raw.organization.create({ data: { id: organizationId, code: `W14I-${stamp}`, name: 'Green Valley', currencyCode: 'UGX' } });
    await raw.schoolProfile.create({ data: { organizationId, name: 'Green Valley', gradingSystem: 'PLE', capacityPolicy: 'OFF' } as any });
    spine = await ensureAcademicSpine(raw, { organizationId, yearName: '2026', gradeName: 'Baby', className: 'Baby' });
    await raw.term.update({ where: { id: spine.termId }, data: { startDate: new Date('2026-01-15'), endDate: new Date('2026-12-15') } });
    for (const s of [
      { code: 'present', label: 'Present', isPresent: true, isDefault: true },
      { code: 'late', label: 'Late', isPresent: true, isLate: true },
      { code: 'absent', label: 'Absent', isAbsent: true },
      { code: 'excused', label: 'Excused', isAbsent: true, isExcused: true },
    ]) {
      await raw.attendanceStatusConfig.create({ data: { organizationId, ...s } as any });
    }

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    admission = moduleRef.get(StudentAdmissionService);
    students = moduleRef.get(StudentService);
    attendance = moduleRef.get(StudentAttendanceService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  describe('D07 — one child, one record', () => {
    it('quick register refuses the same child twice and names the match', async () => {
      await as(REGISTRAR, () => reg('Atim Grace'));
      const err = await as(REGISTRAR, () => reg('  atim   grace ')).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toMatchObject({ code: 'LIKELY_DUPLICATE', duplicates: [expect.objectContaining({ name: 'Atim Grace' })] });
      expect(await countNamed('Atim Grace')).toBe(1);
    });

    it('the admit form hits the same check', async () => {
      await expect(
        as(REGISTRAR, () => students.create({ name: 'Atim Grace', admissionNo: `X-${stamp}`, enrollmentDate: '2026-02-01', dateOfBirth: '2022-03-14' } as any)),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await countNamed('Atim Grace')).toBe(1);
    });

    it('two simultaneous registrations of one child create one record', async () => {
      const results = await Promise.allSettled([as(REGISTRAR, () => reg('Okello Ivan')), as(REGISTRAR, () => reg('Okello Ivan'))]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await countNamed('Okello Ivan')).toBe(1);
    });

    it('with no date of birth, the same name in the same class is still caught', async () => {
      await as(REGISTRAR, () => reg('Nakato Sarah', { dateOfBirth: undefined }));
      await expect(as(REGISTRAR, () => reg('Nakato Sarah', { dateOfBirth: undefined }))).rejects.toBeInstanceOf(ConflictException);
    });

    it('a different child with the same name and birthday needs the grant and a reason, and is audited', async () => {
      await expect(as(REGISTRAR, () => reg('Atim Grace', { allowDuplicate: true, duplicateReason: 'Twin' }))).rejects.toBeInstanceOf(ForbiddenException);
      await expect(as(REGISTRAR_OVERRIDE, () => reg('Atim Grace', { allowDuplicate: true }))).rejects.toThrow(/why/);
      const res: any = await as(REGISTRAR_OVERRIDE, () => reg('Atim Grace', { allowDuplicate: true, duplicateReason: 'Different parents; cousin' }));
      expect(await countNamed('Atim Grace')).toBe(2);
      const audit = await raw.auditLog.findFirst({ where: { organizationId, entityId: res.profile.id, newValues: { path: ['duplicateOverride'], equals: true } } as any });
      expect(audit).not.toBeNull();
    });
  });

  describe('D08 — attendance arithmetic', () => {
    let pupil = '';
    const mark = async (date: string, status: string) =>
      raw.studentAttendance.create({ data: { organizationId, studentProfileId: pupil, classId: spine.classId, date: new Date(date), status } });
    const policy = (lateContribution: number | null, excusedInDenominator = false) =>
      raw.schoolProfile.updateMany({ where: { organizationId }, data: { attendanceLateContribution: lateContribution, attendanceExcusedInDenominator: excusedInDenominator } as any });
    const byStudent = () => as(['*'], () => attendance.byStudent(pupil, '2026-01-01', '2026-12-31'));

    beforeAll(async () => {
      pupil = (await as(REGISTRAR, () => reg('Attendance Child'))).profile.id;
    });

    it('one late day with no school policy: no rate is invented', async () => {
      await mark('2026-02-02', 'late');
      await policy(null);
      const s: any = await byStudent();
      expect(s).toMatchObject({ total: 1, present: 0, late: 1, attendanceRate: null, policyMissing: true });
    });

    it('one late day is 100% or 50% by the school policy — never 150%', async () => {
      await policy(1);
      expect((await byStudent() as any).attendanceRate).toBe(100);
      await policy(0.5);
      expect((await byStudent() as any).attendanceRate).toBe(50);
    });

    it('a mixed month matches an independent calculation, with excused in and out', async () => {
      await mark('2026-02-03', 'present');
      await mark('2026-02-04', 'present');
      await mark('2026-02-05', 'absent');
      await mark('2026-02-06', 'excused');
      // late 0.5 + present 2 = 2.5 attended. Out: denominator 4 (late, 2 present, absent). In: 5.
      await policy(0.5, false);
      expect((await byStudent() as any).attendanceRate).toBe(62.5);
      await policy(0.5, true);
      expect((await byStudent() as any).attendanceRate).toBe(50);
    });

    it('the class report and the pupil summary agree', async () => {
      await policy(1, false);
      const pupilRate = (await byStudent() as any).attendanceRate;
      const report: any = await as(['*'], () => attendance.report(spine.classId, '2026-02-01', '2026-02-28'));
      expect(report.summary.rate).toBe(pupilRate);
      expect(pupilRate).toBe(75); // (1 late + 2 present) / (1 + 2 + 1 absent)
    });

    it('the calculator never exceeds 100 for any mix', () => {
      const catalog = {
        present: { isPresent: true },
        late: { isPresent: true, isLate: true },
        absent: { isAbsent: true },
        excused: { isAbsent: true, isExcused: true },
      };
      for (const late of [0, 1, 5]) {
        for (const lc of [1, 0.5]) {
          for (const excIn of [true, false]) {
            const s = summarizeAttendance([['present', 3], ['late', late], ['absent', 1], ['excused', 2]], catalog, { lateContribution: lc, excusedInDenominator: excIn });
            expect(s.rate!).toBeLessThanOrEqual(100);
            expect(s.sessions).toBe(3 + late + 1 + 2);
            expect(s.present + s.late + s.absent + s.excused).toBe(s.sessions);
          }
        }
      }
    });
  });
});
