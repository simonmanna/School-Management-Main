import {
  resolveAllowsSubdivision,
  validateSubdivision,
} from '../../src/modules/school/enrollment/subdivision';

/**
 * Subdivision rules (ADR-029) — the boolean that replaced GroupingMode.
 *
 * Replaces enrollment-grouping.spec.ts, which tested the four-valued mode and the
 * section/stream pairing rules. With one subdivision level those rules collapse
 * to: undivided classes take no section; divided classes with sections need one;
 * a section must belong to the learner's class and still be active.
 */
describe('validateSubdivision', () => {
  const P4 = 'class_p4';
  const north = { id: 'sec_north', classId: P4, name: 'North', isActive: true };
  const foreign = { id: 'sec_p5_north', classId: 'class_p5', name: 'North', isActive: true };
  const retired = { id: 'sec_old', classId: P4, name: 'Old West', isActive: false };

  const base = { allowsSubdivision: true, cohortClassId: P4, classHasActiveSections: true };

  it('accepts a section of the learner\'s own class', () => {
    const r = validateSubdivision({ ...base, sectionId: north.id, section: north });
    expect(r.ok).toBe(true);
    expect(r.value.sectionId).toBe(north.id);
  });

  it('refuses a section from another class — "P5 North" for a P4 learner', () => {
    const r = validateSubdivision({ ...base, sectionId: foreign.id, section: foreign });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/different class/);
  });

  it('refuses a section that cannot be found', () => {
    const r = validateSubdivision({ ...base, sectionId: 'missing', section: null });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/not found/);
  });

  it('refuses a deactivated section for new placements', () => {
    const r = validateSubdivision({ ...base, sectionId: retired.id, section: retired });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/deactivated/);
  });

  it('accepts a deactivated section when history is being repaired', () => {
    const r = validateSubdivision({ ...base, sectionId: retired.id, section: retired, allowInactive: true });
    expect(r.ok).toBe(true);
  });

  it('requires a section when the class is divided and has sections', () => {
    const r = validateSubdivision({ ...base, sectionId: null });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/choose one/);
  });

  it('allows a class-only placement when the divided class has no sections yet', () => {
    // Brief §10: the stream is optional. With nothing to choose, nothing is required.
    const r = validateSubdivision({ ...base, classHasActiveSections: false, sectionId: null });
    expect(r.ok).toBe(true);
    expect(r.value.sectionId).toBeNull();
  });

  it('refuses a section on an undivided class', () => {
    const r = validateSubdivision({
      allowsSubdivision: false,
      cohortClassId: P4,
      classHasActiveSections: false,
      sectionId: north.id,
      section: north,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/not divided/);
  });

  it('accepts an undivided class with no section', () => {
    const r = validateSubdivision({ allowsSubdivision: false, cohortClassId: P4, classHasActiveSections: false });
    expect(r.ok).toBe(true);
  });


  it('speaks the school\'s own word for a subdivision', () => {
    const r = validateSubdivision({ ...base, sectionId: null, label: 'House' });
    expect(r.errors.join(' ')).toMatch(/divided into houses/);
  });

  it('reports every problem at once', () => {
    const r = validateSubdivision({
      ...base,
      sectionId: retired.id,
      section: { ...retired, classId: 'class_p5' },
    });
    expect(r.errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe('resolveAllowsSubdivision', () => {
  it('lets the cohort override the class', () => {
    expect(resolveAllowsSubdivision({ cohortOverride: false, classAllowsStreams: true })).toBe(false);
    expect(resolveAllowsSubdivision({ cohortOverride: true, classAllowsStreams: false })).toBe(true);
  });

  it('follows the class when the cohort does not override', () => {
    expect(resolveAllowsSubdivision({ classAllowsStreams: false })).toBe(false);
    expect(resolveAllowsSubdivision({ classAllowsStreams: true })).toBe(true);
  });


  it('defaults to subdivided', () => {
    expect(resolveAllowsSubdivision({})).toBe(true);
  });
});
