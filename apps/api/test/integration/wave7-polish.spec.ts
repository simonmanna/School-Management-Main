/**
 * Wave 7 — the E2E audit's P3 list, against a real database:
 *
 *   - a failed login after an expired lockout starts the count again;
 *   - HR's offboarding reason decides the school's staff status;
 *   - Term changes leave an audit trail;
 *   - a guardian who was unlinked can be linked again (was a 500);
 *   - the NULL cases of two unique keys are enforced;
 *   - one bad offer does not stop the expiry sweep.
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
import { AuthModule } from '../../src/kernel/auth/auth.module';
import { AuthService } from '../../src/kernel/auth/auth.service';
import { PasswordService } from '../../src/kernel/auth/password.service';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';
import { StaffOffboardingSubscriber } from '../../src/modules/school/people/staff-offboarding.subscriber';
import { TermService } from '../../src/modules/school/foundation/academic-year.service';
import { GuardianService } from '../../src/modules/school/people/guardian.service';
import { AdmissionsService } from '../../src/modules/school/admissions/admissions.service';

// otplib ships ESM only; MFA is not under test here.
jest.mock('otplib', () => ({ authenticator: {} }));

describeDb('integration: wave 7 polish', () => {
  const raw = new PrismaClient();
  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  const stamp = Date.now();
  const organizationId = `org_w7_${stamp}`;
  const organizationCode = `W7-${stamp}`.slice(0, 30);
  let yearId = '';
  const as = <T>(fn: () => Promise<T>) =>
    tenant.run({ organizationId, userId: 'office', permissions: ['*'] }, fn);

  beforeAll(async () => {
    await raw.$connect();
    await raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, organizationId);
    await raw.organization.create({ data: { id: organizationId, code: organizationCode, name: 'W7', currencyCode: 'UGX' } });
    yearId = (await raw.academicYear.create({
      data: { organizationId, name: `Y${stamp}`, startDate: new Date('2031-01-01'), endDate: new Date('2031-12-31'), status: 'ACTIVE' },
    })).id;
    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, AuthModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  it('a wrong password after an expired lockout counts from one, not from the old tally', async () => {
    const email = `lock.${stamp}@w7.test`;
    const passwordHash = await moduleRef.get(PasswordService).hash('Right#Pass1');
    const user = await raw.user.create({
      data: {
        organizationId, email, passwordHash, firstName: 'L', isActive: true,
        failedLoginCount: 10, lockedUntil: new Date(Date.now() - 60_000),
      },
    });
    const auth = moduleRef.get(AuthService);
    await expect(auth.login({ organizationCode, email, password: 'wrong' } as any)).rejects.toThrow('Invalid credentials');
    const after = await raw.user.findFirstOrThrow({ where: { id: user.id } });
    expect(after.failedLoginCount).toBe(1);
    expect(after.lockedUntil).toBeNull();
  });

  it.each([
    ['retirement', 'retired'],
    ['resignation', 'resigned'],
    ['dismissal', 'terminated'],
  ])('HR offboarding for %s leaves the teacher %s', async (reason, status) => {
    const partner = await raw.partner.create({ data: { organizationId, code: `T-${reason}-${stamp}`, name: `T ${reason}`, isEmployee: true } });
    const staff = await raw.staffProfile.create({
      data: { organizationId, partnerId: partner.id, employeeNo: `E-${reason}-${stamp}`, joinDate: new Date('2030-01-01'), staffCategory: 'teaching' } as any,
    });
    await moduleRef.get(StaffOffboardingSubscriber).onOffboarded({
      organizationId, employeeId: 'hr-1', partnerId: partner.id, userId: null,
      lastWorkingDay: new Date().toISOString(), reason,
    });
    expect((await raw.staffProfile.findFirstOrThrow({ where: { id: staff.id } })).status).toBe(status);
  });

  it('creating, editing and deleting a term is audited', async () => {
    const terms = moduleRef.get(TermService);
    const term: any = await as(() =>
      terms.create({ academicYearId: yearId, name: 'Term 1', startDate: '2031-01-10', endDate: '2031-04-10' } as any),
    );
    await as(() => terms.update(term.id, { endDate: '2031-04-20' } as any));
    await as(() => terms.remove(term.id));
    const actions = (await raw.auditLog.findMany({ where: { organizationId, entity: 'Term', entityId: term.id } }))
      .map((a) => a.action)
      .sort();
    expect(actions).toEqual(['create', 'delete', 'update']);
  });

  it('a guardian unlinked earlier can be linked again (was a 500)', async () => {
    const pt = await raw.partner.create({ data: { organizationId, code: `S-${stamp}`, name: 'Pupil', isCustomer: true } });
    const sp = await raw.studentProfile.create({
      data: { organizationId, partnerId: pt.id, admissionNo: `A-${stamp}`, enrollmentDate: new Date() },
    });
    const guardians = moduleRef.get(GuardianService);
    const first: any = await as(() =>
      guardians.create({
        studentProfileId: sp.id, relationship: 'mother',
        guardian: { firstName: 'Mum', phone: '+256700111222' },
      } as any),
    );
    await as(() => guardians.remove(first.id));
    const again: any = await as(() =>
      guardians.create({ studentProfileId: sp.id, relationship: 'guardian', guardianContactId: first.guardianContactId } as any),
    );
    expect(again.id).toBe(first.id);
    expect(again.relationship).toBe('guardian');
    const listed = await as(() => guardians.listByStudent(sp.id));
    expect(listed).toHaveLength(1);
  });

  it('a timetable version with no section and a school-wide reminder are unique', async () => {
    const grade = await raw.gradeLevel.create({ data: { organizationId, name: 'P4', order: 4 } });
    const cls = await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: `P4 ${stamp}` } });
    const version = { organizationId, classId: cls.id, sectionId: null, version: 1, reason: 'test', slots: [] } as any;
    await raw.timetableVersion.create({ data: version });
    await expect(raw.timetableVersion.create({ data: version })).rejects.toThrow();

    const log = { organizationId, kind: 'marks_due', subjectId: `s-${stamp}`, milestone: 'T-1', userId: null } as any;
    await raw.academicReminderLog.create({ data: log });
    await expect(raw.academicReminderLog.create({ data: log })).rejects.toThrow();
  });

  it('one failing offer does not stop the expiry sweep', async () => {
    const admissions = moduleRef.get(AdmissionsService);
    const mk = async (name: string) => {
      const app = await raw.admissionApplication.create({
        data: {
          organizationId, academicYearId: yearId, applicationNumber: `APP-${name}-${stamp}`,
          applicantFirstName: name, applicantLastName: `W7${stamp}`, status: 'offer_issued',
        } as any,
      });
      await raw.offerLetter.create({
        data: { organizationId, applicationId: app.id, status: 'issued', expiresAt: new Date(Date.now() - 86_400_000) } as any,
      });
      return app.id;
    };
    const bad = await mk('Bad');
    const good = await mk('Good');
    const real = (admissions as any).applyReview.bind(admissions);
    const spy = jest.spyOn(admissions as any, 'applyReview').mockImplementation(async (...args: any[]) => {
      if (args[1] === bad) throw new Error('boom');
      return real(...args);
    });
    const res: any = await as(() => admissions.expireLapsedOffers(new Date()));
    spy.mockRestore();
    expect(res.failed).toBeGreaterThanOrEqual(1);
    expect((await raw.admissionApplication.findFirstOrThrow({ where: { id: good } })).status).toBe('offer_expired');
  });
});
