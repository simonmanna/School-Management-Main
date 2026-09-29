/**
 * Wave 16 (audit P1-1) — a family applies online and follows it by magic link.
 *
 *  - the form offers only OPEN cycles, and refuses a closed one
 *  - an application goes through the office's own create path (source=online,
 *    primary guardian, submitted) and a tracking token is issued to the email
 *  - a duplicate is refused without naming the existing application
 *  - a honeypot hit stores nothing
 *  - documents attach by token only, PDF/JPG/PNG only
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
import { PublicAdmissionsService } from '../../src/modules/school/admissions/public-admissions.service';
import { AdmissionsPortalService } from '../../src/modules/school/admissions/admissions-portal.service';

describeDb('integration: Wave 16 public online application', () => {
  const raw = new PrismaClient();
  let moduleRef: TestingModule;
  let svc: PublicAdmissionsService;

  const stamp = Date.now();
  const organizationId = `org_w16_apply_${stamp}`;
  const orgCode = `APPLY-${stamp}`;
  let openCycleId = '';
  let closedCycleId = '';
  let classId = '';
  let token = '';

  const form = (over: Record<string, unknown> = {}) => ({
    admissionCycleId: openCycleId,
    applyingForClassId: classId,
    applicantFirstName: 'Amani',
    applicantLastName: 'Okello',
    applicantDob: '2020-05-14',
    applicantGender: 'female' as const,
    guardian: { firstName: 'Grace', lastName: 'Okello', relationship: 'mother', phone: '0772123456', email: 'Grace.Okello@example.ug' },
    ...over,
  });

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({ where: { code: 'UGX' }, update: {}, create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 } });
    await raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, organizationId);
    await raw.organization.create({ data: { id: organizationId, code: orgCode, name: 'Hillside Nursery & Primary', currencyCode: 'UGX' } });
    await raw.schoolProfile.create({ data: { organizationId, name: 'Hillside Nursery & Primary School' } });
    const year = await raw.academicYear.create({ data: { organizationId, name: '2027', startDate: new Date('2027-01-01'), endDate: new Date('2027-12-31') } });
    openCycleId = (await raw.admissionCycle.create({ data: { organizationId, academicYearId: year.id, name: '2027 Intake', status: 'open' } })).id;
    closedCycleId = (await raw.admissionCycle.create({ data: { organizationId, academicYearId: year.id, name: '2027 Late', status: 'closed' } })).id;
    const grade = await raw.gradeLevel.create({ data: { organizationId, name: 'Baby Class', order: 1 } });
    classId = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'Baby Class' } })).id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    svc = moduleRef.get(PublicAdmissionsService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  it('offers only open intakes and the classes the school admits into', async () => {
    const opts: any = await svc.options(orgCode);
    expect(opts.schoolName).toBe('Hillside Nursery & Primary School');
    expect(opts.cycles.map((c: any) => c.id)).toEqual([openCycleId]);
    expect(opts.classes.map((c: any) => c.name)).toContain('Baby Class');
    await expect(svc.options('NO-SUCH-SCHOOL')).rejects.toThrow(/School not found/);
  });

  it('submits through the office pipeline and issues a tracking link to the guardian', async () => {
    const out: any = await svc.apply(orgCode, form());
    expect(out.received).toBe(true);
    expect(out.applicationNumber).toMatch(/^APP-/);
    expect(out.trackingLinkSentTo).toBe('gr**********@example.ug');
    expect(out.devToken).toBeTruthy();
    token = out.devToken;

    const app = await raw.admissionApplication.findFirst({ where: { organizationId, applicationNumber: out.applicationNumber }, include: { guardians: true } });
    expect(app).toMatchObject({ status: 'submitted', sourceOfEnquiry: 'online', admissionCycleId: openCycleId, applyingForClassId: classId });
    expect(app!.guardians).toHaveLength(1);
    expect(app!.guardians[0]).toMatchObject({ email: 'grace.okello@example.ug', isPrimary: true, financiallyResponsible: true });

    const portal = moduleRef.get(AdmissionsPortalService);
    const view: any = await portal.portalView((await portal.resolveToken(token)).applicationId);
    expect(view).toMatchObject({ applicationNumber: out.applicationNumber, applicantName: 'Amani Okello', status: 'submitted' });
  });

  it('refuses a duplicate without naming the existing application', async () => {
    const err: any = await svc.apply(orgCode, form({ applicantFirstName: 'AMANI ' })).catch((e) => e);
    expect(err?.status).toBe(409);
    expect(String(err.message)).toMatch(/already with the school/);
    expect(String(err.message)).not.toMatch(/APP-/);
  });

  it('refuses a closed intake', async () => {
    await expect(svc.apply(orgCode, form({ admissionCycleId: closedCycleId, applicantFirstName: 'Other' }))).rejects.toThrow(/not open/);
  });

  it('stores nothing when the honeypot is filled', async () => {
    const before = await raw.admissionApplication.count({ where: { organizationId } });
    const out: any = await svc.apply(orgCode, form({ applicantFirstName: 'Bot', website: 'http://spam.example' }));
    expect(out).toEqual({ received: true });
    expect(await raw.admissionApplication.count({ where: { organizationId } })).toBe(before);
  });

  it('attaches a document by token, and only a PDF/JPG/PNG', async () => {
    const pdf = { originalname: 'birth.pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test'), size: 13 };
    const doc: any = await svc.uploadDocument(token, 'birth_certificate', pdf);
    expect(doc.type).toBe('birth_certificate');
    const stored = await raw.applicationDocument.findFirst({ where: { id: doc.id } });
    expect(stored?.fileId).toBeTruthy();

    await expect(
      svc.uploadDocument(token, 'birth_certificate', { originalname: 'x.exe', mimetype: 'application/x-msdownload', buffer: Buffer.from('MZ'), size: 2 }),
    ).rejects.toThrow(/PDF, JPG or PNG/);
    await expect(svc.uploadDocument('not-a-token', 'birth_certificate', pdf)).rejects.toThrow(/Invalid access link/);
  });
});
