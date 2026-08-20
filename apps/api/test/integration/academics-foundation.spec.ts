/**
 * Academics foundation — integration proof (P0-2 spine, P1-6 lifecycle, historical integrity).
 *
 * Runs only when DATABASE_URL is set (see _setup.ts). Mirrors the existing
 * school integration specs: real Nest container + real Postgres, with
 * tenant scoping provided by TenantContextService.run.
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
import { AcademicYearService, TermService } from '../../src/modules/school/foundation/academic-year.service';
import { TimetableService } from '../../src/modules/school/academics/academics.service';
import { CurriculumService } from '../../src/modules/school/academics/academics.service';

describeDb('integration: academics foundation (P0-2 / P1-6 / historical)', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let years: AcademicYearService;
  let terms: TermService;
  let timetable: TimetableService;
  let curricula: CurriculumService;

  const organizationId = `org_acad_${Date.now()}`;
  const perms = ['school:manageFoundation', 'school:read', 'school:lessonplans:write', 'school:curriculum:write'];
  const asUser = <T>(userId: string, fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId, permissions: perms }, fn);

  let yearId = '';
  let termId = '';
  let classId = '';
  let sectionId = '';
  let subjectId = '';
  let periodId = '';
  let spineClassId = '';
  let spineSectionId = '';

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({ where: { code: 'UGX' }, update: {}, create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 } });
    await raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, organizationId);
    await raw.organization.create({ data: { id: organizationId, code: `ACAD-${Date.now()}`, name: 'Acad School', currencyCode: 'UGX' } });
    await raw.schoolProfile.create({ data: { organizationId, name: 'Acad School', gradingSystem: 'UCE' } });

    const year = await raw.academicYear.create({ data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') } });
    yearId = year.id;
    const term = await raw.term.create({ data: { organizationId, academicYearId: yearId, name: 'Term 1', startDate: new Date('2026-01-15'), endDate: new Date('2026-04-15'), isCurrent: true } });
    termId = term.id;
    const grade = await raw.gradeLevel.create({ data: { organizationId, name: 'P5', order: 5 } });
    const cls = await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'P5 Gold' } });
    classId = cls.id;
    const sec = await raw.section.create({ data: { organizationId, classId, name: 'A' } });
    sectionId = sec.id;
    const subj = await raw.subject.create({ data: { organizationId, code: 'ENG', name: 'English', isCore: true } });
    subjectId = subj.id;
    const per = await raw.period.create({ data: { organizationId, name: 'P1', startTime: '08:00', endTime: '08:40', order: 1 } });
    periodId = per.id;

    // Dedicated class/section for the timetable-spine test, with a published
    // Curriculum AND a CourseOffering (the canonical spine instance). In production
    // the CourseOffering is created from teacher assignments; here we seed it to
    // prove the slot resolution + FK wiring.
    const spineGrade = await raw.gradeLevel.create({ data: { organizationId, name: 'P5-spine', order: 50 } });
    const spineCls = await raw.schoolClass.create({ data: { organizationId, gradeLevelId: spineGrade.id, name: 'P5 Spine' } });
    spineClassId = spineCls.id;
    const spineSec = await raw.section.create({ data: { organizationId, classId: spineCls.id, name: 'S' } });
    spineSectionId = spineSec.id;
    const spineCur = await raw.curriculum.create({ data: { organizationId, classId: spineCls.id, academicYearId: yearId, name: 'P5 Spine Eng', version: 1, status: 'published', publishedAt: new Date() } });
    await raw.curriculumSubject.create({ data: { organizationId, curriculumId: spineCur.id, subjectId: subj.id, periodsPerWeek: 5, isCore: true } });
    await raw.courseOffering.create({ data: { organizationId, academicYearId: yearId, termId, subjectId: subj.id, classId: spineCls.id, sectionId: spineSec.id, curriculumId: spineCur.id, status: 'active' } });

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    years = moduleRef.get(AcademicYearService);
    terms = moduleRef.get(TermService);
    timetable = moduleRef.get(TimetableService);
    curricula = moduleRef.get(CurriculumService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  it('P1-6: rejects an academic year that overlaps an existing one', async () => {
    let err: any;
    await asUser('su', () => years.create({ name: '2026-b', startDate: new Date('2026-06-01'), endDate: new Date('2026-08-31') } as any)).catch((e) => (err = e));
    expect(err).toBeInstanceOf(BadRequestException);
    expect(String(err.message)).toMatch(/overlap/i);
  });

  it('P1-6: rejects a term that overlaps another within the same academic year', async () => {
    let err: any;
    await asUser('su', () =>
      terms.create({ academicYearId: yearId, name: 'Term 1b', startDate: new Date('2026-02-01'), endDate: new Date('2026-03-31') } as any),
    ).catch((e) => (err = e));
    expect(err).toBeInstanceOf(BadRequestException);
    expect(String(err.message)).toMatch(/overlap/i);
  });

  it('P1-6: creating a second current academic year unsets the previous current', async () => {
    const y2: any = await asUser('su', () =>
      years.create({ name: '2027', startDate: new Date('2027-01-01'), endDate: new Date('2027-12-31'), isCurrent: true } as any),
    );
    const first = await raw.academicYear.findFirst({ where: { id: yearId } });
    const second = await raw.academicYear.findFirst({ where: { id: y2.id } });
    expect(first!.isCurrent).toBe(false);
    expect(second!.isCurrent).toBe(true);
  });

  it('P0-2: creating a timetable slot auto-resolves the canonical CourseOffering spine', async () => {
    const slot: any = await asUser('su', () =>
      timetable.create({ classId: spineClassId, sectionId: spineSectionId, dayOfWeek: 1, periodId, subjectId } as any),
    );
    expect(slot.id).toBeTruthy();
    expect(slot.courseOfferingId).toBeTruthy();

    // The resolved CourseOffering is canonical: same class/section/subject → same id.
    const slot2: any = await asUser('su', () =>
      timetable.create({ classId: spineClassId, sectionId: spineSectionId, dayOfWeek: 3, periodId, subjectId } as any),
    );
    expect(slot2.courseOfferingId).toBe(slot.courseOfferingId);
  });

  it('P0-2: conflict detection rejects a double-booked class/teacher/period', async () => {
    // slot1 already on Monday P1 (created above). Try the same class+day+period again.
    let err: any;
    await asUser('su', () => timetable.create({ classId: spineClassId, sectionId: spineSectionId, dayOfWeek: 1, periodId, subjectId } as any)).catch((e) => (err = e));
    expect(err).toBeInstanceOf(BadRequestException);
    expect(String(err.message)).toMatch(/conflict|double-book/i);
  });

  it('Historical: curriculum publish is immutable; clone produces a new version without mutating v1', async () => {
    const draft: any = await asUser('su', () =>
      curricula.create({ classId, academicYearId: yearId, name: 'P5 English 2026', subjects: [{ subjectId, periodsPerWeek: 5, isCore: true }] } as any),
    );
    expect(draft.version).toBe(1);
    expect(draft.status).toBe('draft');

    const published: any = await asUser('su', () => curricula.publish(draft.id));
    expect(published.status).toBe('published');

    const cloned: any = await asUser('su', () => curricula.cloneAsNewVersion(draft.id));
    expect(cloned.version).toBe(2);
    expect(cloned.status).toBe('draft');
    expect(cloned.parentVersionId).toBe(draft.id);

    // v1 must remain published + unchanged (immutability).
    const v1: any = await asUser('su', () => curricula.findOne(draft.id));
    expect(v1.status).toBe('published');
    expect(v1.version).toBe(1);
  });
});
