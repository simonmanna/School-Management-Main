/**
 * POS T5 — Print Lifecycle Service.
 *
 * Single source of truth for the bill/receipt/KOT print counters + audit log.
 *   BILL    → customer preview (ESC/POS) on the open tab (an Order) or Invoice
 *   RECEIPT → legal payment proof (ESC/POS) on the paid Invoice
 *   KOT     → kitchen tickets (counters live on OrderItem; see PosOrdersService)
 *
 * A print target is resolved dynamically: a POS pre-settle bill references the
 * open `Order`; a post-settle receipt/bill references the `Invoice`; legacy /
 * manual prints reference the generic `Document`. Each print is recorded in
 * DocumentPrintLog for audit (idempotency keys prevent duplicate prints on retry).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { SettingsService } from '../../kernel/settings/settings.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';

export interface PrintLogInput {
  organizationId: string;
  /** The record being printed — an Invoice, Order, or (legacy) Document id. */
  documentId: string;
  documentLineId?: string;
  type: 'KOT' | 'BILL' | 'RECEIPT' | 'CANCEL';
  action?: 'PRINT' | 'REPRINT';
  copies?: number;
  printedById?: string;
  reason?: string;
  printer?: string;
  idempotencyKey?: string;
}

type PrintTarget = 'invoice' | 'order' | 'document';

export interface KitchenDelta {
  addLines: Array<{ line: any; delta: number }>;
  removeLines: Array<{ line: any; delta: number }>;
  unchangedLines: Array<{ line: any }>;
}

@Injectable()
export class PosPrintLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly tenant: TenantContextService,
  ) {}

  /* ──── Target detection ──── */

  /**
   * Resolve which model a print-record id belongs to so print-lifecycle methods
   * target the correct table: a post-settle Invoice, an open-tab Order, or a
   * legacy/manual Document.
   */
  private async resolvePrintTarget(tx: any, recordId: string): Promise<PrintTarget> {
    const inv = await tx.invoice.findFirst({ where: { id: recordId }, select: { id: true } });
    if (inv) return 'invoice';
    const order = await tx.order.findFirst({ where: { id: recordId }, select: { id: true } });
    if (order) return 'order';
    return 'document';
  }

  /* ─────────── Bill helpers ─────────── */

  async markBillPrinted(tx: any, recordId: string, userId?: string): Promise<void> {
    const target = await this.resolvePrintTarget(tx, recordId);
    const data = { billPrintCount: { increment: 1 }, billLastPrintedAt: new Date(), lastPrintedById: userId ?? null };
    if (target === 'invoice') await tx.invoice.update({ where: { id: recordId }, data });
    else if (target === 'order') await tx.order.update({ where: { id: recordId }, data });
    else await tx.document.update({ where: { id: recordId }, data });
  }

  async markLinesBilled(tx: any, recordId: string, _userId?: string): Promise<void> {
    const target = await this.resolvePrintTarget(tx, recordId);
    // Invoice / Order items have no bill-printed-at field; only legacy Document tracks it.
    if (target !== 'document') return;
    await tx.documentLine.updateMany({
      where: { documentId: recordId, billPrintedAt: null },
      data: { billPrintedAt: new Date() },
    });
  }

  async getBillCopyNumber(tx: any, recordId: string): Promise<number> {
    const target = await this.resolvePrintTarget(tx, recordId);
    const model = target === 'invoice' ? tx.invoice : target === 'order' ? tx.order : tx.document;
    const rec = await model.findUnique({ where: { id: recordId }, select: { billPrintCount: true } });
    return (rec?.billPrintCount ?? 0) + 1;
  }

  /* ─────────── Receipt helpers (post-settle: Invoice only) ─────────── */

  async markReceiptPrinted(tx: any, recordId: string, userId?: string, _idempotencyKey?: string): Promise<void> {
    const target = await this.resolvePrintTarget(tx, recordId);
    const data = { receiptPrintCount: { increment: 1 }, receiptLastPrintedAt: new Date(), lastPrintedById: userId ?? null };
    if (target === 'invoice') await tx.invoice.update({ where: { id: recordId }, data });
    else if (target === 'document') await tx.document.update({ where: { id: recordId }, data });
    // Orders have no receipt counter — receipts are only issued post-settle (Invoice).
  }

  async getReceiptCopyNumber(tx: any, recordId: string): Promise<number> {
    const target = await this.resolvePrintTarget(tx, recordId);
    if (target === 'order') return 1;
    const model = target === 'invoice' ? tx.invoice : tx.document;
    const rec = await model.findUnique({ where: { id: recordId }, select: { receiptPrintCount: true } });
    return (rec?.receiptPrintCount ?? 0) + 1;
  }

  /* ─────────── KOT copy helpers ─────────── */

  async getKotCopyNumber(tx: any, recordId: string): Promise<number> {
    const target = await this.resolvePrintTarget(tx, recordId);
    const model = target === 'invoice' ? tx.invoice : target === 'order' ? tx.order : tx.document;
    const rec = await model.findUnique({ where: { id: recordId }, select: { kotPrintCount: true } });
    return (rec?.kotPrintCount ?? 0) + 1;
  }

  async markKotPrinted(tx: any, recordId: string, userId?: string): Promise<void> {
    const target = await this.resolvePrintTarget(tx, recordId);
    const data = { kotPrintCount: { increment: 1 }, lastPrintedById: userId ?? null };
    if (target === 'invoice') await tx.invoice.update({ where: { id: recordId }, data });
    else if (target === 'order') await tx.order.update({ where: { id: recordId }, data });
    else await tx.document.update({ where: { id: recordId }, data });
  }

  /* ─────────── Print log ─────────── */

  async recordPrintLog(tx: any, input: PrintLogInput): Promise<void> {
    // The print log's documentId/invoiceId FKs are both optional. Route the id to
    // the right column so the log row is written without violating a FK. Order-tab
    // prints reference neither (the Order is retired at settle), so both stay null.
    const target = await this.resolvePrintTarget(tx, input.documentId);
    await tx.documentPrintLog.create({
      data: {
        organizationId: input.organizationId,
        documentId: target === 'document' ? input.documentId : null,
        invoiceId: target === 'invoice' ? input.documentId : null,
        documentLineId: input.documentLineId ?? null,
        type: input.type,
        action: input.action ?? 'PRINT',
        copies: input.copies ?? 1,
        printedById: input.printedById ?? null,
        reason: input.reason ?? null,
        printer: input.printer ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });
  }

  /* ─────────── KOT deltas (open tab = Order + OrderItem) ─────────── */

  /**
   * Compute kitchen deltas between an order's current item quantities and the
   * last-printed quantities stored in `kitchenPrintedQty`. Used by the manual
   * KOT-print endpoint. `line` is an OrderItem (carries its `modifiers`).
   */
  async getKitchenDeltas(tx: any, orderId: string): Promise<KitchenDelta> {
    const items = await tx.orderItem.findMany({
      where: { orderId, cancelled: false },
      orderBy: { lineNumber: 'asc' },
      include: { modifiers: true },
    });
    const addLines: KitchenDelta['addLines'] = [];
    const removeLines: KitchenDelta['removeLines'] = [];
    const unchangedLines: KitchenDelta['unchangedLines'] = [];
    for (const ln of items) {
      const currentQty = Number(ln.quantity);
      const printedQty = ln.kitchenPrintedQty != null ? Number(ln.kitchenPrintedQty) : 0;
      if (ln.kitchenLastPrintedAt == null) addLines.push({ line: ln, delta: currentQty });
      else if (currentQty > printedQty) addLines.push({ line: ln, delta: currentQty - printedQty });
      else if (currentQty < printedQty) removeLines.push({ line: ln, delta: printedQty - currentQty });
      else unchangedLines.push({ line: ln });
    }
    return { addLines, removeLines, unchangedLines };
  }

  async markKitchenPrinted(tx: any, itemIds: string[], qtyMap: Map<string, number>, userId?: string): Promise<void> {
    if (!itemIds.length) return;
    const now = new Date();
    await tx.orderItem.updateMany({
      where: { id: { in: itemIds } },
      data: { kitchenPrintCount: { increment: 1 }, kitchenLastPrintedAt: now, lastKitchenPrintedById: userId ?? null },
    });
    for (const id of itemIds) {
      const qty = qtyMap.get(id);
      if (qty != null) await tx.orderItem.update({ where: { id }, data: { kitchenPrintedQty: qty } });
    }
  }

  async markCancelPrinted(tx: any, itemIds: string[], userId?: string): Promise<void> {
    if (!itemIds.length) return;
    await tx.orderItem.updateMany({
      where: { id: { in: itemIds } },
      data: { cancelPrintCount: { increment: 1 }, cancelLastPrintedAt: new Date(), lastKitchenPrintedById: userId ?? null },
    });
  }

  /* ─────────── Printer settings ─────────── */

  async getPrinterSettings(_type: 'kot' | 'bill' | 'receipt'): Promise<{ host: string; port: number } | null> {
    const host = await this.settings.get(`pos.printerHost`);
    if (!host || typeof host !== 'string') return null;
    const port = Number(await this.settings.get(`pos.printerPort`) ?? 9100);
    return { host, port };
  }
}
