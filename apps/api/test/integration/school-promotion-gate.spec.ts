/**
 * A8 promotion gate + portals — integration proof.
 *
 *  - A8-repeat:  a student whose published result recommends 'repeat' is held in
 *                the same class by rollover; a 'promote' student advances.
 *  - A8-portal:  the student portal surfaces published results + certificates
 *                from the spine.
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
import { PromotionService } from '../../src/modules/school/people/promotion.service';
import { PortalsService } from '../../src/modules/school/portals/portals.service';

describeDb('integration: A8 promotion gate + portals', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let promotion: PromotionService;
  let portals: PortalsService;

  const organizationId = `org_a8_${Date.now()}`;
  let fromTermId = '', toTermId = '', s1Class = '', s2Class = '', nextClass = '';
  let promoteStudent = '', repeatStudent = '';

  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);
  const perms = ['school:students:write', 'school:portal:student'];
  const asUser = <T>(fn: () => Promise<T>): Promise<T> => tenant.run({ organizationId, userId: 'registrar', permissions: perms }, fn);

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({ where: { code: 'UGX' }, update: {}, create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 } });
    await setOrg(organizationId);
    await raw.organization.create({ data: { id: organizationId, code: `A8-${Date.now()}`, name: 'A8 School', currencyCode: 'UGX' } });
    const year = await raw.academicYear.create({ data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') } });
    fromTermId = (await raw.term.create({ data: { organizationId, academicYearId: year.id, name: 'Term 1', startDate: new Date('2026-01-15'), endDate: new Date('2026-04-15') } })).id;
    toTermId = (await raw.term.create({ data: { organizationId, academicYearId: year.id, name: 'Term 2', startDate: new Date('2026-05-01'), endDate: new Date('2026-08-15') } })).id;

    const g1 = await raw.gradeLevel.create({ data: { organizationId, name: 'P1', order: 1 } });
    const g2 = await raw.gradeLevel.create({ data: { organizationId, name: 'P2', order: 2 } });
    s1Class = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId: g1.id, name: 'P1 A' } })).id;
    s2Class = s1Class;
    nextClass = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId: g2.id, name: 'P2 A' } })).id;

    // Two P1 students: one recommended promote, one repeat (both from published results).
    const mk = async (name: string) => {
      const partner = await raw.partner.create({ data: { organizationId, code: `P-${name}-${Date.now()}`, name, isCustomer: true } });
      return (await raw.studentProfile.create({ data: { organizationId, partnerId: partner.id, admissionNo: `A8-${name}`, enrollmentDate: new Date('2026-01-15'), currentClassId: s1Class, status: 'active' } })).id;
    };
    promoteStudent = await mk('Pass Pupil');
    repeatStudent = await mk('Repeat Pupil');

    const rs = await raw.resultSet.create({ data: { organizationId, termId: fromTermId, scopeType: 'class', scopeId: s1Class, status: 'published', revision: 1, publishedAt: new Date() } });
    await raw.studentTermResult.createMany({ data: [
      { organizationId, resultSetId: rs.id, studentProfileId: promoteStudent, termId: fromTermId, meanPercent: 75, subjectsCount: 4, eligible: true, promotionRecommendation: 'promote' },
      { organizationId, resultSetId: rs.id, studentProfileId: repeatStudent, termId: fromTermId, meanPercent: 28, subjectsCount: 4, eligible: false, promotionRecommendation: 'repeat' },
    ] });

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    promotion = moduleRef.get(PromotionService);
    portals = moduleRef.get(PortalsService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  it('A8-repeat: rollover holds the repeat-recommended pupil, promotes the other', async () => {
    const plan: any = await asUser(() => promotion.rolloverTerm({ fromTermId, toTermId, dryRun: true } as any));
    expect(plan.counts.repeated).toBe(1);
    expect(plan.counts.promoted).toBe(1);
    expect(plan.repeat[0].studentProfileId).toBe(repeatStudent);
    expect(plan.repeat[0].toClassId).toBe(s1Class); // same class
    expect(plan.promote[0].studentProfileId).toBe(promoteStudent);
    expect(plan.promote[0].toClassId).toBe(nextClass); // next grade

    // Execute for real and confirm the enrollments landed as planned.
    await asUser(() => promotion.rolloverTerm({ fromTermId, toTermId, dryRun: false } as any));
    const repeatEnr = await raw.enrollment.findFirst({ where: { studentProfileId: repeatStudent, termId: toTermId } });
    expect(repeatEnr?.classId).toBe(s1Class);
    const promoteEnr = await raw.enrollment.findFirst({ where: { studentProfileId: promoteStudent, termId: toTermId } });
    expect(promoteEnr?.classId).toBe(nextClass);
  });

  it('A8-portal: student portal surfaces published results + certificates', async () => {
    // Issue a certificate for the promoted pupil.
    await raw.certificate.create({ data: { organizationId, studentProfileId: promoteStudent, type: 'merit', status: 'issued', serialNumber: `CERT-A8-${Date.now()}`, verificationCode: `CERT-AAAA-BBBB-${Date.now() % 10000}`, title: 'Merit', issuedAt: new Date(), payload: { holderName: 'Pass Pupil' } } });

    const dash: any = await asUser(() => portals.studentDashboard(promoteStudent));
    expect(dash.publishedResults.length).toBeGreaterThanOrEqual(1);
    expect(dash.publishedResults[0].promotionRecommendation).toBe('promote');
    expect(dash.certificates.length).toBe(1);
    expect(dash.certificates[0].type).toBe('merit');
  });
});
