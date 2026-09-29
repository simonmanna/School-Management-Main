/**
 * Unit tests for competition ranking (P0-5, C5; consolidated Wave 16).
 *
 * Bug: the rank was computed with `Array.findIndex`, which returns
 * the position of the first match — i.e. ordinal ranking. Two students
 * with the same GPA could receive different ranks on different
 * report-card regenerations, and the "competition" semantics that the
 * school expects (1, 2, 2, 4) were never produced.
 *
 * Fix: only advance the rank when the score changes. Ties share a rank, the
 * next rank skips.
 *
 * Wave 16: these cases used to exercise a second copy
 * (`GradingService.competitionRank`) that nothing in production called. They
 * now pin `assignCompetitionRanks`, the function `computeResultSet` uses for
 * the class and subject positions printed on report cards.
 */
import { Prisma } from '@prisma/client';
import { assignCompetitionRanks } from '../../src/modules/school/assessment/result-computation';

const ranks = (scores: Array<[string, number | null]>, order: 'asc' | 'desc' = 'desc') =>
  Object.fromEntries(assignCompetitionRanks(scores.map(([id, value]) => ({ id, value })), order));

describe('assignCompetitionRanks (P0-5, C5 — class rank for ties)', () => {
  it('ranks nobody in an empty list', () => {
    expect(ranks([])).toEqual({});
  });

  it('returns 1 for a single student', () => {
    expect(ranks([['stu_1', 3.5]])).toEqual({ stu_1: 1 });
  });

  it('assigns 1, 2, 3 for three distinct scores', () => {
    expect(ranks([['stu_a', 4.0], ['stu_b', 3.0], ['stu_c', 2.0]])).toEqual({ stu_a: 1, stu_b: 2, stu_c: 3 });
  });

  it('assigns 1, 1, 1 when all three students tie', () => {
    expect(ranks([['stu_a', 3.5], ['stu_b', 3.5], ['stu_c', 3.5]])).toEqual({ stu_a: 1, stu_b: 1, stu_c: 1 });
  });

  it('produces 1, 1, 3, 4 for a tie at the top', () => {
    expect(ranks([['stu_top1', 4.0], ['stu_top2', 4.0], ['stu_mid', 3.0], ['stu_low', 2.0]])).toEqual({
      stu_top1: 1,
      stu_top2: 1,
      stu_mid: 3,
      stu_low: 4,
    });
  });

  it('produces 1, 2, 2, 4 for a two-way tie in the middle', () => {
    expect(ranks([['stu_a', 4.0], ['stu_b', 3.0], ['stu_c', 3.0], ['stu_d', 2.0]])).toEqual({
      stu_a: 1,
      stu_b: 2,
      stu_c: 2,
      stu_d: 4,
    });
  });

  it('produces 1, 2, 2, 2, 5 for a three-way tie in the middle', () => {
    expect(ranks([['stu_a', 4.0], ['stu_b', 3.0], ['stu_c', 3.0], ['stu_d', 3.0], ['stu_e', 2.0]])).toEqual({
      stu_a: 1,
      stu_b: 2,
      stu_c: 2,
      stu_d: 2,
      stu_e: 5,
    });
  });

  it('leaves a student with no score unranked, without taking a position', () => {
    expect(ranks([['stu_a', 4.0], ['stu_ghost', null], ['stu_b', 3.0]])).toEqual({ stu_a: 1, stu_b: 2 });
  });

  it('handles floating-point scores (does not collapse near values into a tie)', () => {
    expect(ranks([['stu_a', 4.0], ['stu_b', 3.333_333_4], ['stu_c', 3.333_333_3]])).toEqual({
      stu_a: 1,
      stu_b: 2,
      stu_c: 3,
    });
  });

  it('gives the same ranks whatever order the input arrives in', () => {
    const a = ranks([['stu_x', 4.0], ['stu_y', 4.0], ['stu_z', 2.0]]);
    const b = ranks([['stu_z', 2.0], ['stu_y', 4.0], ['stu_x', 4.0]]);
    expect(a).toEqual(b);
    expect(a).toEqual({ stu_x: 1, stu_y: 1, stu_z: 3 });
  });

  it('ranks ascending for aggregates, where lower is better (UNEB PLE)', () => {
    expect(ranks([['stu_a', 12], ['stu_b', 4], ['stu_c', 12], ['stu_d', 30]], 'asc')).toEqual({
      stu_b: 1,
      stu_a: 2,
      stu_c: 2,
      stu_d: 4,
    });
  });

  it('accepts Decimal values and compares them exactly', () => {
    const out = assignCompetitionRanks(
      [
        { id: 'a', value: new Prisma.Decimal('71.50') },
        { id: 'b', value: new Prisma.Decimal('71.5') },
        { id: 'c', value: new Prisma.Decimal('80') },
      ],
      'desc',
    );
    expect(Object.fromEntries(out)).toEqual({ c: 1, a: 2, b: 2 });
  });
});
