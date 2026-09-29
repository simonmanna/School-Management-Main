/**
 * Wave 17 — audit §13 / D07: one fictional school's year, end to end, against a
 * real database, through the same services the screens call.
 *
 * Green Valley Nursery and Primary (UGX, Africa/Kampala), 2026 → 2027:
 *   1. two siblings admitted at the front desk share one guardian contact;
 *   2. a stream transfer keeps effective-dated history;
 *   3. a withdrawal and re-admission keep one pupil identity;
 *   4. the term is billed; two part payments and an overpayment reconcile to the
 *      student balance and the AR control account;
 *   5. the daily register and a lesson register stay separate;
 *   6. year end: one pupil repeats P1, the rest move up to P2, the P7 pupil
 *      graduates — and every 2026 placement, invoice and register row is unchanged.
 *
 * Browser-level journeys for the same school workflows live in apps/web/e2e.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';
import { ensureAccountCategories, makeAccountFactory } from './_accounts';
import { KernelModule } from '../../src/kernel/kernel.module';
import { DocumentsModule } from '../../src/modules/documents/documents.module';
import { CoreModule } from '../../src/modules/core/core.module';
import { AccountingModule } from '../../src/modules/accounting/accounting.module';
import { InventoryModule } from '../../src/modules/inventory/inventory.module';
import { InvoicingModule } from '../../src/modules/invoicing/invoicing.module';
import { SchoolModule } from '../../src/modules/school/school.module';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';
import { StudentAdmissionService } from '../../src/modules/school/people/student-admission.service';
import { StudentEnrollmentService } from '../../src/modules/school/enrollment/student-enrollment.service';
import { PlacementService } from '../../src/modules/school/enrollment/placement.service';
import { PromotionRunService } from '../../src/modules/school/enrollment/promotion-run.service';
import { BillingService, SchoolPaymentService } from '../../src/modules/school/fees/billing.service';
import { SchoolFinanceQueryService } from '../../src/modules/school/fees/school-finance-query.service';
import { StudentAttendanceService } from '../../src/modules/school/attendance/student-attendance.service';

describeDb('integration: Green Valley — a school year end to end (wave 17 D07)', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let admission: StudentAdmissionService;
  let enrollments: StudentEnrollmentService;
  let placements: PlacementService;
  let promotion: PromotionRunService;
  let billing: BillingService;
  let payments: SchoolPaymentService;
  let finance: SchoolFinanceQueryService;
  let attendance: StudentAttendanceService;

  const stamp = Date.now();
  const organizationId = `org_w17gv_${stamp}`;
  const FEE = 300_000;
  const as = <T>(fn: () => Promise<T>): Promise<T> => tenant.run({ organizationId, userId: 'gv_admin', permissions: ['*'] }, fn);

  const ids: Record<string, string> = {};
  const pupils: Record<string, { profileId: string; enrollmentId: string }> = {};
  let roll = 0;

  const admit = async (key: string, name: string, classId: string, sectionId: string | null, guardian?: { name: string; phone: string }) => {
    roll += 1;
    const res: any = await as(() =>
      admission.register({
        name,
        dateOfBirth: `2019-0${(roll % 9) + 1}-1${roll % 9}`,
        classId,
        sectionId: sectionId ?? undefined,
        termId: ids.term3,
        rollNumber: `GV-${roll}`,
        ...(guardian ? { guardianName: guardian.name, guardianPhone: guardian.phone, guardianRelationship: 'mother' } : {}),
      } as any),
    );
    pupils[key] = { profileId: res.profile.id, enrollmentId: res.enrollment.id };
    return res;
  };

  const glAr = async () => {
    const r = await raw.journalLine.aggregate({ where: { organizationId, accountId: ids.ar }, _sum: { baseDebit: true, baseCredit: true } });
    return Number(r._sum.baseDebit ?? 0) - Number(r._sum.baseCredit ?? 0);
  };

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({ where: { code: 'UGX' }, update: {}, create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 } });
    await raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, organizationId);
    await raw.organization.create({ data: { id: organizationId, code: `GV-${stamp}`, name: 'Green Valley Nursery and Primary', currencyCode: 'UGX', timezone: 'Africa/Kampala' } as any });
    await raw.schoolProfile.create({ data: { organizationId, name: 'Green Valley Nursery and Primary', gradingSystem: 'PLE', capacityPolicy: 'OFF' } as any });

    // Books.
    const mk = makeAccountFactory(raw, await ensureAccountCategories(raw));
    const cash = (await mk(organizationId, 'GV-1100', 'Cash', 'cash')).id;
    const bank = (await mk(organizationId, 'GV-1200', 'Stanbic Bank', 'bank')).id;
    ids.ar = (await mk(organizationId, 'GV-1300', 'Fees Receivable', 'receivable')).id;
    const revenue = (await mk(organizationId, 'GV-4100', 'Tuition Revenue', 'revenue')).id;
    for (const [code, name, type] of [['SALES', 'Sales', 'sales'], ['CASH', 'Cash', 'cash'], ['BANK', 'Bank', 'bank'], ['GEN', 'General', 'general']] as const) {
      await raw.journal.create({ data: { organizationId, code, name, journalType: type } });
    }
    for (const [key, accountId] of [['default_cash', cash], ['default_bank', bank], ['accounts_receivable', ids.ar]] as const) {
      await raw.accountMapping.create({ data: { organizationId, key, accountId } });
    }
    const category = await raw.productCategory.create({ data: { organizationId, name: 'School Fees', incomeAccountId: revenue } });
    const tuition = await raw.product.create({ data: { organizationId, code: 'TUITION', name: 'Tuition', productType: 'service', categoryId: category.id, salesPrice: FEE } });

    // Calendar: 2026 (three terms, Term 3 current) and 2027 Term 1.
    const y2026 = await raw.academicYear.create({ data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'), isCurrent: true } });
    const y2027 = await raw.academicYear.create({ data: { organizationId, name: '2027', startDate: new Date('2027-01-01'), endDate: new Date('2027-12-31') } });
    ids.y2026 = y2026.id;
    ids.y2027 = y2027.id;
    await raw.term.create({ data: { organizationId, academicYearId: y2026.id, name: 'Term 1', startDate: new Date('2026-02-02'), endDate: new Date('2026-04-30') } });
    await raw.term.create({ data: { organizationId, academicYearId: y2026.id, name: 'Term 2', startDate: new Date('2026-05-25'), endDate: new Date('2026-08-14') } });
    ids.term3 = (await raw.term.create({ data: { organizationId, academicYearId: y2026.id, name: 'Term 3', startDate: new Date('2026-09-07'), endDate: new Date('2026-12-04'), isCurrent: true } })).id;
    ids.t2027 = (await raw.term.create({ data: { organizationId, academicYearId: y2027.id, name: 'Term 1', startDate: new Date('2027-02-01'), endDate: new Date('2027-04-30') } })).id;

    // Ladder: P1 → P2; P7 ends the school.
    const programme = await raw.academicProgramme.create({ data: { organizationId, code: 'PRI', name: 'Primary', isActive: true, effectiveFrom: new Date('2000-01-01') } });
    const level = await raw.academicLevel.create({ data: { organizationId, code: 'PRI', name: 'Primary', defaultProgrammeId: programme.id } });
    const p2 = await raw.gradeLevel.create({ data: { organizationId, name: 'P2', order: 2, academicLevelId: level.id } });
    const p1 = await raw.gradeLevel.create({ data: { organizationId, name: 'P1', order: 1, academicLevelId: level.id, nextGradeLevelId: p2.id } });
    const p7 = await raw.gradeLevel.create({ data: { organizationId, name: 'P7', order: 7, academicLevelId: level.id, isTerminal: true } });
    ids.p1 = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId: p1.id, name: 'P1', allowsStreams: true } })).id;
    ids.p2 = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId: p2.id, name: 'P2', allowsStreams: false } })).id;
    ids.p7 = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId: p7.id, name: 'P7', allowsStreams: false } })).id;
    ids.north = (await raw.section.create({ data: { organizationId, classId: ids.p1, name: 'North', code: 'N' } })).id;
    ids.south = (await raw.section.create({ data: { organizationId, classId: ids.p1, name: 'South', code: 'S' } })).id;

    // Registers.
    for (const s of [
      { code: 'present', label: 'Present', isPresent: true, isDefault: true, sortOrder: 2 },
      { code: 'absent', label: 'Absent', isAbsent: true, sortOrder: 1 },
      { code: 'late', label: 'Late', isPresent: true, isLate: true, sortOrder: 3 },
    ]) await raw.attendanceStatusConfig.create({ data: { organizationId, ...s } as any });
    ids.period1 = (await raw.period.create({ data: { organizationId, name: 'Period 1', startTime: '08:00', endTime: '08:40', order: 1 } as any })).id;

    // P1 term fees, published.
    const structure = await raw.feeStructure.create({
      data: { organizationId, name: 'P1 Term 3', academicYearId: y2026.id, status: 'published', components: [{ code: 'TUITION', productId: tuition.id, amount: FEE }], applicableTo: { classIds: [ids.p1] } },
    });
    const v1 = await raw.feeStructureVersion.create({ data: { organizationId, feeStructureId: structure.id, versionNo: 1, isImmutable: true, publishedAt: new Date() } });
    await raw.feeItem.create({ data: { organizationId, feeStructureVersionId: v1.id, code: 'TUITION', name: 'Tuition', productId: tuition.id, amount: FEE, isOptional: false, frequency: 'termly', appliesTo: {} } });
    await raw.feeStructure.update({ where: { id: structure.id }, data: { currentVersionId: v1.id } });
    await raw.feeSchedule.create({ data: { organizationId, feeStructureId: structure.id, termId: ids.term3, dueDate: new Date('2026-10-15') } });

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    admission = moduleRef.get(StudentAdmissionService);
    enrollments = moduleRef.get(StudentEnrollmentService);
    placements = moduleRef.get(PlacementService);
    promotion = moduleRef.get(PromotionRunService);
    billing = moduleRef.get(BillingService);
    payments = moduleRef.get(SchoolPaymentService);
    finance = moduleRef.get(SchoolFinanceQueryService);
    attendance = moduleRef.get(StudentAttendanceService);

    // Term 3, 2026 (Date only is faked — the dated-spec convention).
    jest.useFakeTimers({
      now: new Date('2026-10-01T06:00:00.000Z'),
      doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'],
    });
  });

  afterAll(async () => {
    jest.useRealTimers();
    await moduleRef?.close();
    await raw.$disconnect();
  });

  it('1. siblings admitted at the front desk share one guardian', async () => {
    const mum = { name: 'Nabirye Harriet', phone: '+256772000111' };
    await admit('brian', 'Akello Brian', ids.p1, ids.north, mum);
    await admit('sarah', 'Akello Sarah', ids.p1, ids.north, mum);
    await admit('repeater', 'Mugisha Tom', ids.p1, ids.north);
    await admit('leaver', 'Namutebi Grace', ids.p7, null);
    const links = await raw.studentGuardian.findMany({
      where: { organizationId, studentProfileId: { in: [pupils.brian.profileId, pupils.sarah.profileId] } },
    });
    expect(links).toHaveLength(2);
    expect(new Set(links.map((l) => l.guardianContactId)).size).toBe(1);
  });

  it('2. a stream transfer keeps effective-dated history', async () => {
    await as(() =>
      placements.move(pupils.sarah.enrollmentId, {
        classId: ids.p1, sectionId: ids.south, movementReason: 'STREAM_CHANGE', reason: 'Balance the streams', effectiveFrom: '2026-10-05T00:00:00.000Z',
      } as any),
    );
    const history = await raw.enrollmentPlacement.findMany({ where: { enrollmentId: pupils.sarah.enrollmentId }, orderBy: { effectiveFrom: 'asc' } });
    expect(history).toHaveLength(2);
    expect(history[0].sectionId).toBe(ids.north);
    expect(history[0].effectiveTo).not.toBeNull();
    expect(history[1].sectionId).toBe(ids.south);
    expect(history[1].effectiveTo).toBeNull();
  });

  it('3. withdrawal and re-admission keep one pupil identity', async () => {
    const tmp = await admit('returner', 'Okot Daniel', ids.p1, ids.south);
    await as(() => enrollments.withdraw(pupils.returner.enrollmentId, { reason: 'Family moved', effectiveAt: '2026-10-06T00:00:00.000Z' } as any));
    // Same year: the school reinstates the membership rather than opening a
    // second one, so the child's 2026 history stays in one place.
    await as(() =>
      enrollments.changeStatus(pupils.returner.enrollmentId, {
        toStatus: 'ACTIVE', reason: 'Returned after the move fell through', effectiveAt: '2026-10-08T00:00:00.000Z',
        placement: { termId: ids.term3, classId: ids.p1, sectionId: ids.south, effectiveFrom: '2026-10-08T00:00:00.000Z' },
      } as any),
    );
    // Admitting the same child again as new is refused, not duplicated.
    await expect(
      as(() => admission.admit({ organizationId, name: 'Okot Daniel', existingStudentProfileId: tmp.profile.id, placement: { termId: ids.term3, classId: ids.p1, sectionId: ids.south } } as any)),
    ).rejects.toThrow(/already has a 2026 enrollment/);
    expect(await raw.studentProfile.count({ where: { organizationId, partner: { name: 'Okot Daniel' } } })).toBe(1);
    const ens = await raw.studentEnrollment.findMany({ where: { studentProfileId: tmp.profile.id } });
    expect(ens.map((e) => e.status)).toEqual(['ACTIVE']);
    const history = await raw.enrollmentPlacement.findMany({ where: { enrollmentId: ens[0].id } });
    expect(history.length).toBeGreaterThanOrEqual(2); // closed at withdrawal, reopened on return
  });

  it('4. billing, part payments and an overpayment reconcile to the ledger', async () => {
    await as(() => billing.generateForTerm({ termId: ids.term3, classId: ids.p1 } as any));
    const invoices = await raw.schoolFeeInvoice.count({ where: { organizationId, termId: ids.term3 } });
    expect(invoices).toBe(4); // brian, sarah, repeater, returner — P7 has no P1 fee
    await as(() => payments.collect({ studentProfileId: pupils.brian.profileId, amount: 100_000, paymentMethod: 'cash' } as any));
    await as(() => payments.collect({ studentProfileId: pupils.brian.profileId, amount: 120_000, paymentMethod: 'mobile_money' } as any));
    await as(() => payments.collect({ studentProfileId: pupils.sarah.profileId, amount: 350_000, paymentMethod: 'bank' } as any));

    const brian: any = await as(() => finance.studentBalance(pupils.brian.profileId));
    expect(brian).toMatchObject({ billed: FEE, collected: 220_000, balance: 80_000 });
    const sarah: any = await as(() => finance.studentBalance(pupils.sarah.profileId));
    expect(sarah.billed).toBe(FEE);
    expect(sarah.balance).toBeLessThanOrEqual(0); // 50,000 held for the family, not lost

    // AR control = open invoices − unallocated receipts.
    const open = 4 * FEE - 100_000 - 120_000 - FEE;
    const unallocated = 50_000;
    expect(await glAr()).toBe(open - unallocated);
  });

  it('5. the daily register and a lesson register stay separate', async () => {
    const date = '2026-10-01';
    const entries = (status: string) => [{ studentProfileId: pupils.brian.profileId, status }];
    await as(() => attendance.mark({ date, classId: ids.p1, entries: entries('present') } as any));
    await as(() => attendance.mark({ date, classId: ids.p1, periodId: ids.period1, entries: entries('absent') } as any));
    const daily: any[] = await as(() => attendance.dailyRegister(ids.p1, date));
    const lesson: any[] = await as(() => attendance.dailyRegister(ids.p1, date, ids.period1));
    expect(daily.find((r) => r.studentProfileId === pupils.brian.profileId)?.status).toBe('present');
    expect(lesson.find((r) => r.studentProfileId === pupils.brian.profileId)?.status).toBe('absent');
  });

  it('6. year end: repeat, promote, graduate — 2026 history unchanged', async () => {
    const before = {
      placements: await raw.enrollmentPlacement.findMany({ where: { organizationId }, orderBy: { id: 'asc' }, select: { id: true, classCohortId: true, sectionId: true, effectiveFrom: true } }),
      invoices: await raw.schoolFeeInvoice.findMany({ where: { organizationId }, orderBy: { id: 'asc' }, select: { id: true, status: true, documentId: true } }),
      marks: await raw.studentAttendance.count({ where: { organizationId } }),
    };

    // After the last day of term.
    jest.setSystemTime(new Date('2026-12-10T06:00:00.000Z'));
    await as(() =>
      enrollments.repeat(pupils.repeater.enrollmentId, { toAcademicYearId: ids.y2027, toTermId: ids.t2027, reason: 'Did not meet P1 outcomes', effectiveFrom: '2027-02-01T00:00:00.000Z' } as any),
    );
    const plan: any = await as(() => promotion.rollover({ fromTermId: ids.term3, toTermId: ids.t2027, dryRun: true }));
    expect(plan.graduate.map((r: any) => r.studentProfileId)).toEqual([pupils.leaver.profileId]);
    const done: any = await as(() => promotion.rollover({ fromTermId: ids.term3, toTermId: ids.t2027, dryRun: false }));
    expect((done.executed ?? []).filter((x: any) => x.error)).toEqual([]);

    const next = await raw.studentEnrollment.findMany({
      where: { organizationId, academicYearId: ids.y2027 },
      include: { placements: { include: { classCohort: { select: { classId: true } } } } },
    });
    const classOf = (profileId: string) => next.find((e) => e.studentProfileId === profileId)?.placements[0]?.classCohort?.classId;
    expect(classOf(pupils.brian.profileId)).toBe(ids.p2);
    expect(classOf(pupils.sarah.profileId)).toBe(ids.p2);
    expect(classOf(pupils.returner.profileId)).toBe(ids.p2);
    expect(classOf(pupils.repeater.profileId)).toBe(ids.p1);
    expect(next.find((e) => e.studentProfileId === pupils.leaver.profileId)).toBeUndefined();
    const leaver = await raw.studentProfile.findUniqueOrThrow({ where: { id: pupils.leaver.profileId } });
    expect(leaver.status).toMatch(/graduat|alumni|completed/i);

    // Every 2026 record is exactly as it was.
    const after2026 = await raw.enrollmentPlacement.findMany({
      where: { organizationId, id: { in: before.placements.map((p) => p.id) } },
      orderBy: { id: 'asc' },
      select: { id: true, classCohortId: true, sectionId: true, effectiveFrom: true },
    });
    expect(after2026).toEqual(before.placements);
    expect(await raw.schoolFeeInvoice.findMany({ where: { organizationId }, orderBy: { id: 'asc' }, select: { id: true, status: true, documentId: true } })).toEqual(before.invoices);
    expect(await raw.studentAttendance.count({ where: { organizationId } })).toBe(before.marks);
  });
});
