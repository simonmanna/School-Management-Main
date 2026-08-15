import { Prisma } from '@prisma/client';
import {
  computeResultSet,
  computeSubject,
  aggregateComponent,
  assessmentPercent,
  divisionUCE,
  computeUCEAggregate,
  type BandConfig,
  type ResultInput,
  type SubjectInput,
  type AssessmentDatum,
} from './result-computation';

/**
 * Golden tests for the pure result kernel — the class of bug that float
 * arithmetic and undefined rounding actually produce lives here: band edges,
 * every rounding mode, participation states, best-N ties, and rank ties.
 */

// Standard Uganda UCE bands (D1 best → F9 fail).
const UCE_BANDS: BandConfig[] = [
  { min: 90, max: 100, grade: 'D1', gpa: 4.0, points: 1 },
  { min: 80, max: 89, grade: 'D2', gpa: 3.6, points: 2 },
  { min: 70, max: 79, grade: 'C3', gpa: 3.2, points: 3 },
  { min: 65, max: 69, grade: 'C4', gpa: 2.8, points: 4 },
  { min: 60, max: 64, grade: 'C5', gpa: 2.4, points: 5 },
  { min: 50, max: 59, grade: 'C6', gpa: 2.0, points: 6 },
  { min: 40, max: 49, grade: 'P7', gpa: 1.5, points: 7 },
  { min: 35, max: 39, grade: 'P8', gpa: 1.0, points: 8 },
  { min: 0, max: 34, grade: 'F9', gpa: 0.0, points: 9 },
];

const baseInput = (over: Partial<ResultInput> = {}): ResultInput => ({
  gradingSystem: 'UCE',
  bands: UCE_BANDS,
  roundingMode: 'half_up',
  decimalPlaces: 0,
  rankOn: 'gpa',
  students: [],
  ...over,
});

// A one-assessment subject producing a given raw percentage.
const pctSubject = (subjectId: string, pct: number, max = 100): SubjectInput => ({
  subjectId,
  passMark: 50,
  components: [],
  assessments: [{ componentId: null, kind: 'exam', effectiveScore: (pct / 100) * max, maxScore: max, participation: 'present' }],
});

describe('result-computation golden', () => {
  describe('band edges (dp=0, half_up)', () => {
    const cases: Array<[number, string]> = [
      [39.49, 'P8'], [39.5, 'P7'], [39.51, 'P7'],
      [49.49, 'P7'], [49.5, 'C6'], [49.51, 'C6'],
      [34.4, 'F9'], [34.5, 'P8'],
      [89.5, 'D1'], [89.49, 'D2'],
    ];
    it.each(cases)('%d%% → %s', (pct, grade) => {
      const r = computeSubject(pctSubject('s', pct), baseInput());
      expect(r.grade).toBe(grade);
    });
  });

  describe('rounding modes at 39.5', () => {
    const modes: Array<['half_up' | 'half_even' | 'floor' | 'ceil', string]> = [
      ['half_up', 'P7'],   // 40
      ['ceil', 'P7'],      // 40
      ['floor', 'P8'],     // 39
      ['half_even', 'P7'], // 40 (nearest even)
    ];
    it.each(modes)('%s → %s', (mode, grade) => {
      const r = computeSubject(pctSubject('s', 39.5), baseInput({ roundingMode: mode }));
      expect(r.grade).toBe(grade);
    });
    it('half_even rounds 38.5 down to 38 (even)', () => {
      const r = computeSubject(pctSubject('s', 38.5), baseInput({ roundingMode: 'half_even' }));
      expect(r.finalPercent!.toNumber()).toBe(38);
      expect(r.grade).toBe('P8');
    });
  });

  describe('participation', () => {
    const c = { id: 'c1', kind: 'cat', weight: 100, aggregation: 'mean' as const, countsAbsentAsZero: true };
    const datum = (participation: string, score: number | null = 50): AssessmentDatum => ({ componentId: 'c1', kind: 'cat', effectiveScore: score, maxScore: 100, participation });

    it('absent counts as zero when configured', () => {
      expect(aggregateComponent([datum('present', 80), datum('absent', null)], c)!.toNumber()).toBe(40);
    });
    it('absent is excluded when countsAbsentAsZero is false', () => {
      expect(aggregateComponent([datum('present', 80), datum('absent', null)], { ...c, countsAbsentAsZero: false })!.toNumber()).toBe(80);
    });
    it('exempt and excused are excluded', () => {
      expect(assessmentPercent(datum('exempt'), true)).toBeNull();
      expect(assessmentPercent(datum('excused'), true)).toBeNull();
    });
    it('malpractice scores zero', () => {
      expect(assessmentPercent(datum('malpractice'), true)!.toNumber()).toBe(0);
    });
  });

  describe('best_n with ties at the cut', () => {
    it('takes the best 2 of 4, ties included deterministically', () => {
      const c = { id: 'c1', kind: 'cat', weight: 100, aggregation: 'best_n' as const, bestN: 2 };
      const data: AssessmentDatum[] = [90, 70, 70, 40].map((s) => ({ componentId: 'c1', kind: 'cat', effectiveScore: s, maxScore: 100, participation: 'present' }));
      // best 2 = 90 and one of the 70s → mean 80.
      expect(aggregateComponent(data, c)!.toNumber()).toBe(80);
    });
  });

  describe('weighted components (CA 40 / Exam 60)', () => {
    it('combines CA and exam into the final percent and splits scores', () => {
      const subject: SubjectInput = {
        subjectId: 'math',
        passMark: 50,
        components: [
          { id: 'ca', kind: 'cat', weight: 40, aggregation: 'mean' },
          { id: 'exam', kind: 'exam', weight: 60, aggregation: 'mean' },
        ],
        assessments: [
          { componentId: 'ca', kind: 'cat', effectiveScore: 50, maxScore: 100, participation: 'present' },
          { componentId: 'exam', kind: 'exam', effectiveScore: 80, maxScore: 100, participation: 'present' },
        ],
      };
      const r = computeSubject(subject, baseInput());
      // 50*0.4 + 80*0.6 = 20 + 48 = 68 → C4
      expect(r.finalPercent!.toNumber()).toBe(68);
      expect(r.grade).toBe('C4');
      expect(r.caScore!.toNumber()).toBe(50);
      expect(r.examScore!.toNumber()).toBe(80);
    });
  });

  describe('no marks', () => {
    it('a student with no scored subjects yields null term result', () => {
      const out = computeResultSet(baseInput({
        students: [{ studentProfileId: 'empty', subjects: [{ subjectId: 's', passMark: 50, components: [], assessments: [] }] }],
      }));
      expect(out.students[0].term.meanPercent).toBeNull();
      expect(out.students[0].term.subjectsCount).toBe(0);
    });
  });

  describe('competition ranking with ties', () => {
    it('ties share rank 1, next rank skips to 3', () => {
      const out = computeResultSet(baseInput({
        students: [
          { studentProfileId: 'a', subjects: [pctSubject('s', 90)] }, // D1 gpa4
          { studentProfileId: 'b', subjects: [pctSubject('s', 92)] }, // D1 gpa4
          { studentProfileId: 'c', subjects: [pctSubject('s', 55)] }, // C6 gpa2
        ],
      }));
      const rank = (id: string) => out.students.find((s) => s.studentProfileId === id)!.term.classRank;
      expect(rank('a')).toBe(1);
      expect(rank('b')).toBe(1);
      expect(rank('c')).toBe(3);
    });
  });

  describe('UCE aggregate + division + eligibility', () => {
    it('best-8 aggregate and Division I', () => {
      const subjects = Array.from({ length: 8 }, (_, i) => ({ subjectId: `s${i}`, points: 3 })); // 8×C3 = 24
      const agg = computeUCEAggregate(subjects);
      expect(agg.best8Aggregate).toBe(24);
      expect(agg.eligible).toBe(true);
      expect(divisionUCE(agg.best8Aggregate, agg.eligible)).toBe('I');
    });
    it('4+ F9s disqualifies (U) even with a good aggregate', () => {
      const subjects = [
        { subjectId: 'a', points: 1 }, { subjectId: 'b', points: 1 }, { subjectId: 'c', points: 1 }, { subjectId: 'd', points: 1 },
        { subjectId: 'e', points: 9 }, { subjectId: 'f', points: 9 }, { subjectId: 'g', points: 9 }, { subjectId: 'h', points: 9 },
      ];
      const agg = computeUCEAggregate(subjects);
      expect(agg.f9Count).toBe(4);
      expect(agg.eligible).toBe(false);
      expect(divisionUCE(agg.best8Aggregate, agg.eligible)).toBe('U');
    });
    it('a compulsory subject failed at F9 breaks eligibility', () => {
      const subjects = [
        { subjectId: 'eng', points: 9, isCompulsory: true },
        { subjectId: 'b', points: 2 }, { subjectId: 'c', points: 2 },
      ];
      expect(computeUCEAggregate(subjects).eligible).toBe(false);
    });
  });

  describe('promotion recommendation', () => {
    it('all subjects passed → promote; none → repeat; mixed → review', () => {
      const mk = (pcts: number[]) => computeResultSet(baseInput({
        students: [{ studentProfileId: 'x', subjects: pcts.map((p, i) => pctSubject(`s${i}`, p)) }],
      })).students[0].term.promotionRecommendation;
      expect(mk([70, 80, 90])).toBe('promote');
      expect(mk([10, 20, 30])).toBe('repeat');
      expect(mk([70, 20, 90])).toBe('review');
    });
  });
});
