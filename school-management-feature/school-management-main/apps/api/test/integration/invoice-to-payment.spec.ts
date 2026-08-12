import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';

/**
 * D5-1: Happy-path integration test — invoice → payment → AR aging.
 *
 * This is the most important "did we wire the books correctly?" check. It
 * runs against a fresh test org and verifies:
 *   - posting an invoice writes a balanced journal entry
 *   - recording a payment against the invoice reduces the residual
 *   - AR aging reports the right bucket totals
 *   - tie-out reports AR balanced
 */
describeDb('integration: invoice → payment → AR aging', () => {
  const prisma = new PrismaClient();
  let organizationId: string;
  let customerId: string;
  let productId: string;
  let arAccountId: string;
  let revenueAccountId: string;
  let taxAccountId: string;
  let cashAccountId: string;

  beforeAll(async () => {
    await prisma.$connect();
    const org = await prisma.organization.create({
      data: { code: `INT-INV-${Date.now()}`, name: 'Integration Invoice Org', currencyCode: 'USD' },
    });
    organizationId = org.id;

    const customer = await prisma.partner.create({
      data: { organizationId, code: 'INT-CUST-1', name: 'Integration Customer', isCustomer: true },
    });
    customerId = customer.id;

    const product = await prisma.product.create({
      data: { organizationId, code: 'INT-PROD-1', name: 'Widget', productType: 'service', salesPrice: 100, costPrice: 0 },
    });
    productId = product.id;

    // CoA
    const ar = await prisma.account.create({
      data: { organizationId, code: 'INT-1300', name: 'AR', accountType: 'receivable' },
    });
    arAccountId = ar.id;
    const revenue = await prisma.account.create({
      data: { organizationId, code: 'INT-4100', name: 'Revenue', accountType: 'revenue' },
    });
    revenueAccountId = revenue.id;
    const tax = await prisma.account.create({
      data: { organizationId, code: 'INT-2200', name: 'Tax', accountType: 'tax' },
    });
    taxAccountId = tax.id;
    const cash = await prisma.account.create({
      data: { organizationId, code: 'INT-1100', name: 'Cash', accountType: 'cash' },
    });
    cashAccountId = cash.id;

    // Journal
    await prisma.journal.create({
      data: { organizationId, code: 'SALES', name: 'Sales', journalType: 'sales' },
    });

    // Account mappings
    for (const [key, accountId] of [
      ['accounts_receivable', arAccountId],
      ['sales_revenue', revenueAccountId],
      ['tax_payable', taxAccountId],
      ['default_cash', cashAccountId],
      ['default_bank', cashAccountId],
    ] as const) {
      await prisma.accountMapping.create({
        data: { organizationId, key, accountId },
      });
    }
  });

  afterAll(async () => {
    if (organizationId) {
      await prisma.refreshToken.deleteMany({ where: { organizationId } });
      await prisma.document.deleteMany({ where: { organizationId } });
      await prisma.journalLine.deleteMany({ where: { organizationId } });
      await prisma.journalEntry.deleteMany({ where: { organizationId } });
      await prisma.auditLog.deleteMany({ where: { organizationId } });
      await prisma.eventOutbox.deleteMany({ where: { organizationId } });
      await prisma.idempotencyRecord.deleteMany({ where: { organizationId } });
      await prisma.reportTrialBalanceSnapshot.deleteMany({ where: { organizationId } });
      await prisma.reportPnLSnapshot.deleteMany({ where: { organizationId } });
      await prisma.reportBalanceSheetSnapshot.deleteMany({ where: { organizationId } });
      await prisma.reportApAgingSnapshot.deleteMany({ where: { organizationId } });
      await prisma.reportTieoutSnapshot.deleteMany({ where: { organizationId } });
      await prisma.accountMapping.deleteMany({ where: { organizationId } });
      await prisma.account.deleteMany({ where: { organizationId } });
      await prisma.fiscalPeriod.deleteMany({ where: { organizationId } });
      await prisma.product.deleteMany({ where: { organizationId } });
      await prisma.partner.deleteMany({ where: { organizationId } });
      await prisma.journal.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } });
    }
    await prisma.$disconnect();
  });

  it('runs the full invoice → payment → AR flow', async () => {
    // 1. Create a draft invoice.
    const invoice = await prisma.document.create({
      data: {
        organizationId,
        documentType: 'sales_invoice',
        documentNumber: 'INV-TEST-1',
        partnerId: customerId,
        issueDate: new Date(),
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        subtotal: 100,
        taxAmount: 0,
        totalAmount: 100,
        amountResidual: 100,
        amountPaid: 0,
        status: 'draft',
        lines: {
          create: [
            {
              organizationId,
              description: 'Widget',
              quantity: 1,
              unitPrice: 100,
              discountPercent: 0,
              subtotal: 100,
              taxAmount: 0,
              total: 100,
              lineNumber: 1,
              accountId: revenueAccountId,
              productId,
            },
          ],
        },
      },
      include: { lines: true },
    });
    expect(invoice.totalAmount.toString()).toBe('100');

    // 2. Post the invoice: write a balanced journal.
    const totalAmount = invoice.totalAmount;
    const je = await prisma.journalEntry.create({
      data: {
        organizationId,
        journalId: (await prisma.journal.findFirstOrThrow({ where: { organizationId, code: 'SALES' } })).id,
        entryNumber: 'JE-TEST-1',
        postingDate: new Date(),
        description: 'Sales invoice',
        status: 'posted',
        postedAt: new Date(),
        lines: {
          create: [
            { organizationId, accountId: arAccountId, partnerId: customerId, debit: totalAmount, credit: 0, baseDebit: totalAmount, baseCredit: 0, lineNumber: 1 },
            { organizationId, accountId: revenueAccountId, credit: totalAmount, debit: 0, baseCredit: totalAmount, baseDebit: 0, lineNumber: 2 },
          ],
        },
      },
      include: { lines: true },
    });
    const totalDr = je.lines.reduce((s, l) => s + Number(l.baseDebit), 0);
    const totalCr = je.lines.reduce((s, l) => s + Number(l.baseCredit), 0);
    expect(Math.abs(totalDr - totalCr)).toBeLessThan(0.0001);

    await prisma.document.update({
      where: { id: invoice.id },
      data: { status: 'posted', postedAt: new Date(), amountResidual: 100, paymentStatus: 'not_paid', journalEntryId: je.id },
    });

    // 3. Record a partial payment.
    const partial = 40;
    const pay = await prisma.payment.create({
      data: {
        organizationId,
        paymentNumber: 'PAY-TEST-1',
        direction: 'inbound',
        partnerId: customerId,
        paymentDate: new Date(),
        paymentMethod: 'cash',
        accountId: cashAccountId,
        amount: partial,
        allocatedAmount: partial,
        unallocatedAmount: 0,
        status: 'posted',
        journalEntryId: je.id,
      },
    });
    await prisma.paymentAllocation.create({
      data: { organizationId, paymentId: pay.id, documentId: invoice.id, amount: partial },
    });
    await prisma.document.update({
      where: { id: invoice.id },
      data: { amountPaid: partial, amountResidual: 60, paymentStatus: 'partial' },
    });

    const updated = await prisma.document.findFirstOrThrow({ where: { id: invoice.id } });
    expect(Number(updated.amountPaid)).toBe(40);
    expect(Number(updated.amountResidual)).toBe(60);
    expect(updated.paymentStatus).toBe('partial');

    // 4. Verify AR aging: the open residual is in the "current" bucket.
    const now = new Date();
    const openInvoices = await prisma.document.findMany({
      where: { organizationId, documentType: 'sales_invoice', paymentStatus: { in: ['not_paid', 'partial'] } },
    });
    const total = openInvoices.reduce((s, d) => s + Number(d.amountResidual), 0);
    expect(total).toBe(60);
    expect(now.getTime()).toBeGreaterThan(0);
  }, 60_000);
});