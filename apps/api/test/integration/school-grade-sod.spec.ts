/**
 * A0 assessment hardening — integration proof against a real DB.
 *
 * Guards the concrete production bugs A0 fixed:
 *  - A0-marks:   marksObtained outside [0, maxMarks] is rejected (service + DB CHECK).
 *  - A0-sod:     the person who ENTERED a mark cannot APPROVE it (segregation of duty);
 *                a different approver succeeds.
 *  - A0-reject:  submitted marks can be rejected with a reason (the previously
 *                unreachable `rejected` state), then resubmitted and approved —
 *                and every step writes an AuditLog row.
 *  - A0-concurrency: a stale `version` on re-entry yields 409, not a silent overwrite.
 *  - A0-approved-lock: approved marks can't be silently re-upserted.
 *  - A0-publish: report-card publish sets publishedAt; unpublish clears it.
 *
 * Same DB requirements as the other school integration specs (RLS-inert target).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, BadRequestException } from '@nestjs/common';
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
import {
  ExamTypeService,
  ExamService,
  ExamScheduleService,
  GradeEntryService,
  ReportCardService,
} from '../../src/modules/school/examinations/examinations.service';

describeDb('integration: A0 grade hardening + SoD', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let students: StudentService;
  let examTypes: ExamTypeService;
  let exams: ExamService;
  let schedules: ExamScheduleService;
  let grades: GradeEntryService;
  let reportCards: ReportCardService;

  const organizationId = `org_a0_${Date.now()}`;
  let termId = '';
  let classId = '';
  let subjectId = '';

  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);
  const perms = ['school:grades:write', 'school:grades:approve', 'school:results:compute', 'school:results:publish'];
  // Run a call as a specific actor — SoD depends on enterer ≠ approver userId.
  const asUser = <T>(userId: string, fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId, permissions: perms }, fn);

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await setOrg(organizationId);
    await raw.organization.create({ data: { id: organizationId, code: `A0-${Date.now()}`, name: 'A0 School', currencyCode: 'UGX' } });
    await raw.schoolProfile.create({ data: { organizationId, name: 'A0 School', gradingSystem: 'UCE' } });

    const year = await raw.academicYear.create({
      data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
    });
    termId = (await raw.term.create({
      data: { organizationId, academicYearId: year.id, name: 'Term 1', startDate: new Date('2026-01-15'), endDate: new Date('2026-04-15'), isCurrent: true },
    })).id;
    const grade = await raw.gradeLevel.create({ data: { organizationId, name: 'S1', order: 8 } });
    classId = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'S1 East' } })).id;
    subjectId = (await raw.subject.create({ data: { organizationId, code: 'MATH', name: 'Mathematics', isCore: true } })).id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();

    tenant = moduleRef.get(TenantContextService);
    students = moduleRef.get(StudentService);
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

  // Build a fresh exam schedule so each test is independent.
  const makeSchedule = async (max = 100): Promise<string> => {
    const et = await asUser('setup', () => examTypes.create({ name: `Final ${Date.now()}-${Math.random()}`, weight: 100, isFinal: true } as any)) as any;
    const exam = await asUser('setup', () => exams.schedule({
      termId, examTypeId: et.id, name: `Exam ${Date.now()}`,
      // BaseCrudService.create passes these straight to Prisma, which requires a
      // full ISO-8601 DateTime (a bare 'YYYY-MM-DD' is rejected).
      startDate: '2026-03-01T00:00:00.000Z', endDate: '2026-03-10T00:00:00.000Z', classes: [classId],
    } as any)) as any;
    const sched = await asUser('setup', () => schedules.create({
      examId: exam.id, classId, subjectId, date: '2026-03-05T00:00:00.000Z', startTime: '09:00', maxMarks: max,
    } as any)) as any;
    return sched.id;
  };

  const makeStudent = (admissionNo: string) =>
    asUser('registrar', () => students.create({ name: `Student ${admissionNo}`, admissionNo, enrollmentDate: '2026-01-15', currentClassId: classId } as any)) as Promise<any>;

  it('A0-marks: rejects marks above maxMarks', async () => {
    const s = await makeStudent(`M-${Date.now()}`);
    const scheduleId = await makeSchedule(100);
    await expect(
      asUser('teacher_a', () => grades.bulkUpsert({ examScheduleId: scheduleId, entries: [{ studentProfileId: s.id, marksObtained: 120, maxMarks: 100 }] } as any)),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Nothing persisted.
    const rows = await raw.gradeEntry.findMany({ where: { examScheduleId: scheduleId } });
    expect(rows).toHaveLength(0);
  });

  it('A0-sod: enterer cannot approve own marks; a different approver can', async () => {
    const s = await makeStudent(`SOD-${Date.now()}`);
    const scheduleId = await makeSchedule(100);

    await asUser('teacher_a', () => grades.bulkUpsert({ examScheduleId: scheduleId, entries: [{ studentProfileId: s.id, marksObtained: 72, maxMarks: 100 }] } as any));
    await asUser('teacher_a', () => grades.submit(scheduleId));

    // Same person who entered tries to approve → refused.
    await expect(asUser('teacher_a', () => grades.approve(scheduleId))).rejects.toBeInstanceOf(BadRequestException);

    // A different approver (head of department) succeeds.
    const res = await asUser('hod_b', () => grades.approve(scheduleId)) as any;
    expect(res.updated).toBe(1);
    const row = await raw.gradeEntry.findFirst({ where: { examScheduleId: scheduleId, studentProfileId: s.id } });
    expect(row?.status).toBe('approved');
    expect(row?.approvedById).toBe('hod_b');
    // UCE band for 72% is C3.
    expect(row?.grade).toBe('C3');
  });

  it('A0-reject: submitted → rejected(reason) → resubmit → approve, all audited', async () => {
    const s = await makeStudent(`REJ-${Date.now()}`);
    const scheduleId = await makeSchedule(100);

    await asUser('teacher_a', () => grades.bulkUpsert({ examScheduleId: scheduleId, entries: [{ studentProfileId: s.id, marksObtained: 55, maxMarks: 100 }] } as any));
    await asUser('teacher_a', () => grades.submit(scheduleId));

    const rej = await asUser('hod_b', () => grades.reject(scheduleId, 'Marks look transposed — please re-check')) as any;
    expect(rej.updated).toBe(1);
    const rejected = await raw.gradeEntry.findFirst({ where: { examScheduleId: scheduleId } });
    expect(rejected?.status).toBe('rejected');
    expect(rejected?.rejectionReason).toContain('transposed');

    // Re-entering marks returns the row to draft (version bumps); resubmit; approve.
    await asUser('teacher_a', () => grades.bulkUpsert({ examScheduleId: scheduleId, entries: [{ studentProfileId: s.id, marksObtained: 65, maxMarks: 100 }] } as any));
    await asUser('teacher_a', () => grades.submit(scheduleId));
    await asUser('hod_b', () => grades.approve(scheduleId));

    const final = await raw.gradeEntry.findFirst({ where: { examScheduleId: scheduleId } });
    expect(final?.status).toBe('approved');
    expect(Number(final?.marksObtained)).toBe(65);

    // Audit trail exists for the grade mutations (reject at least).
    const audits = await raw.auditLog.findMany({ where: { organizationId, entity: 'GradeEntry' } });
    const actions = audits.map((a) => a.action);
    expect(actions).toContain('reject');
    expect(actions).toContain('approve');
  });

  it('A0-concurrency: stale version on re-entry is a 409', async () => {
    const s = await makeStudent(`VER-${Date.now()}`);
    const scheduleId = await makeSchedule(100);

    await asUser('teacher_a', () => grades.bulkUpsert({ examScheduleId: scheduleId, entries: [{ studentProfileId: s.id, marksObtained: 40, maxMarks: 100 }] } as any));
    const created = await raw.gradeEntry.findFirst({ where: { examScheduleId: scheduleId } });
    expect(created?.version).toBe(0);

    // One editor overwrites (version 0 → 1).
    await asUser('teacher_a', () => grades.bulkUpsert({ examScheduleId: scheduleId, entries: [{ studentProfileId: s.id, marksObtained: 45, maxMarks: 100, version: 0 }] } as any));

    // A second editor still holding version 0 must be rejected, not silently win.
    await expect(
      asUser('teacher_c', () => grades.bulkUpsert({ examScheduleId: scheduleId, entries: [{ studentProfileId: s.id, marksObtained: 90, maxMarks: 100, version: 0 }] } as any)),
    ).rejects.toBeInstanceOf(ConflictException);

    const row = await raw.gradeEntry.findFirst({ where: { examScheduleId: scheduleId } });
    expect(Number(row?.marksObtained)).toBe(45); // the stale editor's 90 never landed
  });

  it('A0-approved-lock: an approved mark cannot be silently re-upserted', async () => {
    const s = await makeStudent(`LOCK-${Date.now()}`);
    const scheduleId = await makeSchedule(100);
    await asUser('teacher_a', () => grades.bulkUpsert({ examScheduleId: scheduleId, entries: [{ studentProfileId: s.id, marksObtained: 80, maxMarks: 100 }] } as any));
    await asUser('teacher_a', () => grades.submit(scheduleId));
    await asUser('hod_b', () => grades.approve(scheduleId));

    await expect(
      asUser('teacher_a', () => grades.bulkUpsert({ examScheduleId: scheduleId, entries: [{ studentProfileId: s.id, marksObtained: 10, maxMarks: 100 }] } as any)),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('A0-publish: report-card publish sets publishedAt; unpublish clears it', async () => {
    const s = await makeStudent(`PUB-${Date.now()}`);
    const scheduleId = await makeSchedule(100);
    await asUser('teacher_a', () => grades.bulkUpsert({ examScheduleId: scheduleId, entries: [{ studentProfileId: s.id, marksObtained: 70, maxMarks: 100 }] } as any));
    await asUser('teacher_a', () => grades.submit(scheduleId));
    await asUser('hod_b', () => grades.approve(scheduleId));

    const card = await asUser('registrar', () => reportCards.generate({ studentProfileId: s.id, termId } as any)) as any;
    expect(card.publishedAt).toBeNull();

    const published = await asUser('head', () => reportCards.publish(card.id)) as any;
    expect(published.publishedAt).not.toBeNull();

    const unpublished = await asUser('head', () => reportCards.unpublish(card.id)) as any;
    expect(unpublished.publishedAt).toBeNull();
  });
});
