/**
 * Fees ⇄ accounting hardening, end to end against a real database:
 *
 *   1. A signed MoMo callback with NO tenant context resolves its organization,
 *      posts Dr MoMo Clearing / Cr AR, and a replay posts nothing.
 *   2. A provider payout sweeps clearing to bank net of charges; clearing = 0.
 *   3. An admission fee is a posted invoice, paid through PaymentService, and
 *      counts toward the payer's receivable; waiving voids it.
 *   4. The term-close snapshot is scoped to the term and agrees with residuals.
 *   5. AR ⇄ GL reconciles and no cached projection drifts after all of it.
 */
import { createHmac } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { ensureAccountCategories, makeAccountFactory } from './_accounts';
import { KernelModule } from '../../src/kernel/kernel.module';
import { DocumentsModule } from '../../src/modules/documents/documents.module';
import { CoreModule } from '../../src/modules/core/core.module';
import { AccountingModule } from '../../src/modules/accounting/accounting.module';
import { InventoryModule } from '../../src/modules/inventory/inventory.module';
import { InvoicingModule } from '../../src/modules/invoicing/invoicing.module';
import { FeesModule } from '../../src/modules/school/fees/fees.module';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';
import { PrismaService } from '../../src/kernel/prisma/prisma.service';
import { DocumentBuilderService } from '../../src/modules/invoicing/document/document-builder.service';
import { PostingService } from '../../src/modules/accounting/posting/posting.service';
import { MobileMoneyService } from '../../src/modules/school/fees/mobile-money.service';
import { FinanceControlsService } from '../../src/modules/school/fees/finance-controls.service';
import { SchoolFinanceQueryService } from '../../src/modules/school/fees/school-finance-query.service';
import { AdmissionFeeService } from '../../src/modules/school/admissions/admission-fee.service';

describe('integration: fees ⇄ accounting hardening', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let prisma: PrismaService;
  let momo: MobileMoneyService;
  let controls: FinanceControlsService;
  let finance: SchoolFinanceQueryService;
  let admissionFees: AdmissionFeeService;

  const stamp = Date.now();
  const organizationId = `org_hard_${stamp}`;
  const userId = 'bursar_h1';
  const SECRET = 'momo-test-secret';
  const TUITION = 600_000;

  let studentProfileId = '';
  let studentPartnerId = '';
  let guardianPartnerId = '';
  let termId = '';
  let bankAccountId = '';
  let arAccountId = '';

  const asTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId, permissions: [] }, fn);

  const glBalance = async (accountId: string) => {
    const r = await raw.journalLine.aggregate({
      where: { organizationId, accountId },
      _sum: { baseDebit: true, baseCredit: true },
    });
    return Number(r._sum.baseDebit ?? 0) - Number(r._sum.baseCredit ?? 0);
  };

  beforeAll(async () => {
    await raw.$connect();
    await raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, organizationId);
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await raw.organization.create({
      data: { id: organizationId, code: `HARD-${stamp}`, name: 'Hardening School', currencyCode: 'UGX' },
    });
    const mk = makeAccountFactory(raw, await ensureAccountCategories(raw));
    const cash = await mk(organizationId, 'H-1100', 'Cash', 'cash');
    const bank = await mk(organizationId, 'H-1200', 'Bank', 'bank');
    bankAccountId = bank.id;
    arAccountId = (await mk(organizationId, 'H-1300', 'Fees Receivable', 'receivable')).id;
    const revenue = await mk(organizationId, 'H-4100', 'Tuition Revenue', 'revenue');
    for (const [code, name, type] of [
      ['SALES', 'Sales', 'sales'],
      ['CASH', 'Cash', 'cash'],
      ['BANK', 'Bank', 'bank'],
      ['GEN', 'General', 'general'],
    ] as const) {
      await raw.journal.create({ data: { organizationId, code, name, journalType: type } });
    }
    for (const [key, accountId] of [
      ['default_cash', cash.id],
      ['default_bank', bank.id],
      ['accounts_receivable', arAccountId],
      ['sales_revenue', revenue.id],
    ] as const) {
      await raw.accountMapping.create({ data: { organizationId, key, accountId } });
    }

    const year = await raw.academicYear.create({
      data: { organizationId, name: `Y${stamp}`, startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
    });
    termId = (
      await raw.term.create({
        data: { organizationId, academicYearId: year.id, name: 'Term 1', startDate: new Date('2026-01-15'), endDate: new Date('2026-04-15') },
      })
    ).id;

    const studentPartner = await raw.partner.create({
      data: { organizationId, code: `STU-${stamp}`, name: 'Nakato Pupil', isCustomer: true },
    });
    studentPartnerId = studentPartner.id;
    studentProfileId = (
      await raw.studentProfile.create({
        data: { organizationId, partnerId: studentPartner.id, admissionNo: `ADM-${stamp}`, enrollmentDate: new Date('2026-01-10') },
      })
    ).id;
    const guardianPartner = await raw.partner.create({
      data: { organizationId, code: `GUA-${stamp}`, name: 'Guardian Okello', isCustomer: true },
    });
    guardianPartnerId = guardianPartner.id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, FeesModule],
      providers: [AdmissionFeeService],
    }).compile();
    await moduleRef.init();

    tenant = moduleRef.get(TenantContextService);
    prisma = moduleRef.get(PrismaService);
    // ADR-032 P6: live collection is off by default; this suite tests it enabled.
    process.env.ENABLE_LIVE_MOBILE_MONEY = 'true';
    momo = moduleRef.get(MobileMoneyService);
    controls = moduleRef.get(FinanceControlsService);
    finance = moduleRef.get(SchoolFinanceQueryService);
    admissionFees = moduleRef.get(AdmissionFeeService);

    // A posted tuition invoice with a SchoolFeeInvoice for the term, built on
    // the same document + posting path billing uses.
    const builder = moduleRef.get(DocumentBuilderService);
    const posting = moduleRef.get(PostingService);
    await asTenant(() =>
      prisma.client.$transaction(async (tx: any) => {
        const doc = await builder.createDocument(
          tx,
          'sales_invoice',
          { partnerId: studentPartnerId, issueDate: new Date('2026-01-20').toISOString(), reference: `TERM-${termId}`, sourceType: 'school_fee' },
          [{ accountId: revenue.id, description: 'Tuition', quantity: 1, unitPrice: TUITION }],
        );
        const full = await tx.document.findFirst({ where: { id: doc.id }, include: { lines: true } });
        const entry = await posting.post(
          {
            journalCode: 'SALES',
            date: new Date('2026-01-20'),
            sourceType: 'school_fee_invoice',
            sourceId: full.id,
            lines: await builder.salesPostingLines(tx, full),
          },
          tx,
        );
        await tx.document.update({
          where: { id: full.id },
          data: { status: 'posted', paymentStatus: 'not_paid', amountResidual: full.totalAmount, journalEntryId: entry.id },
        });
        await tx.schoolFeeInvoice.create({
          data: { organizationId, invoiceNumber: `SFI-H-${stamp}`, documentId: full.id, studentProfileId, termId, status: 'issued' },
        });
      }),
    );

    await asTenant(() => momo.upsertGateway('mtn', { baseUrl: 'https://sandbox.example', callbackSecret: SECRET, credentials: { subscriptionKey: 'k', accessToken: 't' } }));
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  const providerRef = `SCH-HARD-${stamp}`;
  const callbackBody = (status: string, amount: number) =>
    JSON.stringify({ externalId: providerRef, status, amount: String(amount), currency: 'UGX' });
  const sign = (body: string) => createHmac('sha256', SECRET).update(body).digest('hex');

  it('a signed MoMo callback with no tenant context posts to clearing, once', async () => {
    const gateway = await raw.paymentGatewayAccount.findFirstOrThrow({ where: { organizationId, provider: 'mtn' } });
    await raw.mobileMoneyRequest.create({
      data: {
        organizationId,
        studentProfileId,
        provider: 'mtn',
        providerRef,
        msisdn: '256772000111',
        amount: 250_000,
        currency: 'UGX',
        status: 'pending',
        gatewayAccountId: gateway.id,
      },
    });

    // Outside any tenant.run — exactly how the public controller calls it.
    const body = callbackBody('SUCCESSFUL', 250_000);
    const first: any = await momo.handleCallback('mtn', body, sign(body));
    expect(first).toMatchObject({ matched: true, status: 'succeeded', posted: true });

    const again: any = await momo.handleCallback('mtn', body, sign(body));
    expect(again.posted).toBe(false);

    const payments = await raw.payment.findMany({ where: { organizationId, externalReference: providerRef } });
    expect(payments).toHaveLength(1);
    const clearing = await raw.account.findFirstOrThrow({ where: { organizationId, code: 'MOMO-CLR' } });
    expect(payments[0].accountId).toBe(clearing.id);
    expect(await glBalance(clearing.id)).toBe(250_000);
  });

  it('rejects a forged callback before touching anything', async () => {
    const body = callbackBody('SUCCESSFUL', 999_999);
    await expect(momo.handleCallback('mtn', body, 'bad')).rejects.toThrow(/Invalid callback signature/);
  });

  it('a provider payout sweeps clearing to bank net of charges', async () => {
    const [position] = await asTenant(() => momo.clearingPosition());
    expect(position.unsettledCollections).toBe(250_000);
    expect(position.variance).toBe(0);

    await asTenant(() =>
      momo.recordSettlement({
        provider: 'mtn',
        reference: `PAYOUT-${stamp}`,
        grossAmount: 250_000,
        charges: 2_500,
        bankAccountId,
        requestIds: position.unsettled.map((u: any) => u.id),
      }),
    );
    const [after] = await asTenant(() => momo.clearingPosition());
    expect(after.glBalance).toBe(0);
    expect(after.unsettledCollections).toBe(0);
    expect(await glBalance(bankAccountId)).toBe(247_500);
  });

  it('an admission fee is a posted receivable paid through the payment engine', async () => {
    const contact = await raw.contact.create({ data: { organizationId, partnerId: guardianPartnerId, firstName: 'Okello' } });
    const app = await raw.admissionApplication.create({
      data: {
        organizationId,
        applicationNumber: `APP-${stamp}`,
        applicantFirstName: 'New',
        applicantLastName: 'Pupil',
        parentContactId: contact.id,
        status: 'under_review',
        academicYearId: (await raw.term.findFirstOrThrow({ where: { id: termId } })).academicYearId,
      } as any,
    });

    const charged = await asTenant(() => admissionFees.charge(app.id, { amount: 50_000 }));
    const doc = await raw.document.findFirstOrThrow({ where: { id: charged.invoiceId } });
    expect(doc.status).toBe('posted');
    expect(doc.journalEntryId).toBeTruthy();
    expect(doc.sourceType).toBe('school_admission_fee');

    // It is part of the payer's receivable universe.
    const open = await raw.document.findMany({
      where: { organizationId, partnerId: guardianPartnerId, sourceType: 'school_admission_fee', status: 'posted', amountResidual: { gt: 0 } },
    });
    expect(open).toHaveLength(1);

    await asTenant(() => admissionFees.pay(app.id, { paymentMethod: 'cash' }));
    const status = await asTenant(() => admissionFees.status(app.id));
    expect(status.feeStatus).toBe('paid');
    expect(status.invoice?.payments).toHaveLength(1);
    const settledApp = await raw.admissionApplication.findFirstOrThrow({ where: { id: app.id } });
    expect(settledApp.feeStatus).toBe('paid');
    expect(await asTenant(() => admissionFees.isSettled(prisma.client, settledApp))).toBe(true);
  });

  it('waiving an unpaid admission fee voids the invoice and reverses its journal', async () => {
    const contact = await raw.contact.create({ data: { organizationId, partnerId: guardianPartnerId, firstName: 'Okello 2' } });
    const app = await raw.admissionApplication.create({
      data: {
        organizationId,
        applicationNumber: `APP2-${stamp}`,
        applicantFirstName: 'Other',
        applicantLastName: 'Pupil',
        parentContactId: contact.id,
        status: 'under_review',
        academicYearId: (await raw.term.findFirstOrThrow({ where: { id: termId } })).academicYearId,
      } as any,
    });
    const { invoiceId } = await asTenant(() => admissionFees.charge(app.id, { amount: 30_000 }));
    await asTenant(() => admissionFees.waive(app.id, 'sibling'));
    const doc = await raw.document.findFirstOrThrow({ where: { id: invoiceId } });
    expect(doc.status).toBe('cancelled');
    const entry = await raw.journalEntry.findFirstOrThrow({ where: { id: doc.journalEntryId! } });
    expect(entry.status).toBe('reversed');
  });

  it('the term snapshot is term-scoped and agrees with stored residuals', async () => {
    const snap = await asTenant(() => controls.termTotalsSnapshot(termId));
    expect(snap.billed).toBe(TUITION);
    expect(snap.collected).toBe(250_000);
    expect(snap.balance).toBe(TUITION - 250_000);
    expect(snap.residualVariance).toBe(0);
    expect(snap.bySource.school_fee.invoices).toBe(1);
    // The admission fee is not term-bound and must not leak into the term.
    expect(snap.bySource.school_admission_fee).toBeUndefined();
  });

  it('AR reconciles to the GL and no cached projection drifts', async () => {
    const ar = await asTenant(() => finance.reconcileCurrentArToGl());
    expect(Math.abs(ar.variance)).toBeLessThanOrEqual(0.01);
    const projections = await asTenant(() => finance.reconcileCachedProjections());
    expect(projections.drifted).toEqual([]);
  });

});
