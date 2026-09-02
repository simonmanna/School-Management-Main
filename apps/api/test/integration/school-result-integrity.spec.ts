/**
 * A3 result spine — integration proof against a real DB.
 *
 *  - A3-compute:   frozen roster + approved exam marks → compute → published →
 *                  StudentTermResult carries gpa/rank; report card reads the
 *                  spine (provenance = result_spine).
 *  - A3-gate:      the publish gate rejects unapproved marks with a structured
 *                  MARKS_NOT_APPROVED conflict.
 *  - A3-immutable: a published ResultSet's computed snapshot cannot be UPDATEd
 *                  (DB trigger), and its child result rows are frozen.
 *  - A3-amend:     an amendment recomputes into revision 2; revision 1 is
 *                  archived, not mutated.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
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
import { StudentService } from '../../src/modules/school/people/student.service';
import { AcademicRosterService } from '../../src/modules/school/assessment/roster.service';
import { ResultRunService } from '../../src/modules/school/assessment/result-run.service';
import { ExamTypeService, ExamService, ExamScheduleService, GradeEntryService, ReportCardService } from '../../src/modules/school/examinations/examinations.service';

describeDb('integration: A3 result spine', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let students: StudentService;
  let rosters: AcademicRosterService;
  let results: ResultRunService;
  let examTypes: ExamTypeService;
  let exams: ExamService;
  let schedules: ExamScheduleService;
  let grades: GradeEntryService;
  let reportCards: ReportCardService;

  const organizationId = `org_a3_${Date.now()}`;
  let termId = '';
  let subjectId = '';

  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);
  const perms = ['school:exams:write', 'school:grades:write', 'school:grades:approve', 'school:assessments:write', 'school:results:compute', 'school:results:publish', 'school:results:amend', 'school:students:write'];
  const asUser = <T>(userId: string, fn: () => Promise<T>): Promise<T> => tenant.run({ organizationId, userId, permissions: perms }, fn);

  // A class with one exam, marks entered + (optionally) approved, roster frozen.
  async function seedClass(tag: string, opts: { approve: boolean }) {
    const grade = await raw.gradeLevel.create({ data: { organizationId, name: `G-${tag}`, order: 8 } });
    const classId = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: `Class ${tag}` } })).id;
    const s1: any = await asUser('registrar', () => students.create({ name: `S1 ${tag}`, admissionNo: `${tag}-1`, enrollmentDate: '2026-01-15', currentClassId: classId } as any));
    const s2: any = await asUser('registrar', () => students.create({ name: `S2 ${tag}`, admissionNo: `${tag}-2`, enrollmentDate: '2026-01-15', currentClassId: classId } as any));

    const et: any = await asUser('setup', () => examTypes.create({ name: `Final ${tag}`, weight: 100, isFinal: true } as any));
    const exam: any = await asUser('setup', () => exams.schedule({ termId, examTypeId: et.id, name: `Exam ${tag}`, startDate: '2026-03-01T00:00:00.000Z', endDate: '2026-03-10T00:00:00.000Z', classes: [classId] } as any));
    const sched: any = await asUser('setup', () => schedules.create({ examId: exam.id, classId, subjectId, date: '2026-03-05T00:00:00.000Z', startTime: '09:00', maxMarks: 100 } as any));

    await asUser('teacher', () => grades.bulkUpsert({ examScheduleId: sched.id, entries: [
      { studentProfileId: s1.id, marksObtained: 82, maxMarks: 100 },
      { studentProfileId: s2.id, marksObtained: 55, maxMarks: 100 },
    ] } as any));
    if (opts.approve) {
      await asUser('teacher', () => grades.submit(sched.id));
      await asUser('hod', () => grades.approve(sched.id)); // different user → SoD ok
      // Approved marks close the paper. Phase 5's gate refuses to release a
      // result computed from a paper someone could still be marking.
      await raw.examSchedule.update({ where: { id: sched.id }, data: { marksLockedAt: new Date(), marksLockedById: 'hod' } });
    }

    const roster: any = await asUser('admin', () => rosters.capture({ termId, classId, source: 'derived_current_class' } as any));
    await asUser('admin', () => rosters.freeze(roster.id));
    return { classId, s1, s2, rosterId: roster.id };
  }

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({ where: { code: 'UGX' }, update: {}, create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 } });
    await setOrg(organizationId);
    await raw.organization.create({ data: { id: organizationId, code: `A3-${Date.now()}`, name: 'A3 School', currencyCode: 'UGX' } });
    await raw.schoolProfile.create({ data: { organizationId, name: 'A3 School', gradingSystem: 'UCE' } });
    const year = await raw.academicYear.create({ data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') } });
    termId = (await raw.term.create({ data: { organizationId, academicYearId: year.id, name: 'Term 1', startDate: new Date('2026-01-15'), endDate: new Date('2026-04-15'), isCurrent: true } })).id;
    subjectId = (await raw.subject.create({ data: { organizationId, code: 'MATH', name: 'Mathematics', isCore: true } })).id;
    // Phase 5's publish gate checks that the numbers were produced under a
    // signed-off rule: a subject with no policy, or a draft one, blocks release.
    const policy = await raw.assessmentPolicy.create({ data: { organizationId, name: 'A3 Maths', subjectId, termId, passMark: 50 } });
    await raw.assessmentComponent.create({ data: { organizationId, policyId: policy.id, name: 'Exam', kind: 'exam', weight: 100, aggregation: 'mean' } });
    await raw.assessmentPolicy.update({ where: { id: policy.id }, data: { publishedAt: new Date() } });

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    students = moduleRef.get(StudentService);
    rosters = moduleRef.get(AcademicRosterService);
    results = moduleRef.get(ResultRunService);
    examTypes = moduleRef.get(ExamTypeService);
    exams = moduleRef.get(ExamService);
    schedules = moduleRef.get(ExamScheduleService);
    grades = moduleRef.get(GradeEntryService);
    reportCards = moduleRef.get(ReportCardService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  it('A3-compute: compute → publish → report card reads the spine', async () => {
    const { s1, rosterId } = await seedClass('OK', { approve: true });
    const rs: any = await asUser('exams', () => results.compute({ termId, rosterId } as any));
    expect(rs.status).toBe('computed');
    expect(rs.studentCount).toBe(2);

    const published: any = await asUser('head', () => results.publish(rs.id));
    expect(published.status).toBe('published');
    expect(published.publishedAt).not.toBeNull();

    const term = await raw.studentTermResult.findFirst({ where: { resultSetId: rs.id, studentProfileId: s1.id } });
    expect(Number(term?.meanPercent)).toBeGreaterThan(0);
    expect(term?.classRank).toBe(1); // 82% beats 55%

    // Report card now reads the published spine — headline AND body (P3). The
    // subject table used to come from raw GradeEntry while the header came from
    // the spine; both are now spine-sourced, so they cannot disagree.
    const card: any = await asUser('exams', () => reportCards.generate({ studentProfileId: s1.id, termId } as any));
    expect(card.payload.provenance.source).toBe('result_spine');
    expect(card.payload.provenance.resultSetId).toBe(rs.id);
    expect(card.payload.provenance.layoutSource).toBe('result_spine');
    const subjectRows = (card.payload.sections ?? []).flatMap((sec: any) => sec.subjects ?? []);
    expect(subjectRows.length).toBeGreaterThan(0);
    // The card's per-subject total matches the published StudentSubjectResult.
    const ssr = await raw.studentSubjectResult.findFirst({ where: { resultSetId: rs.id, studentProfileId: s1.id } });
    const match = subjectRows.find((r: any) => Math.abs(r.totalPercent - Math.round(Number(ssr!.finalPercent))) <= 1);
    expect(match).toBeTruthy();

    // Regenerating a PUBLISHED card is refused — it is a distributed record.
    await asUser('head', () => reportCards.publish(card.id));
    await expect(asUser('exams', () => reportCards.generate({ studentProfileId: s1.id, termId } as any)))
      .rejects.toThrow(/published/i);
  });

  it('A3-softdelete: a soft-deleted assessment stops contributing to the result', async () => {
    const { s1, rosterId } = await seedClass('DEL', { approve: true });

    const before: any = await asUser('exams', () => results.compute({ termId, rosterId } as any));
    const beforeTerm = await raw.studentTermResult.findFirst({
      where: { resultSetId: before.id, studentProfileId: s1.id },
    });
    expect(Number(beforeTerm?.meanPercent)).toBeGreaterThan(0);

    // Soft-delete the assessment. Its StudentAssessment children stay live —
    // deleting a parent does not cascade — so without a relation filter on the
    // spine readers the marks kept counting and soft delete excluded nothing.
    const sa = await raw.studentAssessment.findFirst({
      where: { studentProfileId: s1.id, termId },
      include: { assessment: true },
    });
    expect(sa).not.toBeNull();
    await raw.assessment.update({ where: { id: sa!.assessmentId }, data: { deletedAt: new Date() } });

    const after: any = await asUser('exams', () => results.compute({ termId, rosterId } as any));
    const afterSubject = await raw.studentSubjectResult.findMany({
      where: { resultSetId: after.id, studentProfileId: s1.id },
    });
    expect(afterSubject).toHaveLength(0);

    // Restore, so the later tests in this suite see the class they seeded.
    await raw.assessment.update({ where: { id: sa!.assessmentId }, data: { deletedAt: null } });
  });

  it('A3-gate: publish rejects unapproved marks with a structured conflict', async () => {
    const { rosterId } = await seedClass('BAD', { approve: false });
    const rs: any = await asUser('exams', () => results.compute({ termId, rosterId } as any));
    let err: any;
    await asUser('head', () => results.publish(rs.id)).catch((e) => { err = e; });
    expect(err).toBeInstanceOf(BadRequestException);
    const conflicts = err.getResponse().conflicts;
    expect(conflicts.some((c: any) => c.code === 'MARKS_NOT_APPROVED')).toBe(true);
  });

  // readiness() is the pre-publish checklist the UI is meant to call BEFORE
  // offering Publish, so an administrator sees "3 pupils have unapproved marks"
  // instead of discovering it from a failed publish. It loaded the ResultSet
  // without its termResults relation and then handed it to runPublishGate,
  // which reads rs.termResults for the coverage check — so every call on a set
  // that HAD a roster threw a TypeError and answered 500. Only the NO_ROSTER
  // early-return escaped, which is why nothing else in this suite caught it:
  // publish() includes the relation and was always fine.
  it('A3-readiness: the checklist returns structured conflicts, not a 500', async () => {
    const { rosterId } = await seedClass('RDY', { approve: false });
    const rs: any = await asUser('exams', () => results.compute({ termId, rosterId } as any));

    const report: any = await asUser('head', () => results.readiness(rs.id));

    expect(report.ready).toBe(false);
    expect(report.conflicts.some((c: any) => c.code === 'MARKS_NOT_APPROVED')).toBe(true);
    // The summary counts come off the relation that was missing.
    expect(report.summary.studentsExpected).toBeGreaterThan(0);
    expect(report.summary.studentsCovered).toBe(report.summary.studentsExpected);
    expect(report.summary.marksTotal).toBeGreaterThan(0);
    expect(report.summary.hasChecksums).toBe(true);
  });

  it('A3-readiness: a fully approved set reports ready with no conflicts', async () => {
    const { rosterId } = await seedClass('RDY2', { approve: true });
    const rs: any = await asUser('exams', () => results.compute({ termId, rosterId } as any));

    const report: any = await asUser('head', () => results.readiness(rs.id));

    expect(report.conflicts).toEqual([]);
    expect(report.ready).toBe(true);
    expect(report.summary.rosterFrozen).toBe(true);
    expect(report.summary.sodViolations).toBe(0);

    // readiness() and the publish gate must agree: what the checklist calls
    // ready is exactly what publish accepts.
    await expect(asUser('head', () => results.publish(rs.id))).resolves.toBeTruthy();
  });

  it('A3-immutable: a published result set snapshot is UPDATE-proof', async () => {
    const { rosterId } = await seedClass('IMM', { approve: true });
    const rs: any = await asUser('exams', () => results.compute({ termId, rosterId } as any));
    await asUser('head', () => results.publish(rs.id));

    await expect(
      raw.$executeRawUnsafe(`UPDATE "ResultSet" SET "outputChecksum" = 'tampered' WHERE id = $1`, rs.id),
    ).rejects.toThrow(/immutable|cannot be modified/);

    // Child result rows are frozen too.
    const term = await raw.studentTermResult.findFirst({ where: { resultSetId: rs.id } });
    await expect(
      raw.$executeRawUnsafe(`UPDATE "StudentTermResult" SET "gpa" = 4 WHERE id = $1`, term!.id),
    ).rejects.toThrow(/immutable/);
  });

  it('A3-amend: amendment recomputes to revision 2 and archives revision 1', async () => {
    const { rosterId } = await seedClass('AMD', { approve: true });
    const rs1: any = await asUser('exams', () => results.compute({ termId, rosterId } as any));
    await asUser('head', () => results.publish(rs1.id));
    expect(rs1.revision).toBe(1);

    const req: any = await asUser('head', () => results.requestAmendment({ resultSetId: rs1.id, reason: 'Re-mark subject' } as any));
    const rs2: any = await asUser('head', () => results.approveAmendment(req.id));
    expect(rs2.revision).toBe(2);

    const old = await raw.resultSet.findFirst({ where: { id: rs1.id } });
    expect(old?.status).toBe('archived'); // superseded, not mutated
  });
});
