import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';
import { EventBus } from '../../kernel/events/event-bus';
import { AuditService } from '../../kernel/audit/audit.service';
import { ApprovalsService } from '../../kernel/approvals/approvals.service';
import { PostingService } from '../accounting/posting/posting.service';
import { AccountDeterminationService } from '../accounting/posting/account-determination.service';
import { StockService } from '../inventory/stock.service';
import { dec, ZERO } from '../../kernel/common/money';

interface CreateDebitNoteInput {
  direction: 'outbound' | 'inbound';
  partnerId: string;
  documentId?: string;
  reason: 'price_adjustment' | 'returned_goods' | 'overcharge' | 'correction' | 'other';
  reasonNote?: string;
  issueDate?: string;
  currencyCode?: string;
  exchangeRate?: number;
  notes?: string;
  /** RTV only: warehouse the returned goods leave from (defaults to org warehouse). */
  locationId?: string;
  lines: Array<{
    productId?: string;
    description: string;
    quantity: number;
    unitPrice: number;
    taxId?: string;
    notes?: string;
  }>;
}

/**
 * Debit notes (Phase F.6).
 *
 * Two directions:
 *   - outbound: we issue to a customer (increases their AR — they owe us more).
 *     GL: Dr Receivable / Cr Revenue (or Cr Sales Adjustment if correcting a sale)
 *   - inbound:  supplier issued us a debit note (increases our AP).
 *     GL: Dr Expense/Stock / Cr Payable
 *
 * Posting goes through the same PostingService so the books remain balanced.
 */
@Injectable()
export class DebitNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly sequence: SequenceService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly posting: PostingService,
    private readonly determination: AccountDeterminationService,
    private readonly stock: StockService,
  ) {}

  async create(input: CreateDebitNoteInput) {
    const orgId = this.tenant.organizationId;
    if (!input.lines?.length) throw new BadRequestException('At least one line required');
    const partner = await this.prisma.raw.partner.findFirst({
      where: { id: input.partnerId, organizationId: orgId },
    });
    if (!partner) throw new NotFoundException('Partner not found');
    const year = new Date().getUTCFullYear();
    const prefix = input.direction === 'outbound' ? `DBN-OUT-${year}-` : `DBN-IN-${year}-`;
    const noteNumber = await this.sequence.next(`debitnote:${year}`, { prefix, padding: 5 });

    let subtotal = 0;
    const taxAmount = 0;
    for (const ln of input.lines) {
      const lineSubtotal = Number(ln.quantity) * Number(ln.unitPrice);
      subtotal += lineSubtotal;
      // Tax is computed at post time using AccountDeterminationService.
    }

    const note = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.debitNote.create({
        data: {
          organizationId: orgId,
          noteNumber,
          direction: input.direction,
          partnerId: input.partnerId,
          documentId: input.documentId,
          reason: input.reason,
          reasonNote: input.reasonNote,
          issueDate: input.issueDate ? new Date(input.issueDate) : new Date(),
          currencyCode: input.currencyCode ?? 'USD',
          exchangeRate: input.exchangeRate ?? 1,
          subtotal,
          taxAmount: 0,
          totalAmount: subtotal,
          status: 'draft',
          notes: input.notes,
          // RTV warehouse is stashed here (DebitNote has no locationId column) and
          // read back at post time by postSupplierReturn.
          customFields: input.locationId ? { locationId: input.locationId } : {},
          createdBy: this.tenant.userId ?? null,
          lines: {
            create: input.lines.map((ln, idx) => ({
              organizationId: orgId,
              productId: ln.productId ?? null,
              description: ln.description,
              quantity: ln.quantity,
              unitPrice: ln.unitPrice,
              taxId: ln.taxId ?? null,
              subtotal: Number(ln.quantity) * Number(ln.unitPrice),
              total: Number(ln.quantity) * Number(ln.unitPrice),
              lineNumber: idx + 1,
              notes: ln.notes ?? null,
            })),
          },
        },
        include: { lines: true },
      });
      return created;
    });

    await this.audit.record({
      entity: 'DebitNote',
      entityId: note.id,
      action: 'create',
      newValues: { noteNumber, direction: input.direction },
    });
    this.events.publish('debit_note.created' as any, {
      organizationId: orgId,
      noteId: note.id,
      noteNumber,
      direction: input.direction,
    });
    return note;
  }

  async post(id: string) {
    const orgId = this.tenant.organizationId;
    const note = await this.prisma.client.debitNote.findFirst({
      where: { id, organizationId: orgId },
      include: { lines: true, partner: true },
    });
    if (!note) throw new NotFoundException('Debit note not found');
    if (note.status !== 'draft') throw new BadRequestException(`Cannot post debit note in status ${note.status}`);

    // Approval gate (no workflow ⇒ proceeds). Sits before the RTV branch so both
    // paths are gated. Block-and-retry: caller re-posts once approved.
    const amount = note.lines.reduce((s, ln) => s + Number(ln.subtotal), 0);
    const gate = await this.approvals.checkOrRequestApproval({
      entityType: 'debit_note',
      entityId: note.id,
      snapshot: { amount, direction: note.direction, reason: note.reason },
    });
    if (gate?.needsApproval) {
      throw new BadRequestException(
        `Approval required before posting debit note. Pending approval request ${gate.requestId}.`,
      );
    }

    // Return-to-vendor takes a dedicated path: it ships stock back and reverses
    // inventory value, unlike a plain supplier debit note (pure AP/expense adjust).
    if (note.direction === 'inbound' && note.reason === 'returned_goods') {
      return this.postSupplierReturn(note);
    }

    const journalCode = note.direction === 'outbound' ? 'SALES' : 'PURCH';
    const counterAccount =
      note.direction === 'outbound'
        ? await this.determination.receivableAccount(note.partner, this.prisma.client)
        : await this.determination.payableAccount(note.partner, this.prisma.client);
    const lines = note.lines.map((ln) => {
      const amt = Number(ln.subtotal);
      return note.direction === 'outbound'
        ? // Dr AR, Cr Revenue (per line description — uses income account mapping)
          { accountId: counterAccount, debit: amt, partnerId: note.partnerId }
        : // Dr Expense, Cr AP
          { accountId: counterAccount, credit: amt, partnerId: note.partnerId };
    });
    // For the offsetting leg, hit the income/expense account for each line.
    const offsetAccountByLine: Array<{ accountId: string; amount: number }> = [];
    for (const ln of note.lines) {
      // Use AccountDeterminationService via the partner's product category if
      // available; otherwise the default income/expense mapping.
      let accountId: string | null = null;
      if (ln.productId) {
        const product = await this.prisma.raw.product.findFirst({
          where: { id: ln.productId, organizationId: orgId },
          include: { category: true },
        });
        if (product) {
          if (note.direction === 'outbound' && product.category?.incomeAccountId) {
            accountId = product.category.incomeAccountId;
          } else if (note.direction === 'inbound' && product.category?.expenseAccountId) {
            accountId = product.category.expenseAccountId;
          }
        }
      }
      if (!accountId) {
        accountId =
          note.direction === 'outbound'
            ? await this.determination.mapped('sales_revenue')
            : await this.determination.mapped('default_expense');
      }
      offsetAccountByLine.push({ accountId, amount: Number(ln.subtotal) });
    }

    // Build posting lines: aggregate by account.
    const agg = new Map<string, number>();
    for (const l of lines) {
      if (l.debit) agg.set(l.accountId, (agg.get(l.accountId) ?? 0) + Number(l.debit));
      if (l.credit) agg.set(l.accountId, (agg.get(l.accountId) ?? 0) - Number(l.credit));
    }
    for (const o of offsetAccountByLine) {
      agg.set(o.accountId, (agg.get(o.accountId) ?? 0) - o.amount);
    }
    // Emit balanced posting lines: debit legs + credit legs.
    const postingLines: Array<{ accountId: string; debit?: number; credit?: number }> = [];
    for (const l of lines) {
      postingLines.push({ accountId: l.accountId, debit: l.debit, credit: l.credit });
    }
    for (const o of offsetAccountByLine) {
      postingLines.push({ accountId: o.accountId, credit: o.amount });
    }

    await this.posting.post({
      journalCode,
      date: note.issueDate,
      description: `${note.direction === 'outbound' ? 'Debit note to customer' : 'Debit note from supplier'} ${note.noteNumber}`,
      sourceType: 'debit_note',
      sourceId: note.id,
      lines: postingLines,
    });

    const updated = await this.prisma.client.debitNote.update({
      where: { id },
      data: { status: 'posted', postedAt: new Date(), postedById: this.tenant.userId ?? null },
    });
    await this.audit.record({
      entity: 'DebitNote',
      entityId: id,
      action: 'update',
      newValues: { status: 'posted' },
    });
    this.events.publish('debit_note.posted' as any, {
      organizationId: orgId,
      noteId: id,
      direction: note.direction,
      amount: String(Number(note.totalAmount)),
    });
    return updated;
  }

  /**
   * Return-to-vendor (RTV): an inbound debit note with reason `returned_goods`.
   * Physically ships stock back and takes its value out of inventory:
   *   Dr Accounts Payable          (note amount — reduces what we owe the supplier)
   *     Cr Stock Valuation         (stock cost removed — keeps GL == InventoryLedger)
   *     Cr Stock Adj Income        (when the supplier credits more than the goods cost)
   *   [Dr Stock Adj Expense]       (when they credit less than cost)
   * Stock leaves at cost via issue(return_to_supplier, skipGl); this method owns the
   * balanced GL. Whole thing is one transaction so a stock failure can't post a
   * half entry.
   */
  private async postSupplierReturn(note: any) {
    const orgId = this.tenant.organizationId;

    const updated = await this.prisma.client.$transaction(async (tx: any) => {
      const location = await this.resolveReturnLocation(tx, note);
      const apAccount = await this.determination.payableAccount(note.partner, tx);
      const stockValAccount = await this.determination.mapped('stock_valuation', tx);

      const postingLines: Array<{ accountId: string; debit?: string; credit?: string; partnerId?: string }> = [];
      let totalAp = ZERO;

      for (const ln of note.lines as any[]) {
        const price = dec(ln.subtotal);
        const qty = Number(ln.quantity);
        const product = ln.productId
          ? await tx.product.findFirst({ where: { id: ln.productId, organizationId: orgId } })
          : null;
        const isStock =
          !!product && product.trackInventory && (product.productType === 'stockable' || product.productType === 'consumable');

        totalAp = totalAp.plus(price);

        if (isStock && qty > 0 && location) {
          const issueRes = await this.stock.issue(
            {
              productId: ln.productId,
              locationId: location.id,
              quantity: qty,
              moveType: 'return_to_supplier',
              skipGlPosting: true,
              sourceType: 'debit_note',
              sourceId: note.id,
              reference: note.noteNumber,
            } as any,
            tx,
          );
          const cost = dec(issueRes?.totalValue ?? 0);
          if (cost.gt(ZERO)) postingLines.push({ accountId: stockValAccount, credit: cost.toString() });
          // Return variance: supplier credit (price) vs the stock cost removed.
          const variance = price.minus(cost);
          if (variance.gt(ZERO)) {
            postingLines.push({ accountId: await this.determination.mapped('stock_adjustment_income', tx), credit: variance.toString() });
          } else if (variance.lt(ZERO)) {
            postingLines.push({ accountId: await this.determination.mapped('stock_adjustment_expense', tx), debit: variance.negated().toString() });
          }
        } else {
          // Non-stock line on an RTV (e.g. a credited service/fee): reduce expense.
          if (price.gt(ZERO)) postingLines.push({ accountId: await this.determination.mapped('default_expense', tx), credit: price.toString() });
        }
      }

      if (totalAp.gt(ZERO)) {
        postingLines.unshift({ accountId: apAccount, debit: totalAp.toString(), partnerId: note.partnerId });
      }

      await this.posting.post(
        {
          journalCode: 'PURCH',
          date: note.issueDate,
          description: `Return to vendor ${note.noteNumber}`,
          sourceType: 'debit_note',
          sourceId: note.id,
          lines: postingLines,
        } as any,
        tx,
      );

      return tx.debitNote.update({
        where: { id: note.id },
        data: { status: 'posted', postedAt: new Date(), postedById: this.tenant.userId ?? null },
      });
    });

    await this.audit.record({
      entity: 'DebitNote',
      entityId: note.id,
      action: 'update',
      newValues: { status: 'posted', kind: 'return_to_vendor' },
    });
    this.events.publish('debit_note.posted' as any, {
      organizationId: orgId,
      noteId: note.id,
      direction: note.direction,
      amount: String(Number(note.totalAmount)),
    });
    return updated;
  }

  /** RTV source warehouse: the one stashed on the note (customFields.locationId),
   *  else the org's default active warehouse. */
  private async resolveReturnLocation(tx: any, note: any) {
    const stashed = note.customFields && (note.customFields as any).locationId;
    if (stashed) {
      const loc = await tx.inventoryLocation.findFirst({ where: { id: stashed, organizationId: this.tenant.organizationId } });
      if (loc) return loc;
    }
    return tx.inventoryLocation.findFirst({
      where: { organizationId: this.tenant.organizationId, type: 'warehouse', isActive: true },
    });
  }

  async cancel(id: string) {
    const note = await this.prisma.client.debitNote.findFirst({ where: { id, organizationId: this.tenant.organizationId } });
    if (!note) throw new NotFoundException('Debit note not found');
    if (note.status === 'posted') throw new BadRequestException('Cannot cancel a posted debit note; reverse with a credit note');
    return this.prisma.client.debitNote.update({ where: { id }, data: { status: 'cancelled' } });
  }

  list(query: { direction?: string; status?: string }) {
    const where: any = { organizationId: this.tenant.organizationId };
    if (query.direction) where.direction = query.direction;
    if (query.status) where.status = query.status;
    return this.prisma.client.debitNote.findMany({
      where,
      include: { lines: true, partner: { select: { name: true } } },
      orderBy: { issueDate: 'desc' },
      take: 200,
    });
  }

  findOne(id: string) {
    return this.prisma.client.debitNote.findFirst({
      where: { id, organizationId: this.tenant.organizationId },
      include: { lines: true, partner: true },
    });
  }
}
