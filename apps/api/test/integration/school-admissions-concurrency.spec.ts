/**
 * Integration — admissions capacity, atomicity and portal isolation.
 *
 * These guarantees were previously hand-verified once against a running server and
 * had no automated coverage, which is how a real capacity defect survived: the seat
 * guard subtracted BOTH `claimedSeats` and the derived `occupied` count, so every
 * committed seat was counted twice and a capacity-2 class admitted one student
 * sequentially. The parallel-only check missed it because every racing request read
 * `occupied = 0` before any of them committed. Hence the sequential case below.
 *
 * The capacity state contract under test:
 *   claimedSeats  THE seat ledger — +1 inside the enrol transaction, −1 on withdrawal
 *   occupied      derived Enrollment count, REPORTING ONLY, never in the guard
 *   available     capacity − reservedCapacity − claimedSeats
 *
 * Modelled on school-fees-concurrency.spec.ts (connection_limit=1, Promise.all,
 * count-the-winners). Same DB requirements as school-happy-path.spec.ts.
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
import { AdmissionsWorkflowService } from '../../src/modules/school/admissions/admissions-workflow.service';
import { AdmissionsPortalService } from '../../src/modules/school/admissions/admissions-portal.service';
import { EnrollmentService } from '../../src/modules/school/people/enrollment.service';

describeDb('integration: admissions capacity, atomicity and portal isolation', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let admissions: AdmissionsService;
  let workflows: AdmissionsWorkflowService;
  let portal: AdmissionsPortalService;
  let enrollment: EnrollmentService;

  const organizationId = `org_cap_${Date.now()}`;
  const userId = 'registrar_1';
  let academicYearId = '';
  let termId = '';
  let classId = '';
  let sectionAId = '';
  let sectionBId = '';
  let cycleId = '';

  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);

  const asTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId, permissions: ['school:admissions:write'] }, fn);

  let seq = 0;
  async function newApp() {
    seq += 1;
    return asTenant(() =>
      admissions.create({
        academicYearId,
        admissionCycleId: cycleId,
        applicantFirstName: `Cap${seq}`,
        applicantLastName: `Race${Date.now()}${seq}`,
        applyingForClassId: classId,
      } as any),
    ) as Promise<any>;
  }

  const enrollInto = (applicationId: string, sectionId?: string) =>
    asTenant(() =>
      admissions.enroll({
        applicationId,
        classId,
        sectionId,
        termId,
        rollNumber: applicationId.slice(0, 8),
        student: { name: `Student ${applicationId.slice(0, 6)}` },
      } as any),
    );

  /** capacity row keyed the way setCapacity/resolveCapacity do (sentinel for null). */
  async function setCapacity(capacity: number, sectionId?: string, claimedSeats = 0) {
    const SENT = '__none__';
    return raw.admissionCapacity.upsert({
      where: {
        organizationId_admissionCycleId_classId_sectionId_streamId: {
          organizationId,
          admissionCycleId: cycleId,
          classId,
          sectionId: sectionId ?? SENT,
          streamId: SENT,
        },
      },
      update: { capacity, claimedSeats, reservedCapacity: 0 },
      create: {
        organizationId,
        admissionCycleId: cycleId,
        classId,
        sectionId: sectionId ?? SENT,
        streamId: SENT,
        capacity,
        reservedCapacity: 0,
        claimedSeats,
      },
    });
  }

  const claimedFor = async (sectionId?: string) => {
    const SENT = '__none__';
    const row = await raw.admissionCapacity.findFirst({
      where: { organizationId, admissionCycleId: cycleId, classId, sectionId: sectionId ?? SENT, streamId: SENT },
    });
    return row?.claimedSeats ?? 0;
  };

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await setOrg(organizationId);
    await raw.organization.create({
      data: { id: organizationId, code: `CAP-${Date.now()}`, name: 'Capacity School', currencyCode: 'UGX' },
    });

    const year = await raw.academicYear.create({
      data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
    });
    academicYearId = year.id;
    const term = await raw.term.create({
      data: {
        organizationId,
        academicYearId: year.id,
        name: 'Term 1',
        startDate: new Date('2026-01-15'),
        endDate: new Date('2026-04-15'),
        isCurrent: true,
      },
    });
    termId = term.id;
    const grade = await raw.gradeLevel.create({ data: { organizationId, name: 'S1', order: 8 } });
    const cls = await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'S1 East' } });
    classId = cls.id;
    const secA = await raw.section.create({ data: { organizationId, classId, name: 'A' } });
    const secB = await raw.section.create({ data: { organizationId, classId, name: 'B' } });
    sectionAId = secA.id;
    sectionBId = secB.id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();

    tenant = moduleRef.get(TenantContextService);
    admissions = moduleRef.get(AdmissionsService);
    workflows = moduleRef.get(AdmissionsWorkflowService);
    portal = moduleRef.get(AdmissionsPortalService);
    enrollment = moduleRef.get(EnrollmentService);

    // A direct-entry workflow keeps these tests about capacity, not about stages.
    const wf: any = await asTenant(() => workflows.create({ name: 'Direct', presetKey: 'simple', isDefault: true }));
    const cycle = await raw.admissionCycle.create({
      data: { organizationId, academicYearId, name: 'Capacity 2026', workflowId: wf.id },
    });
    cycleId = cycle.id;
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  // ───────────────────────────── Capacity ─────────────────────────────

  it('capacity 1, two simultaneous enrolments: exactly one succeeds', async () => {
    await setCapacity(1);
    const [a, b] = await Promise.all([newApp(), newApp()]);

    const results = await Promise.allSettled([enrollInto(a.id), enrollInto(b.id)]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(String((failed[0] as PromiseRejectedResult).reason)).toMatch(/seat|full|available/i);
    expect(await claimedFor()).toBe(1);
  });

  it('capacity 2, three simultaneous enrolments: exactly two succeed', async () => {
    await setCapacity(2);
    const apps = await Promise.all([newApp(), newApp(), newApp()]);

    const results = await Promise.allSettled(apps.map((a) => enrollInto(a.id)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await claimedFor()).toBe(2);
  });

  it('capacity 2, two SEQUENTIAL enrolments: both succeed', async () => {
    // The regression that the parallel cases above cannot catch. The old guard was
    // `claimedSeats < capacity − reserved − occupied`; after the first enrolment
    // committed, that seat sat in both counters and the second was wrongly refused.
    await setCapacity(2);
    const a = await newApp();
    const b = await newApp();

    await expect(enrollInto(a.id)).resolves.toBeDefined();
    await expect(enrollInto(b.id)).resolves.toBeDefined();
    expect(await claimedFor()).toBe(2);
  });

  it('releases the seat on withdrawal, and only from the section it was claimed in', async () => {
    // The release used to filter on `before.sectionId` / `before.streamId` — columns
    // that do not exist on AdmissionApplication — so both filters were dropped and
    // updateMany could decrement whichever capacity row it reached first.
    await setCapacity(5, sectionAId);
    await setCapacity(5, sectionBId);
    const inA = await newApp();
    await enrollInto(inA.id, sectionAId);

    const beforeA = await claimedFor(sectionAId);
    const beforeB = await claimedFor(sectionBId);
    expect(beforeA).toBe(1);

    // Ending the Enrollment is the real exit path: `enrolled` is a terminal ADMISSION
    // status, so the release that used to hang off admissions `withdraw` never ran.
    const enrolment = await raw.enrollment.findFirst({ where: { applicationId: inA.id } });
    await asTenant(() => enrollment.withdraw(enrolment!.id, { reason: 'left the country' }));

    expect(await claimedFor(sectionAId)).toBe(beforeA - 1);
    expect(await claimedFor(sectionBId)).toBe(beforeB);
  });

  it('reports occupied alongside claimedSeats so the two can be reconciled', async () => {
    await setCapacity(10);
    const a = await newApp();
    await enrollInto(a.id);

    const status: any[] = await asTenant(() => admissions.capacityStatus(cycleId));
    const row = status.find((r) => r.classId === classId && r.sectionId === '__none__');
    expect(row).toBeDefined();
    // `occupied` is reported so an operator can reconcile it against the ledger, but
    // `available` is derived from the ledger alone — counting both is what caused the
    // double-count. (The two are not asserted equal here: earlier cases in this suite
    // reset `claimedSeats` directly, which is exactly the drift `occupied` exposes.)
    expect(row.occupied).toEqual(expect.any(Number));
    expect(row.available).toBe(row.capacity - row.reservedCapacity - row.claimedSeats);
  });

  // ─────────────────────────── Enrolment atomicity ───────────────────────────

  it('rolls back completely when enrolment fails part-way through', async () => {
    await setCapacity(10);
    const app = await newApp();
    const before = {
      partners: await raw.partner.count({ where: { organizationId } }),
      profiles: await raw.studentProfile.count({ where: { organizationId } }),
      enrollments: await raw.enrollment.count({ where: { organizationId } }),
      history: await raw.studentStatusHistory.count({ where: { organizationId } }),
      claimed: await claimedFor(),
    };

    // Fail after the student has been created but before the transaction commits.
    const enrollment: any = moduleRef.get(
      (await import('../../src/modules/school/people/enrollment.service')).EnrollmentService,
    );
    const original = enrollment.enrollNewStudent.bind(enrollment);
    const spy = jest
      .spyOn(enrollment, 'enrollNewStudent')
      .mockImplementation(async (input: any, tx: any) => {
        await original(input, tx);
        throw new Error('simulated failure after student creation');
      });

    await expect(enrollInto(app.id)).rejects.toThrow(/simulated failure/);
    spy.mockRestore();

    expect(await raw.partner.count({ where: { organizationId } })).toBe(before.partners);
    expect(await raw.studentProfile.count({ where: { organizationId } })).toBe(before.profiles);
    expect(await raw.enrollment.count({ where: { organizationId } })).toBe(before.enrollments);
    expect(await raw.studentStatusHistory.count({ where: { organizationId } })).toBe(before.history);
    // The seat claim is inside the same transaction, so it rolls back too — a failed
    // enrolment must not silently consume a seat.
    expect(await claimedFor()).toBe(before.claimed);

    const after = await raw.admissionApplication.findFirst({ where: { id: app.id } });
    expect(after!.status).toBe('submitted');
  });

  it('enrolling the same application twice produces exactly one student', async () => {
    await setCapacity(10);
    const app = await newApp();
    await enrollInto(app.id);
    await enrollInto(app.id).catch(() => undefined);
    expect(await raw.enrollment.count({ where: { applicationId: app.id } })).toBe(1);
  });

  // ──────────────────────────── Portal isolation ────────────────────────────

  describe('portal tokens', () => {
    const guardianEmail = 'guardian@example.test';

    async function appWithGuardian() {
      seq += 1;
      const app: any = await asTenant(() =>
        admissions.create({
          academicYearId,
          admissionCycleId: cycleId,
          applicantFirstName: `Portal${seq}`,
          applicantLastName: `Case${Date.now()}${seq}`,
          applyingForClassId: classId,
          guardians: [
            { firstName: 'Guardian', relationship: 'mother', email: guardianEmail, isPrimary: true },
          ],
        } as any),
      );
      return app;
    }

    it('a token resolves only to the application it was issued for', async () => {
      const a = await appWithGuardian();
      const b = await appWithGuardian();
      const issued: any = await asTenant(() => portal.issueAccessLink(a.id, guardianEmail));

      const resolved = await portal.resolveToken(issued.devToken);
      expect(resolved.applicationId).toBe(a.id);
      // The token IS the identity. There is no client-supplied application id that
      // could point it at B.
      expect(resolved.applicationId).not.toBe(b.id);
    });

    it('rejects a missing token as unauthenticated, not as a server error', async () => {
      await expect(portal.resolveToken('')).rejects.toMatchObject({ status: 401 });
    });

    it('rejects a malformed or unknown token', async () => {
      await expect(portal.resolveToken('not-a-real-token')).rejects.toThrow(/Invalid access link/);
    });

    it('rejects an expired token', async () => {
      const a = await appWithGuardian();
      const issued: any = await asTenant(() => portal.issueAccessLink(a.id, guardianEmail));
      await raw.admissionPortalToken.updateMany({
        where: { applicationId: a.id },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });
      await expect(portal.resolveToken(issued.devToken)).rejects.toThrow(/expired/i);
    });

    it('refuses to issue a link to an address that is not on the application', async () => {
      const a = await appWithGuardian();
      await expect(
        asTenant(() => portal.issueAccessLink(a.id, 'attacker@example.test')),
      ).rejects.toThrow(/not on file/i);
    });
  });
});
