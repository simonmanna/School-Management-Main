/**
 * A `PlacementLookupService` stand-in for unit specs.
 *
 * Billing, meals and statutory now ask placement history where a learner sits,
 * instead of reading `StudentProfile.currentClassId` (ADR-027). Their unit specs
 * construct the service directly with mocks, so they need something to pass for
 * that dependency.
 *
 * `attach` reads `placement` straight off each fixture. That keeps the fixture
 * honest: it states the placement the code under test will actually read, rather
 * than a `currentClassId` the production path no longer looks at. A fixture with
 * no `placement` resolves to null, which is how these services see a learner who
 * has not been placed for the term.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface StubPlacement {
  classId: string;
  gradeLevelId?: string;
  sectionId?: string | null;
  enrollmentId?: string;
  placementId?: string;
  classCohortId?: string;
  academicYearId?: string;
  termId?: string;
  rollNumber?: string | null;
}

/** A placement shaped like `ResolvedPlacement`, with test-friendly defaults. */
export function placement(p: StubPlacement): Record<string, unknown> {
  return {
    enrollmentId: p.enrollmentId ?? `enr_${p.classId}`,
    placementId: p.placementId ?? `plc_${p.classId}`,
    classCohortId: p.classCohortId ?? `coh_${p.classId}`,
    classId: p.classId,
    sectionId: p.sectionId ?? null,
    streamId: null,
    gradeLevelId: p.gradeLevelId ?? `grade_of_${p.classId}`,
    academicYearId: p.academicYearId ?? 'ay_test',
    termId: p.termId ?? 'term_test',
    rollNumber: p.rollNumber ?? null,
  };
}

/**
 * The stub itself.
 *
 * `studentWhere` returns a marker rather than `{}`: a spec asserting on the
 * `where` passed to `findMany` can then see that a class filter was applied at
 * all, which an empty object would hide.
 */
export function makePlacementLookupStub() {
  const where = (target: any, at: any = {}) =>
    target && Object.keys(target).length > 0 ? { __placementTarget: { target, at } } : {};
  const attach = async (students: any[]) =>
    students.map((s) => ({
      ...s,
      placement: s.placement ?? null,
      placementSource: s.placement ? 'placement' : 'none',
    }));

  return {
    studentWhere: jest.fn(where),
    attach: jest.fn(attach),
    resolve: jest.fn(async (ids: string[]) => new Map(ids.map((id) => [id, null]))),
    studentIdsIn: jest.fn(async () => [] as string[]),
    describe: jest.fn(async (ids: string[]) => new Map(ids.map((id) => [id, undefined]))),
  };
}
