import { markResponse, totalAuto, type MarkableQuestion } from './cbt-marking';

const opts = (correctId: string) => [
  { id: 'a', isCorrect: correctId === 'a' },
  { id: 'b', isCorrect: correctId === 'b' },
  { id: 'c', isCorrect: correctId === 'c' },
];

describe('cbt-marking (pure auto-marker)', () => {
  it('mcq_single: correct → full, wrong → 0', () => {
    const q: MarkableQuestion = { type: 'mcq_single', marks: 2, options: opts('b') };
    expect(markResponse(q, { optionId: 'b' }).score!.toNumber()).toBe(2);
    expect(markResponse(q, { optionId: 'a' }).score!.toNumber()).toBe(0);
  });

  it('mcq_multi: exact set match only', () => {
    const q: MarkableQuestion = { type: 'mcq_multi', marks: 3, options: [
      { id: 'a', isCorrect: true }, { id: 'b', isCorrect: true }, { id: 'c', isCorrect: false },
    ] };
    expect(markResponse(q, { optionIds: ['a', 'b'] }).score!.toNumber()).toBe(3);
    expect(markResponse(q, { optionIds: ['a'] }).score!.toNumber()).toBe(0); // partial = 0
    expect(markResponse(q, { optionIds: ['a', 'b', 'c'] }).score!.toNumber()).toBe(0);
  });

  it('true_false', () => {
    const q: MarkableQuestion = { type: 'true_false', marks: 1, options: [
      { id: 'true', isCorrect: true }, { id: 'false', isCorrect: false },
    ] };
    expect(markResponse(q, { optionId: 'true' }).isCorrect).toBe(true);
    expect(markResponse(q, { optionId: 'false' }).isCorrect).toBe(false);
  });

  it('numeric with tolerance', () => {
    const q: MarkableQuestion = { type: 'numeric', marks: 2, answerKey: { value: 3.14, tolerance: 0.01 } };
    expect(markResponse(q, { value: 3.15 }).score!.toNumber()).toBe(2);
    expect(markResponse(q, { value: 3.2 }).score!.toNumber()).toBe(0);
    expect(markResponse(q, { value: 'abc' }).score!.toNumber()).toBe(0);
  });

  it('short_answer: normalized match', () => {
    const q: MarkableQuestion = { type: 'short_answer', marks: 1, answerKey: { accepted: ['Kampala', 'kampala city'] } };
    expect(markResponse(q, { text: '  KAMPALA ' }).isCorrect).toBe(true);
    expect(markResponse(q, { text: 'Entebbe' }).isCorrect).toBe(false);
  });

  it('matching: all pairs right', () => {
    const q: MarkableQuestion = { type: 'matching', marks: 4, answerKey: { pairs: { l1: 'r2', l2: 'r1' } } };
    expect(markResponse(q, { pairs: { l1: 'r2', l2: 'r1' } }).score!.toNumber()).toBe(4);
    expect(markResponse(q, { pairs: { l1: 'r2', l2: 'r2' } }).score!.toNumber()).toBe(0);
  });

  it('essay → needs manual', () => {
    const r = markResponse({ type: 'essay', marks: 10 }, { text: 'long answer' });
    expect(r.needsManual).toBe(true);
    expect(r.score).toBeNull();
  });

  it('totalAuto sums objective and counts manual pending', () => {
    const items = [
      { question: { type: 'mcq_single', marks: 2, options: opts('a') } as MarkableQuestion, response: { optionId: 'a' } },
      { question: { type: 'numeric', marks: 3, answerKey: { value: 10 } } as MarkableQuestion, response: { value: 10 } },
      { question: { type: 'essay', marks: 5 } as MarkableQuestion, response: { text: 'x' } },
    ];
    const { autoScore, manualPending } = totalAuto(items);
    expect(autoScore.toNumber()).toBe(5);
    expect(manualPending).toBe(1);
  });
});
