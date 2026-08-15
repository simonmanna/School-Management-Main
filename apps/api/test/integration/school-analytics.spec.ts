/**
 * A7 analytics — integration proof. Reads the published result spine and pins
 * every answer to the ResultSet revision.
 *
 *  - A7-descriptive: grade distribution + subject/class performance.
 *  - A7-diagnostic:  CA-vs-exam divergence flags an anomaly.
 *  - A7-predictive:  the at-risk register carries its triggering rule.
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
import { AnalyticsService } from '../../src/modules/school/analytics/analytics.service';

describeDb('integration: A7 analytics', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let analytics: AnalyticsService;

  const organizationId = `org_a7_${Date.now()}`;
  let resultSetId = '';
  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);
  const asUser = <T>(fn: () => Promise<T>): Promise<T> => tenant.run({ organizationId, userId: 'head', permissions: ['school:analytics:read'] }, fn);

  beforeAll(async () => {
    await raw.$connect();
    await setOrg(organizationId);
    await raw.organization.create({ data: { id: organizationId, code: `A7-${Date.now()}`, name: 'A7 School', currencyCode: 'UGX' } });
    await raw.currency.upsert({ where: { code: 'UGX' }, update: {}, create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 } });
    const year = await raw.academicYear.create({ data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') } });
    const term = await raw.term.create({ data: { organizationId, academicYearId: year.id, name: 'Term 1', startDate: new Date('2026-01-15'), endDate: new Date('2026-04-15'), isCurrent: true } });

    const rs = await raw.resultSet.create({ data: { organizationId, termId: term.id, scopeType: 'class', status: 'published', revision: 2, publishedAt: new Date() } });
    resultSetId = rs.id;

    // Two strong students, one at-risk; one subject shows a CA/exam divergence.
    await raw.studentTermResult.createMany({ data: [
      { organizationId, resultSetId: rs.id, studentProfileId: 'stuA', termId: term.id, gpa: 3.6, meanPercent: 82, subjectsCount: 2, eligible: true },
      { organizationId, resultSetId: rs.id, studentProfileId: 'stuB', termId: term.id, gpa: 3.2, meanPercent: 70, subjectsCount: 2, eligible: true },
      { organizationId, resultSetId: rs.id, studentProfileId: 'stuC', termId: term.id, gpa: 0.8, meanPercent: 32, subjectsCount: 2, eligible: false },
    ] });
    await raw.studentSubjectResult.createMany({ data: [
      { organizationId, resultSetId: rs.id, studentProfileId: 'stuA', subjectId: 'math', finalPercent: 84, grade: 'D2', caScore: 82, examScore: 85 },
      { organizationId, resultSetId: rs.id, studentProfileId: 'stuA', subjectId: 'eng', finalPercent: 80, grade: 'D2', caScore: 78, examScore: 81 },
      { organizationId, resultSetId: rs.id, studentProfileId: 'stuB', subjectId: 'math', finalPercent: 72, grade: 'C3', caScore: 90, examScore: 55 }, // divergence!
      { organizationId, resultSetId: rs.id, studentProfileId: 'stuB', subjectId: 'eng', finalPercent: 68, grade: 'C4', caScore: 66, examScore: 69 },
      { organizationId, resultSetId: rs.id, studentProfileId: 'stuC', subjectId: 'math', finalPercent: 30, grade: 'F9', caScore: 32, examScore: 29 },
      { organizationId, resultSetId: rs.id, studentProfileId: 'stuC', subjectId: 'eng', finalPercent: 34, grade: 'F9', caScore: 35, examScore: 33 },
    ] });

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    analytics = moduleRef.get(AnalyticsService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  it('A7-descriptive: grade distribution + class performance are pinned to the revision', async () => {
    const dist: any = await asUser(() => analytics.gradeDistribution(resultSetId));
    expect(dist.resultSetRevision).toBe(2);
    const f9 = dist.distribution.find((d: any) => d.grade === 'F9');
    expect(f9.count).toBe(2);

    const cls: any = await asUser(() => analytics.classPerformance(resultSetId));
    expect(cls.studentCount).toBe(3);
    expect(cls.passRate).toBeCloseTo(66.67, 1); // 2 of 3 above 50
    expect(cls.eligibleRate).toBeCloseTo(66.67, 1);

    const subj: any = await asUser(() => analytics.subjectPerformance(resultSetId));
    const math = subj.subjects.find((s: any) => s.subjectId === 'math');
    expect(math.count).toBe(3);
  });

  it('A7-diagnostic: CA-vs-exam divergence flags the anomaly', async () => {
    const div: any = await asUser(() => analytics.caVsExamDivergence(resultSetId, 25));
    expect(div.flagged.length).toBe(1);
    expect(div.flagged[0].studentProfileId).toBe('stuB');
    expect(div.flagged[0].subjectId).toBe('math');
    expect(div.flagged[0].gap).toBe(35);
  });

  it('A7-predictive: the at-risk register carries the triggering rule', async () => {
    const risk: any = await asUser(() => analytics.atRisk(resultSetId, 50));
    const stuC = risk.register.find((r: any) => r.studentProfileId === 'stuC');
    expect(stuC).toBeDefined();
    expect(stuC.reasons).toContain('not_eligible');
    expect(stuC.reasons.some((r: string) => r.startsWith('mean_below_pass'))).toBe(true);
    // Strong students are not flagged.
    expect(risk.register.find((r: any) => r.studentProfileId === 'stuA')).toBeUndefined();
  });
});
