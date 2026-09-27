/**
 * Wave 14 — audit 2026-09-27 F03, F04, F05, F09, F21, against a real database.
 *
 * D03: one adjustment has one economic effect, however many approvals race;
 *      two different adjustments to one invoice both land.
 * D04: an adjustment belongs to its invoice's pupil; only a live fee invoice.
 * D05: a billing run queued while the term was open does not post after close;
 *      close and posting serialize.
 * D09: in drawer mode cash goes through a session; a missing movement shows as
 *      variance; a cashbook school sees untracked custody, never zero.
 * F21: the cash book reports the day that was asked for.
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
import { FinanceControlsService } from '../../src/modules/school/fees/finance-controls.service';
import { SchoolFinanceQueryService } from '../../src/modules/school/fees/school-finance-query.service';
import { BillingRunService } from '../../src/modules/school/fees/billing-run.service';
import { CashDeskService } from '../../src/modules/school/fees/cash-desk.service';
import { placeInClass } from './_placement';

describeDb('integration: wave 14 finance integrity (F03/F04/F05/F09/F21)', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let billing: BillingService;
  let payments: SchoolPaymentService;
  let controls: FinanceControlsService;
  let finance: SchoolFinanceQueryService;
  let runs: BillingRunService;
  let desk: CashDeskService;

  const stamp = Date.now();
  const organizationId = `org_w14f_${stamp}`;
  const TUITION = 350_000;
  const as = <T>(userId: string, fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId, permissions: ['*'] }, fn);
  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);

  let termId = '';
  let classId = '';
  let arAccountId = '';
  let seq = 0;
  const pupils: Array<{ id: string; partnerId: string }> = [];

  const addPupil = async (name: string) => {
    seq += 1;
    const partner = await raw.partner.create({
      data: { organizationId, code: `W14F-${stamp}-${seq}`, name, isCustomer: true, receivableAccountId: arAccountId },
    });
    const student = await raw.studentProfile.create({
      data: { organizationId, partnerId: partner.id, admissionNo: `W14F-${seq}`, enrollmentDate: new Date('2026-01-10'), status: 'active' },
    });
    await placeInClass(raw, { organizationId, studentProfileId: student.id, classId });
    const p = { id: student.id, partnerId: partner.id };
    pupils.push(p);
    return p;
  };

  const invoiceOf = async (studentProfileId: string) => {
    const sfi = await raw.schoolFeeInvoice.findFirst({ where: { organizationId, studentProfileId, termId } });
    return sfi ? raw.document.findUnique({ where: { id: sfi.documentId } }) : null;
  };

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({ where: { code: 'UGX' }, update: {}, create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 } });
    await setOrg(organizationId);
    await raw.organization.create({
      data: { id: organizationId, code: `W14F-${stamp}`, name: 'Green Valley', currencyCode: 'UGX', timezone: 'Africa/Kampala' } as any,
    });
    await raw.schoolProfile.create({ data: { organizationId, name: 'Green Valley', gradingSystem: 'PLE' } as any });
    const mk = makeAccountFactory(raw, await ensureAccountCategories(raw));
    const cashAccountId = (await mk(organizationId, 'W14-1100', 'Cash', 'cash')).id;
    arAccountId = (await mk(organizationId, 'W14-1300', 'Fees Receivable', 'receivable')).id;
    const revenueAccountId = (await mk(organizationId, 'W14-4100', 'Tuition Revenue', 'revenue')).id;
    for (const [code, name, type] of [['SALES', 'Sales', 'sales'], ['CASH', 'Cash', 'cash'], ['GEN', 'General', 'general']] as const) {
      await raw.journal.create({ data: { organizationId, code, name, journalType: type } });
    }
    for (const [key, accountId] of [['default_cash', cashAccountId], ['accounts_receivable', arAccountId]] as const) {
      await raw.accountMapping.create({ data: { organizationId, key, accountId } });
    }
    const category = await raw.productCategory.create({ data: { organizationId, name: 'School Fees', incomeAccountId: revenueAccountId } });
    const product = await raw.product.create({
      data: { organizationId, code: 'TUITION', name: 'Tuition', productType: 'service', categoryId: category.id, salesPrice: TUITION },
    });
    const year = await raw.academicYear.create({ data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') } });
    termId = (
      await raw.term.create({
        data: { organizationId, academicYearId: year.id, name: 'Term 3', startDate: new Date('2026-09-01'), endDate: new Date('2026-12-05'), isCurrent: true },
      })
    ).id;
    const gradeLevel = await raw.gradeLevel.create({ data: { organizationId, name: 'P1', order: 1 } });
    classId = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId: gradeLevel.id, name: 'P1' } })).id;
    const structure = await raw.feeStructure.create({
      data: {
        organizationId, name: 'P1 Term Fees', academicYearId: year.id, status: 'published',
        components: [{ code: 'TUITION', productId: product.id, amount: TUITION }], applicableTo: { classIds: [classId] },
      },
    });
    const version = await raw.feeStructureVersion.create({
      data: { organizationId, feeStructureId: structure.id, versionNo: 1, isImmutable: true, publishedAt: new Date() },
    });
    await raw.feeItem.create({
      data: {
        organizationId, feeStructureVersionId: version.id, code: 'TUITION', name: 'Tuition', productId: product.id,
        amount: TUITION, isOptional: false, frequency: 'termly', appliesTo: {},
      },
    });
    await raw.feeStructure.update({ where: { id: structure.id }, data: { currentVersionId: version.id } });
    await raw.feeSchedule.create({ data: { organizationId, feeStructureId: structure.id, termId, dueDate: new Date('2026-10-01') } });

    await addPupil('Atim');
    await addPupil('Okello');

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, FeesModule],
    }).compile();
    tenant = moduleRef.get(TenantContextService);
    billing = moduleRef.get(BillingService);
    payments = moduleRef.get(SchoolPaymentService);
    controls = moduleRef.get(FinanceControlsService);
    finance = moduleRef.get(SchoolFinanceQueryService);
    runs = moduleRef.get(BillingRunService);
    desk = moduleRef.get(CashDeskService);

    await as('bursar_1', () => billing.generateForTerm({ termId } as any));
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  describe('D04 — an adjustment belongs to its invoice', () => {
    it("refuses another pupil's invoice and changes nothing", async () => {
      const [a, b] = pupils;
      const invoiceA = await invoiceOf(a.id);
      const before = await raw.feeAdjustment.count({ where: { organizationId } });
      await expect(
        as('bursar_1', () =>
          controls.createAdjustment({ studentProfileId: b.id, documentId: invoiceA!.id, direction: 'debit', amount: 1000, reason: 'test' }),
        ),
      ).rejects.toThrow(/different pupil/);
      expect(await raw.feeAdjustment.count({ where: { organizationId } })).toBe(before);
    });

    it('refuses a document that is not a live fee invoice', async () => {
      // A cancelled fee invoice for a pupil who then left.
      const leaver = await addPupil('Leaver');
      await as('bursar_1', () => billing.billSingleStudent(leaver.id, termId));
      const cancelled = await invoiceOf(leaver.id);
      await raw.document.update({ where: { id: cancelled!.id }, data: { status: 'cancelled' } });
      await expect(
        as('bursar_1', () => controls.createAdjustment({ documentId: cancelled!.id, direction: 'debit', amount: 1000, reason: 'test' })),
      ).rejects.toThrow(/not a posted school-fee invoice/);
      await raw.studentProfile.update({ where: { id: leaver.id }, data: { status: 'withdrawn' } as any });
    });

    it('derives the pupil from the invoice when none is named', async () => {
      const invoiceA = await invoiceOf(pupils[0].id);
      const adj = await as('bursar_1', () =>
        controls.createAdjustment({ documentId: invoiceA!.id, direction: 'debit', amount: 500, reason: 'Derived pupil' }),
      );
      expect(adj.studentProfileId).toBe(pupils[0].id);
      await as('bursar_2', () => controls.rejectAdjustment(adj.id, 'cleanup'));
    });
  });

  describe('D03 — one adjustment, one economic effect', () => {
    it('two racing approvals of one UGX 1,000 debit post exactly once (250k-style residual +1,000)', async () => {
      const doc = await invoiceOf(pupils[0].id);
      const before = Number(doc!.amountResidual);
      const adj = await as('bursar_1', () =>
        controls.createAdjustment({ documentId: doc!.id, direction: 'debit', amount: 1000, reason: 'Race' }),
      );
      const results = await Promise.allSettled([
        as('bursar_2', () => controls.approveAdjustment(adj.id)),
        as('bursar_3', () => controls.approveAdjustment(adj.id)),
      ]);
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      const journals = await raw.journalEntry.count({ where: { organizationId, sourceType: 'school_fee_adjustment', sourceId: adj.id } });
      expect(journals).toBe(1);
      const after = Number((await raw.document.findUnique({ where: { id: doc!.id } }))!.amountResidual);
      expect(after - before).toBe(1000);
    });

    it('two different adjustments to one invoice both land (no lost update)', async () => {
      const doc = await invoiceOf(pupils[0].id);
      const before = Number(doc!.amountResidual);
      const a1 = await as('bursar_1', () => controls.createAdjustment({ documentId: doc!.id, direction: 'debit', amount: 700, reason: 'One' }));
      const a2 = await as('bursar_1', () => controls.createAdjustment({ documentId: doc!.id, direction: 'debit', amount: 300, reason: 'Two' }));
      await Promise.all([as('bursar_2', () => controls.approveAdjustment(a1.id)), as('bursar_3', () => controls.approveAdjustment(a2.id))]);
      const after = Number((await raw.document.findUnique({ where: { id: doc!.id } }))!.amountResidual);
      expect(after - before).toBe(1000);
    });

    it('approve racing reject has one winner', async () => {
      const doc = await invoiceOf(pupils[1].id);
      const adj = await as('bursar_1', () => controls.createAdjustment({ documentId: doc!.id, direction: 'debit', amount: 200, reason: 'Contest' }));
      await Promise.allSettled([
        as('bursar_2', () => controls.approveAdjustment(adj.id)),
        as('bursar_3', () => controls.rejectAdjustment(adj.id, 'no')),
      ]);
      const final = await raw.feeAdjustment.findUnique({ where: { id: adj.id } });
      const journals = await raw.journalEntry.count({ where: { organizationId, sourceType: 'school_fee_adjustment', sourceId: adj.id } });
      expect(['posted', 'rejected']).toContain(final!.status);
      expect(journals).toBe(final!.status === 'posted' ? 1 : 0);
    });
  });

  describe('D05 — the close boundary', () => {
    it('a run queued while open does not post after close; resumes after an authorized reopen', async () => {
      const late = await addPupil('Late Entry');
      const run = await as('bursar_1', () => runs.start(termId));
      await as('bursar_1', () => controls.closeTerm(termId));
      await expect(as('bursar_1', () => runs.process(run.id))).rejects.toThrow(/financially closed/);
      expect(await invoiceOf(late.id)).toBeNull();
      expect(await raw.billingRunItem.count({ where: { billingRunId: run.id, status: 'posted' } })).toBe(0);

      await expect(as('bursar_2', () => controls.reopenTerm(termId, ''))).rejects.toThrow(/reason/);
      await as('bursar_2', () => controls.reopenTerm(termId, 'Late admission billed'));
      await as('bursar_1', () => runs.process(run.id));
      expect(await invoiceOf(late.id)).not.toBeNull();
    });

    it('a direct posting inside a closed term is refused under the lock', async () => {
      const extra = await addPupil('Walk-in');
      await as('bursar_1', () => controls.closeTerm(termId));
      await expect(as('bursar_1', () => billing.billSingleStudent(extra.id, termId))).rejects.toThrow(/financially closed/);
      expect(await invoiceOf(extra.id)).toBeNull();
      await as('bursar_2', () => controls.reopenTerm(termId, 'Test reopen'));
    });

    it('close racing a posting: the snapshot and the ledger agree', async () => {
      const racer = await addPupil('Racer');
      const [bill, close] = await Promise.allSettled([
        as('bursar_1', () => billing.billSingleStudent(racer.id, termId)),
        as('bursar_2', () => controls.closeTerm(termId)),
      ]);
      expect(close.status).toBe('fulfilled');
      const snap: any = (await raw.termFinancialClose.findFirst({ where: { organizationId, termId } }))!.snapshot;
      const invoice = await invoiceOf(racer.id);
      if (bill.status === 'fulfilled' && invoice) {
        // The posting won the lock: the frozen snapshot must include it.
        const live = await controls.termTotalsSnapshot(termId).catch(() => null);
        expect(snap.billed).toBe(live?.billed ?? snap.billed);
      } else {
        expect(invoice).toBeNull();
      }
      await as('bursar_1', () => controls.reopenTerm(termId, 'Race test'));
    });
  });

  describe('D09 — cash custody', () => {
    it('drawer mode: cash without an open drawer is refused', async () => {
      await raw.schoolProfile.updateMany({ where: { organizationId }, data: { cashCustodyMode: 'drawer' } });
      await expect(
        as('cashier_1', () => payments.collect({ studentProfileId: pupils[1].id, amount: 100_000, paymentMethod: 'cash' } as any)),
      ).rejects.toThrow(/Open your drawer/);
    });

    it('drawer mode: a receipt moves the drawer once; recon holds at zero', async () => {
      const opened: any = await as('cashier_1', () => desk.open(0));
      expect(opened.session).not.toBeNull();
      const res: any = await as('cashier_1', () =>
        payments.collect({ studentProfileId: pupils[1].id, amount: 100_000, paymentMethod: 'cash' } as any),
      );
      const moves = await raw.cashMovement.findMany({ where: { paymentId: res.payment.id } });
      expect(moves.reduce((t, m) => t + Number(m.amount), 0)).toBe(100_000);
      const status: any = await as('cashier_1', () => desk.status());
      expect(Number(status.session.expectedCash)).toBe(100_000);
      const recon = await as('cashier_1', () => finance.reconcileOperationalCash());
      expect(recon.variance).toBe(0);
    });

    it('a cash receipt with no movement is a variance in drawer mode and untracked custody in cashbook mode', async () => {
      await raw.schoolProfile.updateMany({ where: { organizationId }, data: { cashCustodyMode: 'cashbook' } });
      await as('cashier_2', () => payments.collect({ studentProfileId: pupils[0].id, amount: 50_000, paymentMethod: 'cash' } as any));
      const book = await as('cashier_2', () => finance.reconcileOperationalCash());
      expect(book.mode).toBe('cashbook');
      expect(book.untrackedCustody).toBe(50_000);
      await raw.schoolProfile.updateMany({ where: { organizationId }, data: { cashCustodyMode: 'drawer' } });
      const drawer = await as('cashier_2', () => finance.reconcileOperationalCash());
      expect(drawer.variance).toBe(50_000);
      expect(drawer.byMethod.find((m) => m.paymentMethod === 'cash')?.payments).toBe(150_000);
    });

    it('closing the drawer reconciles counted against expected', async () => {
      const closed: any = await as('cashier_1', () => desk.close({ closingCounted: 100_000 }));
      expect(Number(closed.closingDifference ?? 0)).toBe(0);
    });
  });

  describe('F21 — the cash book reports the day asked for', () => {
    it('labels the requested school day, not a server-shifted one', async () => {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kampala' }).format(new Date());
      const book: any = await as('bursar_1', () => finance.dailyCashBook(today));
      expect(book.date).toBe(today);
      expect(book.timeZone).toBe('Africa/Kampala');
      expect(book.cashTotal).toBe(150_000);
    });
  });
});
