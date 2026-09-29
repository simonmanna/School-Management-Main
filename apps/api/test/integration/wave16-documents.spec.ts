/**
 * Wave 16 Track B — the official printouts a Ugandan primary school runs on,
 * rendered from a real database and read back as text.
 *
 *  - B1 leaving certificate: snapshotted from the record; refused for a pupil
 *       still enrolled; one live certificate per pupil.
 *  - B4 fee receipt: A5 and 80 mm thermal; every office print after the first
 *       is stamped as a copy; a family download never consumes the original.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';
import { ensureAccountCategories, makeAccountFactory } from './_accounts';
import { KernelModule } from '../../src/kernel/kernel.module';
import { DocumentsModule } from '../../src/modules/documents/documents.module';
import { CoreModule } from '../../src/modules/core/core.module';
import { AccountingModule } from '../../src/modules/accounting/accounting.module';
import { InventoryModule } from '../../src/modules/inventory/inventory.module';
import { InvoicingModule } from '../../src/modules/invoicing/invoicing.module';
import { CertificationModule } from '../../src/modules/school/certification/certification.module';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';
import { CertificateService } from '../../src/modules/school/certification/cert.service';
import { CertificatePdfService } from '../../src/modules/school/certification/certificate-pdf.service';
import { SchoolPaymentService } from '../../src/modules/school/fees/billing.service';
import { FeeReceiptPdfService } from '../../src/modules/school/fees/fee-receipt-pdf.service';
import { placeInClass } from './_placement';
import { expectPdf, pdfText } from '../_pdf-text';

describeDb('integration: Wave 16 school documents', () => {
  const raw = new PrismaClient();
  let moduleRef: TestingModule;
  let tenant: TenantContextService;

  const stamp = Date.now();
  const organizationId = `org_w16_docs_${stamp}`;
  let classId = '';
  let arAccountId = '';

  const asTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId: 'registrar_w16', permissions: [] }, fn);

  async function pupil(tag: string, status: string) {
    const partner = await raw.partner.create({
      data: { organizationId, code: `STU-${tag}`, name: `Nakato ${tag}`, isCustomer: true, receivableAccountId: arAccountId },
    });
    const student = await raw.studentProfile.create({
      data: {
        organizationId,
        partnerId: partner.id,
        admissionNo: `ADM-${tag}`,
        enrollmentDate: new Date('2024-02-05'),
        dateOfBirth: new Date('2016-06-12'),
        gender: 'Female',
        status: status as any,
      },
    });
    await placeInClass(raw, { organizationId, studentProfileId: student.id, classId, effectiveFrom: new Date('2024-02-05') });
    if (status !== 'active') {
      await raw.studentStatusHistory.create({
        data: { organizationId, studentProfileId: student.id, fromStatus: 'active', toStatus: status, changedAt: new Date('2026-08-29') },
      });
    }
    return student;
  }

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, organizationId);
    await raw.organization.create({ data: { id: organizationId, code: `W16D-${stamp}`, name: 'Green Valley Primary', currencyCode: 'UGX' } });
    await raw.schoolProfile.create({
      data: { organizationId, name: 'Green Valley Primary School', motto: 'Learn to Serve', address: 'P.O. Box 1, Mukono' },
    });
    const mk = makeAccountFactory(raw, await ensureAccountCategories(raw));
    arAccountId = (await mk(organizationId, 'W16-1300', 'Fees Receivable', 'receivable')).id;
    await raw.accountMapping.create({ data: { organizationId, key: 'accounts_receivable', accountId: arAccountId } });
    const cash = (await mk(organizationId, 'W16-1100', 'Cash', 'cash')).id;
    await raw.accountMapping.create({ data: { organizationId, key: 'default_cash', accountId: cash } });
    for (const [code, name, type] of [['SALES', 'Sales', 'sales'], ['CASH', 'Cash', 'cash'], ['BANK', 'Bank', 'bank'], ['GEN', 'General', 'general']] as const) {
      await raw.journal.create({ data: { organizationId, code, name, journalType: type } });
    }
    const grade = await raw.gradeLevel.create({ data: { organizationId, name: 'P5', order: 5 } });
    classId = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'P5 East' } })).id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, CertificationModule],
    }).compile();
    tenant = moduleRef.get(TenantContextService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  describe('B1 · leaving certificate', () => {
    it('issues from the record and prints the transfer form', async () => {
      const s = await pupil('LEAVE', 'transferred');
      const certs = moduleRef.get(CertificateService);
      const cert: any = await asTenant(() =>
        certs.issueLeaving({ studentProfileId: s.id, reasonForLeaving: 'Family relocated to Gulu', conduct: 'Very good', destinationSchool: 'Gulu Primary' }),
      );
      expect(cert.type).toBe('leaving');
      expect(cert.payload).toMatchObject({
        admissionNo: 'ADM-LEAVE',
        lastClass: 'P5 East',
        departureStatus: 'transferred',
        feesCleared: true,
        feesOutstanding: 0,
      });
      expect(cert.payload.leavingDate.slice(0, 10)).toBe('2026-08-29');

      const { pdf, filename } = await asTenant(() => moduleRef.get(CertificatePdfService).generatePdf(cert.id));
      expectPdf(pdf);
      expect(filename).toBe(`${cert.serialNumber}.pdf`);
      const text = pdfText(pdf);
      for (const needle of ['GREEN VALLEY PRIMARY SCHOOL', 'LEAVING CERTIFICATE', 'Nakato LEAVE', 'ADM-LEAVE', 'P5 East', 'Family relocated to Gulu', 'Cleared', cert.verificationCode]) {
        expect(text).toContain(needle);
      }
    });

    it('refuses a pupil who has not left', async () => {
      const s = await pupil('STAY', 'active');
      await expect(
        asTenant(() => moduleRef.get(CertificateService).issueLeaving({ studentProfileId: s.id, reasonForLeaving: 'n/a' })),
      ).rejects.toThrow(/records a departure/);
    });

    it('allows one live leaving certificate per pupil; revoke to reissue', async () => {
      const s = await pupil('TWICE', 'withdrawn');
      const certs = moduleRef.get(CertificateService);
      const first: any = await asTenant(() => certs.issueLeaving({ studentProfileId: s.id, reasonForLeaving: 'Moved' }));
      await expect(asTenant(() => certs.issueLeaving({ studentProfileId: s.id, reasonForLeaving: 'Moved' }))).rejects.toThrow(/already issued/);
      await asTenant(() => certs.revoke(first.id, 'wrong date'));
      const second: any = await asTenant(() => certs.issueLeaving({ studentProfileId: s.id, reasonForLeaving: 'Moved', leavingDate: '2026-08-30' }));
      expect(second.payload.leavingDate.slice(0, 10)).toBe('2026-08-30');

      const revoked = pdfText((await asTenant(() => moduleRef.get(CertificatePdfService).generatePdf(first.id))).pdf);
      expect(revoked).toContain('REVOKED');
    });
  });

  describe('B4 · fee receipt', () => {
    let paymentId = '';

    beforeAll(async () => {
      const s = await pupil('PAY', 'active');
      const out: any = await asTenant(() =>
        moduleRef.get(SchoolPaymentService).collect({
          studentProfileId: s.id,
          amount: 150_000,
          paymentMethod: 'mobile_money',
          externalReference: `MTN-RCPT-${stamp}`,
          externalReferenceType: 'mobile_money_txn',
          convertOverpaymentToCredit: true,
        } as any),
      );
      paymentId = out.payment.id;
    });

    it('prints the original, then stamps every reprint as a copy', async () => {
      const receipts = moduleRef.get(FeeReceiptPdfService);
      const first = await asTenant(() => receipts.generate(paymentId, 'a4'));
      expectPdf(first.pdf);
      const text = pdfText(first.pdf);
      for (const needle of ['OFFICIAL FEE RECEIPT', 'Nakato PAY', 'ADM-PAY', 'P5 East', 'Mobile money', 'UGX 150,000']) expect(text).toContain(needle);
      expect(text).not.toContain('COPY');
      expect(first.reprint).toBe(0);

      const second = await asTenant(() => receipts.generate(paymentId, 'a4'));
      expect(second.reprint).toBe(1);
      expect(pdfText(second.pdf)).toContain('reprint 1');
      expect(second.filename).toMatch(/-copy1\.pdf$/);
    });

    it('renders the 80 mm thermal layout', async () => {
      const out = await asTenant(() => moduleRef.get(FeeReceiptPdfService).generate(paymentId, 'thermal'));
      expectPdf(out.pdf, 800);
      const text = pdfText(out.pdf);
      expect(text).toContain('FEE RECEIPT');
      expect(text).toContain('UGX 150,000');
    });

    it('a family copy is marked as such and does not count as an office print', async () => {
      const receipts = moduleRef.get(FeeReceiptPdfService);
      const before = await raw.auditLog.count({ where: { entity: 'FeeReceipt', entityId: paymentId, action: { in: ['issue', 'reprint'] } } });
      const family = await asTenant(() => receipts.generate(paymentId, 'a4', 'family'));
      expect(pdfText(family.pdf)).toContain('FAMILY COPY');
      const after = await raw.auditLog.count({ where: { entity: 'FeeReceipt', entityId: paymentId, action: { in: ['issue', 'reprint'] } } });
      expect(after).toBe(before);
    });
  });
});
