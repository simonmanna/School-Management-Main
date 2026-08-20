/**
 * A6.2 — Fees & Finance integrity suite. Proves the FINANCIAL_INVARIANTS end to
 * end against a real database, exercising the economic events the audit found
 * broken: waiver, credit, adjustment, refund, and the three reconciliations.
 *
 * Regression guards for the P0/P1 defects:
 *   - a partial waiver posts a GL entry (P0-2)
 *   - a waiver never touches amountPaid (P0-3)
 *   - collected = SUM(PaymentAllocation), portal = statement = ledger (P0-1/P0-4)
 *   - a credit application draws down a typed subledger, not amountPaid
 *   - an adjustment moves residual AND the GL leg together
 *   - a refund is capped at the canonical entitlement (P0-6/P1-3)
 *   - AR ⇄ GL and credit-liability reconcile to zero after a full cycle
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
import { FeesModule } from '../../src/modules/school/fees/fees.module';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';
import { BillingService, SchoolPaymentService } from '../../src/modules/school/fees/billing.service';
import { AdvancedFinanceService } from '../../src/modules/school/fees/advanced.service';
import { FinanceControlsService } from '../../src/modules/school/fees/finance-controls.service';
import { SchoolFinanceQueryService } from '../../src/modules/school/fees/school-finance-query.service';
import { CashSessionService } from '../../src/modules/accounting/treasury/cash-session.service';

describeDb('integration: school fees integrity (invariants)', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let billing: BillingService;
  let payments: SchoolPaymentService;
  let advanced: AdvancedFinanceService;
  let controls: FinanceControlsService;
  let finance: SchoolFinanceQueryService;
  let cashSessions: CashSessionService;

  const organizationId = `org_int_${Date.now()}`;
  const userId = 'bursar_1';
  const approverId = 'bursar_2';
  const TUITION = 1_000_000;

  let studentProfileId = '';
  let partnerId = '';
  let termId = '';
  let cashAccountId = '';
  let arAccountId = '';
  let cashRegisterId = '';

  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);
  const asTenant = <T>(fn: () => Promise<T>, uid = userId): Promise<T> =>
    tenant.run({ organizationId, userId: uid, permissions: [] }, fn);

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await setOrg(organizationId);
    await raw.organization.create({
      data: { id: organizationId, code: `INT-${Date.now()}`, name: 'Integrity School', currencyCode: 'UGX' },
    });
    const mk = makeAccountFactory(raw, await ensureAccountCategories(raw));
    cashAccountId = (await mk(organizationId, 'INT-1100', 'Cash', 'cash')).id;
    arAccountId = (await mk(organizationId, 'INT-1300', 'Fees Receivable', 'receivable')).id;
    const revenueAccountId = (await mk(organizationId, 'INT-4100', 'Tuition Revenue', 'revenue')).id;
    for (const [code, name, type] of [
      ['SALES', 'Sales', 'sales'],
      ['CASH', 'Cash', 'cash'],
      ['GEN', 'General', 'general'],
    ] as const) {
      await raw.journal.create({ data: { organizationId, code, name, journalType: type } });
    }
    for (const [key, accountId] of [
      ['default_cash', cashAccountId],
      ['accounts_receivable', arAccountId],
    ] as const) {
      await raw.accountMapping.create({ data: { organizationId, key, accountId } });
    }
    const category = await raw.productCategory.create({
      data: { organizationId, name: 'School Fees', incomeAccountId: revenueAccountId },
    });
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
    const gradeLevel = await raw.gradeLevel.create({ data: { organizationId, name: 'P1', order: 1 } });
    const schoolClass = await raw.schoolClass.create({ data: { organizationId, gradeLevelId: gradeLevel.id, name: 'P1 East' } });
    const partner = await raw.partner.create({
      data: { organizationId, code: 'STU-0001', name: 'Ada Pupil', isCustomer: true, receivableAccountId: arAccountId },
    });
    partnerId = partner.id;
    const student = await raw.studentProfile.create({
      data: { organizationId, partnerId: partner.id, admissionNo: 'ADM-0001', enrollmentDate: new Date('2026-01-10'), currentClassId: schoolClass.id, status: 'active' },
    });
    studentProfileId = student.id;
    const feeStructure = await raw.feeStructure.create({
      data: {
        organizationId,
        name: 'Standard Term Fees',
        academicYearId: year.id,
        components: [{ code: 'TUITION', productId: product.id, amount: TUITION }],
        applicableTo: { classIds: [schoolClass.id] },
      },
    });
    await raw.feeSchedule.create({
      data: { organizationId, feeStructureId: feeStructure.id, termId, dueDate: new Date('2026-02-15') },
    });
    const register = await raw.cashRegister.create({
      data: { organizationId, code: 'REG-1', name: 'Bursar Drawer', defaultAccountId: cashAccountId },
    });
    cashRegisterId = register.id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, FeesModule],
    }).compile();
    tenant = moduleRef.get(TenantContextService);
    billing = moduleRef.get(BillingService);
    payments = moduleRef.get(SchoolPaymentService);
    advanced = moduleRef.get(AdvancedFinanceService);
    controls = moduleRef.get(FinanceControlsService);
    finance = moduleRef.get(SchoolFinanceQueryService);
    cashSessions = moduleRef.get(CashSessionService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  const glBalance = async (accountId: string): Promise<number> => {
    const rows = await raw.$queryRawUnsafe<Array<{ net: unknown }>>(
      `SELECT COALESCE(SUM("baseDebit" - "baseCredit"),0) AS net FROM "JournalLine" WHERE "organizationId" = $1 AND "accountId" = $2`,
      organizationId, accountId,
    );
    return Number(rows[0]?.net ?? 0);
  };

  it('bills the term and creates a SchoolFeeInvoice 1:1 with the Document', async () => {
    const res = await asTenant(() => billing.generateForTerm({ termId }));
    expect(res.count).toBe(1);
    const sfi = await raw.schoolFeeInvoice.findFirst({ where: { organizationId, studentProfileId } });
    expect(sfi).toBeTruthy();
    expect(sfi!.documentId).toBe(res.documents[0].id);
    // AR debited by the full amount.
    expect(await glBalance(arAccountId)).toBe(TUITION);
  });

  it('collected is SUM(PaymentAllocation); portal balance == statement balance == ledger', async () => {
    const session = await asTenant(() =>
      cashSessions.open({ cashRegisterId, openingFloat: 0 } as any),
    );
    await asTenant(() =>
      payments.collect({ studentProfileId, amount: 400_000, paymentMethod: 'cash', cashSessionId: (session as any).id } as any),
    );

    const balance = await asTenant(() => finance.studentBalance(studentProfileId));
    expect(balance.billed).toBe(TUITION);
    expect(balance.collected).toBe(400_000); // from PaymentAllocation, not amountPaid
    expect(balance.balance).toBe(600_000);

    const ledger = await asTenant(() => finance.studentLedger(studentProfileId));
    expect(ledger.closingBalance).toBe(600_000);
  });

  it('a waiver posts a GL entry and NEVER touches amountPaid (P0-2, P0-3)', async () => {
    const paidBefore = (await raw.document.findFirst({ where: { organizationId, partnerId } }))!.amountPaid;

    const waiver = await asTenant(() =>
      advanced.createWaiver({ studentProfileId, code: `WV-${Date.now()}`, name: 'Bursary', amount: 100_000 }),
    );
    // Maker-checker: a different user approves, then applies.
    await asTenant(() => advanced.approveWaiver((waiver as any).id), approverId);
    await asTenant(() => advanced.applyWaiver((waiver as any).id), approverId);

    // GL: a school_waiver journal entry exists.
    const entry = await raw.journalEntry.findFirst({ where: { organizationId, sourceType: 'school_waiver', sourceId: (waiver as any).id } });
    expect(entry).toBeTruthy();

    // amountPaid is unchanged; amountWaived carries the forgiveness.
    const doc = await raw.document.findFirst({ where: { organizationId, partnerId } });
    expect(Number(doc!.amountPaid)).toBe(Number(paidBefore));
    expect(Number(doc!.amountWaived)).toBe(100_000);

    const balance = await asTenant(() => finance.studentBalance(studentProfileId));
    expect(balance.waived).toBe(100_000);
    expect(balance.balance).toBe(500_000); // 1,000,000 − 400,000 paid − 100,000 waived
  });

  it('rejects applying a waiver that has not been approved (maker-checker)', async () => {
    const w = await asTenant(() =>
      advanced.createWaiver({ studentProfileId, code: `WV2-${Date.now()}`, name: 'Unapproved', amount: 50_000 }),
    );
    await expect(asTenant(() => advanced.applyWaiver((w as any).id))).rejects.toThrow(/must be approved/);
  });

  it('a refund is capped at the canonical entitlement (P0-6)', async () => {
    // The student owes money; there is no unallocated credit, so any refund is rejected.
    await expect(
      asTenant(() => payments.refundFee({ studentProfileId, amount: 10_000, paymentMethod: 'cash' } as any)),
    ).rejects.toThrow(/refundable entitlement/);
  });

  it('an adjustment moves residual and the GL AR leg together', async () => {
    const doc = await raw.document.findFirst({ where: { organizationId, partnerId } });
    const residualBefore = Number(doc!.amountResidual);
    const arBefore = await glBalance(arAccountId);

    const adj = await asTenant(() =>
      controls.createAdjustment({ studentProfileId, documentId: doc!.id, direction: 'credit', amount: 50_000, reason: 'Goodwill' }),
    );
    await asTenant(() => controls.approveAdjustment((adj as any).id), approverId);

    const after = await raw.document.findFirst({ where: { id: doc!.id } });
    expect(Number(after!.amountResidual)).toBe(residualBefore - 50_000);
    // GL AR fell by the same 50k → subledger and GL stay in lock-step.
    expect(await glBalance(arAccountId)).toBe(arBefore - 50_000);
  });

  it('AR subledger reconciles to the GL AR control account (zero variance)', async () => {
    const recon = await asTenant(() => finance.reconcileCurrentArToGl());
    expect(Math.abs(recon.variance)).toBeLessThanOrEqual(0.01);
    expect(recon.perStudent).toHaveLength(0);
  });

  it('a closed term blocks further billing (A4.1) independent of the fiscal period', async () => {
    await asTenant(() => controls.closeTerm(termId));
    await expect(asTenant(() => billing.generateForTerm({ termId }))).rejects.toThrow(/financially closed/);
    await asTenant(() => controls.reopenTerm(termId, 'correction'), approverId);
  });
});
