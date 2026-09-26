/**
 * Wave 13 — the student → academics → results audit (2026-09-26), proved
 * against a real database.
 *
 *   F01  a weighted 89.5% is a D2 end to end, not an F9
 *   F02  a missing required component blocks publication; a learner with no
 *        subject result blocks publication
 *   F04  computing over released results needs an approved amendment; the
 *        released set stays authoritative until its replacement is published
 *   F05  evidence approved after compute makes the snapshot stale
 *   F06  a roster from another term, or a subject roster, cannot make class results
 *   F07  a class-scoped teacher with no classes sees no pupils
 *   F08  the medical record travels only with the medical-read grant
 *   F09  a stream teacher sees their stream's result rows only
 *   F10  a register refuses a pupil who was not in the class that day
 *   F11  a stream move leaves the old stream's compulsory course and joins the
 *        new one; moving back reopens it
 *   F12  last term's class list is last term's class
 *   F14  a list mixing nursery and primary learners cannot be computed
 *   F16  a locked result is still the learner's released result
 *   D2   ABSENT_BLOCKS makes an absence a publication conflict
 *   D4   classTeacherScope STREAM vs CLASS
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { PERMISSIONS } from '@erp/shared';
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
import { ResultRunService } from '../../src/modules/school/assessment/result-run.service';
import { ResultIntegrityService } from '../../src/modules/school/assessment/result-integrity.service';
import { AcademicRosterService } from '../../src/modules/school/assessment/roster.service';
import { StudentAttendanceService } from '../../src/modules/school/attendance/student-attendance.service';
import { PlacementService } from '../../src/modules/school/enrollment/placement.service';
import { ensureAcademicSpine, linkLearner, type AcademicSpine } from './_placement';

describeDb('integration: wave 13 student flow', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let students: StudentService;
  let results: ResultRunService;
  let integrity: ResultIntegrityService;
  let rosters: AcademicRosterService;
  let attendance: StudentAttendanceService;
  let placements: PlacementService;

  const stamp = Date.now();
  const organizationId = `org_w13_${stamp}`;
  const ADMIN = ['*', ...Object.values(PERMISSIONS.school as Record<string, string>)];
  const as = <T>(userId: string, fn: () => Promise<T>, permissions: string[] = ADMIN): Promise<T> =>
    tenant.run({ organizationId, userId, permissions }, fn);
  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);

  let spine: AcademicSpine;
  let term2Id = '';
  let northId = '';
  let southId = '';
  let subjectId = '';
  let catComponentId = '';
  let examComponentId = '';
  const pupils: Array<{ id: string; enrollmentId: string }> = [];
  let seq = 0;

  const pupil = async (name: string, sectionId: string) => {
    seq += 1;
    const partner = await raw.partner.create({ data: { organizationId, code: `W13-${stamp}-${seq}`, name } });
    const profile = await raw.studentProfile.create({
      data: { organizationId, partnerId: partner.id, admissionNo: `W13-${seq}`, enrollmentDate: new Date('2026-01-20') },
    });
    await raw.medicalRecord.create({ data: { organizationId, studentProfileId: profile.id, bloodGroup: 'O+' } as any });
    const link = await linkLearner(raw, { spine, studentProfileId: profile.id, sectionId, effectiveFrom: new Date('2026-01-20') });
    return { id: profile.id, enrollmentId: link.enrollmentId };
  };

  const makeTeacher = async (tag: string) => {
    const role = await raw.role.create({ data: { organizationId, name: `Teacher ${tag} ${stamp}`, dataScope: 'class' } });
    const user = await raw.user.create({
      data: { organizationId, email: `w13-${tag}-${stamp}@school.test`, passwordHash: 'x', firstName: tag, lastName: 'T', isActive: true, roles: { connect: { id: role.id } } } as any,
    });
    const partner = await raw.partner.create({ data: { organizationId, code: `W13-T-${tag}-${stamp}`, name: `${tag} Teacher`, isEmployee: true } });
    const staff = await raw.staffProfile.create({
      data: { organizationId, partnerId: partner.id, employeeNo: `W13-${tag}-${stamp}`, joinDate: new Date('2026-01-01'), staffCategory: 'teaching' } as any,
    });
    await raw.hrEmployee.create({
      data: { organizationId, employeeCode: `W13-${tag}-${stamp}`, userId: user.id, partnerId: partner.id, firstName: tag, lastName: 'T' } as any,
    });
    return { userId: user.id, staffId: staff.id };
  };

  const assessment = async (componentId: string, kind: 'cat' | 'exam', title: string, dueAt: string) =>
    raw.assessment.create({
      data: {
        organizationId, componentId, kind, contribution: 'summative', sourceType: 'manual', status: 'graded',
        termId: spine.termId, subjectId, classId: spine.classId, title, maxScore: 100, dueAt: new Date(dueAt),
      },
    });
  const mark = (assessmentId: string, studentProfileId: string, score: number | null, participation = 'present') =>
    raw.studentAssessment.create({
      data: {
        organizationId, assessmentId, studentProfileId, termId: spine.termId, classId: spine.classId, gradeLevelId: spine.gradeLevelId,
        maxScore: 100, effectiveScore: score, originalScore: score, participation: participation as any,
        approvalStatus: 'approved', enteredById: 'marker', approvedById: 'head', status: 'graded',
      },
    });
  const classRoster = async (termId: string, members: string[]) => {
    const r = await raw.academicRoster.create({ data: { organizationId, termId, scopeType: 'class', classId: spine.classId, name: `P4 ${stamp}` } });
    await raw.academicRosterMember.createMany({
      data: members.map((studentProfileId) => ({ organizationId, rosterId: r.id, studentProfileId, classId: spine.classId, gradeLevelId: spine.gradeLevelId })),
    });
    return raw.academicRoster.update({ where: { id: r.id }, data: { frozenAt: new Date() } });
  };

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({ where: { code: 'UGX' }, update: {}, create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 } });
    await setOrg(organizationId);
    await raw.organization.create({ data: { id: organizationId, code: `W13-${stamp}`, name: 'Green Valley', currencyCode: 'UGX' } });
    await raw.schoolProfile.create({ data: { organizationId, name: 'Green Valley', gradingSystem: 'PLE' } });

    spine = await ensureAcademicSpine(raw, { organizationId, yearName: '2026', gradeName: 'P4', className: 'P4', sectionName: 'North' });
    northId = spine.sectionId!;
    southId = (await raw.section.create({ data: { organizationId, classId: spine.classId, name: 'South' } })).id;
    term2Id = (await raw.term.create({ data: { organizationId, academicYearId: spine.academicYearId, name: 'Term 2', startDate: new Date('2026-05-01'), endDate: new Date('2026-08-01') } })).id;
    subjectId = (await raw.subject.create({ data: { organizationId, code: 'MTC', name: 'Mathematics', isCore: true } })).id;
    const policy = await raw.assessmentPolicy.create({ data: { organizationId, name: 'P4 Maths', subjectId, termId: spine.termId, passMark: 50 } });
    catComponentId = (await raw.assessmentComponent.create({ data: { organizationId, policyId: policy.id, name: 'CAT', kind: 'cat', weight: 40, aggregation: 'mean' } })).id;
    examComponentId = (await raw.assessmentComponent.create({ data: { organizationId, policyId: policy.id, name: 'Exam', kind: 'exam', weight: 60, aggregation: 'mean' } })).id;
    await raw.assessmentPolicy.update({ where: { id: policy.id }, data: { publishedAt: new Date() } });

    pupils.push(await pupil('Aine North', northId));
    pupils.push(await pupil('Bosco North', northId));
    pupils.push(await pupil('Cissy North', northId));
    pupils.push(await pupil('Dan South', southId));

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    students = moduleRef.get(StudentService);
    results = moduleRef.get(ResultRunService);
    integrity = moduleRef.get(ResultIntegrityService);
    rosters = moduleRef.get(AcademicRosterService);
    attendance = moduleRef.get(StudentAttendanceService);
    placements = moduleRef.get(PlacementService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  // ── access ────────────────────────────────────────────────────────────────

  it('F07: a class-scoped teacher who teaches nothing lists no pupils', async () => {
    const t = await makeTeacher('idle');
    const page: any = await as(t.userId, () => students.list({ page: 1, pageSize: 50 } as any), [PERMISSIONS.school.read]);
    expect(page.meta.total).toBe(0);
    await expect(as(t.userId, () => students.findOne(pupils[0].id), [PERMISSIONS.school.read])).rejects.toThrow(/classes you teach/);
  });

  it('D4: a stream class teacher sees their stream; CLASS scope widens it to the class', async () => {
    const t = await makeTeacher('north');
    await raw.section.update({ where: { id: northId }, data: { classTeacherId: t.staffId } });
    const read = [PERMISSIONS.school.read];
    let page: any = await as(t.userId, () => students.list({ page: 1, pageSize: 50 } as any), read);
    expect(page.data.map((s: any) => s.id).sort()).toEqual(pupils.slice(0, 3).map((p) => p.id).sort());
    await expect(as(t.userId, () => students.findOne(pupils[3].id), read)).rejects.toThrow();

    await raw.schoolProfile.updateMany({ where: { organizationId }, data: { classTeacherScope: 'CLASS' } });
    page = await as(t.userId, () => students.list({ page: 1, pageSize: 50 } as any), read);
    expect(page.meta.total).toBe(4);
    await raw.schoolProfile.updateMany({ where: { organizationId }, data: { classTeacherScope: 'STREAM' } });
  });

  it('F08: the medical record only travels with the medical-read grant', async () => {
    const plain: any = await as('registrar', () => students.findOne(pupils[0].id), [PERMISSIONS.school.read]);
    expect(plain.medicalRecord).toBeUndefined();
    const listed: any = await as('registrar', () => students.list({ page: 1, pageSize: 50 } as any), [PERMISSIONS.school.read]);
    expect(listed.data.every((s: any) => s.medicalRecord === undefined)).toBe(true);
    const nurse: any = await as('nurse', () => students.findOne(pupils[0].id), [PERMISSIONS.school.read, PERMISSIONS.school.readMedical]);
    expect(nurse.medicalRecord?.bloodGroup).toBe('O+');
  });

  it('F08/F15: the national ID is stored encrypted, shown masked, and saved with the rest of the record', async () => {
    await as('registrar', () => students.update(pupils[0].id, { name: 'Aine N. North', phone: '+256700000001', nin: 'CM12345678ABCD' } as any));
    const row = await raw.studentProfile.findFirst({ where: { id: pupils[0].id }, include: { partner: true } });
    expect((row!.customFields as any).nin).toBeUndefined();
    expect((row!.customFields as any).ninEncrypted?.ciphertext).toBeTruthy();
    expect(row!.partner.name).toBe('Aine N. North');
    const shown: any = await as('registrar', () => students.findOne(pupils[0].id), [PERMISSIONS.school.read]);
    expect(shown.customFields.ninOnFile).toBe(true);
    expect(shown.customFields.ninLast4).toBe('ABCD');
    expect(JSON.stringify(shown)).not.toContain('CM12345678');
    expect((await as('registrar', () => students.revealNin(pupils[0].id))).nin).toBe('CM12345678ABCD');
  });

  // ── attendance ────────────────────────────────────────────────────────────

  it('F10: a register refuses a pupil from another stream, and saves nothing', async () => {
    const dto = {
      classId: spine.classId, sectionId: northId, date: '2026-02-10',
      entries: [
        { studentProfileId: pupils[0].id, status: 'present' },
        { studentProfileId: pupils[3].id, status: 'present' },
      ],
    };
    await expect(as('teacher', () => attendance.mark(dto as any))).rejects.toThrow(/were not in this class/);
    expect(await raw.studentAttendance.count({ where: { organizationId } })).toBe(0);
    // Before admission is also outside the register.
    await expect(as('teacher', () => attendance.mark({ ...dto, date: '2026-01-05', entries: [dto.entries[0]] } as any))).rejects.toThrow(/were not in this class/);
    await as('teacher', () => attendance.mark({ ...dto, entries: [dto.entries[0]] } as any));
    expect(await raw.studentAttendance.count({ where: { organizationId } })).toBe(1);
  });

  // ── membership ────────────────────────────────────────────────────────────

  it('F11: a stream move leaves the old compulsory course, joins the new one, and moving back reopens it', async () => {
    const offering = (sectionId: string, name: string) =>
      raw.courseOffering.create({
        data: {
          organizationId, name, academicYearId: spine.academicYearId, termId: spine.termId, classCohortId: spine.classCohortId,
          classId: spine.classId, sectionId, audienceScope: 'SECTION', offeringType: 'LEARNING_AREA', status: 'ACTIVE',
          effectiveFrom: new Date('2026-01-15'),
        },
      });
    const north = await offering(northId, 'Literacy North');
    const south = await offering(southId, 'Literacy South');
    const cissy = pupils[2];
    await raw.courseEnrollment.create({
      data: { organizationId, courseOfferingId: north.id, studentEnrollmentId: cissy.enrollmentId, source: 'COMPULSORY', status: 'ENROLLED', startDate: new Date('2026-01-20') },
    });

    await as('registrar', () => placements.move(cissy.enrollmentId, {
      termId: spine.termId, classId: spine.classId, sectionId: southId, effectiveFrom: '2026-03-01T08:00:00.000Z',
      movementReason: 'SECTION_CHANGE', reason: 'Parent request',
    } as any));
    const inNorth = await raw.courseEnrollment.findFirst({ where: { courseOfferingId: north.id, studentEnrollmentId: cissy.enrollmentId } });
    const inSouth = await raw.courseEnrollment.findFirst({ where: { courseOfferingId: south.id, studentEnrollmentId: cissy.enrollmentId } });
    expect(inNorth?.status).toBe('WITHDRAWN');
    expect(inNorth?.endDate?.toISOString()).toBe('2026-03-01T08:00:00.000Z');
    expect(inSouth?.status).toBe('ENROLLED');

    await as('registrar', () => placements.move(cissy.enrollmentId, {
      termId: spine.termId, classId: spine.classId, sectionId: northId, effectiveFrom: '2026-03-20T08:00:00.000Z',
      movementReason: 'SECTION_CHANGE', reason: 'Back again',
    } as any));
    expect((await raw.courseEnrollment.findFirst({ where: { courseOfferingId: north.id, studentEnrollmentId: cissy.enrollmentId } }))?.status).toBe('ENROLLED');
    expect((await raw.courseEnrollment.findFirst({ where: { courseOfferingId: south.id, studentEnrollmentId: cissy.enrollmentId } }))?.status).toBe('WITHDRAWN');
  });

  it("F12: last term's class list is last term's class, including a pupil who has left since", async () => {
    // Bosco leaves in Term 2.
    const bosco = pupils[1];
    await raw.enrollmentPlacement.updateMany({ where: { enrollmentId: bosco.enrollmentId, effectiveTo: null }, data: { effectiveTo: new Date('2026-05-10'), endReason: 'WITHDRAWAL' } });
    await raw.studentEnrollment.update({ where: { id: bosco.enrollmentId }, data: { status: 'WITHDRAWN' } });
    await raw.studentProfile.update({ where: { id: bosco.id }, data: { status: 'withdrawn' } });

    const r: any = await as('admin', () => rosters.capture({ termId: spine.termId, classId: spine.classId, sectionId: northId } as any));
    const ids = r.members.map((m: any) => m.studentProfileId).sort();
    expect(ids).toEqual([pupils[0].id, pupils[1].id, pupils[2].id].sort());
    await expect(as('admin', () => rosters.capture({ termId: spine.termId, classId: spine.classId, asOf: '2026-06-01T00:00:00.000Z' } as any)))
      .rejects.toThrow(/inside the term/);
  });

  // ── results ───────────────────────────────────────────────────────────────

  describe('results', () => {
    let rosterId = '';
    let cat1 = '';
    let exam = '';
    let releasedId = '';

    beforeAll(async () => {
      cat1 = (await assessment(catComponentId, 'cat', 'CAT 1', '2026-02-15')).id;
      exam = (await assessment(examComponentId, 'exam', 'End of term', '2026-04-05')).id;
      // Aine: 92 / 87.8333 → 89.5. Bosco: 70 / 60. Cissy: CAT only (exam row never entered).
      await mark(cat1, pupils[0].id, 92);
      await mark(exam, pupils[0].id, 87.83333 as any);
      await mark(cat1, pupils[1].id, 70);
      await mark(exam, pupils[1].id, 60);
      await mark(cat1, pupils[2].id, 80);
      rosterId = (await classRoster(spine.termId, [pupils[0].id, pupils[1].id, pupils[2].id])).id;
    });

    it('F06: a roster from another term, or a subject roster, cannot make class results', async () => {
      await expect(as('exams', () => results.compute({ termId: term2Id, rosterId } as any))).rejects.toThrow(/different term/);
      const subjectRoster = await raw.academicRoster.create({ data: { organizationId, termId: spine.termId, scopeType: 'subject', classId: spine.classId, subjectId } });
      await raw.academicRosterMember.create({ data: { organizationId, rosterId: subjectRoster.id, studentProfileId: pupils[0].id, classId: spine.classId } });
      await raw.academicRoster.update({ where: { id: subjectRoster.id }, data: { frozenAt: new Date() } });
      await expect(as('exams', () => results.compute({ termId: spine.termId, rosterId: subjectRoster.id } as any))).rejects.toThrow(/subject group/);
    });

    it('F01 + F02: 89.5% is a D2; a missing exam leaves no result and blocks publication', async () => {
      const rs: any = await as('exams', () => results.compute({ termId: spine.termId, rosterId } as any));
      const aine = await raw.studentSubjectResult.findFirst({ where: { resultSetId: rs.id, studentProfileId: pupils[0].id } });
      expect(Number(aine!.finalPercent)).toBeCloseTo(89.5, 1);
      expect(aine!.grade).toBe('D2');
      const cissy = await raw.studentSubjectResult.findFirst({ where: { resultSetId: rs.id, studentProfileId: pupils[2].id } });
      expect(cissy!.finalPercent).toBeNull(); // not 80: the exam was never sat

      const ready: any = await as('head', () => results.readiness(rs.id));
      expect(ready.ready).toBe(false);
      expect(ready.summary.evidenceComplete).toBe(false);
      expect(ready.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'MISSING_EVIDENCE', studentProfileId: pupils[2].id })]));
      await expect(as('head', () => results.publish(rs.id))).rejects.toThrow(/Publish gate failed/);
    });

    it('D2: under ABSENT_BLOCKS an absence is a conflict; under ABSENT_AS_ZERO it counts as zero', async () => {
      await mark(exam, pupils[2].id, null, 'absent');
      await raw.schoolProfile.updateMany({ where: { organizationId }, data: { resultAbsencePolicy: 'ABSENT_BLOCKS' } });
      let rs: any = await as('exams', () => results.compute({ termId: spine.termId, rosterId } as any));
      let ready: any = await as('head', () => results.readiness(rs.id));
      expect(ready.conflicts.map((c: any) => c.code)).toContain('ABSENCE_UNRESOLVED');

      await raw.schoolProfile.updateMany({ where: { organizationId }, data: { resultAbsencePolicy: 'ABSENT_AS_ZERO' } });
      rs = await as('exams', () => results.compute({ termId: spine.termId, rosterId } as any));
      const cissy = await raw.studentSubjectResult.findFirst({ where: { resultSetId: rs.id, studentProfileId: pupils[2].id } });
      expect(Number(cissy!.finalPercent)).toBe(32); // 80 × 0.4 + 0 × 0.6
      ready = await as('head', () => results.readiness(rs.id));
      expect(ready.conflicts).toEqual([]);
    });

    it('F05: evidence approved after compute makes the snapshot stale', async () => {
      const rs: any = await as('exams', () => results.compute({ termId: spine.termId, rosterId } as any));
      const cat2 = (await assessment(catComponentId, 'cat', 'CAT 2', '2026-03-10')).id;
      for (const p of pupils.slice(0, 3)) await mark(cat2, p.id, 50);
      await expect(as('head', () => results.publish(rs.id))).rejects.toThrow(/Publish gate failed/);
      const ready: any = await as('head', () => results.readiness(rs.id));
      expect(ready.conflicts.map((c: any) => c.code)).toContain('STALE_RESULTS');

      const fresh: any = await as('exams', () => results.compute({ termId: spine.termId, rosterId } as any));
      const published: any = await as('head', () => results.publish(fresh.id));
      expect(published.status).toBe('published');
      releasedId = fresh.id;
    });

    it('F09: a stream teacher sees only their stream rows in a result set', async () => {
      const t = await makeTeacher('results');
      await raw.section.update({ where: { id: southId }, data: { classTeacherId: t.staffId } });
      // Nobody from South is in this set.
      await expect(as(t.userId, () => integrity.detail(releasedId), [PERMISSIONS.school.read])).rejects.toThrow(/pupils you teach/);
      await raw.section.update({ where: { id: northId }, data: { classTeacherId: t.staffId } });
      const detail: any = await as(t.userId, () => integrity.detail(releasedId), [PERMISSIONS.school.read]);
      expect(detail.students.every((s: any) => [pupils[0].id, pupils[2].id].includes(s.studentProfileId))).toBe(true);
    });

    it('F16: a locked result is still the released result', async () => {
      const before: any = await as('head', () => results.latestPublished(spine.termId, pupils[0].id));
      await as('head', () => results.lock(releasedId));
      const after: any = await as('head', () => results.latestPublished(spine.termId, pupils[0].id));
      expect(after?.resultSet.id).toBe(releasedId);
      expect(after?.resultSet.status).toBe('locked');
      expect(Number(after?.term.meanPercent)).toBe(Number(before?.term.meanPercent));
    });

    it('F04: recomputing released results needs an approved amendment; the released set stays until replacement', async () => {
      await expect(as('exams', () => results.compute({ termId: spine.termId, rosterId } as any))).rejects.toThrow(/already released/);
      expect((await raw.resultSet.findFirst({ where: { id: releasedId } }))?.status).toBe('locked');

      const req: any = await as('exams', () => results.requestAmendment({ resultSetId: releasedId, reason: 'CAT 2 re-marked' } as any));
      const next: any = await as('head', () => results.approveAmendment(req.id));
      expect((await raw.resultSet.findFirst({ where: { id: releasedId } }))?.status).toBe('locked');
      expect((await as('head', () => results.latestPublished(spine.termId, pupils[0].id)))?.resultSet.id).toBe(releasedId);

      await as('head', () => results.publish(next.id));
      expect((await raw.resultSet.findFirst({ where: { id: releasedId } }))?.status).toBe('archived');
      expect((await as('head', () => results.latestPublished(spine.termId, pupils[0].id)))?.resultSet.id).toBe(next.id);
    });

    it('F14: a list mixing nursery and primary learners cannot be computed', async () => {
      const nursery = await raw.academicProgramme.create({ data: { organizationId, code: `NUR-${stamp}`, name: 'Nursery', stage: 'PRE_PRIMARY', effectiveFrom: new Date('2026-01-01') } });
      const baby = await pupil('Baby Class', northId);
      await raw.studentEnrollment.update({ where: { id: baby.enrollmentId }, data: { programmeId: nursery.id } });
      const grade = await raw.academicRoster.create({ data: { organizationId, termId: spine.termId, scopeType: 'grade', name: 'Mixed' } });
      await raw.academicRosterMember.createMany({
        data: [pupils[0].id, baby.id].map((studentProfileId) => ({ organizationId, rosterId: grade.id, studentProfileId })),
      });
      await raw.academicRoster.update({ where: { id: grade.id }, data: { frozenAt: new Date() } });
      await expect(as('exams', () => results.compute({ termId: spine.termId, rosterId: grade.id, scopeType: 'grade', scopeId: 'mixed' } as any)))
        .rejects.toThrow(/reported differently/);
    });
  });
});
