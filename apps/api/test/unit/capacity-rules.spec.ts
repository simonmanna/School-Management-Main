import {
  describeViolation,
  projectBatch,
  seatViolation,
} from '../../src/modules/school/enrollment/capacity';

/** Capacity rules (ADR-030, brief §11). */
describe('seatViolation', () => {
  const section = (capacity: number | null, occupiedByOthers: number) => ({
    kind: 'section' as const,
    id: 's1',
    name: 'North',
    capacity,
    occupiedByOthers,
  });

  it('never fires for unlimited capacity', () => {
    expect(seatViolation(section(null, 10_000))).toBeNull();
  });

  it('allows the last seat', () => {
    expect(seatViolation(section(30, 29))).toBeNull();
  });

  it('refuses the seat after the last one', () => {
    const v = seatViolation(section(30, 30));
    expect(v).toEqual({ kind: 'section', id: 's1', name: 'North', capacity: 30, occupied: 30 });
  });

  it('does not count the learner against a seat they already hold', () => {
    // A section change inside a full class: 30/30 including this learner means
    // 29 others, so moving them within the class is fine.
    expect(seatViolation(section(30, 29))).toBeNull();
  });

  it('describes a violation in the school\'s own words', () => {
    const v = seatViolation(section(30, 30))!;
    expect(describeViolation(v, 'House')).toBe('House "North" is full (30/30).');
    expect(describeViolation({ ...v, kind: 'class', name: 'P4' })).toBe('Class "P4" is full (30/30).');
  });
});

describe('projectBatch', () => {
  it('catches the overflow that row-by-row checking lets through', () => {
    // 41 learners into an empty class of 40: every row passes alone.
    const [p] = projectBatch([
      { kind: 'class', id: 'c', name: 'P4', capacity: 40, openNow: 0, incoming: 41 },
    ]);
    expect(p.after).toBe(41);
    expect(p.overflow).toBe(1);
  });

  it('reports each target separately', () => {
    const out = projectBatch([
      { kind: 'section', id: 'n', name: 'North', capacity: 30, openNow: 25, incoming: 5 },
      { kind: 'section', id: 's', name: 'South', capacity: 30, openNow: 28, incoming: 5 },
      { kind: 'section', id: 'e', name: 'East', capacity: null, openNow: 90, incoming: 50 },
    ]);
    expect(out.map((o) => o.overflow)).toEqual([0, 3, 0]);
  });
});
