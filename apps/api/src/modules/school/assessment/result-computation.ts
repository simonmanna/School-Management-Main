import { Prisma } from '@prisma/client';

/**
 * Pure result computation kernel (A3).
 *
 * `computeResultSet(input): ResultOutput` is a deterministic projection of
 * marks under a versioned policy: plain data in, plain data out — no Prisma,
 * no Nest, no clock, no randomness. This is what makes results reproducible and
 * unit-testable, and it is exercised by the golden suite
 * (result-computation.golden.spec.ts).
 *
 * Precision + rounding contract:
 *   - Every intermediate value stays full-precision Decimal.
 *   - Rounding happens ONLY at the subject finalPercent (which resolves the
 *     grade band, so the printed percent and grade can never disagree) and at
 *     the term aggregate / GPA / mean. Never on intermediate component scores.
 */

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

export type GradingSystem = 'PLE' | 'UCE' | 'UACE' | 'CBC' | 'generic';
export type RoundingModeName = 'half_up' | 'half_even' | 'floor' | 'ceil';
export type RankOn = 'gpa' | 'aggregate' | 'meanPercent';

export interface BandConfig {
  min: number;
  max: number;
  grade: string;
  gpa: number;
  points?: number;
  remark?: string;
}

export interface ComponentConfig {
  id: string;
  kind: string;
  weight: Prisma.Decimal.Value;
  aggregation: 'mean' | 'sum' | 'best_n' | 'last' | 'weighted_mean';
  bestN?: number | null;
  countsAbsentAsZero?: boolean;
}

export interface AssessmentDatum {
  componentId: string | null;
  kind: string;
  effectiveScore: Prisma.Decimal.Value | null;
  maxScore: Prisma.Decimal.Value;
  participation: string; // present|absent|exempt|excused|malpractice|special_consideration
  /** Ordering hint for the `last` aggregation (higher = later). */
  order?: number;
}

export interface SubjectInput {
  subjectId: string;
  isCompulsory?: boolean;
  isPrincipal?: boolean;
  /** PLE: the four core papers (English, Maths, Science, SST) that the
   *  aggregate is built from. Sourced from `Subject.isCore`, never a name. */
  isCore?: boolean;
  passMark: Prisma.Decimal.Value;
  components: ComponentConfig[];
  assessments: AssessmentDatum[];
}

export interface StudentInput {
  studentProfileId: string;
  classId?: string | null;
  sectionId?: string | null;
  gradeLevelId?: string | null;
  termId?: string | null;
  subjects: SubjectInput[];
}

export interface ResultInput {
  gradingSystem: GradingSystem;
  bands: BandConfig[];
  roundingMode: RoundingModeName;
  decimalPlaces: number;
  rankOn: RankOn;
  students: StudentInput[];
}

export interface ComponentContribution {
  componentId: string;
  kind: string;
  weight: string;
  componentPercent: string | null;
  contribution: string;
}

export interface SubjectResult {
  subjectId: string;
  caScore: Dec | null;
  examScore: Dec | null;
  finalPercent: Dec | null;
  grade: string | null;
  gradePoint: Dec | null;
  points: number | null;
  subjectRank: number | null;
  componentBreakdown: ComponentContribution[];
}

export interface TermResult {
  gpa: Dec | null;
  aggregate: number | null;
  division: string | null;
  meanPercent: Dec | null;
  subjectsCount: number;
  eligible: boolean;
  promotionRecommendation: 'promote' | 'repeat' | 'graduate' | 'review';
  classRank: number | null;
}

export interface StudentResult {
  studentProfileId: string;
  subjects: SubjectResult[];
  term: TermResult;
}

export interface ResultOutput {
  students: StudentResult[];
}

// ── rounding ──────────────────────────────────────────────────────────────
const ROUND: Record<RoundingModeName, Prisma.Decimal.Rounding> = {
  half_up: D.ROUND_HALF_UP,
  half_even: D.ROUND_HALF_EVEN,
  floor: D.ROUND_FLOOR,
  ceil: D.ROUND_CEIL,
};

export function roundDec(v: Dec, mode: RoundingModeName, dp: number): Dec {
  return v.toDecimalPlaces(dp, ROUND[mode]);
}

// ── per-assessment percentage (participation-aware) ─────────────────────────
/**
 * The counted percentage for one assessment, or null when it should be excluded
 * from the aggregate entirely.
 *   exempt / excused              → excluded (null)
 *   absent, countsAbsentAsZero=T  → 0
 *   absent, countsAbsentAsZero=F  → excluded (null)
 *   malpractice                   → 0
 *   special_consideration/present → the effective percentage
 */
export function assessmentPercent(d: AssessmentDatum, countsAbsentAsZero: boolean): Dec | null {
  if (['exempt', 'excused', 'withdrawn', 'not_enrolled', 'missing'].includes(d.participation)) return null;
  if (d.participation === 'absent') return countsAbsentAsZero ? new D(0) : null;
  if (d.participation === 'malpractice') return new D(0);
  if (d.effectiveScore === null || d.effectiveScore === undefined) return null;
  const max = new D(d.maxScore);
  if (max.isZero()) return new D(0);
  return new D(d.effectiveScore).div(max).mul(100);
}

// ── component aggregation ───────────────────────────────────────────────────
export function aggregateComponent(data: AssessmentDatum[], c: ComponentConfig): Dec | null {
  const countsAbsent = c.countsAbsentAsZero ?? true;

  if (c.aggregation === 'sum' || c.aggregation === 'weighted_mean') {
    // Score-space: Σ effective / Σ max × 100, honouring participation.
    let num = new D(0);
    let den = new D(0);
    let any = false;
    for (const d of data) {
      const pct = assessmentPercent(d, countsAbsent);
      if (pct === null) continue;
      any = true;
      const max = new D(d.maxScore);
      const eff = d.participation === 'absent' || d.participation === 'malpractice' ? new D(0) : new D(d.effectiveScore ?? 0);
      num = num.add(eff);
      den = den.add(max);
    }
    if (!any || den.isZero()) return null;
    return num.div(den).mul(100);
  }

  // Percentage-space aggregations.
  const pcts = data
    .map((d) => ({ pct: assessmentPercent(d, countsAbsent), order: d.order ?? 0 }))
    .filter((x): x is { pct: Dec; order: number } => x.pct !== null);
  if (pcts.length === 0) return null;

  if (c.aggregation === 'last') {
    return pcts.reduce((a, b) => (b.order >= a.order ? b : a)).pct;
  }

  let list = pcts.map((x) => x.pct);
  if (c.aggregation === 'best_n' && c.bestN && c.bestN > 0) {
    list = [...list].sort((a, b) => b.comparedTo(a)).slice(0, c.bestN);
  }
  // mean (and best_n after slicing)
  const sum = list.reduce((acc, p) => acc.add(p), new D(0));
  return sum.div(list.length);
}

// ── band resolution ─────────────────────────────────────────────────────────
export function bandFor(percent: Dec, bands: BandConfig[]): BandConfig | null {
  const p = percent.toNumber();
  return bands.find((b) => p >= b.min && p <= b.max) ?? bands[bands.length - 1] ?? null;
}

// ── subject scoring ─────────────────────────────────────────────────────────
export function computeSubject(subject: SubjectInput, input: ResultInput): SubjectResult {
  const breakdown: ComponentContribution[] = [];
  let finalPercent: Dec | null = null;
  let caScore = new D(0);
  let examScore = new D(0);
  let hasCa = false;
  let hasExam = false;

  if (subject.components.length > 0) {
    // Policy mode: weighted components.
    let weightedSum = new D(0);
    let totalWeight = new D(0);
    let anyCounted = false;
    // CA/exam display scores are the weighted-average PERCENTAGE of the
    // non-exam / exam components respectively (not their weighted contribution).
    let caWeighted = new D(0);
    let caWeight = new D(0);
    let examWeighted = new D(0);
    let examWeight = new D(0);
    for (const c of subject.components) {
      const members = subject.assessments.filter(
        (a) => a.componentId === c.id || (a.componentId == null && a.kind === c.kind),
      );
      const componentPct = aggregateComponent(members, c);
      const weight = new D(c.weight);
      breakdown.push({
        componentId: c.id,
        kind: c.kind,
        weight: weight.toString(),
        componentPercent: componentPct ? componentPct.toString() : null,
        contribution: componentPct ? componentPct.mul(weight).div(100).toString() : '0',
      });
      if (componentPct === null) continue;
      anyCounted = true;
      weightedSum = weightedSum.add(componentPct.mul(weight));
      totalWeight = totalWeight.add(weight);
      if (c.kind === 'exam') {
        examWeighted = examWeighted.add(componentPct.mul(weight));
        examWeight = examWeight.add(weight);
        hasExam = true;
      } else {
        caWeighted = caWeighted.add(componentPct.mul(weight));
        caWeight = caWeight.add(weight);
        hasCa = true;
      }
    }
    if (anyCounted && !totalWeight.isZero()) {
      // Normalise by the weight actually present (defensive; publish gate
      // enforces the sum-to-100 invariant separately).
      finalPercent = weightedSum.div(totalWeight);
      caScore = caWeight.isZero() ? new D(0) : caWeighted.div(caWeight);
      examScore = examWeight.isZero() ? new D(0) : examWeighted.div(examWeight);
    }
  } else {
    // Simple mode (no policy): mean of the assessment percentages.
    const pcts = subject.assessments
      .map((a) => assessmentPercent(a, true))
      .filter((p): p is Dec => p !== null);
    if (pcts.length > 0) {
      finalPercent = pcts.reduce((acc, p) => acc.add(p), new D(0)).div(pcts.length);
      // Split CA/exam by kind for display.
      const split = (kinds: (d: AssessmentDatum) => boolean) => {
        const xs = subject.assessments.filter(kinds).map((a) => assessmentPercent(a, true)).filter((p): p is Dec => p !== null);
        return xs.length ? xs.reduce((a, p) => a.add(p), new D(0)).div(xs.length) : null;
      };
      const exam = split((d) => d.kind === 'exam');
      const ca = split((d) => d.kind !== 'exam');
      if (exam) { examScore = exam; hasExam = true; }
      if (ca) { caScore = ca; hasCa = true; }
    }
  }

  if (finalPercent === null) {
    return { subjectId: subject.subjectId, caScore: null, examScore: null, finalPercent: null, grade: null, gradePoint: null, points: null, subjectRank: null, componentBreakdown: breakdown };
  }

  const rounded = roundDec(finalPercent, input.roundingMode, input.decimalPlaces);
  const band = bandFor(rounded, input.bands);
  return {
    subjectId: subject.subjectId,
    caScore: hasCa ? roundDec(caScore, input.roundingMode, input.decimalPlaces) : null,
    examScore: hasExam ? roundDec(examScore, input.roundingMode, input.decimalPlaces) : null,
    finalPercent: rounded,
    grade: band?.grade ?? null,
    gradePoint: band ? new D(band.gpa) : null,
    points: band?.points ?? null,
    subjectRank: null, // filled in the ranking pass
    componentBreakdown: breakdown,
  };
}

// ── PLE aggregate (Uganda Primary Leaving Examination) ──────────────────────
/**
 * PLE aggregate: the sum of the four core subject points — English, Maths,
 * Science and Social Studies — each D1..F9 (1..9). Range 4..36, lower better.
 *
 * The four are fixed, not "best 4 of everything sat": a pupil missing a core
 * paper has no aggregate rather than a flatteringly small one, so `eligible`
 * is false unless all four are present. Where a school has flagged more than
 * four subjects core, the best four among them are taken.
 */
export function computePLEAggregate(
  subjects: Array<{ subjectId: string; points: number | null; isCore?: boolean }>,
): { best4Aggregate: number; coreCount: number; f9Count: number; eligible: boolean } {
  const core = subjects.filter((s) => s.isCore && s.points != null) as Array<{ points: number }>;
  const best4 = [...core].sort((a, b) => a.points - b.points).slice(0, 4);
  const best4Aggregate = best4.reduce((sum, s) => sum + s.points, 0);
  const f9Count = core.filter((s) => s.points === 9).length;
  return { best4Aggregate, coreCount: core.length, f9Count, eligible: core.length >= 4 };
}

/** Classic PLE division bands over the four-subject aggregate (min 4, max 36). */
export function divisionPLE(aggregate: number, eligible: boolean): string {
  if (!eligible) return 'U';
  if (aggregate <= 12) return 'I';
  if (aggregate <= 23) return 'II';
  if (aggregate <= 29) return 'III';
  if (aggregate <= 34) return 'IV';
  return 'U';
}

// ── UCE / UACE aggregates ───────────────────────────────────────────────────
export function computeUCEAggregate(
  subjects: Array<{ subjectId: string; points: number | null; isCompulsory?: boolean }>,
): { best8Aggregate: number; f9Count: number; compulsoryPass: boolean; eligible: boolean } {
  const withPoints = subjects.filter((s) => s.points != null) as Array<{ subjectId: string; points: number; isCompulsory?: boolean }>;
  const sorted = [...withPoints].sort((a, b) => a.points - b.points);
  const best8 = sorted.slice(0, 8);
  const best8Aggregate = best8.reduce((sum, s) => sum + s.points, 0);
  const f9Count = withPoints.filter((s) => s.points === 9).length;
  const compulsory = withPoints.filter((s) => s.isCompulsory);
  const compulsoryPass = compulsory.every((s) => s.points <= 8);
  return { best8Aggregate, f9Count, compulsoryPass, eligible: f9Count <= 3 && compulsoryPass };
}

export function computeUACEAggregate(
  subjects: Array<{ subjectId: string; points: number | null; isPrincipal?: boolean }>,
): { best3Aggregate: number; principalCount: number } {
  const principals = subjects.filter((s) => s.points != null && s.isPrincipal) as Array<{ points: number }>;
  const sorted = [...principals].sort((a, b) => a.points - b.points).slice(0, 3);
  return { best3Aggregate: sorted.reduce((sum, s) => sum + s.points, 0), principalCount: principals.length };
}

/** Classic UCE division bands over the best-8 aggregate (min 8, max 72). */
export function divisionUCE(aggregate: number, eligible: boolean): string {
  if (!eligible) return 'U';
  if (aggregate <= 32) return 'I';
  if (aggregate <= 44) return 'II';
  if (aggregate <= 56) return 'III';
  if (aggregate <= 72) return 'IV';
  return 'U';
}

// ── term scoring ────────────────────────────────────────────────────────────
export function computeTerm(subjectResults: SubjectResult[], subjects: SubjectInput[], input: ResultInput): TermResult {
  const scored = subjectResults.filter((s) => s.finalPercent !== null);
  if (scored.length === 0) {
    return { gpa: null, aggregate: null, division: null, meanPercent: null, subjectsCount: 0, eligible: false, promotionRecommendation: 'review', classRank: null };
  }

  const meanPercent = roundDec(
    scored.reduce((acc, s) => acc.add(s.finalPercent as Dec), new D(0)).div(scored.length),
    input.roundingMode,
    input.decimalPlaces,
  );
  const gpa = roundDec(
    scored.reduce((acc, s) => acc.add(s.gradePoint ?? new D(0)), new D(0)).div(scored.length),
    input.roundingMode,
    2,
  );

  let aggregate: number | null = null;
  let division: string | null = null;
  let eligible = true;
  const pointsBySubject = subjectResults.map((r) => {
    const meta = subjects.find((s) => s.subjectId === r.subjectId);
    return { subjectId: r.subjectId, points: r.points, isCompulsory: meta?.isCompulsory, isPrincipal: meta?.isPrincipal, isCore: meta?.isCore };
  });

  if (input.gradingSystem === 'PLE') {
    const agg = computePLEAggregate(pointsBySubject);
    aggregate = agg.best4Aggregate;
    eligible = agg.eligible;
    division = divisionPLE(agg.best4Aggregate, agg.eligible);
  } else if (input.gradingSystem === 'UCE') {
    const agg = computeUCEAggregate(pointsBySubject);
    aggregate = agg.best8Aggregate;
    eligible = agg.eligible;
    division = divisionUCE(agg.best8Aggregate, agg.eligible);
  } else if (input.gradingSystem === 'UACE') {
    const agg = computeUACEAggregate(pointsBySubject);
    aggregate = agg.best3Aggregate;
    eligible = agg.principalCount >= 2;
  }

  // Promotion recommendation from pass coverage against each subject's pass mark.
  let passed = 0;
  for (const r of scored) {
    const meta = subjects.find((s) => s.subjectId === r.subjectId);
    const pass = new D(meta?.passMark ?? 50);
    if ((r.finalPercent as Dec).greaterThanOrEqualTo(pass)) passed += 1;
  }
  const promotionRecommendation: TermResult['promotionRecommendation'] =
    passed === scored.length ? 'promote' : passed === 0 ? 'repeat' : 'review';

  return { gpa, aggregate, division, meanPercent, subjectsCount: scored.length, eligible, promotionRecommendation, classRank: null };
}

// ── competition ranking (ties share a rank; next rank skips) ────────────────
export function assignCompetitionRanks(
  entries: Array<{ id: string; value: Dec | number | null }>,
  order: 'asc' | 'desc',
): Map<string, number> {
  const ranked = new Map<string, number>();
  const present = entries.filter((e) => e.value !== null) as Array<{ id: string; value: Dec | number }>;
  const num = (v: Dec | number) => (typeof v === 'number' ? v : v.toNumber());
  present.sort((a, b) => (order === 'asc' ? num(a.value) - num(b.value) : num(b.value) - num(a.value)));
  for (let i = 0; i < present.length; i++) {
    if (i === 0 || num(present[i].value) !== num(present[i - 1].value)) {
      ranked.set(present[i].id, i + 1);
    } else {
      ranked.set(present[i].id, ranked.get(present[i - 1].id)!);
    }
  }
  return ranked;
}

// ── top-level ───────────────────────────────────────────────────────────────
export function computeResultSet(input: ResultInput): ResultOutput {
  const students: StudentResult[] = input.students.map((st) => {
    const subjects = st.subjects.map((s) => computeSubject(s, input));
    const term = computeTerm(subjects, st.subjects, input);
    return { studentProfileId: st.studentProfileId, subjects, term };
  });

  // Class rank across students on the configured value.
  const rankOrder: 'asc' | 'desc' = input.rankOn === 'aggregate' ? 'asc' : 'desc';
  const rankValue = (t: TermResult): Dec | number | null =>
    input.rankOn === 'aggregate' ? t.aggregate : input.rankOn === 'meanPercent' ? t.meanPercent : t.gpa;
  const classRanks = assignCompetitionRanks(
    students.map((s) => ({ id: s.studentProfileId, value: rankValue(s.term) })),
    rankOrder,
  );
  for (const s of students) s.term.classRank = classRanks.get(s.studentProfileId) ?? null;

  // Subject rank across students per subject (higher finalPercent = better).
  const subjectIds = new Set<string>();
  for (const s of students) for (const sr of s.subjects) subjectIds.add(sr.subjectId);
  for (const subjectId of subjectIds) {
    const ranks = assignCompetitionRanks(
      students.map((s) => ({ id: s.studentProfileId, value: s.subjects.find((x) => x.subjectId === subjectId)?.finalPercent ?? null })),
      'desc',
    );
    for (const s of students) {
      const sr = s.subjects.find((x) => x.subjectId === subjectId);
      if (sr) sr.subjectRank = ranks.get(s.studentProfileId) ?? null;
    }
  }

  return { students };
}
