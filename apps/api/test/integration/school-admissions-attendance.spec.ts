/**
 * H4 integration — the academic entry path: admissions → enrollment → attendance.
 *
 * Proves against a real DB that an application can be created, accepted (through
 * the admission FSM), and enrolled into a student (Partner + StudentProfile),
 * and that the student's attendance can be marked and read back. These flows had
 * no integration coverage.
 *
 * Same DB requirements as school-happy-path.spec.ts (RLS-inert target). Imports
 * SchoolModule and init()s it so the admission_application workflow registers.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';
import { KernelModule } from '../../src/kernel/kernel.module';
import { DocumentsModule } from '../../src/modules/documents/documents.module';
import { CoreModule } from '../../src/modules/core/core.module';
import { AccountingModule } from '../../src/modules/accounting/accounting.module';
import { InventoryModule } from '../../src/modules/inventory/inventory.module';
import { InvoicingModule } from '../../src/modules/invoicing/invoicing.module';
import { SchoolModule } from '../../src/modules/school/school.module';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';
import { AdmissionsService } from '../../src/modules/school/admissions/admissions.service';
import { StudentAttendanceService } from '../../src/modules/school/attendance/student-attendance.service';

describeDb('integration: school admissions → enrollment → attendance (H4)', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let admissions: AdmissionsService;
  let attendance: StudentAttendanceService;

  const organizationId = `org_adm_${Date.now()}`;
  const userId = 'registrar_1';
  let academicYearId = '';
  let termId = '';
  let classId = '';

  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await setOrg(organizationId);
    await raw.organization.create({ data: { id: organizationId, code: `ADM-${Date.now()}`, name: 'Admissions School', currencyCode: 'UGX' } });

    const year = await raw.academicYear.create({
      data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
    });
    academicYearId = year.id;
    const term = await raw.term.create({
      data: { organizationId, academicYearId: year.id, name: 'Term 1', startDate: new Date('2026-01-15'), endDate: new Date('2026-04-15'), isCurrent: true },
    });
    termId = term.id;
    const grade = await raw.gradeLevel.create({ data: { organizationId, name: 'S1', order: 8 } });
    const cls = await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'S1 East' } });
    classId = cls.id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    // init() so SchoolModule.onModuleInit registers the admission_application FSM.
    await moduleRef.init();

    tenant = moduleRef.get(TenantContextService);
    admissions = moduleRef.get(AdmissionsService);
    attendance = moduleRef.get(StudentAttendanceService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  const asTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId, permissions: ['school:admissions:write', 'school:attendance:write'] }, fn);

  it('creates an application, accepts it through the FSM, and enrolls a student', async () => {
    const app: any = await asTenant(() =>
      admissions.create({
        academicYearId,
        applicantFirstName: 'Grace',
        applicantLastName: 'Nakato',
        applyingForClassId: classId,
      }),
    );
    expect(app.status).toBe('submitted');

    // FSM: submitted → review → under_review → accept → accepted.
    await asTenant(() => admissions.review(app.id, 'review'));
    await asTenant(() => admissions.review(app.id, 'accept', 'strong interview'));
    const accepted = await raw.admissionApplication.findFirst({ where: { id: app.id } });
    expect(accepted!.status).toBe('accepted');

    const result: any = await asTenant(() =>
      admissions.enroll({
        applicationId: app.id,
        classId,
        termId,
        rollNumber: '1',
        student: { name: 'Grace Nakato' },
      }),
    );
    const studentProfileId = result.studentProfile?.id ?? result.studentProfileId;
    expect(studentProfileId).toBeTruthy();
    expect(result.partner?.name).toContain('Grace');

    const student = await raw.studentProfile.findFirst({ where: { id: studentProfileId } });
    expect(student).toBeTruthy();
    expect(student!.currentClassId).toBe(classId);

    // The enrolled student has a Partner (the AR account) carrying the name.
    const partner = await raw.partner.findFirst({ where: { id: student!.partnerId } });
    expect(partner!.name).toContain('Grace');

    // The application is now marked enrolled.
    const enrolledApp = await raw.admissionApplication.findFirst({ where: { id: app.id } });
    expect(enrolledApp!.status).toBe('enrolled');

    // Mark attendance for the student and read it back.
    await asTenant(() =>
      attendance.mark({
        date: '2026-02-03',
        classId,
        entries: [{ studentProfileId, status: 'present' }],
      }),
    );
    const rows = await raw.studentAttendance.findMany({ where: { studentProfileId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('present');
  });
});
