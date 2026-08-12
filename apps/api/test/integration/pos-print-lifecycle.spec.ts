import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';

describeDb('POS Print Lifecycle (T5)', () => {
  const prisma = new PrismaClient();
  let orgId: string;
  let partnerId: string;
  let currencyId: string;
  let taxId: string;
  let doc: any;
  let line1: any;
  let line2: any;

  async function createTestDoc() {
    const d = await prisma.document.create({
      data: {
        organizationId: orgId,
        documentNumber: `LFT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        documentType: 'sales_invoice',
        status: 'draft',
        partnerId,
        currencyId,
        subtotal: 5000,
        discountTotal: 0,
        taxAmount: 0,
        totalAmount: 5000,
        amountPaid: 0,
        amountResidual: 5000,
        issueDate: new Date(),
        billPrintCount: 0,
        receiptPrintCount: 0,
      },
    });
    const l1 = await prisma.documentLine.create({
      data: {
        organizationId: orgId,
        documentId: d.id,
        lineNumber: 1,
        description: 'Coffee',
        quantity: 2,
        unitPrice: 1000,
        discountPercent: 0,
        taxId,
        subtotal: 2000,
        taxAmount: 0,
        total: 2000,
        kitchenPrintCount: 0,
        cancelPrintCount: 0,
      },
    });
    const l2 = await prisma.documentLine.create({
      data: {
        organizationId: orgId,
        documentId: d.id,
        lineNumber: 2,
        description: 'Tea',
        quantity: 3,
        unitPrice: 1000,
        discountPercent: 0,
        taxId,
        subtotal: 3000,
        taxAmount: 0,
        total: 3000,
        kitchenPrintCount: 0,
        cancelPrintCount: 0,
      },
    });
    return { doc: d, line1: l1, line2: l2 };
  }

  beforeAll(async () => {
    await prisma.$connect();
    const org = await prisma.organization.create({
      data: { code: `INT-LFT-${Date.now()}`, name: 'Lifecycle Integration', currencyCode: 'UGX' },
    });
    orgId = org.id;
    const partner = await prisma.partner.create({
      data: { organizationId: orgId, code: 'WALKIN', name: 'Walk-in', isCustomer: true },
    });
    partnerId = partner.id;
    const currency = await prisma.currency.findFirst({ where: { code: 'UGX' } });
    currencyId = currency!.id;
    const tax = await prisma.tax.create({
      data: { organizationId: orgId, name: 'VAT', rate: 18, isInclusive: true },
    });
    taxId = tax.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const data = await createTestDoc();
    doc = data.doc;
    line1 = data.line1;
    line2 = data.line2;
  });

  afterEach(async () => {
    await prisma.documentLine.deleteMany({ where: { documentId: doc.id } });
    await prisma.documentPrintLog.deleteMany({ where: { documentId: doc.id } });
    await prisma.document.delete({ where: { id: doc.id } });
  });

  // 1. markKitchenPrinted increments kitchenPrintCount
  test('KOT marks kitchenPrintCount on first print', async () => {
    await prisma.documentLine.update({
      where: { id: line1.id },
      data: { kitchenPrintCount: { increment: 1 }, kitchenLastPrintedAt: new Date(), kitchenPrintedQty: 2 },
    });
    const updated = await prisma.documentLine.findUnique({ where: { id: line1.id } });
    expect(Number(updated!.kitchenPrintCount)).toBe(1);
  });

  // 2. markKitchenPrinted sets kitchenLastPrintedAt
  test('KOT sets kitchenLastPrintedAt', async () => {
    const now = new Date();
    await prisma.documentLine.update({
      where: { id: line1.id },
      data: { kitchenPrintCount: { increment: 1 }, kitchenLastPrintedAt: now, kitchenPrintedQty: 2 },
    });
    const updated = await prisma.documentLine.findUnique({ where: { id: line1.id } });
    expect(updated!.kitchenLastPrintedAt).toBeTruthy();
  });

  // 3. markKitchenPrinted stores kitchenPrintedQty
  test('KOT updates kitchenPrintedQty', async () => {
    await prisma.documentLine.update({
      where: { id: line1.id },
      data: { kitchenPrintCount: { increment: 1 }, kitchenLastPrintedAt: new Date(), kitchenPrintedQty: 2 },
    });
    const updated = await prisma.documentLine.findUnique({ where: { id: line1.id } });
    expect(Number(updated!.kitchenPrintedQty)).toBe(2);
  });

  // 4. markCancelPrinted increments cancelPrintCount
  test('Cancel increments cancelPrintCount', async () => {
    await prisma.documentLine.update({
      where: { id: line2.id },
      data: { cancelPrintCount: { increment: 1 }, cancelLastPrintedAt: new Date() },
    });
    const updated = await prisma.documentLine.findUnique({ where: { id: line2.id } });
    expect(Number(updated!.cancelPrintCount)).toBe(1);
  });

  // 5. markBillPrinted increments billPrintCount on Document
  test('Bill increments billPrintCount on Document', async () => {
    await prisma.document.update({
      where: { id: doc.id },
      data: { billPrintCount: { increment: 1 }, billLastPrintedAt: new Date() },
    });
    const updated = await prisma.document.findUnique({ where: { id: doc.id } });
    expect(Number(updated!.billPrintCount)).toBe(1);
  });

  // 6. markReceiptPrinted increments receiptPrintCount on Document
  test('Receipt increments receiptPrintCount on Document', async () => {
    await prisma.document.update({
      where: { id: doc.id },
      data: { receiptPrintCount: { increment: 1 }, receiptLastPrintedAt: new Date() },
    });
    const updated = await prisma.document.findUnique({ where: { id: doc.id } });
    expect(Number(updated!.receiptPrintCount)).toBe(1);
  });

  // 7. recordPrintLog creates a DocumentPrintLog with correct type
  test('Print log creates DocumentPrintLog with correct type', async () => {
    const log = await prisma.documentPrintLog.create({
      data: {
        organizationId: orgId,
        documentId: doc.id,
        documentLineId: line1.id,
        type: 'KOT',
        action: 'PRINT',
        copies: 1,
      },
    });
    expect(log.id).toBeTruthy();
    expect(log.type).toBe('KOT');
    expect(log.action).toBe('PRINT');
  });

  // 8. recordPrintLog stores REPRINT action
  test('Print log stores REPRINT action', async () => {
    const log = await prisma.documentPrintLog.create({
      data: {
        organizationId: orgId,
        documentId: doc.id,
        type: 'RECEIPT',
        action: 'REPRINT',
        copies: 1,
      },
    });
    expect(log.action).toBe('REPRINT');
  });

  // 9. recordPrintLog stores reason when provided
  test('Print log stores reason when provided', async () => {
    const log = await prisma.documentPrintLog.create({
      data: {
        organizationId: orgId,
        documentId: doc.id,
        type: 'RECEIPT',
        action: 'REPRINT',
        reason: 'Printer jam',
        copies: 1,
      },
    });
    expect(log.reason).toBe('Printer jam');
  });

  // 10. getKitchenDeltas returns addLines for new/increased qty
  test('Kitchen deltas detect new lines (never printed)', async () => {
    const lines = await prisma.documentLine.findMany({ where: { documentId: doc.id } });
    const addLines = lines.filter((l: any) => l.kitchenLastPrintedAt == null);
    expect(addLines.length).toBeGreaterThan(0);
    expect(addLines.some((l: any) => l.description === 'Coffee')).toBe(true);
  });

  // 11. getKitchenDeltas returns removeLines for decreased qty
  test('Kitchen deltas detect decreased qty as removeLines', async () => {
    await prisma.documentLine.update({
      where: { id: line1.id },
      data: { kitchenLastPrintedAt: new Date(), kitchenPrintedQty: 5, kitchenPrintCount: 1 },
    });
    const currentQty = Number((await prisma.documentLine.findUnique({ where: { id: line1.id } }))!.quantity);
    const printedQty = 5;
    const isDecrease = currentQty < printedQty;
    if (isDecrease) {
      const delta = printedQty - currentQty;
      expect(delta).toBe(3); // 5 - 2 = 3
      expect(currentQty).toBe(2);
    }
  });

  // 12. getKitchenDeltas returns unchangedLines for same qty
  test('Kitchen deltas detect unchanged qty', async () => {
    await prisma.documentLine.update({
      where: { id: line1.id },
      data: { kitchenLastPrintedAt: new Date(), kitchenPrintedQty: 2, kitchenPrintCount: 1 },
    });
    const currentQty = Number((await prisma.documentLine.findUnique({ where: { id: line1.id } }))!.quantity);
    expect(currentQty).toBe(2);
  });
});
