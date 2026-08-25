/**
 * Integration test for the School vertical money path (P2A deliverable, B1 proof).
 *
 * Runs only when DATABASE_URL is set (see _setup.ts). Locally point it at the
 * throwaway `schooldb-planet` database:
 *   DATABASE_URL=postgresql://cafe-pos:cafe-pos@localhost:5432/schooldb-planet?schema=public \
 *     pnpm --filter @erp/api exec jest test/integration/school-happy-path --forceExit
 *
 * The target DB must be RLS-inert — either the connecting role bypasses RLS
 * (a superuser, as in CI's Postgres service) or the org-scoped tables are not
 * FORCE'd. This mirrors the production default (ADR-004: RLS is opt-in defence,
 * app-layer tenancy does the enforcing). A non-superuser owner of a FORCE'd DB
 * blocks the deliberately-unscoped prisma.raw reads the posting engine uses.
 *
 * Proves the authoritative chain the plan calls for:
 *   student → fee assignment → Document(AR) via BillingService.generateForTerm
 *   → open CashSession → SchoolPaymentService.collect (cash)
 *   → Payment + PaymentAllocation + CashMovement all written
 *   → JournalEntry balances, Document.amountResidual reduced
 *   → the cash session's expected cash includes the fee.
 *
 * This is the regression guard for B1: before the rewrite, a school fee
 * collection posted to the GL but never wrote a CashMovement, so it silently
 * fell out of the bursar's Z-report. The CashMovement assertions below fail if
 * that regresses.
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

describeDb('integration: school happy path (fee → payment → cash → ledger)', () => {
  // A single-connection raw client used only for fixture setup. connection_limit=1
  // keeps the app.org_id GUC we set below on the same backend for every insert.
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

  const organizationId = `org_sch_${Date.now()}`;
  const userId = 'bursar_1';
  const TUITION = 800_000;

  let studentProfileId = '';
  let termId = '';
  let cashAccountId = '';
  let arAccountId = '';
  let revenueAccountId = '';
  let cashRegisterId = '';

  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);

  beforeAll(async () => {
    await raw.$connect();
    // Base currency the Organization FKs to (normally from the platform seed).
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await setOrg(organizationId);

    // Tenant root + chart of accounts + journals.
    await raw.organization.create({
      data: { id: organizationId, code: `SCH-${Date.now()}`, name: 'Happy Path School', currencyCode: 'UGX' },
    });
    const mk = makeAccountFactory(raw, await ensureAccountCategories(raw));
    cashAccountId = (await mk(organizationId, 'SCH-1100', 'Cash', 'cash')).id;
    arAccountId = (await mk(organizationId, 'SCH-1300', 'Fees Receivable', 'receivable')).id;
    revenueAccountId = (await mk(organizationId, 'SCH-4100', 'Tuition Revenue', 'revenue')).id;
    for (const [code, name, type] of [
      ['SALES', 'Sales', 'sales'],
      ['CASH', 'Cash', 'cash'],
      ['GEN', 'General', 'general'],
    ] as const) {
      await raw.journal.create({ data: { organizationId, code, name, journalType: type } });
    }
    // Account-determination fallbacks the payment + posting engines read.
    for (const [key, accountId] of [
      ['default_cash', cashAccountId],
      ['accounts_receivable', arAccountId],
    ] as const) {
      await raw.accountMapping.create({ data: { organizationId, key, accountId } });
    }

    // A tuition product whose category books to the revenue account.
    const category = await raw.productCategory.create({
      data: { organizationId, name: 'School Fees', incomeAccountId: revenueAccountId },
    });
    const product = await raw.product.create({
      data: {
        organizationId,
        code: 'TUITION',
        name: 'Tuition',
        productType: 'service',
        categoryId: category.id,
        salesPrice: TUITION,
      },
    });

    // Academic structure.
    const year = await raw.academicYear.create({
      data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
    });
    const term = await raw.term.create({
      data: {
        organizationId,
        academicYearId: year.id,
        name: 'Term 1',
        startDate: new Date('2026-01-15'),
        endDate: new Date('2026-04-15'),
        isCurrent: true,
      },
    });
    termId = term.id;
    const gradeLevel = await raw.gradeLevel.create({ data: { organizationId, name: 'P1', order: 1 } });
    const schoolClass = await raw.schoolClass.create({
      data: { organizationId, gradeLevelId: gradeLevel.id, name: 'P1 East' },
    });

    // One student: Partner (the AR account, carrying its receivable account) +
    // StudentProfile pointing at it.
    const partner = await raw.partner.create({
      data: {
        organizationId,
        code: 'STU-0001',
        name: 'Ada Pupil',
        isCustomer: true,
        receivableAccountId: arAccountId,
      },
    });
    const student = await raw.studentProfile.create({
      data: {
        organizationId,
        partnerId: partner.id,
        admissionNo: 'ADM-0001',
        enrollmentDate: new Date('2026-01-10'),
        currentClassId: schoolClass.id,
        status: 'active',
      },
    });
    studentProfileId = student.id;

    // Fee structure + schedule for the term (one tuition component).
    //
    // The structure MUST be published with an immutable FeeStructureVersion:
    // Phase 2 (P1-G / §Pricing provenance) makes billing refuse any structure
    // that is not `published` with a `currentVersionId`. Billing prices from the
    // immutable FeeItem rows, never the mutable `components` JSON. This mirrors
    // what catalog.publish() does in production; we reproduce its effect here
    // with raw inserts since the fixture builds everything via Prisma directly.
    const feeStructure = await raw.feeStructure.create({
      data: {
        organizationId,
        name: 'Standard Term Fees',
        academicYearId: year.id,
        status: 'draft',
        components: [{ code: 'TUITION', productId: product.id, amount: TUITION }],
        applicableTo: { classIds: [schoolClass.id] },
      },
    });
    const feeVersion = await raw.feeStructureVersion.create({
      data: {
        organizationId,
        feeStructureId: feeStructure.id,
        versionNo: 1,
        publishedAt: new Date('2026-01-01'),
      },
    });
    await raw.feeItem.create({
      data: {
        organizationId,
        feeStructureVersionId: feeVersion.id,
        code: 'TUITION',
        name: 'Tuition',
        productId: product.id,
        amount: TUITION,
        isOptional: false,
      },
    });
    await raw.feeStructure.update({
      where: { id: feeStructure.id },
      data: { status: 'published', currentVersionId: feeVersion.id },
    });
    await raw.feeSchedule.create({
      data: { organizationId, feeStructureId: feeStructure.id, termId, dueDate: new Date('2026-02-15') },
    });

    // A cash register whose default account is the cash GL account.
    const register = await raw.cashRegister.create({
      data: { organizationId, code: 'REG-1', name: 'Bursar Drawer', defaultAccountId: cashAccountId },
    });
    cashRegisterId = register.id;

    moduleRef = await Test.createTestingModule({
      imports: [
        KernelModule,
        DocumentsModule,
        CoreModule,
        AccountingModule,
        InventoryModule,
        InvoicingModule,
        FeesModule,
      ],
    }).compile();

    tenant = moduleRef.get(TenantContextService);
    billing = moduleRef.get(BillingService);
    schoolPayments = moduleRef.get(SchoolPaymentService);
    cashSessions = moduleRef.get(CashSessionService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  const asTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId, permissions: [] }, fn);

  it('bills the term: one posted AR invoice with the full residual and a balanced journal', async () => {
    const result = await asTenant(() => billing.generateForTerm({ termId }));
    expect(result.count).toBe(1);

    const invoice = await raw.document.findFirst({
      where: { organizationId, partnerId: { not: undefined }, sourceType: 'school_fee' },
    });
    expect(invoice).toBeTruthy();
    expect(invoice!.status).toBe('posted');
    expect(Number(invoice!.totalAmount)).toBe(TUITION);
    expect(Number(invoice!.amountResidual)).toBe(TUITION);
    expect(invoice!.documentTypeId).toBeTruthy(); // the FK the fork dropped

    // The invoice's journal entry balances (Dr AR / Cr Revenue).
    const lines = await raw.journalLine.findMany({ where: { journalEntryId: invoice!.journalEntryId! } });
    const debit = lines.reduce((s, l) => s + Number(l.debit), 0);
    const credit = lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(debit).toBeCloseTo(credit, 6);
    expect(debit).toBeCloseTo(TUITION, 6);
  });

  it('collects a partial cash payment on an open session: Payment + Allocation + CashMovement, residual reduced', async () => {
    const PART = 300_000;

    const session = await asTenant(() => cashSessions.open({ cashRegisterId, openingFloat: 0 }));

    const res: any = await asTenant(() =>
      schoolPayments.collect({
        studentProfileId,
        amount: PART,
        paymentMethod: 'cash',
        cashSessionId: session.id,
      }),
    );
    const paymentId = res.payment.id;

    // Payment recorded, allocated to the invoice.
    const payment = await raw.payment.findFirst({ where: { id: paymentId } });
    expect(payment).toBeTruthy();
    expect(Number(payment!.amount)).toBe(PART);
    expect(Number(payment!.allocatedAmount)).toBe(PART);

    const allocations = await raw.paymentAllocation.findMany({ where: { paymentId } });
    expect(allocations).toHaveLength(1);
    expect(Number(allocations[0].amount)).toBe(PART);

    // *** B1 regression guard: the cash movement must exist and tie the payment
    // to the session, or the collection never reaches the Z-report. ***
    const movement = await raw.cashMovement.findFirst({ where: { paymentId, cashSessionId: session.id } });
    expect(movement).toBeTruthy();
    expect(Number(movement!.amount)).toBeCloseTo(PART, 6);

    // The invoice residual dropped by the payment.
    const invoice = await raw.document.findFirst({ where: { organizationId, sourceType: 'school_fee' } });
    expect(Number(invoice!.amountResidual)).toBeCloseTo(TUITION - PART, 6);
    expect(invoice!.paymentStatus).toBe('partial');

    // The payment's own journal entry balances (Dr Cash / Cr AR).
    const jl = await raw.journalLine.findMany({ where: { journalEntryId: payment!.journalEntryId! } });
    const d = jl.reduce((s, l) => s + Number(l.debit), 0);
    const c = jl.reduce((s, l) => s + Number(l.credit), 0);
    expect(d).toBeCloseTo(c, 6);
    expect(d).toBeCloseTo(PART, 6);

    // Closing the session, expected cash === opening float + the fee collected.
    const closed: any = await asTenant(() => cashSessions.close({ closingCounted: PART }));
    expect(Number(closed.closingExpected ?? closed.expectedCash ?? closed.closingExpectedCash)).toBeCloseTo(PART, 6);
  });

  it('is idempotent on a replayed mobile-money reference', async () => {
    // P0-B: idempotency keys on `externalReference` (the machine-issued
    // provider transaction id), NOT `reference` (which is free-text bursar
    // narration and may legitimately repeat). A replayed external key returns
    // the original payment rather than double-collecting.
    const first: any = await asTenant(() =>
      schoolPayments.collect({
        studentProfileId,
        amount: 100_000,
        paymentMethod: 'mobile_money',
        externalReference: 'MM-DUP-1',
        externalReferenceType: 'mobile_money_txn',
      }),
    );
    const second: any = await asTenant(() =>
      schoolPayments.collect({
        studentProfileId,
        amount: 100_000,
        paymentMethod: 'mobile_money',
        externalReference: 'MM-DUP-1',
        externalReferenceType: 'mobile_money_txn',
      }),
    );
    expect(second.replayed).toBe(true);
    expect(second.payment.id).toBe(first.payment.id);

    const dup = await raw.payment.count({ where: { organizationId, externalReference: 'MM-DUP-1' } });
    expect(dup).toBe(1);
  });
});
