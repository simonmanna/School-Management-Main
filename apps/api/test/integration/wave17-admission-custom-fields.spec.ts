/**
 * Wave 17 — audit R03 / D03, against a real database.
 *
 * A school's required pupil fields are enforced on every route that creates a
 * pupil — the student form, the front-desk quick register, CSV import and
 * transfer-in — before any pupil, guardian or enrollment row is written.
 * Valid values are normalised and stored. A returning pupil keeps the record
 * they already have.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
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
import { StudentAdmissionService } from '../../src/modules/school/people/student-admission.service';
import { StudentService } from '../../src/modules/school/people/student.service';
import { AdmissionsService } from '../../src/modules/school/admissions/admissions.service';
import { ensureAcademicSpine, type AcademicSpine } from './_placement';

describeDb('integration: wave 17 required pupil fields on every admission route (R03)', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let admission: StudentAdmissionService;
  let students: StudentService;
  let admissions: AdmissionsService;

  const stamp = Date.now();
  const organizationId = `org_w17cf_${stamp}`;
  const REGISTRAR = ['school:read', 'school:students:write', 'school:enrollment:write', 'school:admissions:write'];
  const as = <T>(fn: () => Promise<T>): Promise<T> => tenant.run({ organizationId, userId: 'registrar_1', permissions: REGISTRAR }, fn);

  let spine: AcademicSpine;
  let roll = 0;
  const countNamed = (name: string) => raw.studentProfile.count({ where: { organizationId, partner: { name } } });
  const enrollmentsNamed = (name: string) =>
    raw.studentEnrollment.count({ where: { organizationId, student: { partner: { name } } } as any });
  const VALID = { bloodGroup: 'O+', siblingsAtSchool: '2' };

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({ where: { code: 'UGX' }, update: {}, create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 } });
    await raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, organizationId);
    await raw.organization.create({ data: { id: organizationId, code: `W17CF-${stamp}`, name: 'Green Valley', currencyCode: 'UGX' } });
    await raw.schoolProfile.create({ data: { organizationId, name: 'Green Valley', gradingSystem: 'PLE', capacityPolicy: 'OFF' } as any });
    spine = await ensureAcademicSpine(raw, { organizationId, yearName: '2026', gradeName: 'P3', className: 'P3' });
    await raw.term.update({ where: { id: spine.termId }, data: { startDate: new Date('2026-01-15'), endDate: new Date('2026-12-15') } });
    await raw.customField.createMany({
      data: [
        { organizationId, entityType: 'student', name: 'bloodGroup', label: 'Blood group', type: 'select', options: ['A+', 'B+', 'O+', 'AB+'], required: true },
        { organizationId, entityType: 'student', name: 'siblingsAtSchool', label: 'Siblings at school', type: 'number', options: [], required: true },
        { organizationId, entityType: 'student', name: 'busStop', label: 'Bus stop', type: 'text', options: [], required: false },
      ],
    });

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    admission = moduleRef.get(StudentAdmissionService);
    students = moduleRef.get(StudentService);
    admissions = moduleRef.get(AdmissionsService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  const quick = (name: string, customFields?: Record<string, unknown>) => {
    roll += 1;
    return as(() =>
      admission.register({ name, dateOfBirth: '2019-05-0' + ((roll % 9) + 1), classId: spine.classId, termId: spine.termId, rollNumber: `R-${roll}`, guardianName: `Parent of ${name}`, guardianPhone: '+256700000000', customFields } as any),
    );
  };

  it('quick register refuses a missing required field and writes nothing', async () => {
    const err = await quick('Akello Joy', { bloodGroup: 'O+' }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify((err as BadRequestException).getResponse())).toMatch(/Siblings at school is required/);
    expect(await countNamed('Akello Joy')).toBe(0);
    expect(await enrollmentsNamed('Akello Joy')).toBe(0);
    expect(await raw.partner.count({ where: { organizationId, name: 'Parent of Akello Joy' } })).toBe(0);
  });

  it('quick register refuses an invalid select value', async () => {
    await expect(quick('Opio Mark', { bloodGroup: 'Z', siblingsAtSchool: 1 })).rejects.toThrow(/Blood group must be one of/);
    expect(await countNamed('Opio Mark')).toBe(0);
  });

  it('quick register stores valid values, normalised', async () => {
    const res: any = await quick('Nambi Ruth', VALID);
    const row = await raw.studentProfile.findFirst({ where: { id: res.profile.id } });
    expect(row!.customFields).toMatchObject({ bloodGroup: 'O+', siblingsAtSchool: 2 });
  });

  it('the student form enforces the same rule', async () => {
    await expect(
      as(() => students.create({ name: 'Mugisha Paul', admissionNo: `F-${stamp}`, enrollmentDate: '2026-02-01', customFields: {} } as any)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await countNamed('Mugisha Paul')).toBe(0);
  });

  it('CSV import fails only the rows missing a required column, and reads the school columns', async () => {
    const res = await as(() =>
      students.bulkImport([
        { admissionno: `C1-${stamp}`, name: 'Csv Missing', bloodgroup: 'A+' },
        { admissionno: `C2-${stamp}`, name: 'Csv Complete', bloodgroup: 'B+', siblingsatschool: '0' },
        { admissionno: `C3-${stamp}`, name: 'Csv Prefixed', cf_bloodgroup: 'AB+', cf_siblingsatschool: '1' },
      ]),
    );
    expect(res.created).toBe(2);
    expect(res.skipped).toEqual([expect.objectContaining({ row: 0, reason: expect.stringMatching(/Siblings at school is required/) })]);
    expect(await countNamed('Csv Missing')).toBe(0);
    const complete = await raw.studentProfile.findFirst({ where: { organizationId, partner: { name: 'Csv Complete' } } });
    expect(complete!.customFields).toMatchObject({ bloodGroup: 'B+', siblingsAtSchool: 0 });
  });

  it('transfer-in enforces the rule and keeps transferredFrom', async () => {
    const base = { name: 'Transfer Pupil', dateOfBirth: '2019-01-01', classId: spine.classId, termId: spine.termId, rollNumber: `T-${stamp}`, transferredFrom: 'Hilltop Primary' };
    await expect(as(() => admissions.transferIn(base as any))).rejects.toBeInstanceOf(BadRequestException);
    expect(await countNamed('Transfer Pupil')).toBe(0);
    const ok: any = await as(() => admissions.transferIn({ ...base, customFields: VALID } as any));
    const row = await raw.studentProfile.findFirst({ where: { id: ok.studentProfileId ?? ok.profile?.id ?? ok.studentProfile?.id } });
    expect(row!.customFields).toMatchObject({ bloodGroup: 'O+', transferredFrom: 'Hilltop Primary' });
  });

  it('a returning pupil is re-enrolled without being asked for fields added later', async () => {
    const res: any = await quick('Returning Pupil', VALID);
    await raw.customField.create({
      data: { organizationId, entityType: 'student', name: 'shoeSize', label: 'Shoe size', type: 'number', options: [], required: true },
    });
    try {
      // Admitting an EXISTING learner takes the enrolExisting path: no new profile.
      const again = await as(() =>
        admission.admit({ organizationId, name: 'Returning Pupil', existingStudentProfileId: res.profile.id } as any),
      ).catch((e) => e);
      expect(again).not.toBeInstanceOf(BadRequestException);
    } finally {
      await raw.customField.deleteMany({ where: { organizationId, name: 'shoeSize' } });
    }
  });
});
