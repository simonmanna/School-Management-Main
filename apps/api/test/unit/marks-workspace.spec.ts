/**
 * The exam workspace — the four questions the UI asks.
 *
 * The behaviour that actually matters to a school is easy to state and easy to
 * regress:
 *
 *   1. a marksheet lists EVERY student in the class, marked or not;
 *   2. adding an exam to a class fans out to one paper per subject, and does
 *      not duplicate papers when it is run again;
 *   3. a class with marks on it cannot be silently removed from the exam;
 *   4. the results grid totals only the subjects that are marked, and ranks
 *      ties on the same position.
 *
 * Each test drives the service directly against a stubbed Prisma client.
 */
import { ConflictException } from '@nestjs/common';
import { MarksWorkspaceService } from '../../src/modules/school/examinations/marks-workspace.service';

const EXAM = {
  id: 'exam_1',
  name: 'Mid-Term',
  termId: 'term_1',
  startDate: new Date('2026-05-04'),
  term: { name: 'Term 1' },
  examType: { name: 'Mid-Term', weight: 30, isFinal: false },
};

function makeService(overrides: Record<string, any> = {}) {
  const client: any = {
    exam: { findFirst: jest.fn().mockResolvedValue(EXAM), findMany: jest.fn().mockResolvedValue([EXAM]) },
    examSchedule: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn(),
    },
    // The paper's lock now lives on its Assessment; the schedule column is the
    // legacy mirror, still read for papers locked before the cutover.
    assessment: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    gradeEntry: {
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    studentProfile: { findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
    schoolClass: { findFirst: jest.fn().mockResolvedValue({ id: 'class_1', name: 'S.1' }), findMany: jest.fn().mockResolvedValue([]) },
    subject: { findFirst: jest.fn().mockResolvedValue({ id: 'sub_math', name: 'Mathematics', code: 'MATH' }), findMany: jest.fn().mockResolvedValue([]) },
    teacherAssignment: { findMany: jest.fn().mockResolvedValue([]) },
    timetableSlot: { findMany: jest.fn().mockResolvedValue([]) },
    schoolProfile: { findFirst: jest.fn().mockResolvedValue({ gradingSystem: 'UCE' }) },
    term: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
  // Applying an exam now mints its gradebook columns in one transaction, so the
  // stub has to be able to open one.
  client.$transaction = jest.fn((fn: any) => (typeof fn === 'function' ? fn(client) : Promise.all(fn)));
  client.studentAssessment = { count: jest.fn().mockResolvedValue(0), ...(overrides.studentAssessment ?? {}) };

  const service = new MarksWorkspaceService(
    { client } as any,
    { organizationId: 'org_1', userId: 'user_1' } as any,
    { record: jest.fn(), recordInTx: jest.fn() } as any,
    {
      bulkUpsert: jest.fn().mockResolvedValue({ count: 1, results: [{ id: 'ge_1', marksObtained: 70, grade: 'B', version: 1 }] }),
      clearEntry: jest.fn().mockResolvedValue({ cleared: true, examScheduleId: 'sched_1', row: { id: 'ge_1' } }),
    } as any,
    { bandFor: jest.fn().mockResolvedValue({ grade: 'B', gpa: 3, min: 60, max: 79 }) } as any,
    { forExamSchedules: jest.fn().mockResolvedValue(0), forExamSchedule: jest.fn().mockResolvedValue(null) } as any,
  );
  return { service, client, grades: (service as any).grades };
}

/**
 * Seed the SPINE for one or more papers.
 *
 * Marks used to be seeded as GradeEntry rows because that is where the marks
 * workspace read them. It reads the assessment spine now, so the fixtures move
 * with it — every assertion below is unchanged, which is the point: the flip
 * was meant to change where a mark lives, not what the screen does.
 *
 * `marks` is keyed by studentProfileId; a value of `null` with a participation
 * means a resolved non-scoring outcome (absent, exempt…).
 */
function seedSpine(
  client: any,
  papers: Array<{
    scheduleId: string;
    marks: Record<string, number | null>;
    participation?: Record<string, string>;
  }>,
) {
  const rows = papers.map((p) => ({
    id: `assess_${p.scheduleId}`,
    sourceRef: p.scheduleId,
    sourceType: 'exam_session',
    lockedAt: null,
    studentAssessments: Object.entries(p.marks).map(([studentProfileId, score]) => ({
      id: `sa_${p.scheduleId}_${studentProfileId}`,
      studentProfileId,
      effectiveScore: score,
      participation: p.participation?.[studentProfileId] ?? 'present',
      approvalStatus: 'draft',
    })),
  }));
  client.assessment.findMany.mockResolvedValue(rows);
  client.assessment.findFirst.mockImplementation(({ where }: any) => {
    const ref = where?.sourceRef;
    const id = typeof ref === 'string' ? ref : undefined;
    return Promise.resolve(rows.find((r) => r.sourceRef === id) ?? null);
  });
  client.studentAssessment.count.mockResolvedValue(
    rows.reduce((n, r) => n + r.studentAssessments.length, 0),
  );
  return rows;
}

function student(id: string, name: string, extra: Record<string, any> = {}) {
  return {
    id,
    admissionNo: `ADM-${id}`,
    currentClassId: 'class_1',
    currentSectionId: null,
    currentStreamId: null,
    currentStream: null,
    partner: { name },
    ...extra,
  };
}

describe('MarksWorkspaceService — marksheet', () => {
  it('lists every student in the class, including those with no mark yet', async () => {
    const { service, client } = makeService();
    client.studentProfile.findMany.mockResolvedValue([
      student('s1', 'Achieng Mary'),
      student('s2', 'Bwire Paul'),
      student('s3', 'Candia Grace'),
    ]);
    client.examSchedule.findFirst.mockResolvedValue({
      id: 'sched_1', maxMarks: 100, marksLockedAt: null,
    });
    // Only one of the three has been marked.
    seedSpine(client, [{ scheduleId: 'sched_1', marks: { s2: 64 } }]);
    client.gradeEntry.findMany.mockResolvedValue([
      { id: 'ge_1', studentProfileId: 's2', marksObtained: 64, grade: 'B', remarks: null, status: 'draft', version: 1 },
    ]);

    const sheet = await service.sheet({ examId: 'exam_1', classId: 'class_1', subjectId: 'sub_math' });

    expect(sheet.students).toHaveLength(3);
    expect(sheet.total).toBe(3);
    expect(sheet.entered).toBe(1);
    expect(sheet.students.map((s) => s.name)).toEqual(['Achieng Mary', 'Bwire Paul', 'Candia Grace']);
    expect(sheet.students[0].marks).toBeNull();
    expect(sheet.students[1].marks).toBe(64);
  });

  it('reports the paper as unapplied — with the full roster — when no schedule exists yet', async () => {
    const { service, client } = makeService();
    client.studentProfile.findMany.mockResolvedValue([student('s1', 'Achieng Mary')]);
    client.examSchedule.findFirst.mockResolvedValue(null);

    const sheet = await service.sheet({ examId: 'exam_1', classId: 'class_1', subjectId: 'sub_math' });

    expect(sheet.applied).toBe(false);
    expect(sheet.examScheduleId).toBeNull();
    expect(sheet.students).toHaveLength(1);
    expect(sheet.maxMarks).toBe(100);
  });

  it('counts a non-scoring outcome as entered, so "absent" is not read as "not done"', async () => {
    const { service, client } = makeService();
    client.studentProfile.findMany.mockResolvedValue([student('s1', 'Achieng Mary'), student('s2', 'Bwire Paul')]);
    client.examSchedule.findFirst.mockResolvedValue({ id: 'sched_1', maxMarks: 100, marksLockedAt: null });
    seedSpine(client, [
      { scheduleId: 'sched_1', marks: { s1: null }, participation: { s1: 'absent' } },
    ]);

    const sheet = await service.sheet({ examId: 'exam_1', classId: 'class_1', subjectId: 'sub_math' });

    expect(sheet.students[0].participation).toBe('absent');
    expect(sheet.entered).toBe(1);
  });

  it('refuses a mark once the paper is locked', async () => {
    const { service, client } = makeService();
    client.examSchedule.findFirst.mockResolvedValue({
      id: 'sched_1', maxMarks: 100, marksLockedAt: new Date('2026-05-20'),
    });

    await expect(
      service.saveMark({ examId: 'exam_1', classId: 'class_1', subjectId: 'sub_math', studentProfileId: 's1', marks: 50 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a mark above the paper maximum', async () => {
    const { service, client } = makeService();
    client.examSchedule.findFirst.mockResolvedValue({ id: 'sched_1', maxMarks: 40, marksLockedAt: null });
    client.studentProfile.findFirst.mockResolvedValue({ id: 's1' });

    await expect(
      service.saveMark({ examId: 'exam_1', classId: 'class_1', subjectId: 'sub_math', studentProfileId: 's1', marks: 41 }),
    ).rejects.toThrow(/between 0 and 40/);
  });

  /**
   * Clearing used to write `gradeEntry` from this service directly and return,
   * with no projection — so the legacy row was cleared while the assessment
   * spine kept the old score, and the gradebook, the result run and the report
   * card all went on counting a mark the teacher had erased. Clearing has to
   * travel the same atomic, projecting path as any other mark write.
   */
  it('routes a cleared mark through the projecting path, never straight at GradeEntry', async () => {
    const { service, client, grades } = makeService();
    client.examSchedule.findFirst.mockResolvedValue({ id: 'sched_1', maxMarks: 100, marksLockedAt: null });
    client.studentProfile.findFirst.mockResolvedValue({ id: 's1' });

    const res = await service.saveMark({
      examId: 'exam_1', classId: 'class_1', subjectId: 'sub_math', studentProfileId: 's1', marks: null,
    });

    expect(res.cleared).toBe(true);
    expect(grades.clearEntry).toHaveBeenCalledWith({
      examScheduleId: 'sched_1', studentProfileId: 's1', remarks: null,
    });
    expect(client.gradeEntry.updateMany).not.toHaveBeenCalled();
    expect(client.gradeEntry.create).not.toHaveBeenCalled();
  });

  it('records a non-scoring outcome as the legacy remark, so the projection can read it back', async () => {
    const { service, client, grades } = makeService();
    client.examSchedule.findFirst.mockResolvedValue({ id: 'sched_1', maxMarks: 100, marksLockedAt: null });
    client.studentProfile.findFirst.mockResolvedValue({ id: 's1' });

    await service.saveMark({
      examId: 'exam_1', classId: 'class_1', subjectId: 'sub_math', studentProfileId: 's1',
      marks: null, participation: 'absent',
    });

    expect(grades.clearEntry).toHaveBeenCalledWith({
      examScheduleId: 'sched_1', studentProfileId: 's1', remarks: 'absent',
    });
  });

  it('creates the paper on demand when a mark is typed into one that was never applied', async () => {
    const { service, client } = makeService();
    client.examSchedule.findFirst.mockResolvedValue(null);
    client.examSchedule.create.mockResolvedValue({ id: 'sched_new', maxMarks: 100, marksLockedAt: null });
    client.studentProfile.findFirst.mockResolvedValue({ id: 's1' });

    const res = await service.saveMark({
      examId: 'exam_1', classId: 'class_1', subjectId: 'sub_math', studentProfileId: 's1', marks: 70,
    });

    expect(client.examSchedule.create).toHaveBeenCalled();
    expect(res.examScheduleId).toBe('sched_new');
  });
});

describe('MarksWorkspaceService — applying an exam to classes', () => {
  it('creates one paper per subject the class takes', async () => {
    const { service, client } = makeService();
    client.teacherAssignment.findMany.mockResolvedValue([{ subjectId: 'sub_math' }, { subjectId: 'sub_eng' }]);
    client.subject.findMany.mockResolvedValue([
      { id: 'sub_math', name: 'Mathematics', code: 'MATH', isCore: true },
      { id: 'sub_eng', name: 'English', code: 'ENG', isCore: true },
    ]);
    client.examSchedule.createMany.mockResolvedValue({ count: 2 });

    const res = await service.applyClasses({ examId: 'exam_1', classIds: ['class_1'] });

    expect(res.created).toBe(2);
    const rows = client.examSchedule.createMany.mock.calls[0][0].data;
    expect(rows.map((r: any) => r.subjectId).sort()).toEqual(['sub_eng', 'sub_math']);
    expect(rows.every((r: any) => r.classId === 'class_1' && r.examId === 'exam_1')).toBe(true);
  });

  it('is idempotent — re-applying only fills the gaps', async () => {
    const { service, client } = makeService();
    client.teacherAssignment.findMany.mockResolvedValue([{ subjectId: 'sub_math' }, { subjectId: 'sub_eng' }]);
    client.subject.findMany.mockResolvedValue([
      { id: 'sub_math', name: 'Mathematics', code: 'MATH', isCore: true },
      { id: 'sub_eng', name: 'English', code: 'ENG', isCore: true },
    ]);
    // Maths is already scheduled for this class.
    client.examSchedule.findMany.mockResolvedValue([{ classId: 'class_1', subjectId: 'sub_math' }]);
    client.examSchedule.createMany.mockResolvedValue({ count: 1 });

    await service.applyClasses({ examId: 'exam_1', classIds: ['class_1'] });

    const rows = client.examSchedule.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
    expect(rows[0].subjectId).toBe('sub_eng');
  });

  it('falls back to every subject when no teaching load or timetable is set up', async () => {
    const { service, client } = makeService();
    client.subject.findMany.mockResolvedValue([
      { id: 'sub_a', name: 'Art', code: 'ART', isCore: false },
      { id: 'sub_b', name: 'Biology', code: 'BIO', isCore: true },
    ]);
    client.examSchedule.createMany.mockResolvedValue({ count: 2 });

    const res = await service.applyClasses({ examId: 'exam_1', classIds: ['class_1'] });

    expect(res.created).toBe(2);
    expect(client.subject.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('will not remove a class that already has marks', async () => {
    const { service, client } = makeService();
    client.examSchedule.findMany.mockResolvedValue([{ id: 'sched_1' }]);
    client.gradeEntry.count.mockResolvedValue(12);

    await expect(service.removeClass({ examId: 'exam_1', classId: 'class_1' }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(client.examSchedule.deleteMany).not.toHaveBeenCalled();
  });

  /**
   * The guard has to see marks that arrived through the spine, not only ones
   * with a legacy row behind them — otherwise unticking a box cascade-deletes
   * real marks the user could see on screen a moment earlier.
   */
  it('will not remove a class whose marks exist only on the spine', async () => {
    const { service, client } = makeService();
    client.examSchedule.findMany.mockResolvedValue([{ id: 'sched_1' }]);
    client.gradeEntry.count.mockResolvedValue(0);
    client.studentAssessment.count.mockResolvedValue(7);

    await expect(service.removeClass({ examId: 'exam_1', classId: 'class_1' }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(client.examSchedule.deleteMany).not.toHaveBeenCalled();
  });

  it('removes a class that has no marks', async () => {
    const { service, client } = makeService();
    client.examSchedule.findMany.mockResolvedValue([{ id: 'sched_1' }, { id: 'sched_2' }]);
    client.gradeEntry.count.mockResolvedValue(0);
    client.studentAssessment.count.mockResolvedValue(0);
    client.examSchedule.deleteMany.mockResolvedValue({ count: 2 });

    const res = await service.removeClass({ examId: 'exam_1', classId: 'class_1' });
    expect(res.removed).toBe(2);
  });
});

describe('MarksWorkspaceService — results grid', () => {
  function gridService() {
    const { service, client } = makeService();
    client.examSchedule.findMany.mockResolvedValue([
      { id: 'sched_m', subjectId: 'sub_math', maxMarks: 100, marksLockedAt: null, subject: { name: 'Mathematics', code: 'MATH' } },
      { id: 'sched_e', subjectId: 'sub_eng', maxMarks: 100, marksLockedAt: null, subject: { name: 'English', code: 'ENG' } },
    ]);
    client.studentProfile.findMany.mockResolvedValue([
      student('s1', 'Achieng Mary'),
      student('s2', 'Bwire Paul'),
      student('s3', 'Candia Grace'),
    ]);
    return { service, client };
  }

  it('totals only the subjects that are marked, and ranks by total', async () => {
    const { service, client } = gridService();
    // s2 has no English mark; s3 has nothing at all.
    seedSpine(client, [
      { scheduleId: 'sched_m', marks: { s1: 80, s2: 90 } },
      { scheduleId: 'sched_e', marks: { s1: 70 } },
    ]);

    const grid = await service.grid({ examId: 'exam_1', classId: 'class_1' });

    const byName = Object.fromEntries(grid.students.map((s) => [s.name, s]));
    expect(byName['Achieng Mary'].total).toBe(150);
    expect(byName['Achieng Mary'].subjectsMarked).toBe(2);
    expect(byName['Achieng Mary'].position).toBe(1);

    expect(byName['Bwire Paul'].total).toBe(90);
    expect(byName['Bwire Paul'].subjectsMarked).toBe(1);
    expect(byName['Bwire Paul'].average).toBe(90); // average over MARKED subjects only
    expect(byName['Bwire Paul'].position).toBe(2);

    expect(byName['Candia Grace'].total).toBeNull();
    expect(byName['Candia Grace'].position).toBe(0); // unranked, not "last"
  });

  it('gives tied students the same position', async () => {
    const { service, client } = gridService();
    seedSpine(client, [{ scheduleId: 'sched_m', marks: { s1: 75, s2: 75, s3: 50 } }]);

    const grid = await service.grid({ examId: 'exam_1', classId: 'class_1' });
    const byName = Object.fromEntries(grid.students.map((s) => [s.name, s]));

    expect(byName['Achieng Mary'].position).toBe(1);
    expect(byName['Bwire Paul'].position).toBe(1);
    expect(byName['Candia Grace'].position).toBe(3); // competition ranking skips 2
  });

  it('reports completion against class size × papers', async () => {
    const { service, client } = gridService();
    seedSpine(client, [{ scheduleId: 'sched_m', marks: { s1: 80 } }]);

    const grid = await service.grid({ examId: 'exam_1', classId: 'class_1' });

    expect(grid.classSize).toBe(3);
    expect(grid.paperCount).toBe(2);
    expect(grid.marksExpected).toBe(6);
    expect(grid.marksEntered).toBe(1);
    expect(grid.complete).toBe(false);
  });

  it('surfaces a non-scoring outcome in the cell instead of a blank', async () => {
    const { service, client } = gridService();
    seedSpine(client, [
      { scheduleId: 'sched_m', marks: { s1: null }, participation: { s1: 'absent' } },
    ]);

    const grid = await service.grid({ examId: 'exam_1', classId: 'class_1' });
    const mary = grid.students.find((s) => s.name === 'Achieng Mary')!;

    expect(mary.cells['sub_math'].participation).toBe('absent');
    expect(mary.cells['sub_math'].marks).toBeNull();
  });
});
