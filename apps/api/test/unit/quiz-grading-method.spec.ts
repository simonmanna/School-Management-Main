/**
 * `pickAttemptScore` — which of a student's quiz attempts becomes the grade.
 *
 * The inline version this replaced read `first` as the LAST element and `last`
 * as the FIRST, over a query with no `orderBy` at all. Both were inverted, and
 * how wrong they were depended on the order Postgres happened to return rows
 * in. Every case below feeds attempts in shuffled order, so a regression that
 * relies on input order fails here rather than in a term's results.
 */
import { pickAttemptScore, type AttemptScore } from '../../src/modules/school/cbt/cbt-marking';

// Deliberately not in attempt order.
const shuffled: AttemptScore[] = [
  { attemptNumber: 3, score: 55 },
  { attemptNumber: 1, score: 40 },
  { attemptNumber: 2, score: 90 },
];

describe('pickAttemptScore', () => {
  it('takes the highest score by default', () => {
    expect(pickAttemptScore(shuffled, 'highest')).toBe(90);
  });

  it('takes the FIRST attempt by attempt number, not by row order', () => {
    expect(pickAttemptScore(shuffled, 'first')).toBe(40);
  });

  it('takes the LAST attempt by attempt number, not by row order', () => {
    expect(pickAttemptScore(shuffled, 'last')).toBe(55);
  });

  it('averages every attempt', () => {
    expect(pickAttemptScore(shuffled, 'average')).toBeCloseTo((40 + 90 + 55) / 3, 10);
  });

  it('is stable however the attempts are ordered on input', () => {
    const reversed = [...shuffled].reverse();
    const sortedAsc = [...shuffled].sort((a, b) => a.attemptNumber - b.attemptNumber);
    for (const method of ['highest', 'first', 'last', 'average'] as const) {
      expect(pickAttemptScore(reversed, method)).toBe(pickAttemptScore(sortedAsc, method));
      expect(pickAttemptScore(shuffled, method)).toBe(pickAttemptScore(sortedAsc, method));
    }
  });

  it('returns null when there is nothing to grade', () => {
    expect(pickAttemptScore([], 'highest')).toBeNull();
  });

  it('handles a single attempt under every method', () => {
    const one: AttemptScore[] = [{ attemptNumber: 1, score: 72 }];
    for (const method of ['highest', 'first', 'last', 'average'] as const) {
      expect(pickAttemptScore(one, method)).toBe(72);
    }
  });

  it('does not mutate the caller’s array', () => {
    const input = [...shuffled];
    pickAttemptScore(input, 'first');
    expect(input.map((a) => a.attemptNumber)).toEqual([3, 1, 2]);
  });
});
