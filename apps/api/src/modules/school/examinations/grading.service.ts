import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';

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
    marks: number,
    maxMarks: number,
    system?: GradingSystem | string,
  ): Promise<GradeBand | null> {
    const bands = await this.bandsFor(system ?? null);
    const pct = (marks / maxMarks) * 100;
    return bands.find((b) => pct >= b.min && pct <= b.max) ?? bands[bands.length - 1];
  }

  /** Return the bands for a grading system — from DB if a scale exists, else built-in. */
  async bandsFor(system?: GradingSystem | string | null): Promise<GradeBand[]> {
    // Try the DB first if a scale is registered.
    if (system) {
      const scale = await this.prisma.client.gradingScale.findFirst({
        where: { name: { contains: system as string } },
      });
      if (scale) return scale.bands as unknown as GradeBand[];
    }
    // Fall back to the built-in default for the system.
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

    const weightById = new Map<string, number>();
    for (const e of entries) {
      const id = e.examSchedule.exam.examTypeId;
      if (!weightById.has(id)) weightById.set(id, Number(e.examSchedule.exam.examType.weight));
    }

    let weightedSum = 0;
    let totalWeight = 0;
    let totalPct = 0;
    for (const e of entries) {
      const w = weightById.get(e.examSchedule.exam.examTypeId) ?? 0;
      const pct = Number(e.marksObtained ?? 0) / Number(e.maxMarks) * 100;
      const gp = Number(e.gradePoint ?? 0);
      weightedSum += gp * w;
      totalWeight += w;
      totalPct += pct;
    }
    const gpa = totalWeight > 0 ? weightedSum / totalWeight : 0;
    const meanPercent = totalPct / entries.length;

    const allEntries = await this.prisma.client.gradeEntry.findMany({
      where: { examSchedule: { exam: { termId } } },
      include: { examSchedule: { include: { exam: { include: { examType: true } } } } },
    });
    const studentIds = Array.from(new Set(allEntries.map((e) => e.studentProfileId)));
    const scores = new Map<string, number>();
    for (const sid of studentIds) {
      const myEntries = allEntries.filter((e) => e.studentProfileId === sid);
      let wSum = 0, wTotal = 0;
      for (const e of myEntries) {
        const w = Number(e.examSchedule.exam.examType.weight);
        const gp = Number(e.gradePoint ?? 0);
        wSum += gp * w;
        wTotal += w;
      }
      scores.set(sid, wTotal > 0 ? wSum / wTotal : 0);
    }
    const sorted = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);
    // P0-5 (C5): use competition ranking so tied students share a rank.
    const rank = GradingService.competitionRank(sorted, studentProfileId);
    return {
      gpa: Math.round(gpa * 100) / 100,
      totalMarks: entries.length,
      meanPercent: Math.round(meanPercent * 100) / 100,
      rank,
    };
  }
}