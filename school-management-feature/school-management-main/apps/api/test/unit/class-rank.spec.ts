/**
 * Unit tests for competition ranking (P0-5, C5).
 *
 * Bug: the rank was computed with `Array.findIndex`, which returns
 * the position of the first match — i.e. ordinal ranking. Two students
 * with the same GPA could receive different ranks on different
 * report-card regenerations, and the "competition" semantics that the
 * school expects (1, 2, 2, 4) were never produced.
 *
 * Fix: walk the sorted-descending list and only increment the rank
 * when the score changes. Ties get the same rank, the next rank skips.
 *
 * Returns null if the target student isn't in the list.
 */
import { GradingService } from '../../src/modules/school/examinations/grading.service';

describe('competitionRank (P0-5, C5 — class rank for ties)', () => {
  it('returns null for an empty list', () => {
    expect(GradingService.competitionRank([], 'stu_1')).toBeNull();
  });

  it('returns 1 for a single student', () => {
    expect(GradingService.competitionRank([['stu_1', 3.5]], 'stu_1')).toBe(1);
  });

  it('assigns 1, 2, 3 for three distinct scores', () => {
    const sorted: Array<[string, number]> = [
      ['stu_a', 4.0],
      ['stu_b', 3.0],
      ['stu_c', 2.0],
    ];
    expect(GradingService.competitionRank(sorted, 'stu_a')).toBe(1);
    expect(GradingService.competitionRank(sorted, 'stu_b')).toBe(2);
    expect(GradingService.competitionRank(sorted, 'stu_c')).toBe(3);
  });

  it('assigns 1, 1, 1 when all three students tie', () => {
    const sorted: Array<[string, number]> = [
      ['stu_a', 3.5],
      ['stu_b', 3.5],
      ['stu_c', 3.5],
    ];
    expect(GradingService.competitionRank(sorted, 'stu_a')).toBe(1);
    expect(GradingService.competitionRank(sorted, 'stu_b')).toBe(1);
    expect(GradingService.competitionRank(sorted, 'stu_c')).toBe(1);
  });

  it('produces competition ranking 1, 2, 2, 4 for two-way tie at rank 2', () => {
    // Two students share the top GPA, the third is alone at second, fourth alone at third.
    const sorted: Array<[string, number]> = [
      ['stu_top1', 4.0],
      ['stu_top2', 4.0],
      ['stu_mid',  3.0],
      ['stu_low',  2.0],
    ];
    expect(GradingService.competitionRank(sorted, 'stu_top1')).toBe(1);
    expect(GradingService.competitionRank(sorted, 'stu_top2')).toBe(1);
    expect(GradingService.competitionRank(sorted, 'stu_mid')).toBe(3);
    expect(GradingService.competitionRank(sorted, 'stu_low')).toBe(4);
  });

  it('produces 1, 2, 2, 4 for a two-way tie in the middle', () => {
    // Top, two tied in the middle, bottom.
    const sorted: Array<[string, number]> = [
      ['stu_a', 4.0],
      ['stu_b', 3.0],
      ['stu_c', 3.0],
      ['stu_d', 2.0],
    ];
    expect(GradingService.competitionRank(sorted, 'stu_a')).toBe(1);
    expect(GradingService.competitionRank(sorted, 'stu_b')).toBe(2);
    expect(GradingService.competitionRank(sorted, 'stu_c')).toBe(2);
    expect(GradingService.competitionRank(sorted, 'stu_d')).toBe(4);
  });

  it('produces 1, 2, 2, 2, 5 for a three-way tie in the middle', () => {
    const sorted: Array<[string, number]> = [
      ['stu_a', 4.0],
      ['stu_b', 3.0],
      ['stu_c', 3.0],
      ['stu_d', 3.0],
      ['stu_e', 2.0],
    ];
    expect(GradingService.competitionRank(sorted, 'stu_a')).toBe(1);
    expect(GradingService.competitionRank(sorted, 'stu_b')).toBe(2);
    expect(GradingService.competitionRank(sorted, 'stu_c')).toBe(2);
    expect(GradingService.competitionRank(sorted, 'stu_d')).toBe(2);
    expect(GradingService.competitionRank(sorted, 'stu_e')).toBe(5);
  });

  it('returns null when the target student is not in the list', () => {
    const sorted: Array<[string, number]> = [
      ['stu_a', 4.0],
      ['stu_b', 3.0],
    ];
    expect(GradingService.competitionRank(sorted, 'stu_ghost')).toBeNull();
  });

  it('handles floating-point scores (does not collapse ties to false positives)', () => {
    // 3.3333... ≠ 3.333333 — these should NOT be tied.
    const sorted: Array<[string, number]> = [
      ['stu_a', 4.0],
      ['stu_b', 3.333_333_4],
      ['stu_c', 3.333_333_3],
    ];
    expect(GradingService.competitionRank(sorted, 'stu_a')).toBe(1);
    expect(GradingService.competitionRank(sorted, 'stu_b')).toBe(2);
    expect(GradingService.competitionRank(sorted, 'stu_c')).toBe(3);
  });

  it('treats exact equal scores as tied even when the input order varies', () => {
    // Same set, different ordering — same ranks.
    const a: Array<[string, number]> = [
      ['stu_x', 4.0],
      ['stu_y', 4.0],
      ['stu_z', 2.0],
    ];
    const b: Array<[string, number]> = [
      ['stu_y', 4.0],
      ['stu_x', 4.0],
      ['stu_z', 2.0],
    ];
    expect(GradingService.competitionRank(a, 'stu_x')).toBe(GradingService.competitionRank(b, 'stu_x'));
    expect(GradingService.competitionRank(a, 'stu_y')).toBe(GradingService.competitionRank(b, 'stu_y'));
    expect(GradingService.competitionRank(a, 'stu_z')).toBe(3);
  });
});
