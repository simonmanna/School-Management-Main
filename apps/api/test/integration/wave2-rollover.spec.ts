/**
 * Year-end rollover with the learners a real school has (E2E audit L1/L2):
 *
 *   - a SUSPENDED pupil is promoted like everyone else. SUSPENDED → COMPLETED
 *     was not a legal transition, so the whole row failed and the UI still
 *     said "Whole school moved up".
 *   - a WITHDRAWN pupil cannot be promoted into next year (it used to mint an
 *     ACTIVE enrollment for a child who had left).
 *   - a grade with no ladder yields a clear per-row reason, not a silent skip.
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
import { StudentEnrollmentService } from '../../src/modules/school/enrollment/student-enrollment.service';
import { PromotionRunService } from '../../src/modules/school/enrollment/promotion-run.service';

describeDb('integration: year-end rollover with suspended / withdrawn / unladdered learners', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let enrollments: StudentEnrollmentService;
  let promotion: PromotionRunService;

  const stamp = Date.now();
  const organizationId = `org_w2roll_${stamp}`;
  let year1 = '';
  let year2 = '';
  let term3 = '';
  let nextTerm1 = '';
  let p1Class = '';
  let p2Class = '';

  const as = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run(
      {
        organizationId,
        userId: 'registrar_roll',
        permissions: ['school:enrollment:write', 'school:enrollment:reactivate', 'school:promotion:apply'],
      },
      fn,
    );

  let seq = 0;
  const enrolIn = async (classId: string) => {
    seq += 1;
    const partner = await raw.partner.create({
      data: { organizationId, code: `R-${stamp}-${seq}`, name: `Roll Pupil ${seq}`, isCustomer: true },
    });
    const sp = await raw.studentProfile.create({
      data: { organizationId, partnerId: partner.id, admissionNo: `RL-${stamp}-${seq}`, enrollmentDate: new Date('2026-09-10') },
    });
    const res: any = await as(() =>
      enrollments.create({
        studentProfileId: sp.id,
        academicYearId: year1,
        status: 'ACTIVE',
        placement: { termId: term3, classId, effectiveFrom: '2026-09-10T00:00:00.000Z' },
      } as any),
    );
    return { studentProfileId: sp.id, enrollmentId: res.enrollment?.id ?? res.id };
  };

  beforeAll(async () => {
    await raw.$connect();
    await raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, organizationId);
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await raw.organization.create({
      data: { id: organizationId, code: `ROLL-${stamp}`, name: 'Rollover School', currencyCode: 'UGX' },
    });

    year1 = (await raw.academicYear.create({
      data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'), isCurrent: true },
    })).id;
    year2 = (await raw.academicYear.create({
      data: { organizationId, name: '2027', startDate: new Date('2027-01-01'), endDate: new Date('2027-12-31') },
    })).id;
    term3 = (await raw.term.create({
      data: { organizationId, academicYearId: year1, name: 'Term 3', startDate: new Date('2026-09-01'), endDate: new Date('2026-12-05'), isCurrent: true },
    })).id;
    nextTerm1 = (await raw.term.create({
      data: { organizationId, academicYearId: year2, name: 'Term 1', startDate: new Date('2027-02-01'), endDate: new Date('2027-05-01') },
    })).id;

    const programme = await raw.academicProgramme.create({
      data: { organizationId, code: 'PRI', name: 'Primary', isActive: true, effectiveFrom: new Date('2000-01-01') },
    });
    const level = await raw.academicLevel.create({
      data: { organizationId, code: 'PRI', name: 'Primary', defaultProgrammeId: programme.id },
    });
    // Ladder: P1 → P2. P2 has NO next grade and is not terminal (unconfigured).
    const p2 = await raw.gradeLevel.create({ data: { organizationId, name: 'P2', order: 2, academicLevelId: level.id } });
    const p1 = await raw.gradeLevel.create({
      data: { organizationId, name: 'P1', order: 1, academicLevelId: level.id, nextGradeLevelId: p2.id },
    });
    p1Class = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId: p1.id, name: 'P1 A', allowsStreams: false } })).id;
    p2Class = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId: p2.id, name: 'P2 A', allowsStreams: false } })).id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    enrollments = moduleRef.get(StudentEnrollmentService);
    promotion = moduleRef.get(PromotionRunService);

    // Enrol inside Term 3 2026 (dated-spec convention: Date only is faked).
    jest.useFakeTimers({
      now: new Date('2026-10-01T09:00:00.000Z'),
      doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'],
    });
  });

  afterAll(async () => {
    jest.useRealTimers();
    await moduleRef?.close();
    await raw.$disconnect();
  });

  it('promotes a suspended learner, reports the unladdered one, and never promotes the withdrawn one', async () => {
    const active = await enrolIn(p1Class);
    const suspended = await enrolIn(p1Class);
    const withdrawn = await enrolIn(p1Class);
    const unladdered = await enrolIn(p2Class);

    await as(() => enrollments.suspend(suspended.enrollmentId, { reason: 'Disciplinary', effectiveAt: '2026-10-02T00:00:00.000Z' } as any));
    await as(() => enrollments.withdraw(withdrawn.enrollmentId, { reason: 'Moved town', effectiveAt: '2026-10-02T00:00:00.000Z' } as any));

    // A withdrawn learner is not on the rollover at all, and a direct promote is refused.
    await expect(
      as(() => enrollments.promote(withdrawn.enrollmentId, { toAcademicYearId: year2, toTermId: nextTerm1, toClassId: p2Class } as any)),
    ).rejects.toThrow(/cannot move on to next year/);

    const plan: any = await as(() => promotion.rollover({ fromTermId: term3, toTermId: nextTerm1, dryRun: true }));
    const ids = (rows: any[]) => rows.map((r) => r.studentProfileId).sort();
    expect(ids(plan.promote)).toEqual([active.studentProfileId, suspended.studentProfileId].sort());
    const reason = plan.skip.find((r: any) => r.studentProfileId === unladdered.studentProfileId)?.reason;
    expect(reason).toMatch(/progression for "P2" is not configured/);
    expect(ids([...plan.promote, ...plan.skip, ...plan.graduate, ...plan.repeat])).not.toContain(withdrawn.studentProfileId);

    const done: any = await as(() => promotion.rollover({ fromTermId: term3, toTermId: nextTerm1, dryRun: false }));
    expect((done.executed ?? []).filter((x: any) => x.error)).toEqual([]);

    const nextYear = await raw.studentEnrollment.findMany({
      where: { organizationId, academicYearId: year2 },
      select: { studentProfileId: true, status: true },
    });
    expect(nextYear.map((e) => e.studentProfileId).sort()).toEqual(
      [active.studentProfileId, suspended.studentProfileId].sort(),
    );
    // The suspended pupil's 2026 membership closed as COMPLETED, not left dangling.
    const old = await raw.studentEnrollment.findFirstOrThrow({ where: { id: suspended.enrollmentId } });
    expect(old.status).toBe('COMPLETED');
  });
});
