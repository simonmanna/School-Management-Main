/**
 * Concurrency (G4) + Atomicity (G5) certification gates for the Fees module.
 *
 * These are the two gates the production-readiness audit (FEES_PRODUCTION_
 * READINESS_2026-08-24.md §7) named as must-pass before exposing real fee
 * collection. They require the integrity migration to be LIVE (it is, in
 * schooldb-planet), because they prove the DATABASE business-key constraints —
 * not the application existence checks — are what stop double-collection.
 *
 * Runs only when DATABASE_URL is set (see _setup.ts). Point it at the
 * throwaway schooldb-planet database, same as school-happy-path.
 *
 *   DATABASE_URL=postgresql://.../schooldb-planet?schema=public \
 *     pnpm --filter @erp/api exec jest test/integration/school-fees-concurrency --forceExit
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
import { placeInClass } from './_placement';

describeDb('integration: school fees concurrency + atomicity (G4/G5)', () => {
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

  const organizationId = `org_fees_gate_${Date.now()}`;
  const userId = 'bursar_gate';
  const TUITION = 800_000;

  let studentProfileId = '';
  let termId = '';
  let closedTermId = '';
  let cashRegisterId = '';
  let feeStructureId = '';
  let tuitionProductId = '';

  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await setOrg(organizationId);

    await raw.organization.create({
      data: { id: organizationId, code: `SCHG-${Date.now()}`, name: 'Fees Gate School', currencyCode: 'UGX' },
    });
    const mk = makeAccountFactory(raw, await ensureAccountCategories(raw));
    const cashAccountId = (await mk(organizationId, 'SCHG-1100', 'Cash', 'cash')).id;
    const arAccountId = (await mk(organizationId, 'SCHG-1300', 'Fees Receivable', 'receivable')).id;
    const revenueAccountId = (await mk(organizationId, 'SCHG-4100', 'Tuition Revenue', 'revenue')).id;
    for (const [code, name, type] of [
      ['SALES', 'Sales', 'sales'],
      ['CASH', 'Cash', 'cash'],
      // Mobile-money and bank receipts post to the BANK journal.
      ['BANK', 'Bank', 'bank'],
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
      data: {
        organizationId,
        code: 'TUITION',
        name: 'Tuition',
        productType: 'service',
        categoryId: category.id,
        salesPrice: TUITION,
      },
    });

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
    // A CLOSED term — modeled by a termFinancialClose row with status
    // 'closed' (per isTermClosed). Used to prove G5 (billing into a closed
    // term is rejected before any document is written).
    // Its own (previous) year: a term must lie inside its academic year, which
    // the database now enforces (Wave 4 calendar constraints).
    const prevYear = await raw.academicYear.create({
      data: { organizationId, name: `Y-prev-${Date.now()}`, startDate: new Date('2025-01-01'), endDate: new Date('2025-12-31') },
    });
    const closedTerm = await raw.term.create({
      data: {
        organizationId,
        academicYearId: prevYear.id,
        name: 'Term 0 (closed)',
        startDate: new Date('2025-09-01'),
        endDate: new Date('2025-12-01'),
        isCurrent: false,
      },
    });
    closedTermId = closedTerm.id;
    await raw.termFinancialClose.create({
      data: { organizationId, termId: closedTermId, status: 'closed', closedAt: new Date() },
    });

    const gradeLevel = await raw.gradeLevel.create({ data: { organizationId, name: 'P1', order: 1 } });
    const schoolClass = await raw.schoolClass.create({
      data: { organizationId, gradeLevelId: gradeLevel.id, name: 'P1 East' },
    });

    const partner = await raw.partner.create({
      data: {
        organizationId,
        code: 'STU-G-0001',
        name: 'Gate Pupil',
        isCustomer: true,
        receivableAccountId: arAccountId,
      },
    });
    const student = await raw.studentProfile.create({
      data: {
        organizationId,
        partnerId: partner.id,
        admissionNo: 'ADM-G-0001',
        enrollmentDate: new Date('2026-01-10'),
        status: 'active',
      },
    });
    await placeInClass(raw, { organizationId: organizationId, studentProfileId: student.id, classId: schoolClass.id });
    studentProfileId = student.id;

    // Published, versioned fee structure (P1-G requires this to bill at all).
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
      data: { organizationId, feeStructureId: feeStructure.id, versionNo: 1, publishedAt: new Date('2026-01-01') },
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
    feeStructureId = feeStructure.id;
    tuitionProductId = product.id;
    await raw.feeSchedule.create({
      data: { organizationId, feeStructureId: feeStructure.id, termId, dueDate: new Date('2026-02-15') },
    });

    const register = await raw.cashRegister.create({
      data: { organizationId, code: 'REG-G1', name: 'Bursar Drawer', defaultAccountId: cashAccountId },
    });
    cashRegisterId = register.id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, FeesModule],
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

  describe('G4 · concurrency (P0-A / P0-B)', () => {
    it('P0-A: two concurrent billing runs for the same student/term yield exactly ONE invoice', async () => {
      const [a, b] = await Promise.all([
        asTenant(() => billing.billSingleStudent(studentProfileId, termId)),
        asTenant(() => billing.billSingleStudent(studentProfileId, termId)),
      ]);

      // Exactly one of the two commits; the other is reported as skipped
      // (the P2002 handler returns skipped, and the DB unique index is the
      // guarantee — the application findFirst guard cannot catch a race).
      const posted = [a, b].filter((r: any) => r?.status === 'posted').length;
      expect(posted).toBe(1);

      const invoices = await raw.document.count({
        where: {
          organizationId,
          partnerId: { not: undefined },
          sourceType: 'school_fee',
          sourceId: { not: undefined },
          reference: `TERM-${termId}`,
        },
      });
      expect(invoices).toBe(1);
    });

    it('audit P0-2: a fee-structure version bump mid-term does not bill the same pupil twice', async () => {
      // The SchoolFeeInvoice key includes feeStructureVersionId, so on its own
      // it would admit a second invoice after a re-publish. The Document key
      // (partner, schedule, TERM-<termId>) is version-blind and is what holds.
      const v2 = await raw.feeStructureVersion.create({
        data: { organizationId, feeStructureId, versionNo: 2, publishedAt: new Date('2026-02-01') },
      });
      await raw.feeItem.create({
        data: {
          organizationId,
          feeStructureVersionId: v2.id,
          code: 'TUITION',
          name: 'Tuition',
          productId: tuitionProductId,
          amount: TUITION + 50_000,
          isOptional: false,
        },
      });
      await raw.feeStructure.update({ where: { id: feeStructureId }, data: { currentVersionId: v2.id } });

      await asTenant(() => billing.billSingleStudent(studentProfileId, termId));
      await asTenant(() => billing.generateForTerm({ termId }));

      expect(await raw.schoolFeeInvoice.count({ where: { organizationId, studentProfileId, termId } })).toBe(1);
      expect(
        await raw.document.count({ where: { organizationId, sourceType: 'school_fee', reference: `TERM-${termId}` } }),
      ).toBe(1);
    });

    it('P0-B: two concurrent mobile-money collects with the same externalReference yield ONE payment', async () => {
      // Pay the invoice first so the collect has something to allocate.
      const session = await asTenant(() => cashSessions.open({ cashRegisterId, openingFloat: 0 }));
      await asTenant(() =>
        schoolPayments.collect({
          studentProfileId,
          amount: TUITION,
          paymentMethod: 'cash',
          cashSessionId: session.id,
        }),
      );

      const EXT = `MM-CONCURRENT-${Date.now()}`;
      const [a, b] = await Promise.all([
        asTenant(() =>
          schoolPayments.collect({
            studentProfileId,
            amount: 50_000,
            paymentMethod: 'mobile_money',
            externalReference: EXT,
            externalReferenceType: 'mobile_money_txn',
          }),
        ),
        asTenant(() =>
          schoolPayments.collect({
            studentProfileId,
            amount: 50_000,
            paymentMethod: 'mobile_money',
            externalReference: EXT,
            externalReferenceType: 'mobile_money_txn',
          }),
        ),
      ]);

      const replays = [a, b].filter((r: any) => r?.replayed === true).length;
      const created = [a, b].filter((r: any) => r?.replayed === false).length;
      expect(created).toBe(1);
      expect(replays).toBe(1);

      const payments = await raw.payment.count({
        where: { organizationId, externalReference: EXT, externalReferenceType: 'mobile_money_txn' },
      });
      expect(payments).toBe(1);
    });
  });

  describe('G5 · atomicity', () => {
    it('billing into a CLOSED term is rejected before any document is written (no partial invoice leaks)', async () => {
      const before = await raw.schoolFeeInvoice.count({
        where: { organizationId, termId: closedTermId },
      });
      expect(before).toBe(0);

      // generateForTerm asserts the term is open at the very top of its
      // transaction, so a closed term throws before any Document/Journal is
      // created. The whole run is one transaction — if it throws, nothing
      // commits. This is the period-control half of G6 too.
      await expect(asTenant(() => billing.generateForTerm({ termId: closedTermId }))).rejects.toThrow(
        /financially closed/,
      );

      const after = await raw.schoolFeeInvoice.count({
        where: { organizationId, termId: closedTermId },
      });
      expect(after).toBe(0); // no partial invoice leaked out of the rolled-back tx
    });
  });
});
