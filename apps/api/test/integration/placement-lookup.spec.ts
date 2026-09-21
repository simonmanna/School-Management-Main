/**
 * PlacementLookupService against a real database (ADR-027).
 *
 * This spec exists because its absence let two bugs through wave 1:
 *
 *   1. `studentWhere` joined `StudentProfile.enrollments` — the LEGACY
 *      `Enrollment` relation, which has no `placements`. Any caller that passed a
 *      class filter would have thrown at runtime. The fee and statutory suites
 *      stayed green because none of them bills or exports by class.
 *   2. `studentWhere` returned a bare `OR`, and catalog then set its own
 *      `where.OR` for the search box, silently discarding the class filter.
 *
 * Every assertion here exercises the class-filter path those suites skipped.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';
import { ensureAcademicSpine, linkLearner, type AcademicSpine } from './_placement';
import { KernelModule } from '../../src/kernel/kernel.module';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';
import { PrismaService } from '../../src/kernel/prisma/prisma.service';
import { PlacementLookupModule } from '../../src/modules/school/enrollment/placement-lookup.module';
import { PlacementLookupService } from '../../src/modules/school/enrollment/placement-lookup.service';

describeDb('integration: PlacementLookupService (ADR-027)', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let prisma: PrismaService;
  let lookup: PlacementLookupService;

  const organizationId = `org_lookup_${Date.now()}`;
  const as = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId: 'user_lookup', permissions: ['school:read'] }, fn);

  let p4: AcademicSpine;
  let p5: AcademicSpine;
  let placedInP4 = '';
  let unplacedOnProjection = '';
  let movedWithStaleProjection = '';
  let movedMidTerm = '';
  const moveDate = new Date('2026-03-01T00:00:00Z');

  async function learner(code: string, name: string): Promise<string> {
    const partner = await raw.partner.create({
      data: { organizationId, code: `${code}-${Date.now()}`, name },
    });
    const s = await raw.studentProfile.create({
      data: {
        organizationId,
        partnerId: partner.id,
        admissionNo: `${code}-${Date.now()}`,
        enrollmentDate: new Date('2026-01-10'),
        status: 'active',
      },
    });
    return s.id;
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, PlacementLookupModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    prisma = moduleRef.get(PrismaService);
    lookup = moduleRef.get(PlacementLookupService);

    await raw.organization.upsert({
      where: { id: organizationId },
      update: {},
      create: { id: organizationId, name: 'Lookup spec', code: organizationId },
    });

    p4 = await ensureAcademicSpine(raw, {
      organizationId,
      yearName: '2026',
      gradeName: 'P4',
      gradeOrder: 4,
      className: 'P4',
      sectionName: 'North',
    });
    p5 = await ensureAcademicSpine(raw, {
      organizationId,
      yearName: '2026',
      gradeName: 'P5',
      gradeOrder: 5,
      className: 'P5',
      sectionName: 'North',
    });

    // A: placed in P4 through placement history.
    placedInP4 = await learner('A', 'Brian Okello');
    await linkLearner(raw, { spine: p4, studentProfileId: placedInP4, effectiveFrom: new Date('2026-01-15') });

    // B: never placed; only the projection says P4. The compat path must keep
    // finding them, or un-backfilled schools stop billing.
    unplacedOnProjection = await learner('B', 'Sarah Namusoke');
    await raw.studentProfile.update({
      where: { id: unplacedOnProjection },
      data: { currentClassId: p4.classId },
    });

    // C: placed in P5, but the projection still (wrongly) says P4. Matching them
    // under P4 would bill them twice — once correctly, once through staleness.
    movedWithStaleProjection = await learner('C', 'Daniel Kato');
    await linkLearner(raw, { spine: p5, studentProfileId: movedWithStaleProjection, effectiveFrom: new Date('2026-01-15') });
    await raw.studentProfile.update({
      where: { id: movedWithStaleProjection },
      data: { currentClassId: p4.classId },
    });

    // D: P4 until 1 March, then P5. The effective-dating case.
    movedMidTerm = await learner('D', 'Martha Nakato');
    await linkLearner(raw, { spine: p4, studentProfileId: movedMidTerm, effectiveFrom: new Date('2026-01-15') });
    await linkLearner(raw, { spine: p5, studentProfileId: movedMidTerm, effectiveFrom: moveDate });
  });

  afterAll(async () => {
    await raw.$disconnect();
    await moduleRef?.close();
  });

  const idsWhere = async (where: object): Promise<string[]> =>
    as(async () =>
      (
        await prisma.client.studentProfile.findMany({
          where: { status: 'active', ...where },
          select: { id: true },
        })
      )
        .map((s) => s.id)
        .sort(),
    );

  it('filters by class through placement history without throwing', async () => {
    // The wave-1 bug: this call joined the legacy relation and threw.
    const ids = await idsWhere(lookup.studentWhere({ classIds: [p4.classId] }, { asOf: new Date('2026-02-01') }));
    expect(ids).toEqual([movedMidTerm, placedInP4].sort());
  });

  it('includes un-backfilled learners on the compat path, but never a moved learner twice', async () => {
    const ids = await idsWhere(
      lookup.studentWhere({ classIds: [p4.classId] }, { asOf: new Date('2026-02-01') }),
    );
    expect(ids).toContain(placedInP4);
    expect(ids).toContain(unplacedOnProjection);
    // C has a placement in P5; the stale P4 projection must not drag them in.
    expect(ids).not.toContain(movedWithStaleProjection);
  });

  it('survives being merged into a where that already has its own OR', async () => {
    // The catalog shape: class filter plus a search box that sets `OR`.
    const where: Record<string, unknown> = {
      ...lookup.studentWhere({ classIds: [p4.classId] }),
    };
    where.OR = [{ admissionNo: { contains: 'C-' } }, { admissionNo: { contains: 'A-' } }];
    const ids = await idsWhere(where);
    // C matches the search but is not in P4. A bare OR from the compat helper
    // would have been overwritten and C would appear here.
    expect(ids).toEqual([placedInP4]);
  });

  it('answers "where was this learner on a given date", not only today', async () => {
    const before = await as(() => lookup.resolve([movedMidTerm], { asOf: new Date('2026-02-15') }));
    const after = await as(() => lookup.resolve([movedMidTerm], { asOf: new Date('2026-03-15') }));
    expect(before.get(movedMidTerm)?.classId).toBe(p4.classId);
    expect(after.get(movedMidTerm)?.classId).toBe(p5.classId);
  });

  it('reports which source each attached placement came from', async () => {
    const rows = await as(async () =>
      lookup.attach(
        await prisma.client.studentProfile.findMany({
          where: { id: { in: [placedInP4, unplacedOnProjection] } },
        }),
      ),
    );
    const bySource = Object.fromEntries(rows.map((r) => [r.id, r.placementSource]));
    expect(bySource[placedInP4]).toBe('placement');
    expect(bySource[unplacedOnProjection]).toBe('projection');
  });

  it('counts class sizes from placements and the projection without double counting', async () => {
    const sizes = await as(() => lookup.classSizes([p4.classId, p5.classId]));
    // P4 today: A (placed) + B (projection only). C and D have moved to P5.
    expect(sizes.get(p4.classId)).toBe(2);
    expect(sizes.get(p5.classId)).toBe(2);
  });

  it('builds a roster with subdivision names', async () => {
    const roster = await as(() => lookup.roster({ classIds: [p4.classId] }));
    const a = roster.find((r) => r.student.id === placedInP4);
    expect(a?.sectionId).toBe(p4.sectionId);
    expect(a?.subdivisionName).toBe('North');
  });

  it('sees nothing belonging to another school', async () => {
    const otherOrg = `${organizationId}_other`;
    const ids = await tenant.run(
      { organizationId: otherOrg, userId: 'intruder', permissions: ['school:read'] },
      async () =>
        (
          await prisma.client.studentProfile.findMany({
            where: lookup.studentWhere({ classIds: [p4.classId] }),
            select: { id: true },
          })
        ).map((s) => s.id),
    );
    expect(ids).toEqual([]);
  });
  it('finds a closed placement when asked about its term', async () => {
    // Billing or reporting a PAST term: the placement was closed at rollover, so
    // it is not effective "now". Without a date the term alone must answer, or a
    // past term silently resolves to today's class.
    const term2 = await raw.term.create({
      data: {
        organizationId,
        academicYearId: p4.academicYearId,
        name: `Term 2 ${Date.now()}`,
        startDate: new Date('2026-05-15'),
        endDate: new Date('2026-08-15'),
      },
    });
    const pupil = await learner('E', 'Grace Achieng');
    await linkLearner(raw, { spine: p4, studentProfileId: pupil, effectiveFrom: new Date('2026-01-15') });
    // Rollover into term 2 in P5 closes the term-1 placement.
    await linkLearner(raw, {
      spine: { ...p5, termId: term2.id },
      studentProfileId: pupil,
      effectiveFrom: new Date('2026-05-15'),
    });

    const term1 = await as(() => lookup.resolve([pupil], { termId: p4.termId }));
    const term2Res = await as(() => lookup.resolve([pupil], { termId: term2.id }));
    expect(term1.get(pupil)?.classId).toBe(p4.classId);
    expect(term2Res.get(pupil)?.classId).toBe(p5.classId);
  });
});
