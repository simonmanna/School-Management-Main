/**
 * Wave 15 — audit 2026-09-29, against a real database.
 *
 * A02 / D02: legacy StaffProfile.compensation (salary, bank account) reaches no
 *   ordinary reader — not the staff directory list, detail, by-campus or
 *   by-department views, and not any other read that includes a staff row
 *   (Prisma global omit). HR can still opt in deliberately.
 * A07: a teacher opens marking from a list of their own assessments; nobody
 *   else's paper is in it, and a teacher with no staff record is refused.
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
import { PrismaService } from '../../src/kernel/prisma/prisma.service';
import { StaffService } from '../../src/modules/school/people/staff.service';
import { MarkingService } from '../../src/modules/school/assessment/marking.service';
import { ensureAcademicSpine, type AcademicSpine } from './_placement';

describeDb('integration: wave 15 staff confidentiality (A02) and teacher marking picker (A07)', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let prisma: PrismaService;
  let staffSvc: StaffService;
  let marking: MarkingService;

  const stamp = Date.now();
  const organizationId = `org_w15_${stamp}`;
  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);

  const TEACHER = ['school:read', 'school:grades:own'];
  const as = <T>(userId: string, permissions: string[], fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId, permissions }, fn);

  const SECRET_BANK = `FICTIONAL-PRIVATE-BANK-${stamp}`;
  const SECRET_SALARY = 987_654_321;

  let spine: AcademicSpine;
  let campusId = '';
  let departmentId = '';
  const users: Record<string, string> = {};
  const staff: Record<string, string> = {};
  let mineId = '';
  let othersId = '';

  const makeUser = async (tag: string, withStaff: boolean) => {
    const role = await raw.role.create({ data: { organizationId, name: `W15 ${tag} ${stamp}`, dataScope: 'class', permissions: TEACHER } as any });
    const user = await raw.user.create({
      data: {
        organizationId, email: `w15-${tag}-${stamp}@school.test`, passwordHash: 'x', firstName: tag, lastName: 'T',
        isActive: true, roles: { connect: { id: role.id } },
      } as any,
    });
    users[tag] = user.id;
    if (!withStaff) return;
    const partner = await raw.partner.create({
      data: { organizationId, code: `W15-T-${tag}-${stamp}`, name: `${tag} Teacher`, isEmployee: true },
    });
    staff[tag] = (
      await raw.staffProfile.create({
        data: {
          organizationId, partnerId: partner.id, employeeNo: `W15-${tag}-${stamp}`, joinDate: new Date('2026-01-01'),
          staffCategory: 'teaching', campusId, departmentId,
          // Retained legacy pay, as found in the audited database.
          compensation: { basicSalary: SECRET_SALARY, bankAccount: SECRET_BANK },
          customFields: { nationalId: `FICTIONAL-NIN-${stamp}` },
        } as any,
      })
    ).id;
    await raw.hrEmployee.create({
      data: { organizationId, employeeCode: `W15-${tag}-${stamp}`, userId: user.id, partnerId: partner.id, firstName: tag, lastName: 'T' } as any,
    });
  };

  const leaks = (value: unknown) => {
    const text = JSON.stringify(value);
    return text.includes(SECRET_BANK) || text.includes(String(SECRET_SALARY)) || text.includes('compensation') || text.includes('FICTIONAL-NIN');
  };

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({ where: { code: 'UGX' }, update: {}, create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 } });
    await setOrg(organizationId);
    await raw.organization.create({ data: { id: organizationId, code: `W15-${stamp}`, name: 'Green Valley W15', currencyCode: 'UGX' } });
    await raw.schoolProfile.create({ data: { organizationId, name: 'Green Valley W15', gradingSystem: 'PLE' } as any });
    spine = await ensureAcademicSpine(raw, { organizationId, yearName: '2026', gradeName: 'P5', className: 'P5', sectionName: 'East' });
    await raw.academicYear.update({ where: { id: spine.academicYearId }, data: { status: 'ACTIVE' } as any });
    campusId = (await raw.campus.create({ data: { organizationId, code: `W15C-${stamp}`, name: 'Main' } as any })).id;
    departmentId = (await raw.department.create({ data: { organizationId, name: `Sciences ${stamp}` } as any })).id;

    await makeUser('teacher', true);
    await makeUser('colleague', true);
    await makeUser('nostaff', false);

    const subjectId = (await raw.subject.create({ data: { organizationId, code: `W15S-${stamp}`, name: 'Science' } as any })).id;
    mineId = (
      await raw.assessment.create({
        data: { organizationId, termId: spine.termId, classId: spine.classId, subjectId, title: 'CAT 1 (mine)', kind: 'cat', teacherPartnerId: staff.teacher, maxScore: 50 } as any,
      })
    ).id;
    othersId = (
      await raw.assessment.create({
        data: { organizationId, termId: spine.termId, classId: spine.classId, subjectId, title: 'CAT 1 (colleague)', kind: 'cat', teacherPartnerId: staff.colleague } as any,
      })
    ).id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    prisma = moduleRef.get(PrismaService);
    staffSvc = moduleRef.get(StaffService);
    marking = moduleRef.get(MarkingService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  describe('A02 — confidential staff fields', () => {
    it('the directory list, detail, by-campus and by-department views carry no pay, bank or custom fields', async () => {
      await as(users.teacher, TEACHER, async () => {
        const list = await staffSvc.list({ page: 1, pageSize: 100 } as any);
        expect(list.data.length).toBeGreaterThanOrEqual(2);
        expect(leaks(list)).toBe(false);
        // The directory still does its job.
        expect((list.data[0] as any).partner?.name).toBeTruthy();

        const one = await staffSvc.findOne(staff.colleague);
        expect(leaks(one)).toBe(false);
        expect(leaks(await staffSvc.listByCampus(campusId))).toBe(false);
        expect(leaks(await staffSvc.listByDepartment(departmentId))).toBe(false);
      });
    });

    it('a staff row included through another model does not carry compensation either', async () => {
      await as(users.teacher, TEACHER, async () => {
        const viaInclude = await prisma.client.partner.findFirst({
          where: { schoolStaff: { id: staff.colleague } },
          include: { schoolStaff: true },
        });
        const direct = await prisma.client.staffProfile.findFirst({ where: { id: staff.colleague } });
        expect(JSON.stringify(direct)).not.toContain(SECRET_BANK);
        expect(JSON.stringify(viaInclude ?? {})).not.toContain(SECRET_BANK);
      });
    });

    it('HR can still read it by asking for it by name, and the stored value is untouched', async () => {
      await as(users.teacher, ['*'], async () => {
        const row: any = await prisma.client.staffProfile.findFirst({ where: { id: staff.colleague }, omit: { compensation: false } } as any);
        expect(row.compensation.bankAccount).toBe(SECRET_BANK);
      });
    });
  });

  describe('A07 — the teacher picks their own assessments', () => {
    it("lists the caller's own assessment with names, and not a colleague's", async () => {
      const rows = await as(users.teacher, TEACHER, () => marking.myAssessments());
      const ids = rows.map((r: any) => r.id);
      expect(ids).toContain(mineId);
      expect(ids).not.toContain(othersId);
      const mine: any = rows.find((r: any) => r.id === mineId);
      expect(mine.className).toBe('P5');
      expect(mine.subjectName).toBe('Science');
      expect(mine.maxScore).toBe(50);
    });

    it('a colleague sees only theirs', async () => {
      const ids = (await as(users.colleague, TEACHER, () => marking.myAssessments())).map((r: any) => r.id);
      expect(ids).toEqual([othersId]);
    });

    it('an account with no staff record is refused', async () => {
      await expect(as(users.nostaff, TEACHER, () => marking.myAssessments())).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
