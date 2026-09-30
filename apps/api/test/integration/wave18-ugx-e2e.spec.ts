/**
 * Wave 18 — a UGX school term, source → ledger → statements, on a real database.
 *
 * One pupil, one term: bill → cash, bank and mobile-money collections →
 * overpayment credit → refund → a mistaken receipt reversed → a petty-cash and
 * an approved bank expense → drawer close with a variance → MoMo payout →
 * bank statement import and reconcile → tie-out → trial balance, balance
 * sheet, cash flow → close and lock the period.
 *
 * Asserts the finance review's end-to-end questions: every source has a
 * journal, debits equal credits, the pupil's balance equals AR control, cash
 * and bank tie to their sources, statements balance, amounts are whole
 * shillings, and the period cannot be posted into once locked.
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
import { ExpensesModule } from '../../src/modules/expenses/expenses.module';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';
import { BillingService, SchoolPaymentService } from '../../src/modules/school/fees/billing.service';
import { MobileMoneyService } from '../../src/modules/school/fees/mobile-money.service';
import { PaymentAllocationReversalService } from '../../src/modules/school/fees/allocation-reversal.service';
import { ExpensesService } from '../../src/modules/expenses/expenses.service';
import { CashSessionService } from '../../src/modules/accounting/treasury/cash-session.service';
import { BankReconciliationService } from '../../src/modules/accounting/treasury/bank-reconciliation.service';
import { TieOutService } from '../../src/modules/accounting/reporting/tieout.service';
import { BalanceSheetReportService } from '../../src/modules/accounting/reporting/balance-sheet-report.service';
import { CashFlowReportService } from '../../src/modules/accounting/reporting/cash-flow-report.service';
import { PeriodCloseService } from '../../src/modules/accounting/posting/period-close.service';
import { FiscalPeriodLifecycleService } from '../../src/modules/accounting/posting/fiscal-period-lifecycle.service';
import { PostingService } from '../../src/modules/accounting/posting/posting.service';
import { placeInClass } from './_placement';

describeDb('integration: wave 18 UGX school term, end to end', () => {
  const raw = new PrismaClient();
  let moduleRef: TestingModule;
  let tenant: TenantContextService;

  const stamp = Date.now();
  const organizationId = `org_w18e2e_${stamp}`;
  const SECRET = 'w18-e2e-momo';
  const TUITION = 850_000;
  const bursar = `bursar_e2e_${stamp}`;
  const headTeacher = `head_e2e_${stamp}`;
  const accountant = `acct_e2e_${stamp}`;
  const acc: Record<string, string> = {};
  let studentProfileId = '';
  let partnerId = '';
  let termId = '';
  let bankAccountId = '';
  let registerId = '';
  let periodId = '';

  const as = <T>(userId: string, fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId, permissions: ['*'] }, fn);
  const svc = <T>(t: new (...a: any[]) => T): T => moduleRef.get(t as any);

  beforeAll(async () => {
    process.env.ENABLE_LIVE_MOBILE_MONEY = 'true';
    await raw.$connect();
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Uganda Shilling', decimalPlaces: 0 },
    });
    await raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, organizationId);
    await raw.organization.create({
      data: {
        id: organizationId,
        code: `W18E2E-${stamp}`,
        name: 'St. Wave Primary',
        currencyCode: 'UGX',
        timezone: 'Africa/Kampala',
        settings: { finance: { pettyCashThreshold: 30_000 } },
      },
    });
    for (const id of [bursar, headTeacher, accountant]) {
      await raw.user.create({ data: { id, organizationId, email: `${id}@w18e2e.test`, passwordHash: 'x', firstName: id } });
    }

    const mk = makeAccountFactory(raw, await ensureAccountCategories(raw));
    acc.cash = (await mk(organizationId, '1100', 'Cash on hand', 'cash')).id;
    acc.bank = (await mk(organizationId, '1200', 'Stanbic', 'bank')).id;
    acc.clearing = (await mk(organizationId, '1150', 'MTN Clearing', 'bank')).id;
    acc.ar = (await mk(organizationId, '1300', 'Fees receivable', 'receivable')).id;
    acc.ap = (await mk(organizationId, '2100', 'Payables', 'payable')).id;
    acc.revenue = (await mk(organizationId, '4100', 'Tuition', 'revenue')).id;
    acc.stationery = (await mk(organizationId, '6100', 'Stationery', 'operating_expense')).id;
    acc.shortOver = (await mk(organizationId, '6900', 'Cash short/over', 'other_expense')).id;
    acc.re = (await mk(organizationId, '3200', 'Retained earnings', 'equity')).id;
    for (const [code, name, type] of [['SALES', 'Sales', 'sales'], ['CASH', 'Cash', 'cash'], ['BANK', 'Bank', 'bank'], ['GEN', 'General', 'general']] as const) {
      await raw.journal.create({ data: { organizationId, code, name, journalType: type } });
    }
    for (const [key, id] of [
      ['default_cash', acc.cash],
      ['default_bank', acc.bank],
      ['accounts_receivable', acc.ar],
      ['accounts_payable', acc.ap],
      ['cash_short_over', acc.shortOver],
      ['retained_earnings', acc.re],
      ['default_expense', acc.stationery],
    ] as const) {
      await raw.accountMapping.create({ data: { organizationId, key, accountId: id } });
    }
    bankAccountId = (await raw.bankAccount.create({ data: { organizationId, accountId: acc.bank, name: 'Stanbic', bankName: 'Stanbic' } })).id;
    registerId = (await raw.cashRegister.create({ data: { organizationId, code: 'DESK', name: 'Fee desk', defaultAccountId: acc.cash } })).id;
    await raw.expenseCategory.create({ data: { organizationId, name: 'Stationery', ledgerAccountId: acc.stationery } });

    const category = await raw.productCategory.create({ data: { organizationId, name: 'Fees', incomeAccountId: acc.revenue } });
    const product = await raw.product.create({
      data: { organizationId, code: 'TUITION', name: 'Tuition', productType: 'service', categoryId: category.id, salesPrice: TUITION },
    });
    const year = await raw.academicYear.create({
      data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
    });
    termId = (
      await raw.term.create({
        data: { organizationId, academicYearId: year.id, name: 'Term 2', startDate: new Date('2026-05-20'), endDate: new Date('2026-08-15'), isCurrent: true },
      })
    ).id;
    const grade = await raw.gradeLevel.create({ data: { organizationId, name: 'P5', order: 5 } });
    const klass = await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'P5 Blue' } });
    partnerId = (await raw.partner.create({ data: { organizationId, code: 'STU-E2E', name: 'Achieng Grace', isCustomer: true, receivableAccountId: acc.ar } })).id;
    studentProfileId = (
      await raw.studentProfile.create({
        data: { organizationId, partnerId, admissionNo: 'E2E-001', enrollmentDate: new Date('2026-02-01'), status: 'active' },
      })
    ).id;
    await placeInClass(raw, { organizationId, studentProfileId, classId: klass.id });
    const fs = await raw.feeStructure.create({
      data: {
        organizationId, name: 'P5 Fees', academicYearId: year.id, status: 'draft',
        components: [{ code: 'TUITION', productId: product.id, amount: TUITION }],
        applicableTo: { classIds: [klass.id] },
      },
    });
    const v1 = await raw.feeStructureVersion.create({ data: { organizationId, feeStructureId: fs.id, versionNo: 1, publishedAt: new Date('2026-01-01') } });
    await raw.feeItem.create({
      data: { organizationId, feeStructureVersionId: v1.id, code: 'TUITION', name: 'Tuition', productId: product.id, amount: TUITION, isOptional: false },
    });
    await raw.feeStructure.update({ where: { id: fs.id }, data: { status: 'published', currentVersionId: v1.id } });
    await raw.feeSchedule.create({ data: { organizationId, feeStructureId: fs.id, termId, dueDate: new Date('2026-06-15') } });

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, FeesModule, ExpensesModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    await as(accountant, () => svc(MobileMoneyService).upsertGateway('mtn', { callbackSecret: SECRET, clearingAccountId: acc.clearing, currency: 'UGX' } as any));
  }, 180_000);

  afterAll(async () => {
    delete process.env.ENABLE_LIVE_MOBILE_MONEY;
    await moduleRef?.close();
    await raw.$disconnect();
  });

  it('runs a whole term and every number ties', async () => {
    // Fiscal period for the term's month (Kampala days).
    periodId = (await as(accountant, () => svc(FiscalPeriodLifecycleService).create({ name: 'Jun 2026', startDate: '2026-06-01', endDate: '2026-06-30' }))).id;

    // 1. Bill the term.
    const billed: any = await as(bursar, () => svc(BillingService).billSingleStudent(studentProfileId, termId));
    expect(billed.status).toBe('posted');

    // 2. Collections: cash through the drawer, a bank transfer, mobile money.
    const session: any = await as(bursar, () => svc(CashSessionService).open({ cashRegisterId: registerId, openingFloat: 0 }));
    const pay = svc(SchoolPaymentService);
    await as(bursar, () => pay.collect({ studentProfileId, amount: 300_000, paymentMethod: 'cash', cashSessionId: session.id, paymentDate: '2026-06-02' } as any));
    await as(bursar, () => pay.collect({ studentProfileId, amount: 400_000, paymentMethod: 'bank', bankAccountId: acc.bank, paymentDate: '2026-06-03', reference: 'FT-E2E-1' } as any));
    const momoRef = `MTN-E2E-${stamp}`;
    await raw.mobileMoneyRequest.create({
      data: { organizationId, studentProfileId, provider: 'mtn', providerRef: momoRef, msisdn: '256772000555', amount: 250_000, currency: 'UGX' },
    });
    const body = JSON.stringify({ externalId: momoRef, status: 'SUCCESSFUL', amount: '250000', currency: 'UGX' });
    await svc(MobileMoneyService).handleCallback('mtn', body, createHmac('sha256', SECRET).update(body).digest('hex'));

    // 700k + 250k = 950k against 850k billed → 100k overpayment credit.
    const credit = await raw.feeCredit.findFirst({ where: { organizationId, source: 'overpayment' } });
    expect(Number(credit!.amount)).toBe(100_000);

    // A fractional shilling is refused at the door.
    await expect(as(bursar, () => pay.collect({ studentProfileId, amount: 1000.5, paymentMethod: 'cash', cashSessionId: session.id } as any))).rejects.toThrow(/whole shillings/);

    // 3. A receipt keyed by mistake, then reversed.
    const mistake: any = await as(bursar, () => pay.collect({ studentProfileId, amount: 20_000, paymentMethod: 'bank', bankAccountId: acc.bank, paymentDate: '2026-06-04', reference: 'WRONG' } as any));
    await as(headTeacher, () => svc(PaymentAllocationReversalService).reversePayment(mistake.payment.id, 'keyed against the wrong pupil'));

    // 4. Expenses: petty cash (one person, under threshold) and an approved bank cheque.
    const exp = svc(ExpensesService);
    const cat = await raw.expenseCategory.findFirst({ where: { organizationId } });
    await as(bursar, () => exp.create({ title: 'Chalk', amount: 25_000, categoryId: cat!.id, expenseDate: '2026-06-05', paymentType: 'CASH', paymentMethod: 'CASH', accountId: acc.cash } as any));
    const big = await as(bursar, () => exp.create({ title: 'Exercise books', amount: 180_000, categoryId: cat!.id, expenseDate: '2026-06-06', paymentType: 'CREDIT' } as any));
    await as(headTeacher, () => exp.approve(big.id, {} as any));
    await as(accountant, () => exp.pay(big.id, { paymentMethod: 'CHEQUE', accountId: acc.bank, paymentDate: '2026-06-07T09:00:00+03:00', reference: 'CHQ-201' } as any));

    // 5. Close the drawer 5,000 short.
    // Expected: 300,000 cash collected − 25,000 petty cash (no drawer mode → no session pay-out).
    const expected = await as(bursar, () => svc(CashSessionService).expectedCash(session.id));
    await as(bursar, () => svc(CashSessionService).close({ sessionId: session.id, closingCounted: Number(expected) - 5_000, varianceReason: 'miscount' } as any));

    // 6. MTN pays out the collection net of 2,500 charges.
    const momoReq = await raw.mobileMoneyRequest.findFirst({ where: { organizationId, providerRef: momoRef } });
    await as(accountant, () =>
      svc(MobileMoneyService).recordSettlement({
        provider: 'mtn', reference: `PAYOUT-${stamp}`, grossAmount: 250_000, charges: 2_500,
        bankAccountId: acc.bank, requestIds: [momoReq!.id], settlementDate: '2026-06-08',
      } as any),
    );

    // 7. Bank statement: transfer in, MoMo payout in, the mistake in and its
    //    reversal out on the bank, the cheque out.
    const recon = svc(BankReconciliationService);
    await as(accountant, () =>
      recon.importStatement(bankAccountId, [
        { postedAt: '2026-06-03', externalRef: 'FT-E2E-1', description: 'Achieng fees', amount: '400000' },
        { postedAt: '2026-06-08', externalRef: 'MTN-PO', description: 'MTN payout', amount: '247500' },
        { postedAt: '2026-06-08', externalRef: 'CHQ-201', description: 'Cheque 201', amount: '-180000' },
      ]),
    );
    const run = await as(accountant, () => recon.match(bankAccountId, { dateToleranceDays: 3 }));
    expect(run.matched).toBe(3);
    const rec = await as(accountant, () => recon.report(bankAccountId, '2026-06-30', '467500'));
    expect(rec.difference).toBe('0');

    // 8. Integrity: every source has a journal; debits = credits; whole shillings.
    const orphanExpense = await raw.expensePayment.count({ where: { organizationId, status: 'posted', journalEntryId: null } });
    expect(orphanExpense).toBe(0);
    const orphanPay = await raw.payment.count({ where: { organizationId, status: 'posted', journalEntryId: null } });
    expect(orphanPay).toBe(0);
    const tb = await raw.journalLine.aggregate({
      where: { organizationId, entry: { status: { in: ['posted', 'reversed'] } } },
      _sum: { baseDebit: true, baseCredit: true },
    });
    expect(Number(tb._sum.baseDebit)).toBe(Number(tb._sum.baseCredit));
    const fractional: any[] = await raw.$queryRawUnsafe(
      `SELECT id FROM "JournalLine" WHERE "organizationId" = $1 AND ("baseDebit" <> ROUND("baseDebit") OR "baseCredit" <> ROUND("baseCredit"))`,
      organizationId,
    );
    expect(fractional).toHaveLength(0);

    // 9. Pupil balance = AR control; bank and clearing tie to their sources.
    const tie = await svc(TieOutService).run(organizationId);
    expect(tie.status).toBe('ran');
    expect(tie.arBalanced).toBe(true);
    const bal = async (accountId: string) => {
      const a = await raw.journalLine.aggregate({
        where: { accountId, entry: { status: { in: ['posted', 'reversed'] } } },
        _sum: { baseDebit: true, baseCredit: true },
      });
      return Number(a._sum.baseDebit ?? 0) - Number(a._sum.baseCredit ?? 0);
    };
    expect(await bal(acc.bank)).toBe(400_000 + 247_500 - 180_000); // mistake and its reversal net to 0
    expect(await bal(acc.clearing)).toBe(0); // swept by the payout
    expect(await bal(acc.cash)).toBe(300_000 - 25_000 - 5_000);

    // 10. Statements.
    const bs: any = await as(accountant, () => svc(BalanceSheetReportService).balanceSheet('2026-06-30'));
    expect(bs.balanced).toBe(true);
    const cf: any = await as(accountant, () => svc(CashFlowReportService).cashFlow({ from: '2026-06-01', to: '2026-06-30' }));
    expect(cf.reconciled).toBe(true);

    // 11. Close and lock June; nothing more lands in it.
    await as(accountant, () => svc(PeriodCloseService).close(periodId));
    await as(accountant, () => svc(PeriodCloseService).lock(periodId));
    await expect(
      as(accountant, () =>
        svc(PostingService).post({
          journalCode: 'GEN',
          date: '2026-06-20T10:00:00+03:00',
          lines: [
            { accountId: acc.cash, debit: 1_000 },
            { accountId: acc.revenue, credit: 1_000 },
          ],
        }),
      ),
    ).rejects.toThrow(/locked/);
  });
});
