/**
 * Integration — the four-step exam workspace, end to end against a real DB.
 *
 * The unit spec proves the decisions; this proves the wiring: that a school can
 * go from "no exam" to "a results sheet with positions" using only the calls the
 * new UI makes, and that the marks it writes are the same GradeEntry rows the
 * rest of the system (report cards, the assessment spine) already reads.
 *
 * Same DB requirement as the other school integration specs.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';
import { KernelModule } from '../../src/kernel/kernel.module';
import { DocumentsModule } from '../../src/modules/documents/documents.module';
import { CoreModule } from '../../src/modules/core/core.module';
import { AccountingModule } from '../../src/modules/accounting/accounting.module';
import { InventoryModule } from '../../src/modules/inventory/inventory.module';
import { InvoicingModule } from '../../src/modules/invoicing/invoicing.module';
import { SchoolModule } from '../../src/modules/school/school.module';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';
import { MarksWorkspaceService } from '../../src/modules/school/examinations/marks-workspace.service';

describeDb('integration: exam workspace — create → apply → mark → results → lock', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let marks: MarksWorkspaceService;

  const organizationId = `org_examws_${Date.now()}`;
  const userId = 'exam_officer_1';

  let termId = '';
  let classId = '';
  let examId = '';
  let mathsId = '';
  let englishId = '';
  const studentIds: string[] = [];

  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);

  const asTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run(
      {
        organizationId,
        userId,
        permissions: ['school:read', 'school:exams:write', 'school:grades:write'],
      },
      fn,
    );

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await setOrg(organizationId);
    await raw.organization.create({
      data: { id: organizationId, code: `EXWS-${Date.now()}`, name: 'Exam Workspace School', currencyCode: 'UGX' },
    });

    const year = await raw.academicYear.create({
      data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
    });
    const term = await raw.term.create({
      data: {
        organizationId, academicYearId: year.id, name: 'Term 1',
        startDate: new Date('2026-01-15'), endDate: new Date('2026-04-15'), isCurrent: true,
      },
    });
    termId = term.id;

    const grade = await raw.gradeLevel.create({ data: { organizationId, name: 'S1', order: 8 } });
    const cls = await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'S1 North' } });
    classId = cls.id;

    const maths = await raw.subject.create({ data: { organizationId, code: 'MATH', name: 'Mathematics' } });
    const english = await raw.subject.create({ data: { organizationId, code: 'ENG', name: 'English' } });
    mathsId = maths.id;
    englishId = english.id;

    // Three students in the class — none of them marked yet.
    for (const name of ['Achieng Mary', 'Bwire Paul', 'Candia Grace']) {
      const partner = await raw.partner.create({
        data: { organizationId, name, code: `P-${name.replace(/\s+/g, '')}-${Date.now()}` },
      });
      const profile = await raw.studentProfile.create({
        data: {
          organizationId,
          partnerId: partner.id,
          admissionNo: `ADM-${studentIds.length + 1}-${Date.now()}`,
          currentClassId: classId,
          enrollmentDate: new Date('2026-01-15'),
          status: 'active',
        },
      });
      studentIds.push(profile.id);
    }

    const examType = await raw.examType.create({ data: { organizationId, name: `Mid-Term ${Date.now()}`, weight: 30 } });
    const exam = await raw.exam.create({
      data: {
        organizationId, termId, examTypeId: examType.id, name: 'Mid-Term Exam',
        startDate: new Date('2026-03-02'), endDate: new Date('2026-03-06'),
      },
    });
    examId = exam.id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();

    tenant = moduleRef.get(TenantContextService);
    marks = moduleRef.get(MarksWorkspaceService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  it('step 2: applying the exam to a class creates one paper per subject, and is idempotent', async () => {
    const first = await asTenant(() => marks.applyClasses({ examId, classIds: [classId], subjectIds: [mathsId, englishId] }));
    expect(first.created).toBe(2);

    const again = await asTenant(() => marks.applyClasses({ examId, classIds: [classId], subjectIds: [mathsId, englishId] }));
    expect(again.created).toBe(0);

    const schedules = await raw.examSchedule.findMany({ where: { examId, classId } });
    expect(schedules).toHaveLength(2);
  });

  it('step 2: coverage reports the class as applied, with its papers and class size', async () => {
    const coverage = await asTenant(() => marks.coverage(examId));
    const row = coverage.classes.find((c) => c.classId === classId)!;

    expect(row.applied).toBe(true);
    expect(row.paperCount).toBe(2);
    expect(row.studentCount).toBe(3);
    expect(row.marksExpected).toBe(6);
    expect(row.marksEntered).toBe(0);
    expect(row.subjects.map((s) => s.subjectName).sort()).toEqual(['English', 'Mathematics']);
  });

  it('step 3: the marksheet lists every student before any mark exists', async () => {
    const sheet = await asTenant(() => marks.sheet({ examId, classId, subjectId: mathsId }));

    expect(sheet.applied).toBe(true);
    expect(sheet.total).toBe(3);
    expect(sheet.entered).toBe(0);
    expect(sheet.students.map((s) => s.name)).toEqual(['Achieng Mary', 'Bwire Paul', 'Candia Grace']);
    expect(sheet.students.every((s) => s.marks === null)).toBe(true);
  });

  it('step 3: a saved mark lands on the GradeEntry row the rest of the system reads', async () => {
    await asTenant(() => marks.saveMark({ examId, classId, subjectId: mathsId, studentProfileId: studentIds[0], marks: 82 }));

    const schedule = await raw.examSchedule.findFirst({ where: { examId, classId, subjectId: mathsId } });
    const entry = await raw.gradeEntry.findFirst({
      where: { examScheduleId: schedule!.id, studentProfileId: studentIds[0] },
    });

    expect(entry).not.toBeNull();
    expect(Number(entry!.marksObtained)).toBe(82);
    expect(entry!.grade).toBeTruthy(); // resolved against the school's grading scale
    expect(entry!.enteredById).toBe(userId);

    const sheet = await asTenant(() => marks.sheet({ examId, classId, subjectId: mathsId }));
    expect(sheet.entered).toBe(1);
    expect(sheet.students.find((s) => s.studentProfileId === studentIds[0])!.marks).toBe(82);
  });

  it('step 3: the mark is projected into the assessment spine in the same write', async () => {
    const schedule = await raw.examSchedule.findFirst({ where: { examId, classId, subjectId: mathsId } });
    const assessment = await raw.assessment.findFirst({
      where: { organizationId, sourceType: 'exam_session', sourceRef: schedule!.id },
    });
    expect(assessment).not.toBeNull();

    const sa = await raw.studentAssessment.findFirst({
      where: { assessmentId: assessment!.id, studentProfileId: studentIds[0] },
    });
    expect(sa).not.toBeNull();
    expect(Number(sa!.effectiveScore)).toBe(82);
  });

  it('step 3: an absent student is recorded without a numeric mark', async () => {
    await asTenant(() =>
      marks.saveMark({ examId, classId, subjectId: mathsId, studentProfileId: studentIds[2], marks: null, participation: 'absent' }),
    );

    const sheet = await asTenant(() => marks.sheet({ examId, classId, subjectId: mathsId }));
    const grace = sheet.students.find((s) => s.studentProfileId === studentIds[2])!;

    expect(grace.marks).toBeNull();
    expect(grace.participation).toBe('absent');
    expect(sheet.entered).toBe(2); // 82 + one resolved absence
  });

  it('step 3: a mark above the paper maximum is refused', async () => {
    await expect(
      asTenant(() => marks.saveMark({ examId, classId, subjectId: mathsId, studentProfileId: studentIds[1], marks: 101 })),
    ).rejects.toThrow(/between 0 and 100/);
  });

  it('step 4: the results grid totals the marked subjects and ranks the class', async () => {
    // Fill in enough to make the ranking meaningful.
    await asTenant(() => marks.saveMark({ examId, classId, subjectId: mathsId, studentProfileId: studentIds[1], marks: 91 }));
    await asTenant(() => marks.saveMark({ examId, classId, subjectId: englishId, studentProfileId: studentIds[0], marks: 74 }));
    await asTenant(() => marks.saveMark({ examId, classId, subjectId: englishId, studentProfileId: studentIds[1], marks: 60 }));

    const grid = await asTenant(() => marks.grid({ examId, classId }));

    expect(grid.subjects.map((s) => s.name)).toEqual(['English', 'Mathematics']);
    expect(grid.classSize).toBe(3);
    expect(grid.marksExpected).toBe(6);

    const mary = grid.students.find((s) => s.studentProfileId === studentIds[0])!;
    const paul = grid.students.find((s) => s.studentProfileId === studentIds[1])!;
    const grace = grid.students.find((s) => s.studentProfileId === studentIds[2])!;

    expect(mary.total).toBe(156); // 82 + 74
    expect(paul.total).toBe(151); // 91 + 60
    expect(mary.position).toBe(1);
    expect(paul.position).toBe(2);

    // Absent in Maths, unmarked in English — no total, and unranked rather than last.
    expect(grace.total).toBeNull();
    expect(grace.position).toBe(0);
    expect(grace.cells[mathsId].participation).toBe('absent');
  });

  it('step 4: locking the class stops further mark entry until it is unlocked', async () => {
    const locked = await asTenant(() => marks.setLock({ examId, classId, locked: true }));
    expect(locked.updated).toBe(2);

    await expect(
      asTenant(() => marks.saveMark({ examId, classId, subjectId: englishId, studentProfileId: studentIds[2], marks: 55 })),
    ).rejects.toThrow(/locked/i);

    const sheet = await asTenant(() => marks.sheet({ examId, classId, subjectId: englishId }));
    expect(sheet.locked).toBe(true);

    await asTenant(() => marks.setLock({ examId, classId, locked: false }));
    const after = await asTenant(() =>
      marks.saveMark({ examId, classId, subjectId: englishId, studentProfileId: studentIds[2], marks: 55 }),
    );
    expect(after.marks).toBe(55);
  });

  it('step 2: a class with marks on it cannot be dropped from the exam', async () => {
    await expect(asTenant(() => marks.removeClass({ examId, classId })))
      .rejects.toThrow(/mark/i);

    const schedules = await raw.examSchedule.findMany({ where: { examId, classId } });
    expect(schedules).toHaveLength(2); // nothing was deleted
  });

  it('step 1: the exam list rolls up progress across the whole exam', async () => {
    const exams = await asTenant(() => marks.exams({ termId }));
    const row = exams.find((e) => e.id === examId)!;

    expect(row.classCount).toBe(1);
    expect(row.paperCount).toBe(2);
    expect(row.marksExpected).toBe(6);
    // 5 numeric marks + 1 absence = 6 students RESOLVED.
    //
    // This used to read 5: the exam list counted GradeEntry rows carrying a
    // number, while the marksheet on the very next screen counted an absence as
    // entered. So a fully-marked paper showed 5/6 here and 6/6 there, and a
    // teacher chasing the sixth mark was chasing one that was never coming.
    // Both counters now use the marksheet's rule.
    expect(row.marksEntered).toBe(6);
    expect(row.examTypeName).toContain('Mid-Term');
  });
});
