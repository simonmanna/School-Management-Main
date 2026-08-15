/**
 * A6 certification — integration proof.
 *
 *  - A6-transcript: rolls published term results into a cumulative transcript.
 *  - A6-external:   records a structured UNEB result with subject rows.
 *  - A6-cert:       issues a certificate with a sequence serial + random code;
 *                   verify returns only holder/type/status; revoke vs void.
 *  - A6-verify:     a bad code leaks nothing (valid:false, no enumeration).
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
import { StudentService } from '../../src/modules/school/people/student.service';
import { TranscriptService, ExternalExamResultService, CertificateService } from '../../src/modules/school/certification/cert.service';

describeDb('integration: A6 certification', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let students: StudentService;
  let transcripts: TranscriptService;
  let external: ExternalExamResultService;
  let certs: CertificateService;

  const organizationId = `org_a6_${Date.now()}`;
  let termId = '', resultSetId = '', studentId = '';

  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);
  const perms = ['school:issue:certificates', 'school:certificates:issue', 'school:certificates:revoke', 'school:exams:write', 'school:students:write'];
  const asUser = <T>(fn: () => Promise<T>): Promise<T> => tenant.run({ organizationId, userId: 'registrar', permissions: perms }, fn);

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({ where: { code: 'UGX' }, update: {}, create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 } });
    await setOrg(organizationId);
    await raw.organization.create({ data: { id: organizationId, code: `A6-${Date.now()}`, name: 'A6 School', currencyCode: 'UGX' } });
    const year = await raw.academicYear.create({ data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') } });
    termId = (await raw.term.create({ data: { organizationId, academicYearId: year.id, name: 'Term 1', startDate: new Date('2026-01-15'), endDate: new Date('2026-04-15'), isCurrent: true } })).id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    students = moduleRef.get(StudentService);
    transcripts = moduleRef.get(TranscriptService);
    external = moduleRef.get(ExternalExamResultService);
    certs = moduleRef.get(CertificateService);

    // A student + a published result set with one term result.
    const partner = await raw.partner.create({ data: { organizationId, code: `P-${Date.now()}`, name: 'Grace Namuli', isCustomer: true } });
    studentId = (await raw.studentProfile.create({ data: { organizationId, partnerId: partner.id, admissionNo: `A6-${Date.now()}`, enrollmentDate: new Date('2026-01-15') } })).id;
    const rs = await raw.resultSet.create({ data: { organizationId, termId, scopeType: 'class', status: 'published', revision: 1, publishedAt: new Date() } });
    resultSetId = rs.id;
    await raw.studentTermResult.create({ data: { organizationId, resultSetId: rs.id, studentProfileId: studentId, termId, gpa: 3.2, aggregate: 24, division: 'I', meanPercent: 72, subjectsCount: 8, eligible: true } });
    await raw.studentSubjectResult.create({ data: { organizationId, resultSetId: rs.id, studentProfileId: studentId, subjectId: 'math', finalPercent: 72, grade: 'C3', gradePoint: 3.2, points: 3 } });
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  it('A6-transcript: rolls published term results into a cumulative transcript', async () => {
    const tr: any = await asUser(() => transcripts.build(studentId));
    expect(tr.payload.cumulativeGpa).toBe('3.2');
    expect(tr.payload.terms.length).toBe(1);
    expect(tr.payload.sourceResultSetIds).toContain(resultSetId);
  });

  it('A6-external: records a structured UNEB result with subject rows', async () => {
    const ext: any = await asUser(() => external.record({
      studentProfileId: studentId, level: 'UCE', year: 2026, indexNumber: 'U0001/001', aggregate: 24, division: 'I',
      subjects: [{ subject: 'Mathematics', grade: 'C3' }, { subject: 'English', grade: 'C4' }],
    } as any));
    expect(ext.subjects.length).toBe(2);
    expect(ext.division).toBe('I');
  });

  it('A6-cert: issue → verify (minimal) → revoke vs void', async () => {
    const cert: any = await asUser(() => certs.issue({ studentProfileId: studentId, type: 'completion', title: 'Certificate of Completion' } as any));
    expect(cert.serialNumber).toMatch(/^CERT-/);
    expect(cert.verificationCode).toMatch(/^CERT-\w{4}-\w{4}-\w{4}$/);
    expect(cert.status).toBe('issued');

    // Public verify returns only holder/type/status — no marks, no student id.
    const v: any = await certs.verify(cert.verificationCode);
    expect(v.valid).toBe(true);
    expect(v.holderName).toBe('Grace Namuli');
    expect(v.type).toBe('completion');
    expect(v.studentProfileId).toBeUndefined();
    expect(v.payload).toBeUndefined();

    // Revoke flips verify to invalid.
    await asUser(() => certs.revoke(cert.id, 'Issued in error'));
    const v2: any = await certs.verify(cert.verificationCode);
    expect(v2.valid).toBe(false);
    expect(v2.status).toBe('revoked');

    // A fresh cert can be voided (distinct from revoked).
    const cert2: any = await asUser(() => certs.issue({ studentProfileId: studentId, type: 'merit', title: 'Merit Award' } as any));
    const voided: any = await asUser(() => certs.revoke(cert2.id, 'Administrative error', true));
    expect(voided.status).toBe('void');
  });

  it('A6-verify: an unknown code leaks nothing', async () => {
    const v: any = await certs.verify('CERT-ZZZZ-ZZZZ-ZZZZ');
    expect(v).toEqual({ valid: false });
  });
});
