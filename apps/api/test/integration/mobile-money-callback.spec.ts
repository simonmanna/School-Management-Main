/**
 * Wave 16 (audit P1-2) — the mobile-money callback, end to end, on a real
 * database. The unit spec (fees-momo-and-explainer) proves signature and
 * state-machine rules against a mocked `collect`; this proves the money lands:
 * a signed SUCCESSFUL callback creates exactly one Payment carrying the
 * provider reference, allocates it to the pupil's open invoice, and moves the
 * request to `succeeded`. A FAILED callback and a replay create nothing.
 */
import { createHmac } from 'node:crypto';
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
import { FeesModule } from '../../src/modules/school/fees/fees.module';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';
import { BillingService } from '../../src/modules/school/fees/billing.service';
import { MobileMoneyService } from '../../src/modules/school/fees/mobile-money.service';
import { placeInClass } from './_placement';

describeDb('integration: mobile-money callback → Payment → allocation (audit P1-2)', () => {
  const raw = new PrismaClient();
  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let momo: MobileMoneyService;

  const stamp = Date.now();
  const organizationId = `org_momo_cb_${stamp}`;
  const SECRET = 'momo-callback-secret';
  const TUITION = 600_000;
  let studentProfileId = '';
  let termId = '';
  let invoiceDocumentId = '';

  const asTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId: 'bursar_momo', permissions: [] }, fn);
  const sign = (body: string) => createHmac('sha256', SECRET).update(body).digest('hex');
  const callback = (ref: string, status: string, amount: number) =>
    JSON.stringify({ externalId: ref, status, amount: String(amount), currency: 'UGX' });
  const pendingRequest = (ref: string, amount: number) =>
    raw.mobileMoneyRequest.create({
      data: { organizationId, studentProfileId, provider: 'mtn', providerRef: ref, msisdn: '256772000001', amount, currency: 'UGX' },
    });

  beforeAll(async () => {
    process.env.ENABLE_LIVE_MOBILE_MONEY = 'true';
    await raw.$connect();
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, organizationId);
    await raw.organization.create({ data: { id: organizationId, code: `MOMO-${stamp}`, name: 'MoMo School', currencyCode: 'UGX' } });

    const mk = makeAccountFactory(raw, await ensureAccountCategories(raw));
    const cash = (await mk(organizationId, 'MM-1100', 'Cash', 'cash')).id;
    const clearing = (await mk(organizationId, 'MM-1150', 'MoMo Clearing', 'bank')).id;
    const ar = (await mk(organizationId, 'MM-1300', 'Fees Receivable', 'receivable')).id;
    const revenue = (await mk(organizationId, 'MM-4100', 'Tuition Revenue', 'revenue')).id;
    for (const [code, name, type] of [['SALES', 'Sales', 'sales'], ['CASH', 'Cash', 'cash'], ['BANK', 'Bank', 'bank'], ['GEN', 'General', 'general']] as const) {
      await raw.journal.create({ data: { organizationId, code, name, journalType: type } });
    }
    await raw.accountMapping.create({ data: { organizationId, key: 'default_cash', accountId: cash } });
    await raw.accountMapping.create({ data: { organizationId, key: 'accounts_receivable', accountId: ar } });

    const category = await raw.productCategory.create({ data: { organizationId, name: 'School Fees', incomeAccountId: revenue } });
    const product = await raw.product.create({
      data: { organizationId, code: 'TUITION', name: 'Tuition', productType: 'service', categoryId: category.id, salesPrice: TUITION },
    });
    const year = await raw.academicYear.create({
      data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
    });
    const term = await raw.term.create({
      data: { organizationId, academicYearId: year.id, name: 'Term 1', startDate: new Date('2026-01-15'), endDate: new Date('2026-04-15'), isCurrent: true },
    });
    termId = term.id;
    const grade = await raw.gradeLevel.create({ data: { organizationId, name: 'P3', order: 3 } });
    const klass = await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'P3 North' } });
    const partner = await raw.partner.create({
      data: { organizationId, code: 'STU-MM-1', name: 'Momo Pupil', isCustomer: true, receivableAccountId: ar },
    });
    const student = await raw.studentProfile.create({
      data: { organizationId, partnerId: partner.id, admissionNo: 'ADM-MM-1', enrollmentDate: new Date('2026-01-10'), status: 'active' },
    });
    studentProfileId = student.id;
    await placeInClass(raw, { organizationId, studentProfileId, classId: klass.id });

    const fs = await raw.feeStructure.create({
      data: {
        organizationId,
        name: 'P3 Fees',
        academicYearId: year.id,
        status: 'draft',
        components: [{ code: 'TUITION', productId: product.id, amount: TUITION }],
        applicableTo: { classIds: [klass.id] },
      },
    });
    const v1 = await raw.feeStructureVersion.create({ data: { organizationId, feeStructureId: fs.id, versionNo: 1, publishedAt: new Date('2026-01-01') } });
    await raw.feeItem.create({
      data: { organizationId, feeStructureVersionId: v1.id, code: 'TUITION', name: 'Tuition', productId: product.id, amount: TUITION, isOptional: false },
    });
    await raw.feeStructure.update({ where: { id: fs.id }, data: { status: 'published', currentVersionId: v1.id } });
    await raw.feeSchedule.create({ data: { organizationId, feeStructureId: fs.id, termId, dueDate: new Date('2026-02-15') } });

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, FeesModule],
    }).compile();
    tenant = moduleRef.get(TenantContextService);
    momo = moduleRef.get(MobileMoneyService);

    const billed: any = await asTenant(() => moduleRef.get(BillingService).billSingleStudent(studentProfileId, termId));
    expect(billed.status).toBe('posted');
    invoiceDocumentId = billed.documentId;
    await asTenant(() => momo.upsertGateway('mtn', { callbackSecret: SECRET, clearingAccountId: clearing, currency: 'UGX' } as any));
  });

  afterAll(async () => {
    delete process.env.ENABLE_LIVE_MOBILE_MONEY;
    await moduleRef?.close();
    await raw.$disconnect();
  });

  it('a signed SUCCESSFUL callback posts one Payment and allocates it to the open invoice', async () => {
    const ref = `MTN-OK-${stamp}`;
    await pendingRequest(ref, 250_000);
    const body = callback(ref, 'SUCCESSFUL', 250_000);

    const res: any = await momo.handleCallback('mtn', body, sign(body));
    expect(res).toMatchObject({ matched: true, status: 'succeeded', posted: true });

    const payments = await raw.payment.findMany({ where: { organizationId, externalReference: ref } });
    expect(payments).toHaveLength(1);
    expect(Number(payments[0].amount)).toBe(250_000);

    const request = await raw.mobileMoneyRequest.findFirst({ where: { providerRef: ref } });
    expect(request?.status).toBe('succeeded');
    expect(request?.paymentId).toBe(payments[0].id);

    const allocations = await raw.paymentAllocation.findMany({ where: { paymentId: payments[0].id } });
    expect(allocations.map((a: any) => a.documentId)).toEqual([invoiceDocumentId]);
    const invoice = await raw.document.findFirst({ where: { id: invoiceDocumentId } });
    expect(Number(invoice?.amountResidual)).toBe(TUITION - 250_000);
  });

  it('a replayed callback posts nothing further', async () => {
    const ref = `MTN-OK-${stamp}`;
    const body = callback(ref, 'SUCCESSFUL', 250_000);
    const res: any = await momo.handleCallback('mtn', body, sign(body));
    expect(res.posted).toBe(false);
    expect(await raw.payment.count({ where: { organizationId, externalReference: ref } })).toBe(1);
  });

  it('a FAILED callback records the failure and creates no Payment', async () => {
    const ref = `MTN-FAIL-${stamp}`;
    await pendingRequest(ref, 100_000);
    const body = JSON.stringify({ externalId: ref, status: 'FAILED', reason: 'PAYER_LIMIT_REACHED' });

    const res: any = await momo.handleCallback('mtn', body, sign(body));
    expect(res).toMatchObject({ matched: true, status: 'failed', posted: false });
    expect(await raw.payment.count({ where: { organizationId, externalReference: ref } })).toBe(0);
    const request = await raw.mobileMoneyRequest.findFirst({ where: { providerRef: ref } });
    expect(request?.status).toBe('failed');
    expect(request?.failureReason).toContain('PAYER_LIMIT_REACHED');
  });

  it('a forged signature changes nothing', async () => {
    const ref = `MTN-FORGED-${stamp}`;
    await pendingRequest(ref, 100_000);
    const body = callback(ref, 'SUCCESSFUL', 100_000);
    await expect(momo.handleCallback('mtn', body, sign(body + 'x'))).rejects.toThrow(/Invalid callback signature/);
    expect(await raw.payment.count({ where: { organizationId, externalReference: ref } })).toBe(0);
    expect((await raw.mobileMoneyRequest.findFirst({ where: { providerRef: ref } }))?.status).toBe('pending');
  });
});
