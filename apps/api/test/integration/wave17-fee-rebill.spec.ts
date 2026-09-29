/**
 * Wave 17 — audit R05 / D05, against a real database.
 *
 * A term is billed, a family pays part, the school publishes a new fee
 * version. The bursar asks for the invoice to be revised; a different person
 * approves. The old invoice is credited (kept on record), the pupil is billed
 * at the new version, the receipt moves to the new invoice, and the student
 * balance, allocations, journals and the AR control account agree exactly.
 * A second approval or a second request does not bill twice; a closed term
 * refuses.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PERMISSIONS } from '@erp/shared';
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
import { BillingService, SchoolPaymentService } from '../../src/modules/school/fees/billing.service';
import { FinanceCorrectionRequestService } from '../../src/modules/school/fees/finance-correction-request.service';
import { SchoolFinanceQueryService } from '../../src/modules/school/fees/school-finance-query.service';
import { placeInClass } from './_placement';

describeDb('integration: wave 17 fee revision — credit and rebill (R05)', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let billing: BillingService;
  let payments: SchoolPaymentService;
  let corrections: FinanceCorrectionRequestService;
  let finance: SchoolFinanceQueryService;

  const stamp = Date.now();
  const organizationId = `org_w17rb_${stamp}`;
  const OLD = 350_000;
  const NEW = 420_000;
  const BURSAR = [PERMISSIONS.school.readFees, PERMISSIONS.school.manageFees, PERMISSIONS.school.refundFees];
  const HEAD = [PERMISSIONS.school.readFees, PERMISSIONS.school.approveRefunds];
  const as = <T>(userId: string, permissions: string[], fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId, permissions }, fn);
  const admin = <T>(fn: () => Promise<T>) => as('admin_1', ['*'], fn);

  let termId = '';
  let classId = '';
  let arAccountId = '';
  let structureId = '';
  let productId = '';
  let pupil = { id: '', partnerId: '' };

  const glAr = async () => {
    const r = await raw.journalLine.aggregate({ where: { organizationId, accountId: arAccountId }, _sum: { baseDebit: true, baseCredit: true } });
    return Number(r._sum.baseDebit ?? 0) - Number(r._sum.baseCredit ?? 0);
  };
  const liveInvoices = () =>
    raw.schoolFeeInvoice.findMany({ where: { organizationId, studentProfileId: pupil.id, termId, status: { notIn: ['voided', 'cancelled'] } } });

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({ where: { code: 'UGX' }, update: {}, create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 } });
    await raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, organizationId);
    await raw.organization.create({ data: { id: organizationId, code: `W17RB-${stamp}`, name: 'Green Valley', currencyCode: 'UGX', timezone: 'Africa/Kampala' } as any });
    await raw.schoolProfile.create({ data: { organizationId, name: 'Green Valley', gradingSystem: 'PLE' } as any });
    const mk = makeAccountFactory(raw, await ensureAccountCategories(raw));
    const cashAccountId = (await mk(organizationId, 'W17-1100', 'Cash', 'cash')).id;
    arAccountId = (await mk(organizationId, 'W17-1300', 'Fees Receivable', 'receivable')).id;
    const revenueAccountId = (await mk(organizationId, 'W17-4100', 'Tuition Revenue', 'revenue')).id;
    for (const [code, name, type] of [['SALES', 'Sales', 'sales'], ['CASH', 'Cash', 'cash'], ['GEN', 'General', 'general']] as const) {
      await raw.journal.create({ data: { organizationId, code, name, journalType: type } });
    }
    for (const [key, accountId] of [['default_cash', cashAccountId], ['accounts_receivable', arAccountId]] as const) {
      await raw.accountMapping.create({ data: { organizationId, key, accountId } });
    }
    const category = await raw.productCategory.create({ data: { organizationId, name: 'School Fees', incomeAccountId: revenueAccountId } });
    productId = (await raw.product.create({
      data: { organizationId, code: 'TUITION', name: 'Tuition', productType: 'service', categoryId: category.id, salesPrice: OLD },
    })).id;
    const year = await raw.academicYear.create({ data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') } });
    termId = (await raw.term.create({
      data: { organizationId, academicYearId: year.id, name: 'Term 3', startDate: new Date('2026-09-01'), endDate: new Date('2026-12-05'), isCurrent: true },
    })).id;
    const gradeLevel = await raw.gradeLevel.create({ data: { organizationId, name: 'P5', order: 5 } });
    classId = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId: gradeLevel.id, name: 'P5' } })).id;
    const structure = await raw.feeStructure.create({
      data: {
        organizationId, name: 'P5 Term Fees', academicYearId: year.id, status: 'published',
        components: [{ code: 'TUITION', productId, amount: OLD }], applicableTo: { classIds: [classId] },
      },
    });
    structureId = structure.id;
    const v1 = await raw.feeStructureVersion.create({ data: { organizationId, feeStructureId: structure.id, versionNo: 1, isImmutable: true, publishedAt: new Date() } });
    await raw.feeItem.create({
      data: { organizationId, feeStructureVersionId: v1.id, code: 'TUITION', name: 'Tuition', productId, amount: OLD, isOptional: false, frequency: 'termly', appliesTo: {} },
    });
    await raw.feeStructure.update({ where: { id: structure.id }, data: { currentVersionId: v1.id } });
    await raw.feeSchedule.create({ data: { organizationId, feeStructureId: structure.id, termId, dueDate: new Date('2026-10-01') } });

    const partner = await raw.partner.create({ data: { organizationId, code: `W17RB-${stamp}`, name: 'Nakimuli Grace', isCustomer: true, receivableAccountId: arAccountId } });
    const student = await raw.studentProfile.create({
      data: { organizationId, partnerId: partner.id, admissionNo: `W17RB-1`, enrollmentDate: new Date('2026-01-10'), status: 'active' },
    });
    await placeInClass(raw, { organizationId, studentProfileId: student.id, classId });
    pupil = { id: student.id, partnerId: partner.id };

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, FeesModule],
    }).compile();
    tenant = moduleRef.get(TenantContextService);
    billing = moduleRef.get(BillingService);
    payments = moduleRef.get(SchoolPaymentService);
    corrections = moduleRef.get(FinanceCorrectionRequestService);
    finance = moduleRef.get(SchoolFinanceQueryService);

    await admin(() => billing.generateForTerm({ termId } as any));
    await admin(() => payments.collect({ studentProfileId: pupil.id, amount: 200_000, paymentMethod: 'cash' } as any));
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  const publishV2 = async () => {
    const v2 = await raw.feeStructureVersion.create({ data: { organizationId, feeStructureId: structureId, versionNo: 2, isImmutable: true, publishedAt: new Date() } });
    await raw.feeItem.create({
      data: { organizationId, feeStructureVersionId: v2.id, code: 'TUITION', name: 'Tuition', productId, amount: NEW, isOptional: false, frequency: 'termly', appliesTo: {} },
    });
    await raw.feeStructure.update({ where: { id: structureId }, data: { currentVersionId: v2.id } });
    return v2.id;
  };

  let oldInvoiceId = '';
  let requestId = '';

  it('refuses a revision while the invoice is already on the current version', async () => {
    const [sfi] = await liveInvoices();
    oldInvoiceId = sfi.id;
    await expect(as('bursar_1', BURSAR, () => corrections.submit({ kind: 'rebill', schoolFeeInvoiceId: sfi.id, reason: 'fee change' }))).rejects.toThrow(
      /already on the current published fee version/,
    );
  });

  it('the bursar files it; the bursar cannot approve their own request', async () => {
    await publishV2();
    const res: any = await as('bursar_1', BURSAR, () => corrections.submit({ kind: 'rebill', schoolFeeInvoiceId: oldInvoiceId, reason: 'Board raised P5 tuition' }));
    expect(res.status).toBe('pending_approval');
    requestId = res.requestId;
    await expect(as('bursar_1', [...BURSAR, PERMISSIONS.school.approveRefunds], () => corrections.approve(requestId))).rejects.toBeInstanceOf(ForbiddenException);
    // Nothing has changed yet.
    expect(await liveInvoices()).toHaveLength(1);
  });

  it('a different approver applies it: old credited and kept, new billed, receipt moved, books agree', async () => {
    const before = await glAr();
    expect(before).toBe(OLD - 200_000);

    const out: any = await as('head_1', HEAD, () => corrections.approve(requestId, 'Approved per board minute 12'));
    expect(out.status).toBe('applied');
    const summary = out.result;
    expect(summary).toMatchObject({ supersededTotal: String(OLD), newTotal: String(NEW), reapplied: [expect.objectContaining({ amount: '200000' })], unappliedOverpayment: '0' });

    const old = await raw.schoolFeeInvoice.findUnique({ where: { id: oldInvoiceId } });
    expect(old!.status).toBe('voided');
    const oldDoc = await raw.document.findUnique({ where: { id: old!.documentId } });
    expect(oldDoc!.status).toBe('cancelled');

    const live = await liveInvoices();
    expect(live).toHaveLength(1);
    const newDoc = await raw.document.findUnique({ where: { id: live[0].documentId } });
    expect(Number(newDoc!.totalAmount)).toBe(NEW);
    expect(Number(newDoc!.amountPaid)).toBe(200_000);
    expect(Number(newDoc!.amountResidual)).toBe(NEW - 200_000);

    // Allocations: the original is reversed, a new one points at the new invoice.
    const allocs = await raw.paymentAllocation.findMany({ where: { organizationId, payment: { partnerId: pupil.partnerId } } as any });
    expect(allocs.filter((a) => a.status === 'posted').map((a) => a.documentId)).toEqual([newDoc!.id]);

    // Student balance and the AR control account agree exactly.
    const balance: any = await admin(() => finance.studentBalance(pupil.id));
    expect(balance.billed).toBe(NEW);
    expect(balance.collected).toBe(200_000);
    expect(balance.balance).toBe(NEW - 200_000);
    expect(await glAr()).toBe(NEW - 200_000);

    // Audit trail names the change.
    const audit = await raw.auditLog.findFirst({ where: { organizationId, entityId: oldInvoiceId, action: 'adjust' } as any });
    expect(audit).not.toBeNull();
  });

  it('replaying the approval or re-filing does not bill twice', async () => {
    await expect(as('head_2', HEAD, () => corrections.approve(requestId))).rejects.toThrow(/already approved/);
    await expect(as('bursar_1', BURSAR, () => corrections.submit({ kind: 'rebill', schoolFeeInvoiceId: oldInvoiceId, reason: 'again' }))).rejects.toThrow(/already voided/);
    const [live] = await liveInvoices();
    await expect(as('bursar_1', BURSAR, () => corrections.submit({ kind: 'rebill', schoolFeeInvoiceId: live.id, reason: 'again' }))).rejects.toThrow(
      /already on the current published fee version/,
    );
    // A later billing run finds the pupil already billed for the term.
    await admin(() => billing.generateForTerm({ termId } as any));
    expect(await liveInvoices()).toHaveLength(1);
    expect(await glAr()).toBe(NEW - 200_000);
  });

  it('a closed term refuses the revision', async () => {
    // v3 published, then the term is closed: the approval must refuse and change nothing.
    const v3 = await raw.feeStructureVersion.create({ data: { organizationId, feeStructureId: structureId, versionNo: 3, isImmutable: true, publishedAt: new Date() } });
    await raw.feeItem.create({
      data: { organizationId, feeStructureVersionId: v3.id, code: 'TUITION', name: 'Tuition', productId, amount: 400_000, isOptional: false, frequency: 'termly', appliesTo: {} },
    });
    await raw.feeStructure.update({ where: { id: structureId }, data: { currentVersionId: v3.id } });
    const [live] = await liveInvoices();
    const req: any = await as('bursar_1', BURSAR, () => corrections.submit({ kind: 'rebill', schoolFeeInvoiceId: live.id, reason: 'v3' }));
    await raw.termFinancialClose.create({ data: { organizationId, termId, status: 'closed', closedAt: new Date() } as any });
    const closed = await as('head_1', HEAD, () => corrections.approve(req.requestId)).catch((e) => e);
    expect(closed).toBeInstanceOf(Error);
    expect(String(closed.message)).toMatch(/closed/i);
    expect((await liveInvoices())[0].id).toBe(live.id);
    expect(await glAr()).toBe(NEW - 200_000);
  });
});
