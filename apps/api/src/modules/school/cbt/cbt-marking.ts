import { Prisma } from '@prisma/client';

/**
 * Pure CBT auto-marker. `markResponse(question, response)` scores one objective
 * response deterministically — no Prisma, no clock. Essays return null (routed
 * to a human marking queue). Unit-tested in cbt-marking.spec.ts.
 */

const D = Prisma.Decimal;

export type QuestionType =
  | 'mcq_single'
  | 'mcq_multi'
  | 'true_false'
  | 'short_answer'
  | 'numeric'
  | 'matching'
  | 'fill_blank'
  | 'essay';

export interface OptionSpec {
  id: string;
  isCorrect: boolean;
}

export interface AnswerKey {
  /** numeric */
  value?: number;
  tolerance?: number;
  /** short_answer / fill_blank — acceptable normalized answers */
  accepted?: string[];
  /** matching — map of leftId → rightId */
  pairs?: Record<string, string>;
}

export interface MarkableQuestion {
  type: QuestionType;
  marks: Prisma.Decimal.Value;
  options?: OptionSpec[];
  answerKey?: AnswerKey | null;
}

export interface MarkResult {
  score: Prisma.Decimal | null; // null = needs manual marking
  isCorrect: boolean | null;
  needsManual: boolean;
}

const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Score one response. `response` shape depends on the question type. */
export function markResponse(question: MarkableQuestion, response: any): MarkResult {
  const marks = new D(question.marks);
  const full: MarkResult = { score: marks, isCorrect: true, needsManual: false };
  const zero: MarkResult = { score: new D(0), isCorrect: false, needsManual: false };

  switch (question.type) {
    case 'essay':
      return { score: null, isCorrect: null, needsManual: true };

    case 'mcq_single':
    case 'true_false': {
      const correct = (question.options ?? []).find((o) => o.isCorrect);
      if (!correct) return { score: null, isCorrect: null, needsManual: true };
      return response?.optionId === correct.id ? full : zero;
    }

    case 'mcq_multi': {
      const correctIds = new Set((question.options ?? []).filter((o) => o.isCorrect).map((o) => o.id));
      const picked: string[] = Array.isArray(response?.optionIds) ? response.optionIds : [];
      const pickedSet = new Set(picked);
      // All-or-nothing: exact set match.
      const exact = pickedSet.size === correctIds.size && [...correctIds].every((id) => pickedSet.has(id));
      return exact ? full : zero;
    }

    case 'numeric': {
      const key = question.answerKey;
      if (key?.value === undefined || key.value === null) return { score: null, isCorrect: null, needsManual: true };
      const val = Number(response?.value);
      if (Number.isNaN(val)) return zero;
      const tol = key.tolerance ?? 0;
      return Math.abs(val - key.value) <= tol ? full : zero;
    }

    case 'short_answer':
    case 'fill_blank': {
      const accepted = (question.answerKey?.accepted ?? []).map(norm);
      if (accepted.length === 0) return { score: null, isCorrect: null, needsManual: true };
      return accepted.includes(norm(response?.text)) ? full : zero;
    }

    case 'matching': {
      const pairs = question.answerKey?.pairs ?? {};
      const given: Record<string, string> = response?.pairs ?? {};
      const keys = Object.keys(pairs);
      if (keys.length === 0) return { score: null, isCorrect: null, needsManual: true };
      const allRight = keys.every((k) => given[k] === pairs[k]);
      return allRight ? full : zero;
    }

    default:
      return { score: null, isCorrect: null, needsManual: true };
  }
}

/** Total the auto-marked scores; returns { autoScore, manualPending }. */
export function totalAuto(
  items: Array<{ question: MarkableQuestion; response: any }>,
): { autoScore: Prisma.Decimal; manualPending: number } {
  let autoScore = new D(0);
  let manualPending = 0;
  for (const it of items) {
    const r = markResponse(it.question, it.response);
    if (r.needsManual) manualPending += 1;
    else if (r.score) autoScore = autoScore.add(r.score);
  }
  return { autoScore, manualPending };
}
