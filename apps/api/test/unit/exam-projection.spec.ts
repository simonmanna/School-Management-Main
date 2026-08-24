/**
 * The GradeEntry → assessment-spine projection.
 *
 * The projection's whole job is to make the legacy row and the spine agree.
 * Two ways it silently failed to do that:
 *
 *   1. `participation` was written once, as a hardcoded `'present'`, and never
 *      updated. `GradeEntry` records a non-scoring outcome in free-text
 *      `remarks`, so an absence never reached the spine at all — which means
 *      `countsAbsentAsZero` has never once fired for an exam mark.
 *
 *   2. a `GradeEntry` with `marksObtained: null` was skipped entirely, so a
 *      cleared mark left the previous score standing in the spine forever. The
 *      marksheet showed the cell empty while the gradebook, the result run and
 *      the report card all still counted the old mark.
 *
 * Both are data-integrity bugs rather than cosmetic ones, so they are pinned
 * here against a stubbed transaction — no database involved.
 */
import { AssessmentProjectionService } from '../../src/modules/school/assessment/assessment-projection.service';

const SCHEDULE = {
  id: 'sched_1',
  classId: 'class_1',
  subjectId: 'sub_math',
  maxMarks: 100,
  exam: { termId: 'term_1', name: 'Mid-Term', examTypeId: null },
  subject: { name: 'Mathematics' },
};

const ASSESSMENT = { id: 'assess_1', maxScore: 100 };

function makeService(gradeEntries: any[]) {
  const postMark = jest.fn().mockResolvedValue({});
  const tx: any = {
    examSchedule: { findFirst: jest.fn().mockResolvedValue(SCHEDULE) },
    gradeEntry: { findMany: jest.fn().mockResolvedValue(gradeEntries) },
    assessment: {
      findFirst: jest.fn().mockResolvedValue(ASSESSMENT),
      create: jest.fn().mockResolvedValue(ASSESSMENT),
    },
    assessmentComponent: { findFirst: jest.fn().mockResolvedValue(null) },
    studentAssessment: {
      upsert: jest.fn().mockImplementation(({ where }: any) => ({
        id: `sa_${where.assessmentId_studentProfileId.studentProfileId}`,
      })),
    },
  };

  const service = new AssessmentProjectionService(
    { client: tx } as any,
    { organizationId: 'org_1', userId: 'user_1' } as any,
    { postMark } as any,
  );
  return { service, tx, postMark };
}

/** The `create`/`update` bodies handed to the StudentAssessment upsert. */
function upsertBodies(tx: any, studentProfileId: string) {
  const call = tx.studentAssessment.upsert.mock.calls.find(
    ([arg]: any) => arg.where.assessmentId_studentProfileId.studentProfileId === studentProfileId,
  );
  return { create: call[0].create, update: call[0].update };
}

describe('exam → spine projection', () => {
  it('carries a non-scoring outcome across, instead of asserting everyone was present', async () => {
    const { service, tx } = makeService([
      { studentProfileId: 's1', marksObtained: null, maxMarks: 100, remarks: 'absent', status: 'draft' },
    ]);

    await service.projectExamSchedule(tx, 'sched_1');

    const { create, update } = upsertBodies(tx, 's1');
    expect(create.participation).toBe('absent');
    // The update half matters more than the create half: a student marked
    // present first and absent afterwards used to keep the stale 'present'.
    expect(update.participation).toBe('absent');
  });

  it('re-derives participation on every projection, so present → absent is not sticky', async () => {
    const { service, tx } = makeService([
      { studentProfileId: 's1', marksObtained: 55, maxMarks: 100, remarks: null, status: 'draft' },
    ]);

    await service.projectExamSchedule(tx, 'sched_1');

    const { update } = upsertBodies(tx, 's1');
    expect(update.participation).toBe('present');
  });

  it('ignores a free-text remark that is not a participation outcome', async () => {
    const { service, tx } = makeService([
      { studentProfileId: 's1', marksObtained: 70, maxMarks: 100, remarks: 'Neat work', status: 'draft' },
    ]);

    await service.projectExamSchedule(tx, 'sched_1');

    expect(upsertBodies(tx, 's1').create.participation).toBe('present');
  });

  it('clears the spine when the legacy mark is cleared, rather than skipping the row', async () => {
    const { service, tx, postMark } = makeService([
      { studentProfileId: 's1', marksObtained: null, maxMarks: 100, remarks: null, status: 'draft', enteredById: 'user_1' },
    ]);

    await service.projectExamSchedule(tx, 'sched_1');

    expect(postMark).toHaveBeenCalledTimes(1);
    expect(postMark).toHaveBeenCalledWith(tx, expect.objectContaining({
      studentAssessmentId: 'sa_s1',
      score: null,
      source: 'exam',
    }));
  });

  it('still posts a real score, and leaves the ledger arithmetic to postMark', async () => {
    const { service, tx, postMark } = makeService([
      { studentProfileId: 's1', marksObtained: 72, maxMarks: 100, remarks: null, status: 'approved', enteredById: 'user_1' },
      { studentProfileId: 's2', marksObtained: null, maxMarks: 100, remarks: 'exempt', status: 'draft', enteredById: 'user_1' },
    ]);

    await service.projectExamSchedule(tx, 'sched_1');

    expect(postMark).toHaveBeenNthCalledWith(1, tx, expect.objectContaining({ score: 72, allowWhenApproved: true }));
    expect(postMark).toHaveBeenNthCalledWith(2, tx, expect.objectContaining({ score: null }));
    expect(upsertBodies(tx, 's2').create.status).toBe('assigned');
    expect(upsertBodies(tx, 's1').create.status).toBe('graded');
  });

  it('does nothing for a schedule with no marks at all', async () => {
    const { service, tx, postMark } = makeService([]);

    await expect(service.projectExamSchedule(tx, 'sched_1')).resolves.toBeNull();
    expect(postMark).not.toHaveBeenCalled();
  });
});
