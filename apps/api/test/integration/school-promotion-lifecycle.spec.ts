/**
 * P5 integration — period attendance, student lifecycle FSM, promotion, rollover.
 *
 * Proves against a real DB:
 *  - P5a period attendance: a daily row (periodId null) and a period row
 *    (periodId set) for the same student/date COEXIST (the two partial unique
 *    indexes replaced the single daily-only unique).
 *  - P5b lifecycle FSM: a legal status change is accepted and recorded; an
 *    illegal one (suspended → alumni) is rejected.
 *  - P5c promotion: promoting a student closes the current enrollment
 *    (`completed`) and CREATES a next-term enrollment; the profile's current
 *    class moves. History is never mutated.
 *  - P5d rollover: a dry-run reports a plan without writing; executing it
 *    promotes every active student one grade and is resumable (already-enrolled
 *    students are skipped).
 *
 * Same DB requirements as the other school integration specs (RLS-inert target).
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
import { StudentService } from '../../src/modules/school/people/student.service';
import { PromotionService } from '../../src/modules/school/people/promotion.service';
import { StudentAttendanceService } from '../../src/modules/school/attendance/student-attendance.service';

describeDb('integration: school promotion + lifecycle (P5)', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let students: StudentService;
  let promotion: PromotionService;
  let attendance: StudentAttendanceService;

  const organizationId = `org_p5_${Date.now()}`;
  const userId = 'registrar_p5';
  let term1 = '';
  let term2 = '';
  let s1ClassId = '';
  let s2ClassId = '';
  let periodId = '';

  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);
  const perms = ['school:students:write', 'school:attendance:write'];
  const asTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId, permissions: perms }, fn);

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await setOrg(organizationId);
    await raw.organization.create({ data: { id: organizationId, code: `P5-${Date.now()}`, name: 'P5 School', currencyCode: 'UGX' } });

    const year = await raw.academicYear.create({
      data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
    });
    const t1 = await raw.term.create({
      data: { organizationId, academicYearId: year.id, name: 'Term 1', startDate: new Date('2026-01-15'), endDate: new Date('2026-04-15'), isCurrent: true },
    });
    const t2 = await raw.term.create({
      data: { organizationId, academicYearId: year.id, name: 'Term 2', startDate: new Date('2026-05-01'), endDate: new Date('2026-08-15') },
    });
    term1 = t1.id;
    term2 = t2.id;

    // Two grades one order apart so rollover has somewhere to promote INTO.
    const gS1 = await raw.gradeLevel.create({ data: { organizationId, name: 'S1', order: 8 } });
    const gS2 = await raw.gradeLevel.create({ data: { organizationId, name: 'S2', order: 9 } });
    s1ClassId = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId: gS1.id, name: 'S1 East' } })).id;
    s2ClassId = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId: gS2.id, name: 'S2 East' } })).id;
    periodId = (await raw.period.create({ data: { organizationId, name: 'P1', startTime: '08:00', endTime: '08:40', order: 1 } })).id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();

    tenant = moduleRef.get(TenantContextService);
    students = moduleRef.get(StudentService);
    promotion = moduleRef.get(PromotionService);
    attendance = moduleRef.get(StudentAttendanceService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  const makeStudent = (admissionNo: string, classId: string) =>
    asTenant(() =>
      students.create({ name: `Student ${admissionNo}`, admissionNo, enrollmentDate: '2026-01-15', currentClassId: classId }),
    ) as Promise<any>;

  it('P5a: daily and period attendance rows coexist for the same student/date', async () => {
    const s = await makeStudent(`P5A-${Date.now()}`, s1ClassId);
    const date = '2026-02-10';

    // Daily register (no periodId) — present.
    await asTenant(() => attendance.mark({ date, classId: s1ClassId, entries: [{ studentProfileId: s.id, status: 'present' }] }));
    // Same day, period 1 — absent. Must NOT collide with the daily row.
    await asTenant(() => attendance.mark({ date, classId: s1ClassId, periodId, entries: [{ studentProfileId: s.id, status: 'absent' }] }));

    const rows = await raw.studentAttendance.findMany({ where: { studentProfileId: s.id } });
    expect(rows).toHaveLength(2);
    const daily = rows.find((r) => r.periodId === null);
    const period = rows.find((r) => r.periodId === periodId);
    expect(daily?.status).toBe('present');
    expect(period?.status).toBe('absent');

    // Re-marking the daily row updates in place (idempotent), still 2 rows total.
    await asTenant(() => attendance.mark({ date, classId: s1ClassId, entries: [{ studentProfileId: s.id, status: 'late' }] }));
    const after = await raw.studentAttendance.findMany({ where: { studentProfileId: s.id } });
    expect(after).toHaveLength(2);
    expect(after.find((r) => r.periodId === null)?.status).toBe('late');
  });

  it('P5b: legal status change recorded; illegal transition rejected', async () => {
    const s = await makeStudent(`P5B-${Date.now()}`, s1ClassId);

    // active → suspended is legal.
    await asTenant(() => students.update(s.id, { status: 'suspended', reason: 'disciplinary' }));
    const suspended = await raw.studentProfile.findFirst({ where: { id: s.id } });
    expect(suspended!.status).toBe('suspended');
    const hist = await raw.studentStatusHistory.findMany({ where: { studentProfileId: s.id } });
    expect(hist).toHaveLength(1);
    expect(hist[0].fromStatus).toBe('active');
    expect(hist[0].toStatus).toBe('suspended');

    // suspended → alumni is NOT a legal transition.
    await expect(asTenant(() => students.update(s.id, { status: 'alumni' }))).rejects.toThrow(/Cannot change student status/);
    // No extra history row was written by the rejected attempt.
    expect(await raw.studentStatusHistory.count({ where: { studentProfileId: s.id } })).toBe(1);
  });

  it('P5c: promotion closes the old enrollment and creates the next-term one', async () => {
    const s = await makeStudent(`P5C-${Date.now()}`, s1ClassId);
    // Seed a current (term 1) enrollment to be closed on promotion.
    await raw.enrollment.create({
      data: { organizationId, studentProfileId: s.id, classId: s1ClassId, termId: term1, rollNumber: '1', status: 'enrolled' },
    });

    const res: any = await asTenant(() =>
      promotion.promote({ studentProfileId: s.id, toTermId: term2, toClassId: s2ClassId }),
    );
    expect(res.outcome).toBe('promoted');
    expect(res.enrollmentId).toBeTruthy();

    const enrollments = await raw.enrollment.findMany({ where: { studentProfileId: s.id }, orderBy: { enrolledAt: 'asc' } });
    expect(enrollments).toHaveLength(2);
    expect(enrollments.find((e) => e.termId === term1)!.status).toBe('completed');
    expect(enrollments.find((e) => e.termId === term2)!.status).toBe('enrolled');

    const profile = await raw.studentProfile.findFirst({ where: { id: s.id } });
    expect(profile!.currentClassId).toBe(s2ClassId);

    // Promoting again into the same term is rejected (per-term uniqueness).
    await expect(asTenant(() => promotion.promote({ studentProfileId: s.id, toTermId: term2, toClassId: s2ClassId }))).rejects.toThrow();
  });

  it('P5d: rollover dry-run reports a plan, then execution promotes active students', async () => {
    const s = await makeStudent(`P5D-${Date.now()}`, s1ClassId);
    await raw.enrollment.create({
      data: { organizationId, studentProfileId: s.id, classId: s1ClassId, termId: term1, rollNumber: '2', status: 'enrolled' },
    });

    // Dry-run: nothing written.
    const plan: any = await asTenant(() => promotion.rolloverTerm({ fromTermId: term1, toTermId: term2, dryRun: true }));
    expect(plan.dryRun).toBe(true);
    const planned = plan.promote.find((p: any) => p.studentProfileId === s.id);
    expect(planned).toBeTruthy();
    expect(planned.toClassId).toBe(s2ClassId);
    // No term-2 enrollment created by the dry-run.
    expect(await raw.enrollment.count({ where: { studentProfileId: s.id, termId: term2 } })).toBe(0);

    // Execute.
    const done: any = await asTenant(() => promotion.rolloverTerm({ fromTermId: term1, toTermId: term2, dryRun: false }));
    expect(done.dryRun).toBe(false);
    const t2Enrollment = await raw.enrollment.findFirst({ where: { studentProfileId: s.id, termId: term2 } });
    expect(t2Enrollment!.classId).toBe(s2ClassId);
    expect((await raw.studentProfile.findFirst({ where: { id: s.id } }))!.currentClassId).toBe(s2ClassId);

    // Resumable: a second execution skips the now-already-enrolled student.
    const again: any = await asTenant(() => promotion.rolloverTerm({ fromTermId: term1, toTermId: term2, dryRun: false }));
    expect(again.skip.some((p: any) => p.studentProfileId === s.id)).toBe(true);
  });
});
