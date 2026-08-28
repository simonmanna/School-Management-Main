/**
 * Integration — staff identity and the teacher-ownership fix (Phase 3).
 *
 * Before this, `StaffProfile` had no link to a login at all, so per-teacher
 * endpoints took the id from the URL and served whoever asked. This proves the
 * chain now resolves and that it actually gates:
 *
 *     User → HrEmployee.userId → Partner → StaffProfile
 *
 * The cases that matter: a teacher resolves to THEIR OWN staff profile; teacher
 * A cannot read teacher B's records; an admin still can; and a login with no
 * employee record resolves to nothing rather than erroring.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';
import { KernelModule } from '../../src/kernel/kernel.module';
import { CoreModule } from '../../src/modules/core/core.module';
import { AccountingModule } from '../../src/modules/accounting/accounting.module';
import { HrModule } from '../../src/modules/hr/hr.module';
import { HrOrgService } from '../../src/modules/hr/hr-org.service';
import { HrReconciliationService } from '../../src/modules/hr/hr-reconciliation.service';
import { EmployeeIdentityService } from '../../src/kernel/auth/employee-identity.service';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';

describeDb('integration: staff identity + teacher ownership', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let identity: EmployeeIdentityService;
  let org: HrOrgService;
  let recon: HrReconciliationService;

  const organizationId = `org_ident_${Date.now()}`;
  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);

  const ADMIN_PERM = 'school:staff:write';
  const TEACHER_PERMS = ['school:read', 'hr:self'];

  let aliceUserId = '';
  let aliceStaffId = '';
  let bobUserId = '';
  let bobStaffId = '';
  let strangerUserId = '';

  const as = <T>(userId: string, permissions: string[], fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId, permissions }, fn);

  /** Full person: User + Partner + StaffProfile + HrEmployee, all linked. */
  const makeTeacher = async (name: string, no: string) => {
    const user = await raw.user.create({
      data: {
        organizationId,
        email: `${no.toLowerCase()}@school.test`,
        passwordHash: 'x',
        firstName: name.split(' ')[0],
        lastName: name.split(' ')[1] ?? '',
      },
    });
    const partner = await raw.partner.create({
      data: { organizationId, code: `P-${no}`, name, isEmployee: true, email: `${no.toLowerCase()}@school.test` },
    });
    const profile = await raw.staffProfile.create({
      data: { organizationId, partnerId: partner.id, employeeNo: no, joinDate: new Date(), staffCategory: 'teaching' },
    });
    await raw.hrEmployee.create({
      data: {
        organizationId,
        employeeCode: no,
        userId: user.id,
        partnerId: partner.id,
        firstName: name.split(' ')[0],
        lastName: name.split(' ')[1] ?? null,
      },
    });
    return { userId: user.id, staffProfileId: profile.id, partnerId: partner.id };
  };

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({ where: { code: 'UGX' }, update: {}, create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 } });
    await setOrg(organizationId);
    await raw.organization.create({ data: { id: organizationId, code: organizationId, name: 'Identity Test', currencyCode: 'UGX' } });

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, CoreModule, AccountingModule, HrModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    identity = moduleRef.get(EmployeeIdentityService);
    org = moduleRef.get(HrOrgService);
    recon = moduleRef.get(HrReconciliationService);

    ({ userId: aliceUserId, staffProfileId: aliceStaffId } = await makeTeacher('Alice Teacher', 'T-001'));
    ({ userId: bobUserId, staffProfileId: bobStaffId } = await makeTeacher('Bob Teacher', 'T-002'));

    const stranger = await raw.user.create({
      data: { organizationId, email: 'bursar@school.test', passwordHash: 'x', firstName: 'Bursar' },
    });
    strangerUserId = stranger.id;
  });

  afterAll(async () => {
    if (moduleRef) await moduleRef.close();
    await raw.hrSalaryChange.deleteMany({ where: { organizationId } });
    await raw.hrEmploymentAction.deleteMany({ where: { organizationId } });
    await raw.hrEmployee.deleteMany({ where: { organizationId } });
    await raw.staffProfile.deleteMany({ where: { organizationId } });
    await raw.partner.deleteMany({ where: { organizationId } });
    await raw.refreshToken.deleteMany({ where: { organizationId } });
    await raw.user.deleteMany({ where: { organizationId } });
    await raw.auditLog.deleteMany({ where: { organizationId } });
    await raw.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
    await raw.$disconnect();
  });

  it('resolves a logged-in teacher to their own staff profile', async () => {
    const me = await as(aliceUserId, TEACHER_PERMS, () => identity.forUser());
    expect(me?.userId).toBe(aliceUserId);
    expect(me?.staffProfileId).toBe(aliceStaffId);
    expect(me?.hrEmployeeId).toBeTruthy();
    expect(me?.partnerId).toBeTruthy();
  });

  it('resolves a login with no employee record to nulls, not an error', async () => {
    const me = await as(strangerUserId, TEACHER_PERMS, () => identity.forUser());
    expect(me?.staffProfileId).toBeNull();
    expect(me?.hrEmployeeId).toBeNull();
  });

  it('knows who is who', async () => {
    await as(aliceUserId, TEACHER_PERMS, async () => {
      expect(await identity.isSelfTeacher(aliceStaffId)).toBe(true);
      expect(await identity.isSelfTeacher(bobStaffId)).toBe(false);
    });
  });

  it('lets a teacher through to their own records', async () => {
    await as(aliceUserId, TEACHER_PERMS, () =>
      identity.assertIsTeacherOrAdmin(aliceStaffId, ADMIN_PERM),
    );
  });

  it("BLOCKS a teacher from another teacher's records (the IDOR fix)", async () => {
    await expect(
      as(aliceUserId, TEACHER_PERMS, () => identity.assertIsTeacherOrAdmin(bobStaffId, ADMIN_PERM)),
    ).rejects.toThrow(ForbiddenException);
  });

  it('BLOCKS a non-staff login from any teacher record', async () => {
    await expect(
      as(strangerUserId, TEACHER_PERMS, () => identity.assertIsTeacherOrAdmin(aliceStaffId, ADMIN_PERM)),
    ).rejects.toThrow(ForbiddenException);
  });

  it('still lets an admin see any teacher', async () => {
    await as(strangerUserId, [...TEACHER_PERMS, ADMIN_PERM], async () => {
      await identity.assertIsTeacherOrAdmin(aliceStaffId, ADMIN_PERM);
      await identity.assertIsTeacherOrAdmin(bobStaffId, ADMIN_PERM);
    });
  });

  it('follows an unlink immediately — no token-lifetime lag', async () => {
    const bobEmp = await raw.hrEmployee.findFirstOrThrow({ where: { organizationId, employeeCode: 'T-002' } });
    // Identity is resolved per request, so breaking the bridge takes effect now.
    await as(bobUserId, TEACHER_PERMS, async () => {
      expect(await identity.isSelfTeacher(bobStaffId)).toBe(true);
    });
    await as(bobUserId, [...TEACHER_PERMS, 'hr:employee_identity'], () => recon.unlink(bobEmp.id));
    await as(bobUserId, TEACHER_PERMS, async () => {
      expect(await identity.isSelfTeacher(bobStaffId)).toBe(false);
    });
  });
});
