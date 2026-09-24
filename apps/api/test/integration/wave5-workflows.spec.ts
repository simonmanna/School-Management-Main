/**
 * Wave 5 — missing workflows, end to end against a real database:
 *
 *   C1/C2  a bootstrapped school is Ugandan by default (UGX, Africa/Kampala) and
 *          starts with nursery + P1–P7 on a promotion ladder, a class per
 *          grade, attendance statuses, the PLE grading scale and a main campus.
 *   S1     bootstrap is one transaction: a failure part-way leaves nothing.
 *   Guard  a CLOSED year's register cannot be marked.
 *   Staff  a suspended teacher loses their own-class access.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
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
import { OrganizationsService } from '../../src/modules/core/organizations.service';
import { StudentAttendanceService } from '../../src/modules/school/attendance/student-attendance.service';
import { ACCOUNTING_BOOTSTRAP } from '../../src/kernel/common/org-bootstrap.tokens';
import { PERMISSIONS } from '@erp/shared';
import { placeInClass } from './_placement';
import { StudentService } from '../../src/modules/school/people/student.service';

describeDb('integration: wave 5 workflows', () => {
  const raw = new PrismaClient();
  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let orgs: OrganizationsService;
  let attendance: StudentAttendanceService;
  const stamp = Date.now();

  beforeAll(async () => {
    await raw.$connect();
    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    orgs = moduleRef.get(OrganizationsService);
    attendance = moduleRef.get(StudentAttendanceService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  it('bootstraps a Ugandan primary school with its structure (C1/C2)', async () => {
    const code = `W5-${stamp}`.slice(0, 30);
    const res: any = await orgs.bootstrap({
      organizationCode: code,
      organizationName: 'Wave5 Primary',
      adminEmail: `head.${stamp}@w5.test`,
      adminFirstName: 'Head',
      adminPassword: 'Str0ng#Pass!',
    } as any);
    const org = await raw.organization.findFirstOrThrow({ where: { id: res.organization.id } });
    expect(org.currencyCode).toBe('UGX');
    expect(org.timezone).toBe('Africa/Kampala');

    const grades = await raw.gradeLevel.findMany({ where: { organizationId: org.id }, orderBy: { order: 'asc' } });
    expect(grades.map((g) => g.name)).toEqual([
      'Baby Class', 'Middle Class', 'Top Class', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7',
    ]);
    // Every grade promotes to the next; P7 ends the ladder.
    for (let i = 0; i < grades.length - 1; i++) expect(grades[i].nextGradeLevelId).toBe(grades[i + 1].id);
    expect(grades[grades.length - 1].isTerminal).toBe(true);
    expect(grades.every((g) => g.academicLevelId)).toBe(true);

    expect(await raw.schoolClass.count({ where: { organizationId: org.id } })).toBe(10);
    expect(await raw.attendanceStatusConfig.count({ where: { organizationId: org.id } })).toBe(4);
    expect(await raw.gradingScale.count({ where: { organizationId: org.id, isDefault: true } })).toBe(1);
    expect(await raw.campus.count({ where: { organizationId: org.id, isMain: true } })).toBe(1);
    expect(await raw.role.count({ where: { organizationId: org.id, name: 'Head Teacher' } })).toBe(1);
  });

  it('a failure part-way through bootstrap leaves no organization behind (S1)', async () => {
    const accounting = moduleRef.get(ACCOUNTING_BOOTSTRAP, { strict: false }) as any;
    const spy = jest.spyOn(accounting, 'seedOrganization').mockRejectedValueOnce(new Error('boom'));
    const code = `W5F-${stamp}`.slice(0, 30);
    await expect(
      orgs.bootstrap({
        organizationCode: code,
        organizationName: 'Broken',
        adminEmail: `x.${stamp}@w5.test`,
        adminFirstName: 'X',
        adminPassword: 'Str0ng#Pass!',
      } as any),
    ).rejects.toThrow('boom');
    spy.mockRestore();
    expect(await raw.organization.count({ where: { code } })).toBe(0);
  });

  describe('closed years and suspended staff', () => {
    const organizationId = `org_w5_${stamp}`;
    let classId = '';
    let teacherUserId = '';
    let staffProfileId = '';

    beforeAll(async () => {
      await raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, organizationId);
      await raw.organization.create({ data: { id: organizationId, code: `W5C-${stamp}`.slice(0, 30), name: 'W5C', currencyCode: 'UGX' } });
      const grade = await raw.gradeLevel.create({ data: { organizationId, name: 'P3', order: 3 } });
      classId = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'P3 A' } })).id;
      const user = await raw.user.create({
        data: { organizationId, email: `t.${stamp}@w5.test`, passwordHash: 'x', firstName: 'T', isActive: true },
      });
      teacherUserId = user.id;
      const partner = await raw.partner.create({ data: { organizationId, code: `T-${stamp}`, name: 'Teacher T', isEmployee: true } });
      staffProfileId = (await raw.staffProfile.create({
        data: { organizationId, partnerId: partner.id, employeeNo: `E-${stamp}`, joinDate: new Date(), staffCategory: 'teaching' } as any,
      })).id;
      await raw.hrEmployee.create({
        data: { organizationId, employeeCode: `E-${stamp}`, userId: user.id, partnerId: partner.id, firstName: 'T' },
      });
      const subject = await raw.subject.create({ data: { organizationId, name: 'English', code: `EN-${stamp}` } as any });
      await raw.teacherAssignment.create({
        data: { organizationId, teacherPartnerId: staffProfileId, subjectId: subject.id, classId } as any,
      });
      await raw.academicYear.create({
        data: { organizationId, name: '2024', startDate: new Date('2024-01-01'), endDate: new Date('2024-12-31'), status: 'CLOSED' },
      });
    });

    it('a closed year\'s register cannot be marked', async () => {
      await expect(
        tenant.run({ organizationId, userId: 'office', permissions: ['*'] }, () =>
          attendance.mark({ date: '2024-05-06', classId, entries: [] } as any),
        ),
      ).rejects.toThrow(/closed/);
    });

    it('a class-scoped teacher lists only the pupils of classes they teach (R1)', async () => {
      const grade = await raw.gradeLevel.findFirstOrThrow({ where: { organizationId } });
      const other = await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: `P3 B ${stamp}` } });
      const mk = async (name: string, cls: string) => {
        const pt = await raw.partner.create({ data: { organizationId, code: `S-${name}-${stamp}`, name, isCustomer: true } });
        const sp = await raw.studentProfile.create({
          data: { organizationId, partnerId: pt.id, admissionNo: `A-${name}-${stamp}`, enrollmentDate: new Date() },
        });
        await placeInClass(raw, { organizationId, studentProfileId: sp.id, classId: cls });
        return sp.id;
      };
      const mine = await mk('Mine', classId);
      const theirs = await mk('Theirs', other.id);
      const role = await raw.role.create({
        data: { organizationId, name: `Class Teacher ${stamp}`, permissions: [PERMISSIONS.school.read], dataScope: 'class' } as any,
      });
      await raw.user.update({ where: { id: teacherUserId }, data: { roles: { connect: { id: role.id } } } });

      const students = moduleRef.get(StudentService);
      const asTeacher = <T>(fn: () => Promise<T>) =>
        tenant.run({ organizationId, userId: teacherUserId, permissions: [PERMISSIONS.school.read] }, fn);
      const page: any = await asTeacher(() => students.list({ page: 1, pageSize: 50 } as any));
      const ids = page.data.map((r: any) => r.id);
      expect(ids).toContain(mine);
      expect(ids).not.toContain(theirs);
      await expect(asTeacher(() => students.list({ classId: other.id } as any))).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('a suspended teacher can no longer act on a class as themselves', async () => {
      const asTeacher = () =>
        tenant.run({ organizationId, userId: teacherUserId, permissions: [PERMISSIONS.school.ownAttendance] }, () =>
          attendance.mark({ date: new Date().toISOString().slice(0, 10), classId, entries: [] } as any),
        );
      // While active they mark their own class...
      await expect(asTeacher()).resolves.toBeDefined();
      // ...and once suspended they cannot.
      await raw.staffProfile.update({ where: { id: staffProfileId }, data: { status: 'suspended' } });
      await expect(asTeacher()).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
