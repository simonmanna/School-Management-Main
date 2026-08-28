/**
 * Integration — LMS teacher identity (Phase 4).
 *
 * `LmsRoleAssignment.userId` must hold a platform `User.id`: the capability
 * guard builds its principal from `tenant.userId`. Roster sync used to write
 * `CourseOfferingTeacher.teacherPartnerId`, which is a `StaffProfile.id`, so
 * every auto-granted `editingteacher` role pointed at an id no principal could
 * ever match — teachers were locked out of their own courses and only got in
 * through the coarse-permission fallback.
 *
 * This proves the role now lands on the real login, and that a teacher whose
 * login is not linked is SKIPPED rather than given a broken assignment.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';
import { KernelModule } from '../../src/kernel/kernel.module';
import { CoreModule } from '../../src/modules/core/core.module';
import { AccountingModule } from '../../src/modules/accounting/accounting.module';
import { InventoryModule } from '../../src/modules/inventory/inventory.module';
import { InvoicingModule } from '../../src/modules/invoicing/invoicing.module';
import { DocumentsModule } from '../../src/modules/documents/documents.module';
import { SchoolModule } from '../../src/modules/school/school.module';
import { EnrolmentService } from '../../src/modules/school/lms/moodle/enrolment/enrolment.service';
import { LmsRolesService } from '../../src/modules/school/lms/moodle/context/roles.service';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';

describeDb('integration: LMS teacher identity', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let enrolment: EnrolmentService;
  let roles: LmsRolesService;

  const organizationId = `org_lmsid_${Date.now()}`;
  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);

  let courseOfferingId = '';
  let linkedUserId = '';
  let linkedStaffId = '';
  let unlinkedStaffId = '';

  const asAdmin = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run(
      { organizationId, userId: 'admin_lmsid', permissions: ['school:read', 'school:courses:write', 'school:courses:enrol'] },
      fn,
    );

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({ where: { code: 'UGX' }, update: {}, create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 } });
    await setOrg(organizationId);
    await raw.organization.create({ data: { id: organizationId, code: organizationId, name: 'LMS Identity Test', currencyCode: 'UGX' } });

    // A teacher with a fully linked login: User + Partner + StaffProfile + HrEmployee.
    const user = await raw.user.create({
      data: { organizationId, email: 'linked@school.test', passwordHash: 'x', firstName: 'Linked', lastName: 'Teacher' },
    });
    linkedUserId = user.id;
    const partner = await raw.partner.create({
      data: { organizationId, code: 'P-LINK', name: 'Linked Teacher', isEmployee: true },
    });
    const profile = await raw.staffProfile.create({
      data: { organizationId, partnerId: partner.id, employeeNo: 'LNK-1', joinDate: new Date(), staffCategory: 'teaching' },
    });
    linkedStaffId = profile.id;
    await raw.hrEmployee.create({
      data: { organizationId, employeeCode: 'LNK-1', userId: user.id, partnerId: partner.id, firstName: 'Linked', lastName: 'Teacher' },
    });

    // A teacher with NO login linked.
    const partner2 = await raw.partner.create({
      data: { organizationId, code: 'P-NOLINK', name: 'Unlinked Teacher', isEmployee: true },
    });
    const profile2 = await raw.staffProfile.create({
      data: { organizationId, partnerId: partner2.id, employeeNo: 'NOL-1', joinDate: new Date(), staffCategory: 'teaching' },
    });
    unlinkedStaffId = profile2.id;

    // Minimal course scaffolding.
    const year = await raw.academicYear.create({
      data: { organizationId, name: 'AY-LMSID', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
    });
    const term = await raw.term.create({
      data: { organizationId, academicYearId: year.id, name: 'T1', startDate: new Date('2026-01-01'), endDate: new Date('2026-04-30') },
    });
    const grade = await raw.gradeLevel.create({ data: { organizationId, name: 'S1-LMSID', order: 1 } });
    const cls = await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'S1 LMSID' } });
    const subject = await raw.subject.create({ data: { organizationId, code: 'PHY-LMSID', name: 'Physics' } });
    const curriculum = await raw.curriculum.create({
      data: { organizationId, classId: cls.id, academicYearId: year.id, name: 'Physics S1 LMSID' },
    });
    const offering = await raw.courseOffering.create({
      data: {
        organizationId,
        academicYearId: year.id,
        termId: term.id,
        classId: cls.id,
        subjectId: subject.id,
        curriculumId: curriculum.id,
      },
    });
    courseOfferingId = offering.id;

    for (const staffProfileId of [linkedStaffId, unlinkedStaffId]) {
      await raw.courseOfferingTeacher.create({
        data: { organizationId, courseOfferingId, teacherPartnerId: staffProfileId, role: 'lead' },
      });
    }

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    enrolment = moduleRef.get(EnrolmentService);
    roles = moduleRef.get(LmsRolesService);

    // The Moodle-style role vocabulary is per-org and seeded on first use.
    await asAdmin(() => roles.seed());
  });

  afterAll(async () => {
    if (moduleRef) await moduleRef.close();
    await raw.lmsRoleAssignment.deleteMany({ where: { organizationId } });
    await raw.lmsRole.deleteMany({ where: { organizationId } });
    await raw.lmsContext.deleteMany({ where: { organizationId } });
    await raw.courseEnrolment.deleteMany({ where: { organizationId } });
    await raw.courseEnrolmentMethod.deleteMany({ where: { organizationId } });
    await raw.courseOfferingTeacher.deleteMany({ where: { organizationId } });
    await raw.courseOffering.deleteMany({ where: { organizationId } });
    await raw.curriculum.deleteMany({ where: { organizationId } });
    await raw.subject.deleteMany({ where: { organizationId } });
    await raw.schoolClass.deleteMany({ where: { organizationId } });
    await raw.gradeLevel.deleteMany({ where: { organizationId } });
    await raw.term.deleteMany({ where: { organizationId } });
    await raw.academicYear.deleteMany({ where: { organizationId } });
    await raw.hrEmployee.deleteMany({ where: { organizationId } });
    await raw.staffProfile.deleteMany({ where: { organizationId } });
    await raw.partner.deleteMany({ where: { organizationId } });
    await raw.user.deleteMany({ where: { organizationId } });
    await raw.auditLog.deleteMany({ where: { organizationId } });
    await raw.eventOutbox.deleteMany({ where: { organizationId } });
    await raw.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
    await raw.$disconnect();
  });

  it('assigns editingteacher to the real User.id, never the StaffProfile.id', async () => {
    await asAdmin(() => enrolment.syncRoster(courseOfferingId) as any);

    const assignments = await raw.lmsRoleAssignment.findMany({
      where: { organizationId, NOT: { userId: null } },
      include: { role: true },
    });
    const teacherRoles = assignments.filter((a) => a.role?.shortname === 'editingteacher');

    // The linked teacher got the role, keyed on their login.
    expect(teacherRoles.map((a) => a.userId)).toContain(linkedUserId);

    // And crucially, NOT on a StaffProfile id.
    expect(teacherRoles.map((a) => a.userId)).not.toContain(linkedStaffId);
    expect(teacherRoles.map((a) => a.userId)).not.toContain(unlinkedStaffId);
  });

  it('every assigned userId resolves to a real User row', async () => {
    const assignments = await raw.lmsRoleAssignment.findMany({
      where: { organizationId, NOT: { userId: null } },
      select: { userId: true },
    });
    const ids = [...new Set(assignments.map((a) => a.userId!))];
    const users = await raw.user.findMany({ where: { id: { in: ids } }, select: { id: true } });
    // Zero orphans: the whole point of the fix.
    expect(users.length).toBe(ids.length);
  });

  it('skips a teacher whose login is not linked rather than writing a broken role', async () => {
    const assignments = await raw.lmsRoleAssignment.findMany({
      where: { organizationId, NOT: { userId: null } },
      select: { userId: true },
    });
    expect(assignments.map((a) => a.userId)).not.toContain(unlinkedStaffId);
  });

  it('is idempotent — re-syncing does not duplicate the teacher role', async () => {
    await asAdmin(() => enrolment.syncRoster(courseOfferingId) as any);
    const assignments = await raw.lmsRoleAssignment.findMany({
      where: { organizationId, userId: linkedUserId },
      include: { role: true },
    });
    const teacherRoles = assignments.filter((a) => a.role?.shortname === 'editingteacher');
    expect(teacherRoles).toHaveLength(1);
  });
});
