/**
 * Wave 13 — a school-sized class (Phase 7 load proof and F17).
 *
 *   - 350 pupils in one class: every page of the pupil list is reachable and
 *     the total is right (a list silently stopping at 50 was F17);
 *   - a term result for all 350 — two approved assessments each — computes and
 *     publishes inside the interactive-transaction budget, with the freshness
 *     re-derivation (F05) included in the publish.
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
import { ensureAcademicSpine } from './_placement';

const PUPILS = 350;

describeDb('integration: wave 13 school-sized class', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let students: StudentService;
  let results: ResultRunService;

  const stamp = Date.now();
  const organizationId = `org_w13s_${stamp}`;
  const ADMIN = ['*', ...Object.values(PERMISSIONS.school as Record<string, string>)];
  const as = <T>(userId: string, fn: () => Promise<T>): Promise<T> => tenant.run({ organizationId, userId, permissions: ADMIN }, fn);

  let termId = '';
  let rosterId = '';
  const ids: string[] = [];

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({ where: { code: 'UGX' }, update: {}, create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 } });
    await raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, organizationId);
    await raw.organization.create({ data: { id: organizationId, code: `W13S-${stamp}`, name: 'Scale School', currencyCode: 'UGX' } });
    await raw.schoolProfile.create({ data: { organizationId, name: 'Scale School', gradingSystem: 'PLE' } });
    const spine = await ensureAcademicSpine(raw, { organizationId, yearName: '2026', gradeName: 'P6', className: 'P6' });
    termId = spine.termId;

    const subjectId = (await raw.subject.create({ data: { organizationId, code: 'ENG', name: 'English', isCore: true } })).id;
    const policy = await raw.assessmentPolicy.create({ data: { organizationId, name: 'P6 English', subjectId, termId, passMark: 50 } });
    const cat = await raw.assessmentComponent.create({ data: { organizationId, policyId: policy.id, name: 'CAT', kind: 'cat', weight: 40, aggregation: 'mean' } });
    const exam = await raw.assessmentComponent.create({ data: { organizationId, policyId: policy.id, name: 'Exam', kind: 'exam', weight: 60, aggregation: 'mean' } });
    await raw.assessmentPolicy.update({ where: { id: policy.id }, data: { publishedAt: new Date() } });

    const partners = Array.from({ length: PUPILS }, (_, i) => ({ organizationId, code: `S-${stamp}-${i}`, name: `Pupil ${String(i).padStart(3, '0')}` }));
    await raw.partner.createMany({ data: partners });
    const partnerRows = await raw.partner.findMany({ where: { organizationId, code: { startsWith: `S-${stamp}-` } }, select: { id: true, code: true } });
    await raw.studentProfile.createMany({
      data: partnerRows.map((p) => ({ organizationId, partnerId: p.id, admissionNo: `A${p.code!.split('-').pop()!.padStart(4, '0')}`, enrollmentDate: new Date('2026-01-20') })),
    });
    const profiles = await raw.studentProfile.findMany({ where: { organizationId }, select: { id: true } });
    ids.push(...profiles.map((p) => p.id));
    await raw.studentEnrollment.createMany({
      data: ids.map((studentProfileId) => ({
        organizationId, studentProfileId, academicYearId: spine.academicYearId, programmeId: spine.programmeId, gradeLevelId: spine.gradeLevelId,
        admissionDate: new Date('2026-01-20'), status: 'ACTIVE', enrollmentType: 'NEW',
      })),
    });
    const enrollments = await raw.studentEnrollment.findMany({ where: { organizationId }, select: { id: true } });
    await raw.enrollmentPlacement.createMany({
      data: enrollments.map((e) => ({ organizationId, enrollmentId: e.id, termId, classCohortId: spine.classCohortId, effectiveFrom: new Date('2026-01-20'), movementReason: 'INITIAL_PLACEMENT' })),
    });

    const mk = (componentId: string, kind: 'cat' | 'exam', title: string) =>
      raw.assessment.create({ data: { organizationId, componentId, kind, contribution: 'summative', sourceType: 'manual', status: 'graded', termId, subjectId, classId: spine.classId, title, maxScore: 100 } });
    const a1 = await mk(cat.id, 'cat', 'CAT 1');
    const a2 = await mk(exam.id, 'exam', 'Exam');
    for (const a of [a1, a2]) {
      await raw.studentAssessment.createMany({
        data: ids.map((studentProfileId, i) => ({
          organizationId, assessmentId: a.id, studentProfileId, termId, classId: spine.classId, maxScore: 100,
          effectiveScore: 30 + ((i * 7) % 70), participation: 'present', approvalStatus: 'approved', enteredById: 'm', approvedById: 'h', status: 'graded',
        })),
      });
    }
    const roster = await raw.academicRoster.create({ data: { organizationId, termId, scopeType: 'class', classId: spine.classId, name: 'P6 — Term 1' } });
    await raw.academicRosterMember.createMany({ data: ids.map((studentProfileId) => ({ organizationId, rosterId: roster.id, studentProfileId, classId: spine.classId })) });
    rosterId = (await raw.academicRoster.update({ where: { id: roster.id }, data: { frozenAt: new Date() } })).id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    students = moduleRef.get(StudentService);
    results = moduleRef.get(ResultRunService);
  }, 600_000);

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  it('F17: every page of a 350-pupil list is reachable, with the right total', async () => {
    const seen = new Set<string>();
    let page = 1;
    let totalPages = 1;
    do {
      const res: any = await as('registrar', () => students.list({ page, pageSize: 50 } as any));
      expect(res.meta.total).toBe(PUPILS);
      totalPages = res.meta.totalPages;
      for (const s of res.data) seen.add(s.id);
      page += 1;
    } while (page <= totalPages);
    expect(totalPages).toBe(7);
    expect(seen.size).toBe(PUPILS);
  });

  it('computes and publishes a 350-pupil term inside the budget', async () => {
    const t0 = Date.now();
    const rs: any = await as('exams', () => results.compute({ termId, rosterId } as any));
    const computedIn = Date.now() - t0;
    expect(rs.studentCount).toBe(PUPILS);

    const t1 = Date.now();
    const published: any = await as('head', () => results.publish(rs.id));
    const publishedIn = Date.now() - t1;
    expect(published.status).toBe('published');

    // Budgets sized for a laptop Postgres; production hardware is faster.
    expect(computedIn).toBeLessThan(120_000);
    expect(publishedIn).toBeLessThan(120_000);
    // eslint-disable-next-line no-console
    console.log(`wave13-scale: compute ${computedIn} ms, publish ${publishedIn} ms for ${PUPILS} pupils`);
  });
});
