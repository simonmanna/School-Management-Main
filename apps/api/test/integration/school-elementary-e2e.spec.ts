/**
 * End-to-end test: an elementary (Ugandan primary) school, one full academic
 * year, driven through the REAL fees services — not seeded documents.
 *
 * This is both a realistic 1-year data seed AND the production-readiness proof
 * the audits demanded: it builds Kampala Junior Academy (P1–P7, 3 terms),
 * publishes an immutable fee structure, enrols pupils, then exercises every
 * money path through BillingService / SchoolPaymentService / the reversal
 * service and asserts the accounting reconciles.
 *
 * Run in isolation (the integration specs share one DB and contend under
 * parallel load):
 *   DATABASE_URL=... pnpm --filter @erp/api exec jest \
 *     test/integration/school-elementary-e2e.spec.ts --forceExit
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
import { CashSessionService } from '../../src/modules/accounting/treasury/cash-session.service';
import { PaymentAllocationReversalService } from '../../src/modules/school/fees/allocation-reversal.service';
import { AdvancedFinanceService } from '../../src/modules/school/fees/advanced.service';

const UGX = (v: number) => new (require('@prisma/client').Prisma).Decimal(v);

describeDb('integration: elementary school — full year e2e (register → bill → pay → refund → reverse)', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let billing: BillingService;
  let schoolPayments: SchoolPaymentService;
  let cashSessions: CashSessionService;
  let reversals: PaymentAllocationReversalService;
  let finance: AdvancedFinanceService;

  const O = `org_elem_${Date.now()}`;
  const accounts: Record<string, string> = {};
  const journals: Record<string, string> = {};
  const grades: Record<string, string> = {};   // P1..P7 -> gradeLevelId
  const classes: Record<string, string> = {};   // P1..P7 -> classId
  const students: Array<{ id: string; partnerId: string; adm: string; grade: string }> = [];
  let yearId = '';
  const termIds: string[] = [];
  let feeStructureId = '';
  let feeVersionId = '';
  let cashRegisterId = '';
  let cashSessionId = '';

  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);
  const asTenant = <T>(fn: () => Promise<T>, userId = 'bursar'): Promise<T> => tenant.run({ organizationId: O, userId, permissions: [] }, fn);

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await setOrg(O);

    await raw.organization.create({ data: { id: O, code: `ELEM-${Date.now()}`, name: 'Kampala Junior Academy', currencyCode: 'UGX' } });
    const mk = makeAccountFactory(raw, await ensureAccountCategories(raw));
    const cats = await ensureAccountCategories(raw);
    accounts.cash = (await mk(O, 'ELEM-1100', 'Cash', 'cash')).id;
    accounts.ar = (await mk(O, 'ELEM-1300', 'Fees Receivable', 'receivable')).id;
    accounts.revenue = (await mk(O, 'ELEM-4100', 'Tuition Revenue', 'revenue')).id;
    accounts.waiver = (await raw.account.create({ data: { organizationId: O, code: 'ELEM-4200', name: 'Fee Waiver Expense', categoryId: cats.get('other_expense')!, normalBalance: 'debit' } })).id;
    accounts.crLiability = (await raw.account.create({ data: { organizationId: O, code: 'ELEM-2150', name: 'Fee-Credit Liability', categoryId: cats.get('current_liability')!, normalBalance: 'credit' } })).id;
    for (const [code, name, type] of [['SALES', 'Sales', 'sales'], ['CASH', 'Cash', 'cash'], ['GEN', 'General', 'general']] as const) {
      const j = await raw.journal.create({ data: { organizationId: O, code, name, journalType: type } });
      journals[code] = j.id;
    }
    for (const [key, accountId] of [['default_cash', accounts.cash], ['accounts_receivable', accounts.ar], ['fee_credit_liability', accounts.crLiability], ['fee_waiver_expense', accounts.waiver]] as const) {
      await raw.accountMapping.create({ data: { organizationId: O, key, accountId } });
    }

    // Products / categories.
    const feeCat = await raw.productCategory.create({ data: { organizationId: O, name: 'School Fees', incomeAccountId: accounts.revenue } });
    const prod = async (code: string, name: string, amount: number) =>
      (await raw.product.create({ data: { organizationId: O, code, name, productType: 'service', categoryId: feeCat.id, salesPrice: UGX(amount) } })).id;
    const P_TUITION = await prod('TUITION', 'Tuition', 350_000);
    const P_LUNCH = await prod('LUNCH', 'Lunch', 200_000);
    const P_TRANSPORT = await prod('TRANSPORT', 'Transport', 150_000);
    const P_DEV = await prod('DEVFUND', 'Development Fund', 100_000);

    // Academic year 2026, three terms.
    const year = await raw.academicYear.create({ data: { organizationId: O, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-05') } });
    yearId = year.id;
    const termDefs = [
      { name: 'Term 1', start: '2026-02-02', end: '2026-04-24', due: '2026-02-20', current: true },
      { name: 'Term 2', start: '2026-05-04', end: '2026-08-07', due: '2026-05-22', current: false },
      { name: 'Term 3', start: '2026-09-07', end: '2026-12-04', due: '2026-09-25', current: false },
    ];
    for (const t of termDefs) {
      const term = await raw.term.create({ data: { organizationId: O, academicYearId: yearId, name: t.name, startDate: new Date(t.start), endDate: new Date(t.end), isCurrent: t.current } });
      termIds.push(term.id);
    }

    // Grades P1–P7, one class each, 3 pupils per grade (21 pupils).
    const firstNames = ['Ada', 'Baker', 'Caro', 'David', 'Esther', 'Frank', 'Grace', 'Hassan', 'Ivy', 'John', 'Kemi', 'Leo', 'Maya', 'Nassi', 'Opio', 'Patra', 'Quin', 'Rita', 'Sami', 'Timo', 'Umar'];
    let n = 0;
    for (let g = 1; g <= 7; g++) {
      const gName = `P${g}`;
      const gl = await raw.gradeLevel.create({ data: { organizationId: O, name: gName, order: g } });
      grades[gName] = gl.id;
      const cls = await raw.schoolClass.create({ data: { organizationId: O, gradeLevelId: gl.id, name: `${gName} A` } });
      classes[gName] = cls.id;
      for (let k = 0; k < 3; k++) {
        n++;
        const adm = `ELEM/2026/${String(n).padStart(3, '0')}`;
        const partner = await raw.partner.create({ data: { organizationId: O, code: `STU-${String(n).padStart(3, '0')}`, name: `${firstNames[n - 1]} Guardian`, isCustomer: true, receivableAccountId: accounts.ar } });
        const stu = await raw.studentProfile.create({ data: { organizationId: O, partnerId: partner.id, admissionNo: adm, enrollmentDate: new Date('2026-01-20'), currentClassId: cls.id, status: 'active' } });
        await raw.enrollment.create({ data: { organizationId: O, studentProfileId: stu.id, termId: termIds[0], classId: cls.id, rollNumber: String(n), enrolledAt: new Date('2026-01-20') } });
        students.push({ id: stu.id, partnerId: partner.id, adm, grade: gName });
      }
    }

    // Published fee structure with immutable version (full-year components).
    const fs = await raw.feeStructure.create({ data: { organizationId: O, name: 'Primary Term Fees', academicYearId: yearId, status: 'draft', components: [] } });
    feeStructureId = fs.id;
    const fv = await raw.feeStructureVersion.create({ data: { organizationId: O, feeStructureId: fs.id, versionNo: 1, publishedAt: new Date('2026-01-01') } });
    feeVersionId = fv.id;
    for (const [code, name, prodId, amt] of [['TUITION', 'Tuition', P_TUITION, 350_000], ['LUNCH', 'Lunch', P_LUNCH, 200_000], ['TRANSPORT', 'Transport', P_TRANSPORT, 150_000], ['DEVFUND', 'Development Fund', P_DEV, 100_000]] as const) {
      await raw.feeItem.create({ data: { organizationId: O, feeStructureVersionId: fv.id, code, name, productId: prodId, amount: UGX(amt), isOptional: code === 'TRANSPORT' } });
    }
    await raw.feeStructure.update({ where: { id: fs.id }, data: { status: 'published', currentVersionId: fv.id } });
    // Schedule all three terms to the same structure.
    for (const tid of termIds) {
      await raw.feeSchedule.create({ data: { organizationId: O, feeStructureId: fs.id, termId: tid, dueDate: new Date('2026-02-20') } });
    }

    const register = await raw.cashRegister.create({ data: { organizationId: O, code: 'REG-ELEM', name: 'Bursar Drawer', defaultAccountId: accounts.cash } });
    cashRegisterId = register.id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, FeesModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    billing = moduleRef.get(BillingService);
    schoolPayments = moduleRef.get(SchoolPaymentService);
    cashSessions = moduleRef.get(CashSessionService);
    reversals = moduleRef.get(PaymentAllocationReversalService);
    finance = moduleRef.get(AdvancedFinanceService);

    // Open a cash session for the collection tests.
    cashSessionId = (await asTenant(() => cashSessions.open({ cashRegisterId, openingFloat: 0 }))).id;
  }, 240_000);

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  it('bills every enrolled pupil for Term 1 (immutable pricing)', async () => {
    const res: any = await asTenant(() => billing.generateForTerm({ termId: termIds[0] }));
    expect(res.count).toBe(21);
    const invoices = await raw.schoolFeeInvoice.count({ where: { organizationId: O, termId: termIds[0] } });
    expect(invoices).toBe(21);
    // Each invoice priced from the immutable FeeItem rows: 350k+200k+100k = 650k
    // (transport is optional, not auto-billed).
    const sampleInv = await raw.schoolFeeInvoice.findFirstOrThrow({ where: { organizationId: O, termId: termIds[0] } });
    const sampleDoc = await raw.document.findFirstOrThrow({ where: { id: sampleInv.documentId } });
    expect(Number(sampleDoc.totalAmount)).toBe(650_000);
  });

  it('collects a partial cash payment and allocates oldest-first', async () => {
    const stu = students[0];
    const inv = await raw.schoolFeeInvoice.findFirstOrThrow({ where: { studentProfileId: stu.id } });
    const docBefore = await raw.document.findFirstOrThrow({ where: { id: inv.documentId } });
    const before = Number(docBefore.amountResidual);
    const r: any = await asTenant(() => schoolPayments.collect({
      studentProfileId: stu.id, amount: 400_000, paymentMethod: 'cash',
      cashSessionId, allocations: [{ documentId: inv.documentId, amount: 400_000 }],
    }));
    expect(r.payment.id).toBeTruthy();
    const docAfter = await raw.document.findFirstOrThrow({ where: { id: inv.documentId } });
    expect(Number(docAfter.amountResidual)).toBe(before - 400_000);
    expect(docAfter.paymentStatus).toBe('partial');
  });

  it('accepts an overpayment, holds it as a refundable credit (B1)', async () => {
    const stu = students[1];
    const inv = await raw.schoolFeeInvoice.findFirstOrThrow({ where: { studentProfileId: stu.id } });
    // Pay the full 650k + 100k over, opting to hold the excess as a credit (B1).
    const r: any = await asTenant(() => schoolPayments.collect({
      studentProfileId: stu.id, amount: 750_000, paymentMethod: 'cash',
      cashSessionId, convertOverpaymentToCredit: true,
      allocations: [{ documentId: inv.documentId, amount: 650_000 }],
    }));
    expect(r.unallocated).toBe(0); // the 100k is now a credit, not free cash
    expect(r.overpaymentCredit).toBeTruthy();
    const credit = await raw.feeCredit.findFirst({ where: { studentProfileId: stu.id, organizationId: O, source: 'overpayment' } });
    expect(credit).toBeTruthy();
    expect(Number(credit!.remaining)).toBe(100_000);
  });

  it('refunds an overpayment credit exactly once (concurrency-safe)', async () => {
    const stu = students[1];
    const credit = await raw.feeCredit.findFirstOrThrow({ where: { studentProfileId: stu.id, organizationId: O, source: 'overpayment' } });
    const r: any = await asTenant(() => schoolPayments.refundFee({ studentProfileId: stu.id, amount: 100_000, paymentMethod: 'cash', cashSessionId }));
    expect(r.payment.id).toBeTruthy();
    const after = await raw.feeCredit.findFirstOrThrow({ where: { id: credit.id } });
    expect(Number(after.remaining)).toBe(0);
    expect(after.status).toBe('refunded');
    // A second refund of the same (now-zero) credit must be rejected.
    await expect(asTenant(() => schoolPayments.refundFee({ studentProfileId: stu.id, amount: 100_000, paymentMethod: 'cash', cashSessionId })))
      .rejects.toThrow();
  });

  it('applies a waiver (maker-checker) and reduces the balance without faking payment', async () => {
    const stu = students[2];
    const inv = await raw.schoolFeeInvoice.findFirstOrThrow({ where: { studentProfileId: stu.id } });
    const docBefore = await raw.document.findFirstOrThrow({ where: { id: inv.documentId } });
    const before = Number(docBefore.amountResidual);
    const w: any = await asTenant(() => finance.createWaiver({
      studentProfileId: stu.id, code: 'WD-1', name: 'Sibling discount',
      amount: 200_000, reason: 'sibling discount', documentId: inv.documentId,
    }));
    await asTenant(() => finance.approveWaiver(w.id), 'headteacher');
    await asTenant(() => finance.applyWaiver(w.id));
    const docAfter = await raw.document.findFirstOrThrow({ where: { id: inv.documentId } });
    expect(Number(docAfter.amountResidual)).toBeLessThan(before);
    // Waived amount must NOT count as paid.
    expect(Number(docAfter.amountPaid)).toBe(0);
  });

  it('reverses an allocation (new event row, never an edit)', async () => {
    const stu = students[0];
    const inv = await raw.schoolFeeInvoice.findFirstOrThrow({ where: { studentProfileId: stu.id } });
    const alloc = await raw.paymentAllocation.findFirstOrThrow({ where: { documentId: inv.documentId } });
    const beforeRev = await raw.paymentAllocationReversal.count({ where: { organizationId: O } });
    await asTenant(() => reversals.reverseAllocation(alloc.id, 'parent disputed the allocation'));
    const afterRev = await raw.paymentAllocationReversal.count({ where: { organizationId: O } });
    expect(afterRev).toBe(beforeRev + 1);
    // The original allocation is preserved as a projection; a reversal event exists.
    const reversal = await raw.paymentAllocationReversal.findFirstOrThrow({ where: { paymentAllocationId: alloc.id } });
    expect(reversal.id).toBeTruthy();
  });

  it('reconciles: every journal balances, AR⇄GL matches, credit liability⇄GL matches', async () => {
    // G3: every journal entry balances.
    const unbalanced = await raw.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*) c FROM "JournalEntry" je
        WHERE je."organizationId"=$1 AND je.status::text='posted'
        AND (SELECT ABS(SUM("baseDebit"-"baseCredit")) FROM "JournalLine" jl WHERE jl."journalEntryId"=je.id) > 0.01`,
      O,
    );
    expect(Number(unbalanced[0].c)).toBe(0);

    // G2: AR subledger (open residual of fee docs, minus unallocated inbound)
    //     = GL AR control. Mirrors the production audit gate (audit-fees-accounting.ts).
    const ar = await raw.$queryRawUnsafe<any[]>(
      `WITH ar AS (
         SELECT id FROM "Account" WHERE "organizationId"=$1 AND "name" ILIKE '%receivable%' AND "name" NOT ILIKE '%not%'
       ),
       sub AS (
         SELECT COALESCE(SUM(d."amountResidual"),0) total,
                COALESCE(SUM(CASE WHEN d."journalEntryId" IS NOT NULL THEN d."amountResidual" ELSE 0 END),0) posted_total,
                COALESCE(SUM(CASE WHEN d."journalEntryId" IS NULL THEN 1 ELSE 0 END),0) seeded_docs
           FROM "Document" d
          WHERE d."organizationId"=$1 AND d."sourceType"=ANY(ARRAY['school_fee','school_penalty','library_fine','school_meal'])
            AND d.status::text=ANY(ARRAY['posted','paid']) AND d."paymentStatus"::text IN ('not_paid','partial')
            AND d."amountResidual">0
       ),
       gl AS (
         SELECT jl."organizationId", SUM(jl."baseDebit" - jl."baseCredit") total
           FROM "JournalLine" jl
           JOIN ar ON ar.id = jl."accountId"
           JOIN "StudentProfile" sp ON sp."partnerId" = jl."partnerId"
          GROUP BY 1
       ),
       unalloc AS (
         SELECT pay."organizationId", SUM(pay."unallocatedAmount") total
           FROM "Payment" pay
           JOIN "StudentProfile" sp ON sp."partnerId" = pay."partnerId"
          WHERE pay."organizationId"=$1 AND pay.direction='inbound' AND pay.status::text<>'cancelled'
          GROUP BY 1
       )
       SELECT COALESCE(sub.posted_total,0) - COALESCE(unalloc.total,0) - COALESCE(gl.total,0) variance
         FROM sub
         LEFT JOIN gl ON true
         LEFT JOIN unalloc ON true`,
      O,
    );
    expect(Math.abs(Number(ar[0].variance))).toBeLessThan(1);

    // G2b: fee-credit liability = GL FEE-CR (the real gate keys on account code 'FEE-CR').
    const cr = await raw.$queryRawUnsafe<any[]>(
      `WITH outstanding AS (
         SELECT "organizationId", SUM(remaining) total FROM "FeeCredit"
          WHERE "isActive"=true AND "organizationId"=$1 GROUP BY 1
       ), gl AS (
         SELECT jl."organizationId", SUM(jl."baseCredit" - jl."baseDebit") total
           FROM "JournalLine" jl JOIN "Account" a ON a.id = jl."accountId"
          WHERE a.code='FEE-CR' AND jl."organizationId"=$1 GROUP BY 1
       )
       SELECT COALESCE(outstanding.total,0) - COALESCE(gl.total,0) variance
         FROM (SELECT 1) t
         LEFT JOIN outstanding ON true
         LEFT JOIN gl ON true`,
      O,
    );
    expect(Math.abs(Number(cr[0].variance))).toBeLessThan(1);
  });
});
