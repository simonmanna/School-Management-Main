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
  let s1SectionId = '';
  let s2SectionId = '';
  let s1StreamId = '';
  let s2StreamId = '';
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
    // Same-named subdivisions under BOTH classes. Section/Stream are unique per
    // (org, class, name), so "West" in S1 and "West" in S2 are different rows —
    // promotion has to RESOLVE the name inside the target class, not carry the
    // source id across. Fixtures are built this way so a carried id would fail.
    s1SectionId = (await raw.section.create({ data: { organizationId, classId: s1ClassId, name: 'West' } })).id;
    s2SectionId = (await raw.section.create({ data: { organizationId, classId: s2ClassId, name: 'West' } })).id;
    s1StreamId = (await raw.stream.create({ data: { organizationId, classId: s1ClassId, name: 'West' } })).id;
    s2StreamId = (await raw.stream.create({ data: { organizationId, classId: s2ClassId, name: 'West' } })).id;

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

  /**
   * Admitting with a class now writes the current term's Enrollment as part of
   * the same transaction — placement and its snapshot can no longer diverge — so
   * these specs no longer seed one by hand. `streamId` has no route through the
   * create DTO, so where a test needs one it is stamped onto the row afterwards.
   */
  const makeStudent = (admissionNo: string, classId: string, sectionId?: string) =>
    asTenant(() =>
      students.create({
        name: `Student ${admissionNo}`,
        admissionNo,
        enrollmentDate: '2026-01-15',
        currentClassId: classId,
        ...(sectionId ? { currentSectionId: sectionId } : {}),
      }),
    ) as Promise<any>;

  /** Put a stream on the pupil's current-term placement, both records together. */
  const setStream = async (studentProfileId: string, streamId: string) => {
    await raw.enrollment.updateMany({
      where: { studentProfileId, termId: term1, status: 'enrolled' },
      data: { streamId },
    });
    await raw.studentProfile.update({ where: { id: studentProfileId }, data: { currentStreamId: streamId } });
  };

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
    // Admission created the term-1 enrollment; promotion must close it.
    const s = await makeStudent(`P5C-${Date.now()}`, s1ClassId);

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

  // ── Placement integrity ───────────────────────────────────────────────────
  //
  // THE INVARIANT: a student's current enrollment and their profile snapshot
  // must agree on all THREE placement fields. Promotion used to write neither
  // streamId on the new enrollment nor currentStreamId on the profile, so a
  // promoted student's profile kept pointing at the OLD class's stream while
  // currentClassId had moved on — the two records disagreed. Batch rollover
  // dropped sectionId as well, for every student in the school at once.
  //
  // These assertions are permanent, not Phase 0 scaffolding: the earlier tests
  // in this file passed throughout the period the defect existed precisely
  // because none of them looked at the subdivision.

  /** Assert Enrollment and StudentProfile agree on class + section + stream. */
  const expectPlacementConsistent = async (studentProfileId: string, termId: string) => {
    const [enrollment, profile] = await Promise.all([
      raw.enrollment.findFirst({ where: { studentProfileId, termId, status: 'enrolled' } }),
      raw.studentProfile.findFirst({ where: { id: studentProfileId } }),
    ]);
    expect(enrollment).toBeTruthy();
    expect(profile).toBeTruthy();
    expect(profile!.currentClassId).toBe(enrollment!.classId);
    expect(profile!.currentSectionId).toBe(enrollment!.sectionId);
    expect(profile!.currentStreamId).toBe(enrollment!.streamId);
  };

  it('P5e: promotion carries section and stream, and the snapshot agrees', async () => {
    const s = await makeStudent(`P5E-${Date.now()}`, s1ClassId, s1SectionId);
    await setStream(s.id, s1StreamId);

    await asTenant(() =>
      promotion.promote({
        studentProfileId: s.id, toTermId: term2, toClassId: s2ClassId,
        toSectionId: s2SectionId, toStreamId: s2StreamId,
      }),
    );

    const next = await raw.enrollment.findFirst({ where: { studentProfileId: s.id, termId: term2 } });
    expect(next!.classId).toBe(s2ClassId);
    expect(next!.sectionId).toBe(s2SectionId);
    // The regression: this was NULL, because promoteOne never wrote streamId.
    expect(next!.streamId).toBe(s2StreamId);

    const profile = await raw.studentProfile.findFirst({ where: { id: s.id } });
    // The worse half: currentStreamId was left pointing at S1's stream while
    // currentClassId had already moved to S2.
    expect(profile!.currentStreamId).toBe(s2StreamId);
    expect(profile!.currentStreamId).not.toBe(s1StreamId);

    await expectPlacementConsistent(s.id, term2);
  });

  it('P5f: rollover resolves the subdivision by name inside the target class', async () => {
    const s = await makeStudent(`P5F-${Date.now()}`, s1ClassId, s1SectionId);
    await setStream(s.id, s1StreamId);

    const plan: any = await asTenant(() => promotion.rolloverTerm({ fromTermId: term1, toTermId: term2, dryRun: true }));
    const planned = plan.promote.find((p: any) => p.studentProfileId === s.id);
    expect(planned).toBeTruthy();
    // Resolved to the TARGET class's rows, never the source's.
    expect(planned.toSectionId).toBe(s2SectionId);
    expect(planned.toStreamId).toBe(s2StreamId);
    expect(planned.toSectionId).not.toBe(s1SectionId);
    expect(planned.subdivision).toBe('West');

    await asTenant(() => promotion.rolloverTerm({ fromTermId: term1, toTermId: term2, dryRun: false }));

    const next = await raw.enrollment.findFirst({ where: { studentProfileId: s.id, termId: term2 } });
    expect(next!.sectionId).toBe(s2SectionId);
    expect(next!.streamId).toBe(s2StreamId);
    await expectPlacementConsistent(s.id, term2);
  });

  it('P5g: a subdivision the target class does not define is dropped, and said so', async () => {
    // "East" exists only under S1. Promotion must not invent one under S2, and
    // must not silently drop it either — the plan has to state what was lost.
    const eastS1 = await raw.section.create({ data: { organizationId, classId: s1ClassId, name: 'East' } });
    const s = await makeStudent(`P5G-${Date.now()}`, s1ClassId, eastS1.id);

    const plan: any = await asTenant(() => promotion.rolloverTerm({ fromTermId: term1, toTermId: term2, dryRun: true }));
    const planned = plan.promote.find((p: any) => p.studentProfileId === s.id);
    expect(planned.toSectionId).toBeNull();
    expect(planned.reason).toContain('not defined in target class');
    expect(planned.reason).toContain('East');
  });

  it('P5h: INVARIANT — every active student\'s enrollment and snapshot agree', async () => {
    // Org-wide sweep. Any write path that moves a student without keeping the
    // two records in step fails here, including paths added later.
    const profiles = await raw.studentProfile.findMany({
      where: { organizationId, status: 'active' },
      select: { id: true, currentClassId: true, currentSectionId: true, currentStreamId: true },
    });
    expect(profiles.length).toBeGreaterThan(0);

    for (const p of profiles) {
      const current = await raw.enrollment.findFirst({
        where: { studentProfileId: p.id, status: 'enrolled' },
        orderBy: { enrolledAt: 'desc' },
      });
      if (!current) continue; // never enrolled — nothing to disagree with
      expect({ id: p.id, class: p.currentClassId, section: p.currentSectionId, stream: p.currentStreamId }).toEqual({
        id: p.id,
        class: current.classId,
        section: current.sectionId,
        stream: current.streamId,
      });
    }
  });
});
