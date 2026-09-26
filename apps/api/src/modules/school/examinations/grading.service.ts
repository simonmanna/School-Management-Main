import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { resolveScale } from '../assessment/grade-bands';
import { bandFor as kernelBandFor } from '../assessment/result-computation';

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
 *   - ECD (nursery / early childhood) — descriptor levels, no points or division
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

export type GradingSystem = 'PLE' | 'UCE' | 'UACE' | 'CBC' | 'ECD' | 'generic';

/**
 * The four subjects a PLE aggregate is built from. Matched by name (and code)
 * the same way `computeUCEAggregate` already identifies English and Maths,
 * because a report card carries subject names, not ids.
 */
const PLE_CORE: ReadonlyArray<{ key: string; test: RegExp }> = [
  { key: 'english', test: /english/i },
  { key: 'mathematics', test: /math/i },
  { key: 'science', test: /science/i },
  { key: 'social', test: /social|sst/i },
];

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
    const scale = await this.scaleFor(system ?? null);
    // A0: exact-Decimal percentage — band boundaries are precisely where JS
    // float error would otherwise flip a grade (e.g. 49.999999999). The lookup
    // is the result kernel's continuous one, so 89.5 is never a gap (F01).
    const pct = percent(marks, maxMarks).toDecimalPlaces(2, D.ROUND_HALF_UP);
    return kernelBandFor(pct, scale.bands, scale.rounding);
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
    return (await this.scaleFor(system ?? null)).bands as GradeBand[];
  }

  /**
   * One resolver for the result kernel and this vertical (B6 fold): a scale
   * registered for the system, else a school house scale for graded systems,
   * else the built-in bands. Never another system's scale (F14).
   */
  private async scaleFor(system: string | null) {
    if (!system) {
      const profile = await this.prisma.client.schoolProfile.findFirst({ select: { gradingSystem: true } });
      system = profile?.gradingSystem ?? 'UCE';
    }
    return resolveScale(this.prisma.client, system);
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

  // ── PLE aggregate (Uganda Primary Leaving Examination) ─────────────────

  /**
   * PLE aggregate: the sum of the four core subject points — English,
   * Mathematics, Science and Social Studies — each graded D1..F9 (1..9).
   * Range 4 (four D1s) to 36 (four F9s); lower is better.
   *
   * Unlike UCE this is NOT "best N of however many were sat": the four are
   * fixed, and a candidate missing one has no aggregate at all rather than a
   * flatteringly small one. That is why `eligible` is false unless all four
   * are present.
   */
  computePLEAggregate(subjects: Array<{ subject: string; subjectCode?: string; points: number | null }>): {
    core: Array<{ key: string; subject: string; points: number }>;
    best4Aggregate: number;
    missing: string[];
    f9Count: number;
    eligible: boolean;
  } {
    const core: Array<{ key: string; subject: string; points: number }> = [];
    const missing: string[] = [];

    for (const want of PLE_CORE) {
      const hit = subjects.find(
        (s) => s.points != null && (want.test.test(s.subject) || want.test.test(s.subjectCode ?? '')),
      );
      if (hit) core.push({ key: want.key, subject: hit.subject, points: hit.points as number });
      else missing.push(want.key);
    }

    const best4Aggregate = core.reduce((sum, s) => sum + s.points, 0);
    const f9Count = core.filter((s) => s.points === 9).length;

    return { core, best4Aggregate, missing, f9Count, eligible: missing.length === 0 };
  }

  /**
   * Classic PLE division bands over the four-subject aggregate (min 4, max 36).
   * A candidate who did not sit all four core papers is Ungraded.
   */
  divisionPLE(aggregate: number, eligible: boolean): string {
    if (!eligible) return 'U';
    if (aggregate <= 12) return 'I';
    if (aggregate <= 23) return 'II';
    if (aggregate <= 29) return 'III';
    if (aggregate <= 34) return 'IV';
    return 'U';
  }

  /** Classic UCE division bands over the best-8 aggregate (min 8, max 72). */
  divisionUCE(aggregate: number, eligible: boolean): string {
    if (!eligible) return 'U';
    if (aggregate <= 32) return 'I';
    if (aggregate <= 44) return 'II';
    if (aggregate <= 56) return 'III';
    if (aggregate <= 72) return 'IV';
    return 'U';
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

  // `computeTermGpa` was removed here: it aggregated `GradeEntry`, the table the
  // B6 migration sealed read-only, so after the cutover it returned zeros for
  // every term. Its only caller was the report card, which now derives its
  // headline from `ReportCardTemplateService.termStats` (P0-2).


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