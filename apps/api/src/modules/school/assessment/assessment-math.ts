import { Prisma } from '@prisma/client';

/**
 * Pure assessment arithmetic — reconcile marker rounds into a canonical
 * original score, apply the ordered adjustment ledger, and derive the
 * percentage. Everything is exact `Decimal` (never JS float), and there is no
 * Prisma / Nest / clock / randomness in here: given the same inputs it always
 * returns the same outputs. A3's result computation reuses this kernel, and it
 * is unit-tested in isolation (assessment-math.spec.ts).
 */

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export type MarkRoundName = 'first' | 'second_blind' | 'reconciliation';

export interface MarkEntryLike {
  round: MarkRoundName;
  score: Prisma.Decimal.Value;
}

export interface AdjustmentLike {
  sequence: number;
  delta?: Prisma.Decimal.Value | null;
  replacementScore?: Prisma.Decimal.Value | null;
}

export interface EffectiveResult {
  originalScore: Decimal | null;
  effectiveScore: Decimal | null;
  percentage: Decimal | null;
}

/** Clamp `v` into [lo, hi]. */
export function clamp(v: Decimal, lo: Decimal, hi: Decimal): Decimal {
  if (v.lt(lo)) return lo;
  if (v.gt(hi)) return hi;
  return v;
}

/** Percentage of max, exact Decimal; 0 when max is 0 (never divide by zero). */
export function percentageOf(score: Prisma.Decimal.Value, maxScore: Prisma.Decimal.Value): Decimal {
  const max = new D(maxScore);
  if (max.isZero()) return new D(0);
  return new D(score).div(max).mul(100);
}

/**
 * The canonical original mark from the marker rounds: the agreed
 * `reconciliation` round if present, else the `first` mark, else a lone blind
 * second. `null` when nothing has been marked yet — a blind second on its own
 * never silently becomes the mark.
 */
export function reconcileOriginal(entries: MarkEntryLike[]): Decimal | null {
  const by = (r: MarkRoundName) => entries.find((e) => e.round === r);
  const chosen = by('reconciliation') ?? by('first') ?? by('second_blind');
  return chosen ? new D(chosen.score) : null;
}

/**
 * Apply the ordered adjustment ledger to an original score, clamped to
 * [0, maxScore]. Each adjustment is either an absolute `replacementScore` or an
 * additive `delta` (the DB CHECK guarantees exactly one is set). Adjustments are
 * applied strictly in `sequence` order, so a later moderation composes on top of
 * an earlier scaling.
 */
export function applyAdjustments(
  original: Decimal,
  adjustments: AdjustmentLike[],
  maxScore: Prisma.Decimal.Value,
): Decimal {
  const max = new D(maxScore);
  let score = original;
  for (const a of [...adjustments].sort((x, y) => x.sequence - y.sequence)) {
    if (a.replacementScore !== null && a.replacementScore !== undefined) {
      score = new D(a.replacementScore);
    } else if (a.delta !== null && a.delta !== undefined) {
      score = score.add(new D(a.delta));
    }
  }
  return clamp(score, new D(0), max);
}

export interface RubricCriterionScore {
  score: Prisma.Decimal.Value;
  maxScore: Prisma.Decimal.Value;
  weight: Prisma.Decimal.Value;
}

/**
 * Roll a set of per-criterion rubric scores up into an earned fraction in
 * [0, 1] — the weighted average of each criterion's score/maxScore. A criterion
 * with maxScore 0 contributes 0. Returns 0 when there is no weight. The caller
 * scales this fraction to the assessment's own maxScore.
 */
export function rollupRubricFraction(items: RubricCriterionScore[]): Decimal {
  let weightedSum = new D(0);
  let totalWeight = new D(0);
  for (const it of items) {
    const max = new D(it.maxScore);
    const w = new D(it.weight);
    const frac = max.isZero() ? new D(0) : new D(it.score).div(max);
    weightedSum = weightedSum.add(frac.mul(w));
    totalWeight = totalWeight.add(w);
  }
  return totalWeight.isZero() ? new D(0) : weightedSum.div(totalWeight);
}

/**
 * The late penalty applied to a raw score: `rawScore * penaltyPercent/100`,
 * exact Decimal. Returns the amount to deduct (never more than the raw score).
 */
export function latePenalty(rawScore: Prisma.Decimal.Value, penaltyPercent: Prisma.Decimal.Value): Decimal {
  const deduction = new D(rawScore).mul(new D(penaltyPercent)).div(100);
  const raw = new D(rawScore);
  return deduction.gt(raw) ? raw : deduction;
}

/**
 * Full pipeline: reconcile marker rounds → apply adjustment ledger → percentage.
 * Null-safe: with no marks and no replacement adjustment, everything is null
 * (the student simply has no score yet). A replacement-kind adjustment (e.g.
 * special consideration) can set a score even before any marking round exists.
 */
export function computeEffective(
  entries: MarkEntryLike[],
  adjustments: AdjustmentLike[],
  maxScore: Prisma.Decimal.Value,
): EffectiveResult {
  const originalScore = reconcileOriginal(entries);

  if (originalScore === null) {
    const hasReplacement = adjustments.some(
      (a) => a.replacementScore !== null && a.replacementScore !== undefined,
    );
    if (!hasReplacement) return { originalScore: null, effectiveScore: null, percentage: null };
    const effective = applyAdjustments(new D(0), adjustments, maxScore);
    return { originalScore: null, effectiveScore: effective, percentage: percentageOf(effective, maxScore) };
  }

  const effectiveScore = applyAdjustments(originalScore, adjustments, maxScore);
  return { originalScore, effectiveScore, percentage: percentageOf(effectiveScore, maxScore) };
}

/**
 * What an assessment IS, for weighting purposes.
 *
 * `Assessment.kind` is the answer. The fallback exists only for rows written
 * before the column did, and it is the OLD GUESS, kept verbatim so those rows
 * keep behaving exactly as they did — `component.kind`, else exam-if-projected,
 * else CAT. That guess is wrong for every component-less homework, quiz and LMS
 * assessment, all of which it weighted as CATs; the backfill is what removes
 * the last of them. Once `kind` is NOT NULL this whole function goes away.
 */
export function kindOf(a: { kind?: string | null; sourceType?: string; component?: { kind?: string } | null }): string {
  return a.kind ?? a.component?.kind ?? (a.sourceType === 'exam_session' ? 'exam' : 'cat');
}
