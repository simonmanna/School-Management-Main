/**
 * Phase 1 — enrollment and grouping integrity, end to end.
 *
 * The exit gate this proves: **placement history, not the profile's current
 * class fields, can reconstruct every learner's placement for any effective
 * date.** Each scenario below is one row of the Phase 1 QA list — mid-term
 * stream change, transfer, late admission, repeater, withdrawn learner still
 * visible in an old roster, and no duplicate active placement.
 *
 * Runs only when DATABASE_URL is set (see _setup.ts).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
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
import { ProgrammeService } from '../../src/modules/school/enrollment/programme.service';
import { ClassCohortService } from '../../src/modules/school/enrollment/class-cohort.service';
import { StudentEnrollmentService } from '../../src/modules/school/enrollment/student-enrollment.service';
import { PlacementService } from '../../src/modules/school/enrollment/placement.service';
import { EnrollmentBackfillService } from '../../src/modules/school/enrollment/enrollment-backfill.service';

describeDb('integration: Phase 1 enrollment & placement (ADR-018 / ADR-019)', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let programmes: ProgrammeService;
  let cohorts: ClassCohortService;
  let enrollments: StudentEnrollmentService;
  let placements: PlacementService;
  let backfill: EnrollmentBackfillService;

  const organizationId = `org_enr_${Date.now()}`;
  const perms = [
    'school:read',
    'school:students:write',
    'school:enrollment:write',
    'school:programmes:write',
    'school:academics:migrate',
    'school:foundation:write',
  ];
  const asUser = <T>(userId: string, fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId, permissions: perms }, fn);

  let yearId = '';
  let nextYearId = '';
  let term1 = '';
  let term2 = '';
  let nextYearTerm1 = '';
  let gradeP5 = '';
  let gradeP6 = '';
  let classP5 = '';
  let classP6 = '';
  let sectionA = '';
  let sectionB = '';
  let streamRed = '';
  let otherClassSection = '';

  /** Create a pupil directly — Phase 1 owns membership, not registration. */
  const makeStudent = async (name: string) => {
    const partner = await raw.partner.create({
      data: { organizationId, code: `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, isCompany: false, isCustomer: true },
    });
    return raw.studentProfile.create({
      data: {
        organizationId,
        partnerId: partner.id,
        admissionNo: `ADM-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        enrollmentDate: new Date('2026-01-15'),
        status: 'active',
      },
    });
  };

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, organizationId);
    await raw.organization.create({ data: { id: organizationId, code: `ENR-${Date.now()}`, name: 'Enrollment School', currencyCode: 'UGX' } });
    await raw.schoolProfile.create({ data: { organizationId, name: 'Enrollment School', gradingSystem: 'UCE' } });

    const year = await raw.academicYear.create({
      data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'), isCurrent: true },
    });
    yearId = year.id;
    const nextYear = await raw.academicYear.create({
      data: { organizationId, name: '2027', startDate: new Date('2027-01-01'), endDate: new Date('2027-12-31') },
    });
    nextYearId = nextYear.id;

    term1 = (
      await raw.term.create({
        data: { organizationId, academicYearId: yearId, name: 'Term 1', startDate: new Date('2026-02-01'), endDate: new Date('2026-04-30'), isCurrent: true },
      })
    ).id;
    term2 = (
      await raw.term.create({
        data: { organizationId, academicYearId: yearId, name: 'Term 2', startDate: new Date('2026-05-15'), endDate: new Date('2026-08-15') },
      })
    ).id;
    nextYearTerm1 = (
      await raw.term.create({
        data: { organizationId, academicYearId: nextYearId, name: 'Term 1', startDate: new Date('2027-02-01'), endDate: new Date('2027-04-30') },
      })
    ).id;

    gradeP5 = (await raw.gradeLevel.create({ data: { organizationId, name: 'P5', order: 5 } })).id;
    gradeP6 = (await raw.gradeLevel.create({ data: { organizationId, name: 'P6', order: 6 } })).id;
    classP5 = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId: gradeP5, name: 'P5', capacity: 40 } })).id;
    classP6 = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId: gradeP6, name: 'P6', capacity: 40 } })).id;

    sectionA = (await raw.section.create({ data: { organizationId, classId: classP5, name: 'A' } })).id;
    sectionB = (await raw.section.create({ data: { organizationId, classId: classP5, name: 'B' } })).id;
    otherClassSection = (await raw.section.create({ data: { organizationId, classId: classP6, name: 'A' } })).id;
    streamRed = (await raw.stream.create({ data: { organizationId, classId: classP5, name: 'Red' } })).id;
    await raw.stream.create({ data: { organizationId, classId: classP5, name: 'Blue' } });

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    programmes = moduleRef.get(ProgrammeService);
    cohorts = moduleRef.get(ClassCohortService);
    enrollments = moduleRef.get(StudentEnrollmentService);
    placements = moduleRef.get(PlacementService);
    backfill = moduleRef.get(EnrollmentBackfillService);

    // Uganda programme templates: P5/P6 land in Upper Primary, and every later
    // rule reads the programme rather than the class name.
    await asUser('su', () => programmes.seedUganda({ linkGradeLevels: true }));
    await asUser('su', () => cohorts.generate({ academicYearId: yearId }));
    await asUser('su', () => cohorts.generate({ academicYearId: nextYearId }));
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  /* ───────────────────────── Programme configuration ───────────────────── */

  it('installs Uganda programme templates and links P5/P6 to Upper Primary', async () => {
    const list: any[] = await asUser('su', () => programmes.list());
    const codes = list.map((p) => p.code).sort();
    expect(codes).toEqual(['ADVANCED_SECONDARY', 'LOWER_SECONDARY', 'PRIMARY_LOWER', 'PRIMARY_UPPER']);

    const upper = list.find((p) => p.code === 'PRIMARY_UPPER');
    expect(upper.stage).toBe('PRIMARY_UPPER');
    expect(upper.curriculumAuthority).toBe('NCDC');
    const linkedGrades = upper.gradeLevels.map((g: any) => g.gradeLevel.name).sort();
    expect(linkedGrades).toEqual(['P5', 'P6']);

    // Lower primary carries "no ranking by default" as configuration, not code.
    const lower = list.find((p) => p.code === 'PRIMARY_LOWER');
    expect(lower.config.rankingEnabled).toBe(false);
    expect(lower.config.continuousObservation).toBe(true);
  });

  it('is idempotent: re-seeding does not create duplicate programmes', async () => {
    await asUser('su', () => programmes.seedUganda({ linkGradeLevels: true }));
    const list: any[] = await asUser('su', () => programmes.list());
    expect(list.filter((p) => p.code === 'PRIMARY_UPPER')).toHaveLength(1);
  });

  it('generates one cohort per class per academic year, and refuses a second', async () => {
    const list: any[] = await asUser('su', () => cohorts.list({ academicYearId: yearId }));
    expect(list.map((c) => c.classId).sort()).toEqual([classP5, classP6].sort());

    await expect(asUser('su', () => cohorts.create({ academicYearId: yearId, classId: classP5 }))).rejects.toThrow(
      /already exists/i,
    );
  });

  /* ─────────────────────────── Grouping integrity ──────────────────────── */

  it('refuses a section that belongs to another class', async () => {
    const student = await makeStudent('Wrong Section');
    const cohort: any = await asUser('su', () => cohorts.list({ academicYearId: yearId, classId: classP5 }));
    await expect(
      asUser('su', () =>
        enrollments.create({
          studentProfileId: student.id,
          academicYearId: yearId,
          placement: { termId: term1, classCohortId: cohort[0].id, sectionId: otherClassSection },
        }),
      ),
    ).rejects.toThrow(/different class/i);
  });

  it('refuses a stream when the cohort runs sections only', async () => {
    const student = await makeStudent('Wrong Stream');
    await expect(
      asUser('su', () =>
        enrollments.create({
          studentProfileId: student.id,
          academicYearId: yearId,
          placement: { termId: term1, classId: classP5, sectionId: sectionA, streamId: streamRed },
        }),
      ),
    ).rejects.toThrow(/sections only/i);
  });

  it('enforces section-and-stream nesting once the cohort switches mode', async () => {
    const p6Cohort: any = (await asUser('su', () => cohorts.list({ academicYearId: yearId, classId: classP6 })))[0];
    const secA = await raw.section.findFirst({ where: { classId: classP6, name: 'A' } });
    const p6StreamLoose = await raw.stream.create({ data: { organizationId, classId: classP6, name: 'Loose' } });
    await asUser('su', () => cohorts.update(p6Cohort.id, { groupingMode: 'SECTION_AND_STREAM' }));

    const student = await makeStudent('Nesting');
    // The stream is in the right class but hangs off no section.
    await expect(
      asUser('su', () =>
        enrollments.create({
          studentProfileId: student.id,
          academicYearId: yearId,
          placement: { termId: term1, classCohortId: p6Cohort.id, sectionId: secA!.id, streamId: p6StreamLoose.id },
        }),
      ),
    ).rejects.toThrow(/not attached to a section/i);

    // Attach it and the same placement is accepted.
    await asUser('su', () => cohorts.attachStreamToSection(p6StreamLoose.id, { sectionId: secA!.id }));
    const created: any = await asUser('su', () =>
      enrollments.create({
        studentProfileId: student.id,
        academicYearId: yearId,
        placement: { termId: term1, classCohortId: p6Cohort.id, sectionId: secA!.id, streamId: p6StreamLoose.id },
      }),
    );
    expect(created.placement.streamId).toBe(p6StreamLoose.id);

    // Put P6 back to sections only for the remaining scenarios.
    await asUser('su', () => enrollments.withdraw(created.enrollment.id, { reason: 'test cleanup' }));
    await asUser('su', () => cohorts.update(p6Cohort.id, { groupingMode: 'SECTION_ONLY' }));
  });

  it('refuses to attach a stream to a section of another class', async () => {
    await expect(
      asUser('su', () => cohorts.attachStreamToSection(streamRed, { sectionId: otherClassSection })),
    ).rejects.toThrow(/different class/i);
  });

  /* ──────────────────── Mid-term movement and history ──────────────────── */

  it('a mid-term section change end-dates the old placement instead of rewriting it', async () => {
    const student = await makeStudent('Mid Term Mover');
    const created: any = await asUser('su', () =>
      enrollments.create({
        studentProfileId: student.id,
        academicYearId: yearId,
        admissionDate: '2026-02-01T00:00:00.000Z',
        placement: { termId: term1, classId: classP5, sectionId: sectionA, rollNumber: '12', effectiveFrom: '2026-02-01T00:00:00.000Z' },
      }),
    );
    const enrollmentId = created.enrollment.id;

    await asUser('su', () =>
      placements.move(enrollmentId, {
        sectionId: sectionB,
        movementReason: 'SECTION_CHANGE',
        reason: 'Parent request',
        effectiveFrom: '2026-03-10T00:00:00.000Z',
      }),
    );

    const history: any[] = await asUser('su', () => placements.history(enrollmentId));
    expect(history).toHaveLength(2);
    expect(history[0].sectionId).toBe(sectionA);
    expect(history[0].effectiveTo?.toISOString()).toBe('2026-03-10T00:00:00.000Z');
    expect(history[0].endReason).toBe('SECTION_CHANGE');
    expect(history[1].sectionId).toBe(sectionB);
    expect(history[1].effectiveTo).toBeNull();
    // The roll number carries forward — a move is not a re-registration.
    expect(history[1].rollNumber).toBe('12');

    // ── The exit gate: reconstruct placement for any effective date. ──
    const inFeb: any = await asUser('su', () => placements.placementAt(student.id, new Date('2026-02-15')));
    const inApril: any = await asUser('su', () => placements.placementAt(student.id, new Date('2026-04-15')));
    expect(inFeb.sectionId).toBe(sectionA);
    expect(inApril.sectionId).toBe(sectionB);

    // Before they ever joined, there is no placement — not a stale guess.
    const inJan = await asUser('su', () => placements.placementAt(student.id, new Date('2026-01-05')));
    expect(inJan).toBeNull();

    // The profile projection follows the newest open placement.
    const profile = await raw.studentProfile.findFirst({ where: { id: student.id } });
    expect(profile!.currentSectionId).toBe(sectionB);
    expect(profile!.currentClassId).toBe(classP5);
  });

  it('never leaves two open placements on one enrollment', async () => {
    const student = await makeStudent('Single Seat');
    const created: any = await asUser('su', () =>
      enrollments.create({
        studentProfileId: student.id,
        academicYearId: yearId,
        placement: { termId: term1, classId: classP5, sectionId: sectionA },
      }),
    );
    for (const section of [sectionB, sectionA, sectionB]) {
      await asUser('su', () =>
        placements.move(created.enrollment.id, { sectionId: section, movementReason: 'SECTION_CHANGE', reason: 'shuffle' }),
      );
    }
    const open = await raw.enrollmentPlacement.count({ where: { enrollmentId: created.enrollment.id, effectiveTo: null } });
    expect(open).toBe(1);
    const all = await raw.enrollmentPlacement.count({ where: { enrollmentId: created.enrollment.id } });
    expect(all).toBe(4);
  });

  it('refuses a second membership for the same learner and academic year', async () => {
    const student = await makeStudent('Duplicate Year');
    await asUser('su', () =>
      enrollments.create({
        studentProfileId: student.id,
        academicYearId: yearId,
        placement: { termId: term1, classId: classP5, sectionId: sectionA },
      }),
    );
    await expect(
      asUser('su', () =>
        enrollments.create({
          studentProfileId: student.id,
          academicYearId: yearId,
          placement: { termId: term1, classId: classP5, sectionId: sectionB },
        }),
      ),
    ).rejects.toThrow(/already has a 2026 enrollment/i);
  });

  /* ───────────────────────── Transfer between classes ───────────────────── */

  it('transfers a learner between classes and keeps the old class in history', async () => {
    const student = await makeStudent('Class Transfer');
    const created: any = await asUser('su', () =>
      enrollments.create({
        studentProfileId: student.id,
        academicYearId: yearId,
        placement: { termId: term1, classId: classP5, sectionId: sectionA, effectiveFrom: '2026-02-01T00:00:00.000Z' },
      }),
    );
    const p6SectionA = await raw.section.findFirst({ where: { classId: classP6, name: 'A' } });

    await asUser('su', () =>
      placements.move(created.enrollment.id, {
        classId: classP6,
        sectionId: p6SectionA!.id,
        movementReason: 'CLASS_CHANGE',
        reason: 'Moved up after assessment',
        effectiveFrom: '2026-03-01T00:00:00.000Z',
      }),
    );

    const feb: any = await asUser('su', () => placements.placementAt(student.id, new Date('2026-02-10')));
    const mar: any = await asUser('su', () => placements.placementAt(student.id, new Date('2026-03-10')));
    expect(feb.classCohort.classId).toBe(classP5);
    expect(mar.classCohort.classId).toBe(classP6);
  });

  /* ───────────────── Late admission after assessments begin ─────────────── */

  it('records a late admission from the date the learner actually joined', async () => {
    const student = await makeStudent('Late Joiner');
    const created: any = await asUser('su', () =>
      enrollments.lateAdmission({
        studentProfileId: student.id,
        academicYearId: yearId,
        admissionDate: '2026-03-20T00:00:00.000Z',
        placement: { termId: term1, classId: classP5, sectionId: sectionA },
      }),
    );
    expect(created.placement.movementReason).toBe('LATE_ADMISSION');
    expect(created.placement.effectiveFrom.toISOString()).toBe('2026-03-20T00:00:00.000Z');

    // They are absent from a roster taken before they joined — which is exactly
    // what makes an earlier assessment roster still correct.
    const p5Cohort: any = (await asUser('su', () => cohorts.list({ academicYearId: yearId, classId: classP5 })))[0];
    const early = await asUser('su', () => placements.roster(p5Cohort.id, { at: new Date('2026-03-01') }));
    const late = await asUser('su', () => placements.roster(p5Cohort.id, { at: new Date('2026-04-01') }));
    expect(early.some((r: any) => r.studentProfileId === student.id)).toBe(false);
    expect(late.some((r: any) => r.studentProfileId === student.id)).toBe(true);
  });

  /* ─────────────────────── Withdrawal and re-entry ──────────────────────── */

  it('keeps a withdrawn learner in the roster that produced last term’s results', async () => {
    const student = await makeStudent('Withdrawn Pupil');
    const created: any = await asUser('su', () =>
      enrollments.create({
        studentProfileId: student.id,
        academicYearId: yearId,
        placement: { termId: term1, classId: classP5, sectionId: sectionA, effectiveFrom: '2026-02-01T00:00:00.000Z' },
      }),
    );
    await asUser('su', () =>
      enrollments.withdraw(created.enrollment.id, { reason: 'Family relocated', effectiveAt: '2026-04-01T00:00:00.000Z' }),
    );

    const p5Cohort: any = (await asUser('su', () => cohorts.list({ academicYearId: yearId, classId: classP5 })))[0];
    const duringTerm = await asUser('su', () => placements.roster(p5Cohort.id, { at: new Date('2026-03-01') }));
    const afterLeaving = await asUser('su', () => placements.roster(p5Cohort.id, { at: new Date('2026-05-01') }));
    expect(duringTerm.some((r: any) => r.studentProfileId === student.id)).toBe(true);
    expect(afterLeaving.some((r: any) => r.studentProfileId === student.id)).toBe(false);

    // No open placement, so no current class — a departed pupil is not counted.
    const profile = await raw.studentProfile.findFirst({ where: { id: student.id } });
    expect(profile!.currentClassId).toBeNull();
    expect(profile!.status).toBe('withdrawn');

    // Re-entry needs a placement; reinstating without one is refused.
    await expect(
      asUser('su', () => enrollments.changeStatus(created.enrollment.id, { toStatus: 'ACTIVE', reason: 'Returned' })),
    ).rejects.toThrow(/needs a placement/i);

    await asUser('su', () =>
      enrollments.changeStatus(created.enrollment.id, {
        toStatus: 'ACTIVE',
        reason: 'Returned in Term 2',
        placement: { termId: term2, classId: classP5, sectionId: sectionB, effectiveFrom: '2026-05-20T00:00:00.000Z' },
      }),
    );
    const back: any = await asUser('su', () => placements.placementAt(student.id, new Date('2026-06-01')));
    expect(back.sectionId).toBe(sectionB);
    // …and the withdrawn period stays a gap in history, not a rewrite.
    const gap = await asUser('su', () => placements.placementAt(student.id, new Date('2026-04-20')));
    expect(gap).toBeNull();
  });

  it('refuses an illegal status transition', async () => {
    const student = await makeStudent('Terminal State');
    const created: any = await asUser('su', () =>
      enrollments.create({
        studentProfileId: student.id,
        academicYearId: yearId,
        placement: { termId: term1, classId: classP5, sectionId: sectionA },
      }),
    );
    await asUser('su', () => enrollments.complete(created.enrollment.id, { reason: 'Finished the year' }));
    await expect(
      asUser('su', () => enrollments.changeStatus(created.enrollment.id, { toStatus: 'ACTIVE', reason: 'oops' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  /* ──────────────────────── Repeating and promotion ─────────────────────── */

  it('a repeater gets a new year’s enrollment at the same grade, both years intact', async () => {
    const student = await makeStudent('Repeater');
    const created: any = await asUser('su', () =>
      enrollments.create({
        studentProfileId: student.id,
        academicYearId: yearId,
        placement: { termId: term1, classId: classP5, sectionId: sectionA },
      }),
    );
    const repeated: any = await asUser('su', () =>
      enrollments.repeat(created.enrollment.id, {
        toAcademicYearId: nextYearId,
        toTermId: nextYearTerm1,
        sectionId: sectionA,
        reason: 'Did not meet promotion criteria',
      }),
    );

    expect(repeated.enrollment.enrollmentType).toBe('REPEAT');
    expect(repeated.enrollment.gradeLevelId).toBe(gradeP5);
    expect(repeated.enrollment.academicYearId).toBe(nextYearId);

    const all: any[] = await asUser('su', () => enrollments.forStudent(student.id));
    expect(all).toHaveLength(2);
    expect(all.map((e) => e.academicYear.name).sort()).toEqual(['2026', '2027']);
    expect(all.find((e) => e.academicYear.name === '2026').status).toBe('COMPLETED');
    expect(all.find((e) => e.academicYear.name === '2027').status).toBe('ACTIVE');
  });

  it('promotion follows the grade ladder into the next academic year', async () => {
    const student = await makeStudent('Promotable');
    const created: any = await asUser('su', () =>
      enrollments.create({
        studentProfileId: student.id,
        academicYearId: yearId,
        placement: { termId: term1, classId: classP5, sectionId: sectionA },
      }),
    );
    const promoted: any = await asUser('su', () =>
      enrollments.promote(created.enrollment.id, { toAcademicYearId: nextYearId, toTermId: nextYearTerm1 }),
    );
    expect(promoted.graduated).toBe(false);
    expect(promoted.enrollment.gradeLevelId).toBe(gradeP6);

    const placement: any = await asUser('su', () => placements.placementAt(student.id, new Date('2027-03-01')));
    expect(placement.classCohort.classId).toBe(classP6);
    expect(placement.movementReason).toBe('PROMOTION');
  });

  it('refuses to guess when a class has more than one section', async () => {
    // P5 has sections A and B. Promotion into it with no section named is
    // ambiguous, and the system asks rather than silently seating the learner.
    const student = await makeStudent('Ambiguous Section');
    const p6SectionA = await raw.section.findFirst({ where: { classId: classP6, name: 'A' } });
    const created: any = await asUser('su', () =>
      enrollments.create({
        studentProfileId: student.id,
        academicYearId: yearId,
        gradeLevelId: gradeP6,
        placement: { termId: term1, classId: classP6, sectionId: p6SectionA!.id },
      }),
    );
    await expect(
      asUser('su', () =>
        placements.move(created.enrollment.id, {
          classId: classP5,
          sectionId: null,
          movementReason: 'CLASS_CHANGE',
          reason: 'Moved down a class',
        }),
      ),
    ).rejects.toThrow(/choose a section/i);
  });

  it('completes rather than promotes a learner at the top grade', async () => {
    const student = await makeStudent('Top Grade');
    const p6SectionA = await raw.section.findFirst({ where: { classId: classP6, name: 'A' } });
    const created: any = await asUser('su', () =>
      enrollments.create({
        studentProfileId: student.id,
        academicYearId: yearId,
        placement: { termId: term1, classId: classP6, sectionId: p6SectionA!.id },
      }),
    );
    const result: any = await asUser('su', () =>
      enrollments.promote(created.enrollment.id, { toAcademicYearId: nextYearId, toTermId: nextYearTerm1 }),
    );
    expect(result.graduated).toBe(true);
    expect(result.enrollment.status).toBe('COMPLETED');
  });

  /* ────────────────────── Bulk placement and rollover ───────────────────── */

  it('bulk placement previews before it commits, and rejects the whole batch on error', async () => {
    const a = await makeStudent('Bulk A');
    const b = await makeStudent('Bulk B');
    const ids: string[] = [];
    for (const s of [a, b]) {
      const created: any = await asUser('su', () =>
        enrollments.create({
          studentProfileId: s.id,
          academicYearId: yearId,
          placement: { termId: term1, classId: classP5, sectionId: sectionA },
        }),
      );
      ids.push(created.enrollment.id);
    }

    const preview: any = await asUser('su', () =>
      placements.bulkPlace({
        termId: term1,
        movementReason: 'SECTION_CHANGE',
        reason: 'Balance the sections',
        dryRun: true,
        rows: ids.map((enrollmentId) => ({ enrollmentId, sectionId: sectionB })),
      }),
    );
    expect(preview.dryRun).toBe(true);
    expect(preview.ok).toBe(2);
    // Nothing was written.
    expect(await raw.enrollmentPlacement.count({ where: { enrollmentId: ids[0], sectionId: sectionB } })).toBe(0);

    // One bad row poisons the batch — nothing is half-applied.
    await expect(
      asUser('su', () =>
        placements.bulkPlace({
          termId: term1,
          movementReason: 'SECTION_CHANGE',
          reason: 'Balance the sections',
          rows: [
            { enrollmentId: ids[0], sectionId: sectionB },
            { enrollmentId: ids[1], sectionId: otherClassSection },
          ],
        }),
      ),
    ).rejects.toThrow(/nothing was saved/i);
    expect(await raw.enrollmentPlacement.count({ where: { enrollmentId: ids[0], sectionId: sectionB } })).toBe(0);

    const committed: any = await asUser('su', () =>
      placements.bulkPlace({
        termId: term1,
        movementReason: 'SECTION_CHANGE',
        reason: 'Balance the sections',
        rows: ids.map((enrollmentId) => ({ enrollmentId, sectionId: sectionB })),
      }),
    );
    expect(committed.committed).toBe(true);
    expect(committed.ok).toBe(2);
    for (const id of ids) {
      const open = await raw.enrollmentPlacement.findFirst({ where: { enrollmentId: id, effectiveTo: null } });
      expect(open!.sectionId).toBe(sectionB);
    }
  });

  it('rolls a cohort into the next term without changing the grouping', async () => {
    const student = await makeStudent('Rollover');
    const created: any = await asUser('su', () =>
      enrollments.create({
        studentProfileId: student.id,
        academicYearId: yearId,
        placement: { termId: term1, classId: classP5, sectionId: sectionA, effectiveFrom: '2026-02-01T00:00:00.000Z' },
      }),
    );
    const p5Cohort: any = (await asUser('su', () => cohorts.list({ academicYearId: yearId, classId: classP5 })))[0];

    const dry: any = await asUser('su', () =>
      placements.termRollover({ fromTermId: term1, toTermId: term2, classCohortId: p5Cohort.id, dryRun: true }),
    );
    expect(dry.dryRun).toBe(true);
    expect(dry.eligible).toBeGreaterThan(0);

    await asUser('su', () => placements.termRollover({ fromTermId: term1, toTermId: term2, classCohortId: p5Cohort.id }));
    const open = await raw.enrollmentPlacement.findFirst({ where: { enrollmentId: created.enrollment.id, effectiveTo: null } });
    expect(open!.termId).toBe(term2);
    expect(open!.sectionId).toBe(sectionA);
    expect(open!.movementReason).toBe('TERM_ROLLOVER');
  });

  it('refuses a rollover across academic years', async () => {
    await expect(
      asUser('su', () => placements.termRollover({ fromTermId: term2, toTermId: nextYearTerm1 })),
    ).rejects.toThrow(/SAME academic year/i);
  });

  /* ─────────────────── Backfill, reconciliation, rollback ───────────────── */

  it('backfills legacy enrollments, reconciles clean, and rolls back only its own rows', async () => {
    const student = await makeStudent('Legacy Pupil');
    const legacy = await raw.enrollment.create({
      data: {
        organizationId,
        studentProfileId: student.id,
        classId: classP5,
        sectionId: sectionA,
        termId: term1,
        rollNumber: '77',
        effectiveDate: new Date('2026-02-01'),
        status: 'enrolled',
      },
    });

    const dry: any = await asUser('su', () => backfill.run({ dryRun: true, academicYearId: yearId }));
    expect(dry.dryRun).toBe(true);
    expect(dry.candidates).toBeGreaterThanOrEqual(1);
    expect(await raw.enrollmentPlacement.count({ where: { legacyEnrollmentId: legacy.id } })).toBe(0);

    const runId = `test-run-${Date.now()}`;
    const applied: any = await asUser('su', () =>
      backfill.run({ dryRun: false, academicYearId: yearId, migrationRunId: runId }),
    );
    expect(applied.placementsCreated).toBeGreaterThanOrEqual(1);
    expect(applied.exceptions).toHaveLength(0);

    const placement = await raw.enrollmentPlacement.findFirst({ where: { legacyEnrollmentId: legacy.id } });
    expect(placement).toBeTruthy();
    expect(placement!.sectionId).toBe(sectionA);
    expect(placement!.rollNumber).toBe('77');
    expect(placement!.migrationRunId).toBe(runId);

    const reconciliation: any = await asUser('su', () => backfill.reconcile(yearId));
    expect(reconciliation.unmappedRows).toBe(0);
    expect(reconciliation.differenceCount).toBe(0);
    expect(reconciliation.duplicateOpenPlacements).toHaveLength(0);
    expect(reconciliation.clean).toBe(true);

    // Re-running is a no-op: the unique legacy key makes it idempotent.
    const rerun: any = await asUser('su', () => backfill.run({ dryRun: false, academicYearId: yearId, migrationRunId: runId }));
    expect(rerun.placementsCreated).toBe(0);
    expect(await raw.enrollmentPlacement.count({ where: { legacyEnrollmentId: legacy.id } })).toBe(1);

    const rolledBack: any = await asUser('su', () => backfill.rollback(runId));
    expect(rolledBack.deletedPlacements).toBeGreaterThanOrEqual(1);
    expect(await raw.enrollmentPlacement.count({ where: { legacyEnrollmentId: legacy.id } })).toBe(0);
  });

  it('sends an unmappable legacy row to the exception queue instead of dropping it', async () => {
    const orphanGrade = await raw.gradeLevel.create({ data: { organizationId, name: 'X9', order: 99 } });
    const orphanClass = await raw.schoolClass.create({ data: { organizationId, gradeLevelId: orphanGrade.id, name: 'X9 Orphan' } });
    const student = await makeStudent('Orphan Pupil');
    const legacy = await raw.enrollment.create({
      data: {
        organizationId,
        studentProfileId: student.id,
        classId: orphanClass.id,
        termId: term1,
        rollNumber: '1',
        effectiveDate: new Date('2026-02-01'),
        status: 'enrolled',
      },
    });

    const runId = `test-exceptions-${Date.now()}`;
    const applied: any = await asUser('su', () =>
      backfill.run({ dryRun: false, academicYearId: yearId, migrationRunId: runId }),
    );
    expect(applied.exceptions.some((e: any) => e.sourceId === legacy.id)).toBe(true);

    const queue: any[] = await asUser('su', () => backfill.listExceptions({ migrationRunId: runId, resolved: false }));
    const row = queue.find((q) => q.sourceId === legacy.id);
    expect(row).toBeTruthy();
    expect(row.reason).toMatch(/no academic programme/i);

    const resolved: any = await asUser('su', () => backfill.resolveException(row.id, { resolutionNote: 'Class retired; not migrated.' }));
    expect(resolved.resolvedAt).toBeTruthy();

    await asUser('su', () => backfill.rollback(runId)).catch(() => undefined);
  });
});
