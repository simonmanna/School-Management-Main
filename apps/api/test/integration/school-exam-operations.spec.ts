/**
 * A4 exam operations — integration proof.
 *
 *  - A4-register: registerClass creates a candidate row per active student,
 *                 idempotently (replacing the Exam.classes JSON).
 *  - A4-seat:     seat allocation fills a venue up to capacity, no further.
 *  - A4-status:   a candidate can be marked absent/withheld.
 *  - A4-clash:    scheduling a second sitting in the same venue at the same
 *                 slot is rejected with a structured VENUE_CLASH conflict.
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
import { ExamTypeService, ExamService, ExamScheduleService } from '../../src/modules/school/examinations/examinations.service';
import { ExamVenueService, ExamRegistrationService } from '../../src/modules/school/examinations/exam-ops.service';

describeDb('integration: A4 exam operations', () => {
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
  let venues: ExamVenueService;
  let regs: ExamRegistrationService;

  const organizationId = `org_a4_${Date.now()}`;
  let termId = '', classId = '', subjectId = '';

  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);
  const perms = ['school:exams:write', 'school:students:write'];
  const asUser = <T>(fn: () => Promise<T>): Promise<T> => tenant.run({ organizationId, userId: 'exams', permissions: perms }, fn);

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({ where: { code: 'UGX' }, update: {}, create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 } });
    await setOrg(organizationId);
    await raw.organization.create({ data: { id: organizationId, code: `A4-${Date.now()}`, name: 'A4 School', currencyCode: 'UGX' } });
    const year = await raw.academicYear.create({ data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') } });
    termId = (await raw.term.create({ data: { organizationId, academicYearId: year.id, name: 'Term 1', startDate: new Date('2026-01-15'), endDate: new Date('2026-04-15'), isCurrent: true } })).id;
    const grade = await raw.gradeLevel.create({ data: { organizationId, name: 'S3', order: 10 } });
    classId = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'S3 North' } })).id;
    subjectId = (await raw.subject.create({ data: { organizationId, code: 'PHY', name: 'Physics', isCore: true } })).id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    students = moduleRef.get(StudentService);
    examTypes = moduleRef.get(ExamTypeService);
    exams = moduleRef.get(ExamService);
    schedules = moduleRef.get(ExamScheduleService);
    venues = moduleRef.get(ExamVenueService);
    regs = moduleRef.get(ExamRegistrationService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  it('A4-register: registerClass creates a candidate per active student, idempotently', async () => {
    for (let i = 0; i < 3; i++) await asUser(() => students.create({ name: `C${i}`, admissionNo: `A4-${Date.now()}-${i}`, enrollmentDate: '2026-01-15', classId } as any) as any);
    const et: any = await asUser(() => examTypes.create({ name: `EOT ${Date.now()}`, weight: 100, isFinal: true } as any));
    const exam: any = await asUser(() => exams.schedule({ termId, examTypeId: et.id, name: `EOT ${Date.now()}`, startDate: '2026-03-01T00:00:00.000Z', endDate: '2026-03-10T00:00:00.000Z', classes: [] } as any));

    const r1: any = await asUser(() => regs.registerClass(exam.id, classId));
    expect(r1.created).toBe(3);
    const r2: any = await asUser(() => regs.registerClass(exam.id, classId)); // idempotent
    expect(r2.created).toBe(0);

    const list = await raw.examRegistration.findMany({ where: { examId: exam.id } });
    expect(list.length).toBe(3);
    (exam as any)._id = exam.id;
    (globalThis as any).__a4exam = exam.id;
  });

  it('A4-seat: allocation fills a venue up to capacity and no further', async () => {
    const examId = (globalThis as any).__a4exam;
    const venue: any = await asUser(() => venues.create({ name: `Room ${Date.now()}`, capacity: 2 } as any));
    const res: any = await asUser(() => regs.allocateSeats({ examId, venueId: venue.id } as any));
    expect(res.seated).toBe(2);
    expect(res.remainingUnseated).toBe(1); // 3 candidates, capacity 2

    const seated = await raw.examRegistration.findMany({ where: { examId, venueId: venue.id } });
    expect(seated.map((s: any) => s.seatNumber).sort()).toEqual(['A1', 'A2']);
  });

  it('A4-status: a candidate can be marked absent', async () => {
    const examId = (globalThis as any).__a4exam;
    const one = await raw.examRegistration.findFirst({ where: { examId } });
    const updated: any = await asUser(() => regs.updateStatus(one!.id, { status: 'absent' } as any));
    expect(updated.status).toBe('absent');
  });

  it('A4-clash: a venue double-booking at the same slot is rejected', async () => {
    const et: any = await asUser(() => examTypes.create({ name: `Clash ${Date.now()}`, weight: 100 } as any));
    const exam: any = await asUser(() => exams.schedule({ termId, examTypeId: et.id, name: `Clash ${Date.now()}`, startDate: '2026-03-01T00:00:00.000Z', endDate: '2026-03-10T00:00:00.000Z', classes: [] } as any));
    const venue: any = await asUser(() => venues.create({ name: `Hall ${Date.now()}`, capacity: 50 } as any));

    await asUser(() => schedules.create({ examId: exam.id, classId, subjectId, date: '2026-03-05T00:00:00.000Z', startTime: '09:00', maxMarks: 100, venueId: venue.id } as any));

    // A second class in the SAME venue at the SAME slot → clash.
    const grade2 = await raw.gradeLevel.create({ data: { organizationId, name: `S3b-${Date.now()}`, order: 10 } });
    const class2 = await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade2.id, name: `S3 South ${Date.now()}` } });
    let err: any;
    await asUser(() => schedules.create({ examId: exam.id, classId: class2.id, subjectId, date: '2026-03-05T00:00:00.000Z', startTime: '09:00', maxMarks: 100, venueId: venue.id } as any)).catch((e) => { err = e; });
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse().conflicts.some((c: any) => c.code === 'VENUE_CLASH')).toBe(true);
  });
});
