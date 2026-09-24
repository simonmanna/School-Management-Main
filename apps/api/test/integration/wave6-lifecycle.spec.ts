/**
 * Wave 6 — lifecycle workers the audit found untested:
 *   - suspension auto-return: an elapsed suspension is lifted, a running one is not;
 *   - offer expiry: a lapsed offer expires and its application moves to
 *     offer_expired; an unexpired offer is left alone;
 *   - found by the web smoke: the fee desk's "Search name or admission no"
 *     matched admission numbers only, so a pupil could not be found by name.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';
import { ensureProgrammeRoute } from './_placement';
import { KernelModule } from '../../src/kernel/kernel.module';
import { DocumentsModule } from '../../src/modules/documents/documents.module';
import { CoreModule } from '../../src/modules/core/core.module';
import { AccountingModule } from '../../src/modules/accounting/accounting.module';
import { InventoryModule } from '../../src/modules/inventory/inventory.module';
import { InvoicingModule } from '../../src/modules/invoicing/invoicing.module';
import { SchoolModule } from '../../src/modules/school/school.module';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';
import { StudentEnrollmentService } from '../../src/modules/school/enrollment/student-enrollment.service';
import { AdmissionsService } from '../../src/modules/school/admissions/admissions.service';
import { StudentService } from '../../src/modules/school/people/student.service';

describeDb('integration: wave 6 lifecycle workers', () => {
  const raw = new PrismaClient();
  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let enrollments: StudentEnrollmentService;
  let admissions: AdmissionsService;
  const stamp = Date.now();
  const organizationId = `org_w6l_${stamp}`;
  let yearId = '';
  let termId = '';
  let classId = '';
  const as = <T>(fn: () => Promise<T>) =>
    tenant.run({ organizationId, userId: 'registrar', permissions: ['*'] }, fn);

  beforeAll(async () => {
    await raw.$connect();
    await raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, organizationId);
    await raw.organization.create({ data: { id: organizationId, code: `W6L-${stamp}`.slice(0, 30), name: 'W6L', currencyCode: 'UGX' } });
    const now = new Date();
    const y = now.getUTCFullYear();
    yearId = (await raw.academicYear.create({
      data: { organizationId, name: `${y}`, startDate: new Date(`${y}-01-01`), endDate: new Date(`${y}-12-31`), isCurrent: true, status: 'ACTIVE' },
    })).id;
    termId = (await raw.term.create({
      data: { organizationId, academicYearId: yearId, name: 'Current', startDate: new Date(`${y}-01-02`), endDate: new Date(`${y}-12-30`), isCurrent: true },
    })).id;
    const grade = await raw.gradeLevel.create({ data: { organizationId, name: 'P2', order: 2 } });
    await ensureProgrammeRoute(raw, organizationId, grade.id);
    classId = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'P2 A', allowsStreams: false } })).id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    enrollments = moduleRef.get(StudentEnrollmentService);
    admissions = moduleRef.get(AdmissionsService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  let seq = 0;
  const enrol = async () => {
    seq += 1;
    const pt = await raw.partner.create({ data: { organizationId, code: `L-${stamp}-${seq}`, name: `L${seq}`, isCustomer: true } });
    const sp = await raw.studentProfile.create({
      data: { organizationId, partnerId: pt.id, admissionNo: `L-${stamp}-${seq}`, enrollmentDate: new Date() },
    });
    const res: any = await as(() =>
      enrollments.create({ studentProfileId: sp.id, academicYearId: yearId, status: 'ACTIVE', placement: { termId, classId } } as any),
    );
    return res.enrollment?.id ?? res.id;
  };

  it('lifts an elapsed suspension and leaves a running one', async () => {
    const elapsed = await enrol();
    const running = await enrol();
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString();
    await as(() => enrollments.suspend(elapsed, { reason: 'Short suspension', suspendedUntil: soon } as any));
    await as(() => enrollments.suspend(running, { reason: 'Long suspension', suspendedUntil: soon } as any));
    // The elapsed one's end date has passed by the time the worker looks.
    await raw.studentEnrollment.update({ where: { id: elapsed }, data: { suspendedUntil: new Date(Date.now() - 86_400_000) } });

    const lifted = await as(() => enrollments.liftExpiredSuspensions(new Date()));
    expect(lifted).toBeGreaterThanOrEqual(1);
    expect((await raw.studentEnrollment.findFirstOrThrow({ where: { id: elapsed } })).status).toBe('ACTIVE');
    expect((await raw.studentEnrollment.findFirstOrThrow({ where: { id: running } })).status).toBe('SUSPENDED');
  });

  it('expires a lapsed offer and leaves a live one', async () => {
    const mk = async (name: string) =>
      raw.admissionApplication.create({
        data: {
          organizationId, academicYearId: yearId, applicationNumber: `APP-${name}-${stamp}`,
          applicantFirstName: name, applicantLastName: `W6${stamp}`, status: 'offer_issued',
        } as any,
      });
    const lapsed = await mk('Lapsed');
    const live = await mk('Live');
    await raw.offerLetter.create({
      data: { organizationId, applicationId: lapsed.id, status: 'issued', expiresAt: new Date(Date.now() - 86_400_000) } as any,
    });
    await raw.offerLetter.create({
      data: { organizationId, applicationId: live.id, status: 'issued', expiresAt: new Date(Date.now() + 7 * 86_400_000) } as any,
    });
    await as(() => admissions.expireLapsedOffers(new Date()));
    expect((await raw.admissionApplication.findFirstOrThrow({ where: { id: lapsed.id } })).status).toBe('offer_expired');
    expect((await raw.admissionApplication.findFirstOrThrow({ where: { id: live.id } })).status).toBe('offer_issued');
  });

  it('finds a pupil by name as well as by admission number', async () => {
    await enrol();
    const students = moduleRef.get(StudentService);
    const byName: any = await as(() => students.list({ search: `l${seq}`, pageSize: 50 } as any));
    expect(byName.data.map((r: any) => r.partner?.name)).toContain(`L${seq}`);
    const byNo: any = await as(() => students.list({ search: `L-${stamp}-${seq}`, pageSize: 50 } as any));
    expect(byNo.data).toHaveLength(1);
  });
});
