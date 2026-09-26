import {
  computeResultSet,
  isDescriptorSystem,
  type ResultInput,
  type SubjectInput,
} from './result-computation';
import { defaultBands } from './grade-bands';

/**
 * Nursery reporting in the result kernel (Wave 12).
 *
 * A nursery card carries a descriptor per learning area and nothing that invites
 * a comparison: no GPA, no aggregate, no division, no position in class. The
 * whole engine was built for an exam-driven secondary school and was inherited
 * downwards, so a Top Class pupil was previously reported on the school's PLE
 * scale with a GPA and a rank. These tests pin the opposite.
 */
const ECD_BANDS = defaultBands('ECD');

const learningArea = (subjectId: string, pct: number): SubjectInput => ({
  subjectId,
  passMark: 50,
  components: [],
  assessments: [{ componentId: null, kind: 'observation', effectiveScore: pct, maxScore: 100, participation: 'present' }],
});

const nursery = (students: ResultInput['students']): ResultInput => ({
  gradingSystem: 'ECD',
  bands: ECD_BANDS,
  roundingMode: 'half_up',
  decimalPlaces: 2,
  rankOn: 'none',
  students,
});

describe('result kernel: nursery (ECD) reporting', () => {
  it('names ECD as a descriptor system and nothing else', () => {
    expect(isDescriptorSystem('ECD')).toBe(true);
    for (const system of ['PLE', 'UCE', 'UACE', 'CBC', 'generic']) {
      expect(isDescriptorSystem(system)).toBe(false);
    }
  });

  it('reads a descriptor off the band, with no grade points', () => {
    const out = computeResultSet(
      nursery([{ studentProfileId: 'child-1', subjects: [learningArea('language', 85), learningArea('numeracy', 45)] }]),
    );
    const [child] = out.students;
    expect(child.subjects.map((s) => s.grade)).toEqual(['Confident', 'Beginning']);
    // The descriptor bands carry gpa 0 so the arithmetic stays total; the term
    // must not average them into a printable "0.00".
    expect(child.term.gpa).toBeNull();
  });

  it('reports no aggregate, division or promotion verdict', () => {
    const out = computeResultSet(
      nursery([{ studentProfileId: 'child-1', subjects: [learningArea('language', 30), learningArea('numeracy', 20)] }]),
    );
    const { term } = out.students[0];
    expect(term.aggregate).toBeNull();
    expect(term.division).toBeNull();
    // Two learning areas below the pass mark would be 'repeat' under the
    // secondary rules. Nursery promotes on age and readiness, so the kernel
    // declines to recommend and leaves it to the class teacher's comment.
    expect(term.promotionRecommendation).toBe('review');
    expect(term.eligible).toBe(true);
  });

  it('still reports the mean the descriptor was read off', () => {
    const out = computeResultSet(
      nursery([{ studentProfileId: 'child-1', subjects: [learningArea('language', 80), learningArea('numeracy', 60)] }]),
    );
    expect(String(out.students[0].term.meanPercent)).toBe('70');
  });

  it('ranks nobody — not in class, not per learning area', () => {
    const out = computeResultSet(
      nursery([
        { studentProfileId: 'child-1', subjects: [learningArea('language', 95)] },
        { studentProfileId: 'child-2', subjects: [learningArea('language', 41)] },
        { studentProfileId: 'child-3', subjects: [learningArea('language', 70)] },
      ]),
    );
    expect(out.students.map((s) => s.term.classRank)).toEqual([null, null, null]);
    expect(out.students.flatMap((s) => s.subjects.map((x) => x.subjectRank))).toEqual([null, null, null]);
  });

  it('leaves a ranked cohort ranked — the switch is rankOn, not the system', () => {
    // Same three learners, a primary programme's configuration. Proof that
    // `rankOn: 'none'` is what suppresses ranking, so a school that wants its
    // nursery ranked can have it by configuring the programme.
    const out = computeResultSet({
      ...nursery([
        { studentProfileId: 'child-1', subjects: [learningArea('language', 95)] },
        { studentProfileId: 'child-2', subjects: [learningArea('language', 41)] },
        { studentProfileId: 'child-3', subjects: [learningArea('language', 70)] },
      ]),
      rankOn: 'meanPercent',
    });
    expect(out.students.map((s) => s.term.classRank)).toEqual([1, 3, 2]);
  });
});
