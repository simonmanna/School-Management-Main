import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/** Percentage = marks / maxMarks * 100, in exact Decimal (never JS float). */
export function percent(marks: Prisma.Decimal.Value, maxMarks: Prisma.Decimal.Value): Decimal {
  const max = new D(maxMarks);
  if (max.isZero()) return new D(0);
  return new D(marks).div(max).mul(100);
}

/**
 * GradingService — pure functions for letter grade, GPA, class rank.
 *
 * Extracted from examinations.service.ts into its own file so that
 * GradeEntryService (which references GradingService at construction
 * time) doesn't hit a circular-reference / TDZ error when both live
 * in the same module file.
 *
 * Supports three Uganda-specific scales:
 *   - UCE (Uganda Certificate of Education, Senior 4) — D1..F9, 9-point
 *   - UACE (Uganda Advanced Certificate of Education, Senior 6) — A..O, 6-point
 *   - CBC (Competency-Based Curriculum) — generic 4-level rubric
 *
 * Plus a legacy 9-point default used by schools that haven't customised.
 */
export interface GradeBand {
  min: number;
  max: number;
  grade: string;
  gpa: number;
  /** For UCE/UACE, the "points" used in aggregates (lower = better). */
  points?: number;
  remark?: string;
}

export type GradingSystem = 'UCE' | 'UACE' | 'CBC' | 'generic';

@Injectable()
export class GradingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve the band for a given score under the chosen system.
   * If no `system` is passed, we use the database default or fall back
   * to the legacy 9-point scale.
   */
  async bandFor(
    marks: Prisma.Decimal.Value,
    maxMarks: Prisma.Decimal.Value,
    system?: GradingSystem | string,
  ): Promise<GradeBand | null> {
    const bands = await this.bandsFor(system ?? null);
    // A0: exact-Decimal percentage — band boundaries are precisely where JS
    // float error would otherwise flip a grade (e.g. 49.999999999).
    const pct = percent(marks, maxMarks);
    return bands.find((b) => pct.gte(b.min) && pct.lte(b.max)) ?? bands[bands.length - 1];
  }

  /**
   * Return the bands for a grading system — from a registered DB scale if one
   * exists, else the built-in constants.
   *
   * A0: the lookup was `name: { contains: system }`, an unanchored substring
   * match that (a) matched "UCE" inside "UACE", (b) matched any scale whose
   * name merely *contained* the token, and (c) ignored `isDefault`. It is now
   * an org-scoped exact-name match, falling back to the org's default scale,
   * then to the built-in constants. (Org scoping is applied by the Prisma
   * tenancy extension.)
   */
  async bandsFor(system?: GradingSystem | string | null): Promise<GradeBand[]> {
    if (system) {
      const exact = await this.prisma.client.gradingScale.findFirst({
        where: { name: { equals: system as string, mode: 'insensitive' } },
      });
      if (exact) return exact.bands as unknown as GradeBand[];
    }
    const fallback = await this.prisma.client.gradingScale.findFirst({
      where: { isDefault: true },
    });
    if (fallback) return fallback.bands as unknown as GradeBand[];

    // No registered scale — use the built-in default for the system.
    switch ((system ?? '').toUpperCase()) {
      case 'UACE': return this.defaultUACE();
      case 'CBC': return this.defaultCBC();
      case 'UCE':
      default: return this.defaultUCE();
    }
  }

  /** Uganda UCE scale (post-2020). D1 (best, 1 pt) → F9 (fail, 9 pts). */
  defaultUCE(): GradeBand[] {
    return [
      { min: 90, max: 100, grade: 'D1', gpa: 4.0, points: 1, remark: 'Distinction' },
      { min: 80, max: 89,  grade: 'D2', gpa: 3.6, points: 2, remark: 'Distinction' },
      { min: 70, max: 79,  grade: 'C3', gpa: 3.2, points: 3, remark: 'Credit' },
      { min: 65, max: 69,  grade: 'C4', gpa: 2.8, points: 4, remark: 'Credit' },
      { min: 60, max: 64,  grade: 'C5', gpa: 2.4, points: 5, remark: 'Credit' },
      { min: 50, max: 59,  grade: 'C6', gpa: 2.0, points: 6, remark: 'Credit' },
      { min: 40, max: 49,  grade: 'P7', gpa: 1.5, points: 7, remark: 'Pass' },
      { min: 35, max: 39,  grade: 'P8', gpa: 1.0, points: 8, remark: 'Pass' },
      { min: 0,  max: 34,  grade: 'F9', gpa: 0.0, points: 9, remark: 'Fail' },
    ];
  }

  /** Uganda UACE scale. A (best, 5 pts) → O (10 pts), F (fail). */
  defaultUACE(): GradeBand[] {
    return [
      { min: 80, max: 100, grade: 'A',  gpa: 4.0, points: 5, remark: 'Distinction' },
      { min: 70, max: 79,  grade: 'B',  gpa: 3.6, points: 6, remark: 'Distinction' },
      { min: 60, max: 69,  grade: 'C',  gpa: 3.2, points: 7, remark: 'Credit' },
      { min: 50, max: 59,  grade: 'D',  gpa: 2.8, points: 8, remark: 'Credit' },
      { min: 40, max: 49,  grade: 'E',  gpa: 2.4, points: 9, remark: 'Pass' },
      { min: 30, max: 39,  grade: 'O',  gpa: 2.0, points: 10, remark: 'Pass' },
      { min: 0,  max: 29,  grade: 'F',  gpa: 0.0, points: 11, remark: 'Fail' },
    ];
  }

  /** CBC competency levels (Uganda lower-secondary). */
  defaultCBC(): GradeBand[] {
    return [
      { min: 80, max: 100, grade: 'A', gpa: 4.0, remark: 'Exceeding Expectations' },
      { min: 65, max: 79,  grade: 'B', gpa: 3.0, remark: 'Meeting Expectations' },
      { min: 50, max: 64,  grade: 'C', gpa: 2.0, remark: 'Approaching Expectations' },
      { min: 0,  max: 49,  grade: 'D', gpa: 1.0, remark: 'Below Expectations' },
    ];
  }

  /** Legacy 9-point scale used by schools that haven't adopted UCE bands. */
  legacyGeneric(): GradeBand[] {
    return [
      { min: 90, max: 100, grade: 'A',  gpa: 4.0, remark: 'Distinction' },
      { min: 80, max: 89,  grade: 'B',  gpa: 3.6, remark: 'Distinction' },
      { min: 70, max: 79,  grade: 'C',  gpa: 3.2, remark: 'Credit' },
      { min: 60, max: 69,  grade: 'D',  gpa: 2.8, remark: 'Credit' },
      { min: 50, max: 59,  grade: 'E',  gpa: 2.4, remark: 'Pass' },
      { min: 40, max: 49,  grade: 'O',  gpa: 2.0, remark: 'Pass' },
      { min: 30, max: 39,  grade: 'F',  gpa: 1.5, remark: 'Fail' },
      { min: 0,  max: 29,  grade: 'F9', gpa: 0.0, remark: 'Fail' },
    ];
  }

  // ── UCE aggregate ──────────────────────────────────────────────────────

  /**
   * UCE aggregate: sum of the best 8 subject points (lower is better).
   * Compulsory subjects are English and Mathematics. A student with 3+
   * F9 grades is disqualified even if the aggregate is good.
   */
  computeUCEAggregate(subjects: Array<{ subject: string; points: number | null; isCompulsory?: boolean }>): {
    best8: Array<{ subject: string; points: number }>;
    best8Aggregate: number;
    f9Count: number;
    compulsoryPass: boolean;
    eligible: boolean;
  } {
    const eligibleSubjects = subjects
      .filter((s) => s.points != null)
      .map((s) => ({ subject: s.subject, points: s.points as number }));

    // Sort ascending (best = lowest points first), then take 8.
    const sorted = [...eligibleSubjects].sort((a, b) => a.points - b.points);
    const best8 = sorted.slice(0, 8);
    const best8Aggregate = best8.reduce((sum, s) => sum + s.points, 0);
    const f9Count = eligibleSubjects.filter((s) => s.points === 9).length;

    // Compulsory: English and Math must not be F9.
    const eng = subjects.find((s) => /english/i.test(s.subject));
    const mtc = subjects.find((s) => /math/i.test(s.subject));
    const compulsoryPass =
      (eng?.points == null || eng.points <= 8) &&
      (mtc?.points == null || mtc.points <= 8);

    return {
      best8,
      best8Aggregate,
      f9Count,
      compulsoryPass,
      eligible: f9Count <= 3 && compulsoryPass,
    };
  }

  // ── UACE aggregate ─────────────────────────────────────────────────────

  /**
   * UACE aggregate: sum of the best 3 principal subject points (lower is
   * better). Subsidiary subjects don't count toward the aggregate but
   * still appear on the card.
   */
  computeUACEAggregate(subjects: Array<{ subject: string; points: number | null; isPrincipal?: boolean }>): {
    principals: Array<{ subject: string; points: number }>;
    subsidiaries: Array<{ subject: string; points: number }>;
    best3Aggregate: number;
    principalCount: number;
  } {
    const eligible = subjects
      .filter((s) => s.points != null)
      .map((s) => ({ subject: s.subject, points: s.points as number, isPrincipal: !!s.isPrincipal }));
    const principals = eligible.filter((s) => s.isPrincipal);
    const subsidiaries = eligible.filter((s) => !s.isPrincipal);

    const sorted = [...principals].sort((a, b) => a.points - b.points);
    const best3 = sorted.slice(0, 3);
    const best3Aggregate = best3.reduce((sum, s) => sum + s.points, 0);

    return {
      principals: principals.map(({ subject, points }) => ({ subject, points })),
      subsidiaries: subsidiaries.map(({ subject, points }) => ({ subject, points })),
      best3Aggregate,
      principalCount: principals.length,
    };
  }

  // ── GPA / rank ──────────────────────────────────────────────────────────

  /**
   * P0-5 (C5): competition ranking.
   *
   * Walk a score-sorted list and only advance the rank when the score
   * changes. Ties share the same rank; the next rank skips.
   *   100, 95, 95, 90  →  ranks 1, 2, 2, 4
   *   100, 100, 100    →  ranks 1, 1, 1
   *
   * Exported for unit testing.
   */
  static competitionRank(
    sorted: Array<[string, number]>,
    target: string,
  ): number | null {
    let rank = 0;
    for (let i = 0; i < sorted.length; i++) {
      if (i === 0 || sorted[i][1] < sorted[i - 1][1]) {
        rank = i + 1;
      }
      if (sorted[i][0] === target) {
        return rank;
      }
    }
    return null;
  }

  /**
   * Compute weighted GPA + class rank for a term. Pulls all GradeEntries
   * for the term's exam schedules and aggregates per student.
   */
  async computeTermGpa(studentProfileId: string, termId: string): Promise<{
    gpa: number;
    totalMarks: number;
    meanPercent: number;
    rank: number | null;
  }> {
    const entries = await this.prisma.client.gradeEntry.findMany({
      where: {
        studentProfileId,
        examSchedule: { exam: { termId } },
      },
      include: { examSchedule: { include: { exam: { include: { examType: true } } } } },
    });
    if (entries.length === 0) return { gpa: 0, totalMarks: 0, meanPercent: 0, rank: null };

    // A0: all aggregation in exact Decimal — no float drift through the
    // weighted GPA, the mean percent, or (critically) the ranking scores that
    // decide who is first in the class.
    const gpa = GradingService.weightedGpa(entries);
    const meanPercent = entries
      .reduce((acc, e) => acc.add(percent(e.marksObtained ?? 0, e.maxMarks)), new D(0))
      .div(entries.length);

    const allEntries = await this.prisma.client.gradeEntry.findMany({
      where: { examSchedule: { exam: { termId } } },
      include: { examSchedule: { include: { exam: { include: { examType: true } } } } },
    });
    const studentIds = Array.from(new Set(allEntries.map((e) => e.studentProfileId)));
    const scores = new Map<string, number>();
    for (const sid of studentIds) {
      const myEntries = allEntries.filter((e) => e.studentProfileId === sid);
      // Rank on the Decimal GPA, materialised to a number only for the sort key.
      scores.set(sid, GradingService.weightedGpa(myEntries).toNumber());
    }
    const sorted = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);
    // P0-5 (C5): use competition ranking so tied students share a rank.
    const rank = GradingService.competitionRank(sorted, studentProfileId);
    return {
      gpa: Number(gpa.toDecimalPlaces(2)),
      totalMarks: entries.length,
      meanPercent: Number(meanPercent.toDecimalPlaces(2)),
      rank,
    };
  }

  /**
   * Weighted GPA = Σ(gradePoint × examTypeWeight) / Σ(examTypeWeight), in exact
   * Decimal. Shared by both the per-student figure and the ranking scores so
   * the two can never disagree. Returns 0 when there is no weight.
   */
  static weightedGpa(
    entries: Array<{ gradePoint: Decimal | null; examSchedule: { exam: { examType: { weight: Decimal } } } }>,
  ): Decimal {
    let weightedSum = new D(0);
    let totalWeight = new D(0);
    for (const e of entries) {
      const w = new D(e.examSchedule.exam.examType.weight);
      const gp = new D(e.gradePoint ?? 0);
      weightedSum = weightedSum.add(gp.mul(w));
      totalWeight = totalWeight.add(w);
    }
    return totalWeight.isZero() ? new D(0) : weightedSum.div(totalWeight);
  }
}