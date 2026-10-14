/**
 * Academics Phase 0 (review 2026-10-14) — what parents see must be right.
 *
 *  A1/A6  each level is graded by its own profile, never the school-wide UCE
 *         fallback: nursery descriptors, P1–P3 grades with no aggregate by
 *         default, P4–P7 an aggregate over four NAMED subjects.
 *  A5     the aggregate is built from the programme's four subjects — never
 *         from every subject ticked "core".
 *  A3/A4  a printed card states the stored result only; editing a grading
 *         scale after release can never change a card a parent already holds.
 */
import { reportingPolicy } from '../../src/modules/school/assessment/reporting-policy';
import { computeResultSet, type ResultInput, type SubjectInput } from '../../src/modules/school/assessment/result-computation';
import { ReportCardTemplateService } from '../../src/modules/school/examinations/report-card-template.service';

const PLE_BANDS = [
  { min: 90, max: 100, grade: 'D1', gpa: 4, points: 1, remark: 'Distinction' },
  { min: 80, max: 89, grade: 'D2', gpa: 3.6, points: 2, remark: 'Distinction' },
  { min: 70, max: 79, grade: 'C3', gpa: 3.2, points: 3, remark: 'Credit' },
  { min: 65, max: 69, grade: 'C4', gpa: 2.8, points: 4, remark: 'Credit' },
  { min: 60, max: 64, grade: 'C5', gpa: 2.4, points: 5, remark: 'Credit' },
  { min: 50, max: 59, grade: 'C6', gpa: 2.0, points: 6, remark: 'Credit' },
  { min: 40, max: 49, grade: 'P7', gpa: 1.5, points: 7, remark: 'Pass' },
  { min: 35, max: 39, grade: 'P8', gpa: 1.0, points: 8, remark: 'Pass' },
  { min: 0, max: 34, grade: 'F9', gpa: 0, points: 9, remark: 'Fail' },
];

describe('reportingPolicy — a grading profile per level (A1, A6)', () => {
  it('nursery: descriptors, never ranked, even in a school whose fallback is UCE', () => {
    expect(reportingPolicy({ stage: 'PRE_PRIMARY', config: {} }, 'UCE')).toEqual({
      gradingSystem: 'ECD', rankOn: 'none', aggregateSubjectIds: [], aggregateSubjectCodes: [],
    });
  });

  it('lower primary: D1–F9 grades, no aggregate, not ranked unless the school turns it on', () => {
    expect(reportingPolicy({ stage: 'PRIMARY_LOWER', config: {} }, 'UCE')).toMatchObject({
      gradingSystem: 'PLE', rankOn: 'none', aggregateSubjectIds: [], aggregateSubjectCodes: [],
    });
    expect(reportingPolicy({ stage: 'PRIMARY_LOWER', config: { ranksLearners: true } }, 'PLE').rankOn).toBe('meanPercent');
  });

  it('upper primary: aggregate over the named subjects, ranked on it', () => {
    expect(reportingPolicy({ stage: 'PRIMARY_UPPER', config: { aggregateSubjectCodes: ['ENG', 'MTC', 'SCI', 'SST'] } }, 'UCE'))
      .toMatchObject({ gradingSystem: 'PLE', rankOn: 'aggregate', aggregateSubjectCodes: ['ENG', 'MTC', 'SCI', 'SST'] });
  });

  it('upper primary with no aggregate subjects yet is ranked on the mean, not on an aggregate it lacks', () => {
    expect(reportingPolicy({ stage: 'PRIMARY_UPPER', config: {} }, 'PLE').rankOn).toBe('meanPercent');
  });

  it('honours the legacy template key `pleSubjects` and an explicit rankOn', () => {
    const p = reportingPolicy({ stage: 'PRIMARY_UPPER', config: { pleSubjects: ['ENG'], rankOn: 'none' } }, 'PLE');
    expect(p.aggregateSubjectCodes).toEqual(['ENG']);
    expect(p.rankOn).toBe('none');
  });

  it('a stage with no primary default falls back to the school system', () => {
    expect(reportingPolicy({ stage: 'LOWER_SECONDARY', config: {} }, 'UCE').gradingSystem).toBe('UCE');
  });
});

/** Four core subjects plus RE, all ticked "core" (compulsory). */
function pupil(id: string, marks: Record<string, number>): { studentProfileId: string; subjects: SubjectInput[] } {
  return {
    studentProfileId: id,
    subjects: Object.entries(marks).map(([subjectId, pct]) => ({
      subjectId,
      isCore: true,
      passMark: 50,
      components: [{ id: 'c1', kind: 'exam', weight: 100, aggregation: 'mean' }],
      assessments: [{ componentId: 'c1', kind: 'exam', effectiveScore: String(pct), maxScore: '100', participation: 'present' }],
    })),
  };
}

const base = (over: Partial<ResultInput>): ResultInput => ({
  gradingSystem: 'PLE', bands: PLE_BANDS, roundingMode: 'half_up', decimalPlaces: 2, rankOn: 'aggregate', students: [], ...over,
});

describe('PLE aggregate from the programme’s named subjects (A5, A6)', () => {
  const kato = pupil('kato', { ENG: 92, MTC: 83, SCI: 90, SST: 88, RE: 95 });

  it('aggregates exactly the four named subjects — RE ticked "core" does not count', () => {
    const out = computeResultSet(base({ aggregateSubjectIds: ['ENG', 'MTC', 'SCI', 'SST'], students: [kato] }));
    expect(out.students[0].term.aggregate).toBe(6); // D1 D2 D1 D2
    expect(out.students[0].term.division).toBe('I');
  });

  it('the legacy isCore pool would have taken the best four of five, including RE', () => {
    const out = computeResultSet(base({ students: [kato] }));
    expect(out.students[0].term.aggregate).toBe(5); // D1 (RE) D1 D1 D2 — the A5 defect, kept only for the golden suite
  });

  it('an empty list means no aggregate and no division — never "U" for a P1 child', () => {
    const p1 = pupil('p1', { LIT1: 81, LIT2: 77, MTC: 90 });
    const out = computeResultSet(base({ aggregateSubjectIds: [], rankOn: 'meanPercent', students: [p1] }));
    expect(out.students[0].term.aggregate).toBeNull();
    expect(out.students[0].term.division).toBeNull();
    expect(out.students[0].term.eligible).toBe(true);
    expect(out.students[0].subjects.map((s) => s.grade)).toEqual(['D2', 'C3', 'D1']);
  });

  it('a missing named paper is Ungraded with no aggregate, not a flatteringly small one', () => {
    const absent = pupil('absent', { ENG: 92, MTC: 83, SCI: 90 });
    const out = computeResultSet(base({ aggregateSubjectIds: ['ENG', 'MTC', 'SCI', 'SST'], students: [absent] }));
    expect(out.students[0].term.aggregate).toBeNull();
    expect(out.students[0].term.division).toBe('U');
    expect(out.students[0].term.eligible).toBe(false);
  });
});

describe('Report card prints the stored result only (A3, A4)', () => {
  function template(subjects: any[], components: any[] = []) {
    const prisma: any = {
      client: {
        studentProfile: { findFirst: jest.fn().mockResolvedValue({ id: 'stu' }) },
        schoolProfile: { findFirst: jest.fn().mockResolvedValue({ gradingSystem: 'UCE' }) },
        subject: { findMany: jest.fn().mockResolvedValue(subjects) },
        assessmentComponent: { findMany: jest.fn().mockResolvedValue(components) },
      },
    };
    const grading: any = { bandFor: jest.fn() };
    return { svc: new ReportCardTemplateService(prisma, { organizationId: 'org' } as any, grading), grading };
  }

  const spine = (overrides: { bands?: any[]; term?: Record<string, unknown> } = {}) => ({
    subjects: [
      { subjectId: 'sci', finalPercent: '80', grade: 'D2', points: 2, gradePoint: '3.6', componentBreakdown: [{ componentId: 'mot', kind: 'exam', componentPercent: '78' }] },
      { subjectId: 'eng', finalPercent: '64', grade: 'C5', points: 5, gradePoint: '2.4', componentBreakdown: [] },
    ],
    term: { aggregate: 16, division: 'II', classRank: 3, meanPercent: '71.5', gpa: '3.0', subjectsCount: 4, ...(overrides.term ?? {}) },
    resultSet: { gradingSystem: 'PLE', gradingScaleSnapshot: { bands: overrides.bands ?? PLE_BANDS } },
  });

  it('grade, points, aggregate and division come from the stored result, and the column is the component’s name', async () => {
    const { svc, grading } = template(
      [{ id: 'sci', name: 'Science', code: 'SCI' }, { id: 'eng', name: 'English', code: 'ENG' }],
      [{ id: 'mot', name: 'Mid Term (MOT)', kind: 'exam' }],
    );
    const { layout, stats } = await svc.buildLayout('stu', 'term', spine() as any);
    const sci = layout.sections[0].subjects.find((s) => s.subject === 'Science')!;
    expect(sci.finalGrade).toBe('D2');
    expect(sci.remark).toBe('Distinction');
    expect(sci.examScores[0].examType).toBe('Mid Term (MOT)');
    expect(layout.summary).toEqual([{ label: 'Aggregate', value: '16' }, { label: 'Division', value: 'II' }]);
    expect(stats).toMatchObject({ aggregate: 16, division: 'II', meanPercent: 71.5 });
    // Nothing is re-banded against today's scale.
    expect(grading.bandFor).not.toHaveBeenCalled();
  });

  it('editing the grading scale after release cannot change the printed card', async () => {
    const subjects = [{ id: 'sci', name: 'Science', code: 'SCI' }, { id: 'eng', name: 'English', code: 'ENG' }];
    const before = await template(subjects).svc.buildLayout('stu', 'term', spine() as any);
    // The school later re-cuts and rewords its LIVE scale: 80% is now "C3 —
    // Good". The released result's snapshot is what the card reads, so the
    // printed grade, remark and headline stay exactly as released.
    const edited = template(subjects);
    edited.grading.bandFor.mockResolvedValue({ min: 75, max: 84, grade: 'C3', points: 3, gpa: 3, remark: 'Good' });
    const after = await edited.svc.buildLayout('stu', 'term', spine() as any);
    expect(after.layout).toEqual(before.layout);
    expect(after.stats).toEqual(before.stats);
    const sci = after.layout.sections[0].subjects.find((s) => s.subject === 'Science')!;
    expect([sci.finalGrade, sci.remark]).toEqual(['D2', 'Distinction']);
  });

  it('a class with no aggregate prints no aggregate and no division (lower primary)', async () => {
    const { svc } = template([{ id: 'sci', name: 'Science', code: 'SCI' }, { id: 'eng', name: 'English', code: 'ENG' }]);
    const { layout } = await svc.buildLayout('stu', 'term', spine({ term: { aggregate: null, division: null } }) as any);
    expect(layout.summary).toEqual([]);
    expect(layout.eligible).toBeUndefined();
  });

  it('a nursery result renders the descriptor layout, whatever the school-wide system', async () => {
    const { svc } = template([{ id: 'sci', name: 'Mathematical Concepts', code: 'ECD-NUM' }, { id: 'eng', name: 'Communication', code: 'ECD-COM' }]);
    const nursery = { ...spine({ term: { aggregate: null, division: null, classRank: null } }), resultSet: { gradingSystem: 'ECD', gradingScaleSnapshot: { bands: [] } } };
    const { layout } = await svc.buildLayout('stu', 'term', nursery as any);
    expect(layout.system).toBe('ECD');
    expect(layout.summary.map((s) => s.label)).not.toContain('Division');
  });
});
