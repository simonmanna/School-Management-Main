/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { dec } from '../../../kernel/common/money';
import { PosOrdersService } from '../order/pos-orders.service';
import { PosInvoiceService } from '../billing/pos-invoice.service';
import { PosReceiptsService } from '../pos-receipts.service';
import { PosTablesService } from '../pos-tables.service';
import { isTableHeldOrderStatus } from '../table-status.util';
import type { PaymentTender } from '../pos.service';

/** One {item, qty} assignment instruction from the client. */
interface ItemAssignment {
  sourceItemId: string;
  quantity: number;
}

/**
 * Split Bills — divide a table's open tab (an open `Order`) into multiple
 * independently-payable bills WITHOUT duplicating the order or touching the
 * kitchen. A `SplitBillItem` references a source `OrderItem` + a partial
 * quantity; the invariant `Σ assigned qty per item ≤ item.quantity` is enforced
 * on every mutation.
 *
 * Each item-split bill settles into its OWN Invoice via the same bridge
 * `PosService.settleTab` uses (`createOrderFromResolved` → `generateInvoice` →
 * `receivePayment`). Because the splits partition the source quantities exactly,
 * stock deducts once and the GL stays balanced across the table. The source open
 * Order is only ever cancelled (never billed) once the last bill settles, so it
 * contributes no stock/GL of its own.
 */
@Injectable()
export class PosSplitService {
  private readonly logger = new Logger('PosSplitService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly orders: PosOrdersService,
    private readonly billing: PosInvoiceService,
    private readonly receipts: PosReceiptsService,
    private readonly tables: PosTablesService,
  ) {}

  // ─── Query ─────────────────────────────────────────────────────────────────

  /** The full split workspace for a table: source items (+ unassigned qty),
   *  every bill (+ its items + per-bill totals), and the table running balance. */
  async getState(tableId: string) {
    const { order, items } = await this.loadOpenTab(this.prisma.client, tableId);
    if (!order) {
      return { tableId, sourceOrderId: null, lines: [], bills: [], summary: this.emptySummary(), splitActive: false };
    }
    const bills = await this.prisma.client.splitBill.findMany({
      where: { sourceOrderId: order.id, status: { not: 'void' } },
      orderBy: { createdAt: 'asc' },
      include: { items: true },
    });
    return this.buildState(tableId, order, items, bills);
  }

  // ─── Bill lifecycle ──────────────────────────────────────────────────────────

  /** Create `count` empty bills against the table's open tab. */
  async addBills(tableId: string, count = 1) {
    const orgId = this.tenant.organizationId;
    const n = Math.max(1, Math.min(20, Math.floor(count)));
    return this.withTableLock(tableId, async (tx) => {
      const { order, items } = await this.loadOpenTab(tx, tableId);
      if (!order) throw new BadRequestException('No open tab on this table to split');
      if (!items?.length) throw new BadRequestException('The tab is empty');
      const existing = await tx.splitBill.count({ where: { sourceOrderId: order.id, status: { not: 'void' } } });
      for (let i = 0; i < n; i++) {
        await tx.splitBill.create({
          data: {
            organizationId: orgId, tableId, sourceOrderId: order.id,
            label: `Bill ${existing + i + 1}`, splitType: 'item', status: 'open',
            createdBy: this.tenant.userId ?? null,
          },
        });
      }
      await this.audit.recordInTx(tx, { entity: 'SplitBill', entityId: order.id, action: 'create', newValues: { tableId, added: n } });
      return this.reloadState(tx, tableId, order.id);
    });
  }

  /** Assign quantity from the unassigned pool into a bill. */
  async assign(billId: string, items: ItemAssignment[]) {
    return this.mutateBill(billId, async (tx, bill, order, srcItems) => {
      const assignedByItem = await this.assignedByItem(tx, order.id);
      for (const it of items) {
        const src = srcItems.find((l: any) => l.id === it.sourceItemId);
        if (!src) throw new BadRequestException(`Unknown source item ${it.sourceItemId}`);
        const qty = Number(it.quantity);
        if (!(qty > 0)) continue;
        const pool = Number(src.quantity) - (assignedByItem.get(src.id) ?? 0);
        if (qty > pool + 1e-6) throw new BadRequestException(`Only ${pool} of "${src.description}" left to assign`);
        await this.upsertItem(tx, bill.id, src.id, qty);
        assignedByItem.set(src.id, (assignedByItem.get(src.id) ?? 0) + qty);
      }
      await this.audit.recordInTx(tx, { entity: 'SplitBill', entityId: bill.id, action: 'assign', newValues: { items } });
    });
  }

  /** Return quantity from a bill back to the unassigned pool. */
  async unassign(billId: string, items: ItemAssignment[]) {
    return this.mutateBill(billId, async (tx, bill) => {
      for (const it of items) {
        await this.decrementItem(tx, bill.id, it.sourceItemId, Number(it.quantity));
      }
      await this.audit.recordInTx(tx, { entity: 'SplitBill', entityId: bill.id, action: 'unassign', newValues: { items } });
    });
  }

  /** Move quantity from one open bill to another. */
  async move(fromBillId: string, toBillId: string, items: ItemAssignment[]) {
    if (fromBillId === toBillId) throw new BadRequestException('Source and target bills are the same');
    const orgId = this.tenant.organizationId;
    const from = await this.prisma.client.splitBill.findFirst({ where: { id: fromBillId } });
    const to = await this.prisma.client.splitBill.findFirst({ where: { id: toBillId } });
    if (!from || !to) throw new NotFoundException('Bill not found');
    if (from.tableId !== to.tableId) throw new BadRequestException('Bills belong to different tables');
    return this.withTableLock(from.tableId, async (tx) => {
      const f = await tx.splitBill.findFirst({ where: { id: fromBillId } });
      const t = await tx.splitBill.findFirst({ where: { id: toBillId } });
      this.assertOpen(f); this.assertOpen(t);
      for (const it of items) {
        const qty = Number(it.quantity);
        await this.decrementItem(tx, fromBillId, it.sourceItemId, qty);
        await this.upsertItem(tx, toBillId, it.sourceItemId, qty);
      }
      await this.recomputeBill(tx, fromBillId);
      await this.recomputeBill(tx, toBillId);
      await this.audit.recordInTx(tx, { entity: 'SplitBill', entityId: toBillId, action: 'assign', newValues: { from: fromBillId, items } });
      void orgId;
      return this.reloadState(tx, from.tableId, from.sourceOrderId);
    });
  }

  /** Fold a source bill's items into a target bill, then delete the source. */
  async merge(targetBillId: string, sourceBillId: string) {
    if (targetBillId === sourceBillId) throw new BadRequestException('Cannot merge a bill into itself');
    const target = await this.prisma.client.splitBill.findFirst({ where: { id: targetBillId } });
    const source = await this.prisma.client.splitBill.findFirst({ where: { id: sourceBillId } });
    if (!target || !source) throw new NotFoundException('Bill not found');
    if (target.tableId !== source.tableId) throw new BadRequestException('Bills belong to different tables');
    return this.withTableLock(target.tableId, async (tx) => {
      const tgt = await tx.splitBill.findFirst({ where: { id: targetBillId } });
      const src = await tx.splitBill.findFirst({ where: { id: sourceBillId }, include: { items: true } });
      this.assertOpen(tgt); this.assertOpen(src);
      for (const it of src.items as any[]) {
        await this.upsertItem(tx, targetBillId, it.sourceItemId, Number(it.quantity));
      }
      await tx.splitBill.delete({ where: { id: sourceBillId } });
      await this.recomputeBill(tx, targetBillId);
      await this.audit.recordInTx(tx, { entity: 'SplitBill', entityId: targetBillId, action: 'merge' as any, newValues: { sourceBillId } });
      return this.reloadState(tx, target.tableId, target.sourceOrderId);
    });
  }

  /** Delete an (unpaid) bill, returning its items to the pool. */
  async deleteBill(billId: string) {
    const bill = await this.prisma.client.splitBill.findFirst({ where: { id: billId } });
    if (!bill) throw new NotFoundException('Bill not found');
    return this.withTableLock(bill.tableId, async (tx) => {
      const b = await tx.splitBill.findFirst({ where: { id: billId } });
      this.assertOpen(b);
      await tx.splitBill.delete({ where: { id: billId } });
      await this.audit.recordInTx(tx, { entity: 'SplitBill', entityId: billId, action: 'delete', newValues: { tableId: bill.tableId } });
      return this.reloadState(tx, bill.tableId, bill.sourceOrderId);
    });
  }

  /** Abort the split: void every open bill (settled bills are kept). */
  async cancelSplit(tableId: string) {
    return this.withTableLock(tableId, async (tx) => {
      const { order } = await this.loadOpenTab(tx, tableId);
      if (!order) return this.buildState(tableId, null, [], []);
      await tx.splitBill.deleteMany({ where: { sourceOrderId: order.id, status: 'open' } });
      await this.audit.recordInTx(tx, { entity: 'SplitBill', entityId: order.id, action: 'cancel', newValues: { kind: 'cancel_split', tableId } });
      return this.reloadState(tx, tableId, order.id);
    });
  }

  // ─── Settlement ──────────────────────────────────────────────────────────────

  /**
   * Settle one bill into its own Invoice (+ Receipt) and take payment. Reuses the
   * exact bridge `settleTab` uses. Idempotent: a bill that already carries an
   * invoiceId returns it without re-charging. Closes + frees the table once every
   * source item is fully assigned to a settled bill.
   */
  async settleBill(
    billId: string,
    dto: { tenders?: PaymentTender[]; paymentMethod?: 'cash' | 'bank' | 'card' | 'mobile_money'; amountTendered?: number; cashSessionId?: string } = {},
  ) {
    const bill = await this.prisma.client.splitBill.findFirst({ where: { id: billId }, include: { items: true } });
    if (!bill) throw new NotFoundException('Bill not found');
    if (bill.status === 'void') throw new BadRequestException('Bill was cancelled');
    if (bill.invoiceId) {
      // Idempotent — already settled.
      const inv = await this.billing.findInvoice(bill.invoiceId);
      return { billId, invoiceId: bill.invoiceId, invoiceNumber: inv?.invoiceNumber, settlementStatus: 'settled', change: 0, tableClosed: false, alreadySettled: true };
    }
    if (!bill.items?.length) throw new BadRequestException('This bill has no items to pay');

    const { order, items } = await this.loadOpenTab(this.prisma.client, bill.tableId);
    if (!order || order.id !== bill.sourceOrderId) throw new ConflictException('The tab changed since this split started — cancel the split and retry');
    const itemById = new Map<string, any>(items.map((l: any) => [l.id, l]));

    const resolvedLines = (bill.items as any[]).map((it) => {
      const src = itemById.get(it.sourceItemId);
      if (!src) throw new ConflictException(`Source item ${it.sourceItemId} is gone — cancel the split and retry`);
      return {
        productId: src.productId ?? null,
        menuItemId: src.menuItemId ?? null,
        description: src.description,
        quantity: Number(it.quantity),
        // The tab item's unitPrice already folds variant/accompaniment/modifier
        // deltas — pass as-is (no re-folding), exactly like settleTab's bridge.
        unitPrice: Number(src.unitPrice),
        taxId: src.taxId ?? null,
        discountPercent: Number(src.discountPercent ?? 0),
        discountType: src.discountType ?? undefined,
        discountAmount: src.discountAmount ? Number(src.discountAmount) : undefined,
        discountReason: src.discountReason ?? null,
        taxInclusive: (src as any).taxInclusive,
        note: null,
        modifiers: (src.modifiers ?? []).map((m: any) => ({ modifierId: m.modifierId ?? '', name: m.name, priceDelta: Number(m.priceDelta) })),
      };
    });

    // Build the order → invoice → payment (each manages its own transaction).
    const billOrder = await this.orders.createOrderFromResolved({
      orderType: 'dine_in',
      tableId: bill.tableId,
      partnerId: bill.partnerId ?? order.partnerId ?? undefined,
      cashSessionId: dto.cashSessionId,
      branchId: order.branchId ?? undefined,
      lines: resolvedLines,
    });

    let invoice: any;
    try {
      invoice = await this.billing.generateInvoice(billOrder.id, {});
    } catch (e: any) {
      this.logger.error(`[split] invoice gen failed for bill ${billId} / order ${billOrder.id}: ${e?.message ?? e}`);
      await this.orders.cancelOrder(billOrder.id, 'split: invoice generation failed').catch(() => undefined);
      throw e;
    }
    let pay: any;
    try {
      pay = await this.billing.receivePayment(invoice.id, {
        tenders: dto.tenders,
        paymentMethod: dto.paymentMethod,
        amountTendered: dto.amountTendered,
        cashSessionId: dto.cashSessionId,
      });
    } catch (e: any) {
      this.logger.error(`[split] payment failed for invoice ${invoice.invoiceNumber} (${invoice.id}): ${e?.message ?? e}`);
      await this.billing.refund(invoice.id, 'split: payment failed').catch(() => undefined);
      throw e;
    }

    // Mark the bill settled + link its invoice.
    await this.prisma.client.splitBill.update({
      where: { id: billId },
      data: {
        status: 'settled', invoiceId: invoice.id, settledAt: new Date(),
        subtotal: invoice.subtotal, totalAmount: invoice.totalAmount, amountPaid: invoice.totalAmount,
      },
    });
    await this.audit.record({ entity: 'SplitBill', entityId: billId, action: 'post' as any, newValues: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber } });

    const tableClosed = await this.maybeCloseTable(bill.tableId, bill.sourceOrderId);

    let receiptHtml: string | undefined;
    try {
      receiptHtml = await this.receipts.buildHtmlReceipt(invoice.id);
    } catch { /* non-fatal */ }

    return {
      billId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      settlementStatus: pay?.settlementStatus ?? 'settled',
      change: pay?.change ?? 0,
      tableClosed,
      receiptHtml,
    };
  }

  // ─── Internals ───────────────────────────────────────────────────────────────

  /** Close + free the table once every source item is fully assigned to a settled
   *  bill (no open bills, no unassigned quantity left). Otherwise leave it open. */
  private async maybeCloseTable(tableId: string, sourceOrderId: string): Promise<boolean> {
    const { order, items } = await this.loadOpenTab(this.prisma.client, tableId);
    if (!order || order.id !== sourceOrderId) return false;
    const open = await this.prisma.client.splitBill.count({ where: { sourceOrderId, status: 'open' } });
    if (open > 0) return false;
    const settled = await this.prisma.client.splitBill.findMany({ where: { sourceOrderId, status: 'settled' }, include: { items: true } });
    const assignedByItem = new Map<string, number>();
    for (const b of settled as any[]) {
      for (const it of b.items) assignedByItem.set(it.sourceItemId, (assignedByItem.get(it.sourceItemId) ?? 0) + Number(it.quantity));
    }
    const fullyAssigned = items.every((l: any) => Math.abs(Number(l.quantity) - (assignedByItem.get(l.id) ?? 0)) < 1e-6);
    if (!fullyAssigned) return false;

    // Everything is paid — retire the source tab Order + free the table (mirrors settleTab).
    try {
      await this.orders.cancelOrder(order.id, `Split-settled across ${settled.length} bill(s)`);
    } catch (e: any) { this.logger.warn(`[split] tab cancel failed: ${e?.message}`); }
    try {
      await this.tables.closeTableOrder({ tableId, orderId: order.id });
    } catch (e: any) { this.logger.warn(`[split] close table failed: ${e?.message}`); }
    return true;
  }

  /** Run a bill-scoped mutation under the table lock + recompute the bill after. */
  private async mutateBill(
    billId: string,
    fn: (tx: any, bill: any, order: any, items: any[]) => Promise<void>,
  ) {
    const bill = await this.prisma.client.splitBill.findFirst({ where: { id: billId } });
    if (!bill) throw new NotFoundException('Bill not found');
    return this.withTableLock(bill.tableId, async (tx) => {
      const b = await tx.splitBill.findFirst({ where: { id: billId } });
      this.assertOpen(b);
      const { order, items } = await this.loadOpenTab(tx, bill.tableId);
      if (!order || order.id !== bill.sourceOrderId) throw new ConflictException('The tab changed — cancel the split and retry');
      await fn(tx, b, order, items);
      await this.recomputeBill(tx, billId);
      return this.reloadState(tx, bill.tableId, bill.sourceOrderId);
    });
  }

  private assertOpen(bill: any): void {
    if (!bill) throw new NotFoundException('Bill not found');
    if (bill.status === 'settled') throw new ConflictException('That bill is already paid and cannot be changed');
    if (bill.status === 'void') throw new ConflictException('That bill was cancelled');
  }

  /** Increment (or create) a bill's item for a source item. */
  private async upsertItem(tx: any, billId: string, sourceItemId: string, qty: number): Promise<void> {
    if (!(qty > 0)) return;
    const existing = await tx.splitBillItem.findFirst({ where: { splitBillId: billId, sourceItemId } });
    if (existing) {
      await tx.splitBillItem.update({ where: { id: existing.id }, data: { quantity: dec(existing.quantity).plus(qty) as any } });
    } else {
      await tx.splitBillItem.create({ data: { organizationId: this.tenant.organizationId, splitBillId: billId, sourceItemId, quantity: qty } });
    }
  }

  /** Decrement a bill's item (delete when it hits zero). */
  private async decrementItem(tx: any, billId: string, sourceItemId: string, qty: number): Promise<void> {
    if (!(qty > 0)) return;
    const existing = await tx.splitBillItem.findFirst({ where: { splitBillId: billId, sourceItemId } });
    if (!existing) throw new BadRequestException('That item is not on this bill');
    const next = Number(existing.quantity) - qty;
    if (next < -1e-6) throw new BadRequestException(`Bill only has ${Number(existing.quantity)} of that item`);
    if (next <= 1e-6) await tx.splitBillItem.delete({ where: { id: existing.id } });
    else await tx.splitBillItem.update({ where: { id: existing.id }, data: { quantity: next } });
  }

  /** Recompute a bill's snapshot totals (proportional share of each source item). */
  private async recomputeBill(tx: any, billId: string): Promise<void> {
    const bill = await tx.splitBill.findFirst({ where: { id: billId }, include: { items: true } });
    if (!bill) return;
    const { items } = await this.loadOpenTab(tx, bill.tableId);
    const itemById = new Map<string, any>(items.map((l: any) => [l.id, l]));
    let subtotal = dec(0); let total = dec(0);
    for (const it of bill.items as any[]) {
      const src = itemById.get(it.sourceItemId);
      if (!src) continue;
      const lineQty = Number(src.quantity) || 1;
      const ratio = dec(it.quantity).dividedBy(lineQty);
      const lineTotal = this.lineTotal(src);
      subtotal = subtotal.plus(dec(lineTotal).times(ratio));
      total = total.plus(dec(lineTotal).times(ratio));
    }
    await tx.splitBill.update({ where: { id: billId }, data: { subtotal: subtotal as any, totalAmount: total as any } });
  }

  /** Discounted line amount for an OrderItem (OrderItem stores no per-line total). */
  private lineTotal(it: any): number {
    const qty = Number(it.quantity);
    const unit = Number(it.unitPrice);
    const disc = Number(it.discountPercent ?? 0);
    return qty * unit * (1 - disc / 100);
  }

  /** Map of sourceItemId → total qty assigned across all non-void bills. */
  private async assignedByItem(db: any, sourceOrderId: string): Promise<Map<string, number>> {
    const bills = await db.splitBill.findMany({ where: { sourceOrderId, status: { not: 'void' } }, include: { items: true } });
    const map = new Map<string, number>();
    for (const b of bills as any[]) {
      for (const it of b.items) map.set(it.sourceItemId, (map.get(it.sourceItemId) ?? 0) + Number(it.quantity));
    }
    return map;
  }

  /** The open tab Order for a table (+ its items), or null. */
  private async loadOpenTab(db: any, tableId: string): Promise<{ order: any | null; items: any[] }> {
    const link = await db.posTableOrder.findFirst({
      where: { tableId, closedAt: null },
      orderBy: { openedAt: 'desc' },
      include: {
        order: {
          include: { items: { where: { cancelled: false }, orderBy: { lineNumber: 'asc' }, include: { modifiers: true } } },
        },
      },
    });
    const o = link?.order;
    const isOpen = o && !o.invoiceId && isTableHeldOrderStatus(o.status);
    const order = isOpen ? o : null;
    return { order, items: order?.items ?? [] };
  }

  private async reloadState(tx: any, tableId: string, sourceOrderId: string) {
    const { order, items } = await this.loadOpenTab(tx, tableId);
    const bills = await tx.splitBill.findMany({ where: { sourceOrderId, status: { not: 'void' } }, orderBy: { createdAt: 'asc' }, include: { items: true } });
    return this.buildState(tableId, order, items, bills);
  }

  /** Shape the API response the SplitBillDialog renders. */
  private buildState(tableId: string, order: any | null, items: any[], bills: any[]) {
    const assigned = new Map<string, number>();
    for (const b of bills) for (const it of b.items) assigned.set(it.sourceItemId, (assigned.get(it.sourceItemId) ?? 0) + Number(it.quantity));

    const outLines = items.map((l: any) => {
      const a = assigned.get(l.id) ?? 0;
      return {
        id: l.id,
        description: l.description,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        discountPercent: Number(l.discountPercent ?? 0),
        lineTotal: this.lineTotal(l),
        assignedQty: a,
        unassignedQty: Math.max(0, Number(l.quantity) - a),
        modifiers: (l.modifiers ?? []).map((m: any) => m.name),
      };
    });

    const outBills = bills.map((b: any) => ({
      id: b.id,
      label: b.label,
      status: b.status,
      splitType: b.splitType,
      partnerId: b.partnerId,
      invoiceId: b.invoiceId,
      totalAmount: Number(b.totalAmount),
      amountPaid: Number(b.amountPaid),
      items: (b.items as any[]).map((it) => {
        const src = items.find((l: any) => l.id === it.sourceItemId);
        const qty = Number(it.quantity);
        const ratio = src && Number(src.quantity) ? qty / Number(src.quantity) : 0;
        return {
          sourceItemId: it.sourceItemId,
          description: src?.description ?? '(removed)',
          quantity: qty,
          lineTotal: src ? this.lineTotal(src) * ratio : 0,
        };
      }),
    }));

    const tableTotal = outLines.reduce((s: number, l: any) => s + l.lineTotal, 0);
    const assignedTotal = outBills.reduce((s, b) => s + b.totalAmount, 0);
    const paidTotal = outBills.filter((b) => b.status === 'settled').reduce((s, b) => s + b.totalAmount, 0);
    const unassignedTotal = outLines.reduce((s, l) => s + (l.unassignedQty / (l.quantity || 1)) * l.lineTotal, 0);
    const fullyAssigned = outLines.length > 0 && outLines.every((l) => l.unassignedQty < 1e-6);
    const openBills = outBills.filter((b) => b.status === 'open').length;

    return {
      tableId,
      sourceOrderId: order?.id ?? null,
      lines: outLines,
      bills: outBills,
      summary: {
        tableTotal,
        assignedTotal,
        unassignedTotal: Math.max(0, unassignedTotal),
        paidTotal,
        outstandingTotal: Math.max(0, tableTotal - paidTotal),
        fullyAssigned,
        openBills,
      },
      splitActive: bills.length > 0,
    };
  }

  private emptySummary() {
    return { tableTotal: 0, assignedTotal: 0, unassignedTotal: 0, paidTotal: 0, outstandingTotal: 0, fullyAssigned: false, openBills: 0 };
  }

  /**
   * Run `fn` while holding a `FOR UPDATE` lock on the table row (serialises two
   * cashiers operating on the same table's split). Pass `undefined` tableId for a
   * no-lock pass-through.
   */
  private async withTableLock<T>(tableId: string | undefined, fn: (tx: any) => Promise<T>): Promise<T> {
    const orgId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      if (tableId) {
        await tx.$queryRawUnsafe(`SELECT id FROM "PosTable" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE`, tableId, orgId);
      }
      return fn(tx);
    });
  }

  /** True when the table has any non-void split bill (used to block plain settle). */
  async hasActiveSplit(sourceOrderId: string): Promise<boolean> {
    const n = await this.prisma.client.splitBill.count({ where: { sourceOrderId, status: { not: 'void' } } });
    return n > 0;
  }
}
