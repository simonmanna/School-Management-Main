import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';
import { EventBus } from '../../kernel/events/event-bus';
import { AuditService } from '../../kernel/audit/audit.service';
import { ApprovalsService } from '../../kernel/approvals/approvals.service';
import { StockService } from '../inventory/stock.service';
import { StockPostingService } from '../inventory/posting/stock-posting.service';
import { CashSessionService } from '../accounting/treasury/cash-session.service';
import { dec, ZERO } from '../../kernel/common/money';
import type {
  CreatePODto,
  ReceivePODto,
  PayPODto,
  ReceiveLineDto,
  UpdatePODto,
} from './purchase-orders.dto';

@Injectable()
export class PurchaseOrdersService {
  private readonly logger = new Logger('PurchaseOrders');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly sequence: SequenceService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly stock: StockService,
    private readonly stockPosting: StockPostingService,
    private readonly cashSession: CashSessionService,
  ) {}

  // ── Step 1: Register Purchase ──────────────────────────────────────────

  async create(dto: CreatePODto) {
    const orgId = this.tenant.organizationId;
    if (!dto.lines?.length)
      throw new BadRequestException('At least one line required');
    if (!dto.warehouseId)
      throw new BadRequestException('Warehouse is required');

    // Validate warehouse exists
    const warehouse = await this.prisma.raw.inventoryLocation.findFirst({
      where: { id: dto.warehouseId, organizationId: orgId },
    });
    if (!warehouse) throw new NotFoundException('Warehouse not found');

    // Validate partner exists (basic FK guard)
    if (dto.partnerId) {
      const partner = await this.prisma.raw.partner.findFirst({
        where: { id: dto.partnerId, organizationId: orgId },
      });
      if (!partner) throw new NotFoundException('Supplier not found');
    }

    const year = new Date().getUTCFullYear();
    const orderNumber = await this.sequence.next(`po:${year}`, {
      prefix: `PO-${year}-`,
      padding: 5,
    });

    let subtotal = 0;
    let taxAmount = 0;
    for (const ln of dto.lines) {
      const lineSubtotal = Number(ln.quantity) * Number(ln.unitPrice);
      const lineTax = lineSubtotal * (Number(ln.taxRate ?? 0) / 100);
      subtotal += lineSubtotal;
      taxAmount += lineTax;
    }
    const total = subtotal + taxAmount;

    const order = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.purchaseOrder.create({
        data: {
          organizationId: orgId,
          orderNumber,
          partnerId: dto.partnerId,
          branchId: dto.branchId,
          description: dto.description,
          expectedDeliveryDate: dto.expectedDeliveryDate
            ? new Date(dto.expectedDeliveryDate)
            : null,
          currencyCode: dto.currencyCode ?? 'USD',
          exchangeRate: dto.exchangeRate ?? 1,
          subtotal,
          taxAmount,
          totalAmount: total,
          status: 'draft',
          paymentType: dto.paymentType ?? 'cash',
          paymentStatus: dto.paymentType === 'credit' ? 'not_paid' : null,
          notes: dto.notes,
          terms: dto.terms,
          requestId: dto.requestId,
          createdBy: this.tenant.userId ?? null,
          lines: {
            create: dto.lines.map((ln, idx) => ({
              organizationId: orgId,
              productId: ln.productId ?? null,
              description: ln.description,
              quantity: ln.quantity,
              unitOfMeasureId: ln.unitOfMeasureId ?? null,
              unitPrice: ln.unitPrice,
              taxId: ln.taxId ?? null,
              taxRate: ln.taxRate ?? 0,
              subtotal: Number(ln.quantity) * Number(ln.unitPrice),
              lineNumber: idx + 1,
              notes: ln.notes ?? null,
            })),
          },
        },
        include: { lines: true },
      });

      // Approval gate: if an active policy exists, the PO stays in draft
      // pending approval. Otherwise it auto-approves to active.
      const approvalResult = await this.approvals.requestApproval({
        entityType: 'purchase_order',
        entityId: created.id,
        snapshot: {
          amount: total,
          partnerId: dto.partnerId,
          orderNumber,
          createdBy: this.tenant.userId,
        },
      });

      if (!approvalResult) {
        // No policy → auto-approve, PO becomes active immediately
        await tx.purchaseOrder.update({
          where: { id: created.id },
          data: { status: 'active' },
        });
        created.status = 'active';
      } else {
        await this.audit.recordInTx(tx, {
          entity: 'PurchaseOrder',
          entityId: created.id,
          action: 'create',
          newValues: {
            orderNumber,
            totalAmount: total,
            approvalRequestId: approvalResult.id,
            status: 'draft',
          },
        });
      }

      return created;
    });

    await this.audit.record({
      entity: 'PurchaseOrder',
      entityId: order.id,
      action: 'create',
      newValues: { orderNumber, totalAmount: total, paymentType: dto.paymentType },
    });
    this.events.publish('purchase_order.created' as any, {
      organizationId: orgId,
      orderId: order.id,
      orderNumber,
      partnerId: dto.partnerId,
    });
    return order;
  }

  // ── Listing & detail ───────────────────────────────────────────────────

  async list(query: {
    status?: string;
    paymentType?: string;
    paymentStatus?: string;
    partnerId?: string;
    search?: string;
    page?: number;
    pageSize?: number;
    dateFrom?: string;
    dateTo?: string;
  }) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 25));
    const where: any = { organizationId: this.tenant.organizationId };
    if (query.status) where.status = query.status;
    if (query.paymentType) where.paymentType = query.paymentType;
    if (query.paymentStatus) where.paymentStatus = query.paymentStatus;
    if (query.partnerId) where.partnerId = query.partnerId;
    if (query.search) {
      where.OR = [
        { orderNumber: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
        { paymentType: { contains: query.search, mode: 'insensitive' } },
        { paymentStatus: { contains: query.search, mode: 'insensitive' } },
        { status: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.dateFrom) {
      where.orderDate = { ...(where.orderDate || {}), gte: new Date(query.dateFrom) };
    }
    if (query.dateTo) {
      const end = new Date(query.dateTo);
      end.setHours(23, 59, 59, 999);
      where.orderDate = { ...(where.orderDate || {}), lte: end };
    }
    const [data, total] = await Promise.all([
      this.prisma.client.purchaseOrder.findMany({
        where,
        include: { partner: { select: { id: true, name: true } } },
        orderBy: { orderDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.purchaseOrder.count({ where }),
    ]);
    return { data, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  findOne(id: string) {
    return this.prisma.client.purchaseOrder.findFirst({
      where: { id, organizationId: this.tenant.organizationId },
      include: {
        lines: true,
        receipts: { include: { lines: true } },
        payments: true,
        request: true,
      },
    });
  }

  // ── Step 2: Receive Products ───────────────────────────────────────────

  /**
   * Apply a set of received lines to a purchase order inside an existing tx:
   * hard over-receipt block, bump each PO line's receivedQuantity, and recompute
   * the PO status — all under optimistic locks. The single source of truth for
   * "receive against a PO", shared by the PO-driven receive() and the standalone
   * goods-receipt post() so the two can never diverge (the bug this fixes: post()
   * used to stock the warehouse while leaving the PO at 0 received, letting the
   * same goods be received again).
   *
   * Lines are matched to PO lines by explicit purchaseOrderLineId, else by the
   * first PO line with the same productId. Lines that match nothing are ignored
   * here (they still receive stock) — only matched lines move the PO.
   */
  async applyReceiptToPO(
    tx: any,
    purchaseOrderId: string,
    lines: Array<{ purchaseOrderLineId?: string; productId?: string; quantity: number; description?: string }>,
  ): Promise<{ status: string }> {
    const orgId = this.tenant.organizationId;
    const po = await tx.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, organizationId: orgId },
      include: { lines: true },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status === 'cancelled')
      throw new BadRequestException('Cannot receive against a cancelled PO');
    if (po.status === 'received')
      throw new BadRequestException('PO is fully received');
    if (!['active', 'partially_received'].includes(po.status))
      throw new BadRequestException(`PO is in status "${po.status}" — cannot receive`);

    const poLines = new Map<string, any>(po.lines.map((l: any) => [l.id, l]));
    const poLinesByProduct = new Map<string, any>(
      po.lines.filter((l: any) => l.productId).map((l: any) => [l.productId, l]),
    );
    const resolve = (ln: { purchaseOrderLineId?: string; productId?: string }): string | null => {
      if (ln.purchaseOrderLineId) {
        if (!poLines.has(ln.purchaseOrderLineId))
          throw new BadRequestException(`PO line ${ln.purchaseOrderLineId} not found`);
        return ln.purchaseOrderLineId;
      }
      if (ln.productId) {
        const match = poLinesByProduct.get(ln.productId);
        if (match) return match.id;
      }
      return null;
    };

    // Aggregate by PO line: two receipt lines can map to one PO line, and the
    // optimistic version lock means each line may be updated only once per tx.
    const addByLine = new Map<string, number>();
    for (const ln of lines) {
      const lineId = resolve(ln);
      if (!lineId) continue;
      addByLine.set(lineId, (addByLine.get(lineId) ?? 0) + Number(ln.quantity));
    }

    // Over-receipt is a hard block (no tolerance) — check every affected line first.
    for (const [lineId, adding] of addByLine) {
      const poLine = poLines.get(lineId)!;
      const ordered = Number(poLine.quantity);
      const already = Number(poLine.receivedQuantity);
      if (already + adding > ordered) {
        throw new BadRequestException(
          `Over-receiving PO line "${poLine.description}": ordered ${ordered}, already received ${already}, trying to receive ${adding}`,
        );
      }
    }

    for (const [lineId, adding] of addByLine) {
      const poLine = poLines.get(lineId)!;
      const updated = await tx.purchaseOrderLine.updateMany({
        where: { id: lineId, version: poLine.version },
        data: { receivedQuantity: { increment: adding }, version: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw new BadRequestException(
          `PO line "${poLine.description}" was modified by another user. Please refresh and try again.`,
        );
      }
    }

    const allLines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId } });
    const fullyReceived = allLines.every(
      (l: any) => Number(l.receivedQuantity) >= Number(l.quantity),
    );
    const newStatus = fullyReceived ? 'received' : 'partially_received';
    const updatedPo = await tx.purchaseOrder.updateMany({
      where: { id: purchaseOrderId, organizationId: orgId, version: po.version },
      data: { status: newStatus, version: { increment: 1 } },
    });
    if (updatedPo.count === 0) {
      throw new BadRequestException(
        'Purchase order was modified by another user. Please refresh and try again.',
      );
    }
    return { status: newStatus };
  }

  async receive(id: string, dto: ReceivePODto) {
    const orgId = this.tenant.organizationId;

    if (!dto.warehouseId)
      throw new BadRequestException('Warehouse is required for receiving stock');
    if (!dto.lines?.length)
      throw new BadRequestException('At least one line required');

    const warehouse = await this.prisma.raw.inventoryLocation.findFirst({
      where: { id: dto.warehouseId, organizationId: orgId },
    });
    if (!warehouse) throw new NotFoundException('Warehouse not found');

    // Load PO with lines (must include version for optimistic locking)
    const po = await this.prisma.client.purchaseOrder.findFirst({
      where: { id, organizationId: orgId },
      include: { lines: true },
    });
    if (!po) throw new NotFoundException('Purchase order not found');

    // Guard: PO must be active or partially received
    if (po.status === 'cancelled')
      throw new BadRequestException('Cannot receive against a cancelled PO');
    if (po.status === 'received')
      throw new BadRequestException('PO is fully received');
    if (!['active', 'partially_received'].includes(po.status))
      throw new BadRequestException(
        `PO is in status "${po.status}" — cannot receive`,
      );

    // Cache PO lines by ID AND productId for fast lookup
    const poLines = new Map(po.lines.map((l) => [l.id, l]));
    const poLinesByProduct = new Map(
      po.lines.filter((l) => l.productId).map((l) => [l.productId!, l]),
    );

    // Resolve the effective PO line ID for each receive line
    function resolvePOLineId(rln: ReceiveLineDto): string | null {
      if (rln.purchaseOrderLineId) {
        if (!poLines.has(rln.purchaseOrderLineId))
          throw new BadRequestException(
            `PO line ${rln.purchaseOrderLineId} not found`,
          );
        return rln.purchaseOrderLineId;
      }
      if (rln.productId) {
        const match = poLinesByProduct.get(rln.productId);
        if (match) return match.id;
      }
      return null;
    }

    // Resolve once and attach back so both loops use the same resolution.
    // `_unitCost` falls back to the ordered price when the client omits a cost:
    // receiving at 0 would post a zero-value GL entry (inventory never
    // capitalised) and permanently dilute the product's moving average.
    const resolvedLines = dto.lines.map((rln) => {
      const resolvedLineId = resolvePOLineId(rln);
      const poLine = resolvedLineId ? poLines.get(resolvedLineId) : undefined;
      return {
        ...rln,
        _resolvedLineId: resolvedLineId,
        _unitCost: rln.unitCost ?? (poLine ? Number(poLine.unitPrice) : undefined),
      };
    });

    // Over-receipt is validated inside applyReceiptToPO (within the tx below).

    // Generate GRN number
    const year = new Date().getUTCFullYear();
    const receiptNumber = await this.sequence.next(`grn:${year}`, {
      prefix: `GRN-${year}-`,
      padding: 5,
    });

    // Everything in ONE transaction — stock, GRN, PO status, PO lines
    const result = await this.prisma.client.$transaction(async (tx) => {
      // 1. Create GRN (draft)
      const grn = await tx.goodsReceiptNote.create({
        data: {
          organizationId: orgId,
          receiptNumber,
          purchaseOrderId: id,
          partnerId: po.partnerId,
          branchId: po.branchId,
          warehouseId: dto.warehouseId,
          receivedAt: dto.receivedAt
            ? new Date(dto.receivedAt)
            : new Date(),
          status: 'draft',
          notes: dto.notes,
          createdBy: this.tenant.userId ?? null,
          lines: {
            create: resolvedLines.map((rln, idx) => ({
              organizationId: orgId,
              purchaseOrderLineId: rln._resolvedLineId,
              productId: rln.productId ?? null,
              description: rln.description,
              quantity: rln.quantity,
              unitCost: rln._unitCost ?? 0,
              batchNumber: rln.batchNumber ?? null,
              expiryDate: rln.expiryDate
                ? new Date(rln.expiryDate)
                : null,
              notes: rln.notes ?? null,
              lineNumber: idx + 1,
            })),
          },
        },
        include: { lines: true },
      });

      // 2. Advance the PO: over-receipt block + receivedQuantity + status, all
      //    under optimistic locks. Shared with the standalone goods-receipt
      //    post() so "receive against a PO" has exactly one implementation.
      const { status: newStatus } = await this.applyReceiptToPO(
        tx,
        id,
        resolvedLines.map((r) => ({
          purchaseOrderLineId: r._resolvedLineId ?? undefined,
          productId: r.productId ?? undefined,
          quantity: Number(r.quantity),
          description: r.description,
        })),
      );

      // 3. Post GRN
      await tx.goodsReceiptNote.update({
        where: { id: grn.id },
        data: {
          status: 'posted',
          postedAt: new Date(),
          postedById: this.tenant.userId ?? null,
        },
      });

      // 4. Issue stock-in for each line (only stockable products).
      //    receiveForDocument (not receive) so the receipt capitalises into
      //    inventory: Dr Stock Valuation / Cr GRNI, atomic in this tx, and the
      //    ledger row carries goods_receipt:<grnId> for traceability.
      // Accumulate the value actually capitalised, plus its input tax, so the
      // voucher entry below credits AP with exactly what GRNI was credited.
      let receiptNet = ZERO;
      let receiptTax = ZERO;

      for (const rln of resolvedLines) {
        if (!rln.productId) continue;
        const product = await tx.product.findFirst({
          where: { id: rln.productId, organizationId: orgId },
        });
        if (!product) continue;
        // Last-resort cost when the line matched no PO line and carried no cost.
        const unitCost = rln._unitCost ?? Number(product.costPrice ?? 0);
        const received = await this.stock.receiveForDocument(
          {
            productId: rln.productId,
            locationId: dto.warehouseId,
            quantity: Number(rln.quantity),
            unitCost,
            uomId: product.purchaseUomId ?? undefined,
            batchNumber: rln.batchNumber,
            expiryDate: rln.expiryDate ? new Date(rln.expiryDate) : undefined,
            reference: `GRN ${receiptNumber}`,
          } as any,
          {
            sourceType: 'goods_receipt',
            sourceId: grn.id,
            date: dto.receivedAt ? new Date(dto.receivedAt) : new Date(),
          },
          tx,
        );
        const lineNet = dec(received.totalValue);
        const poLine = rln._resolvedLineId ? poLines.get(rln._resolvedLineId) : undefined;
        const taxRate = poLine ? dec(poLine.taxRate ?? 0) : ZERO;
        receiptNet = receiptNet.plus(lineNet);
        receiptTax = receiptTax.plus(lineNet.times(taxRate).dividedBy(100));
      }

      // 4b. Voucher the receipt to the supplier: Dr GRNI + Dr Input Tax / Cr AP.
      //     Closes the accrual postReceipt raised, so a received PO leaves
      //     Dr Inventory + Dr Input Tax / Cr AP and GRNI back at zero.
      await this.stockPosting.postReceiptVoucher({
        partnerId: po.partnerId,
        netTotal: receiptNet,
        taxTotal: receiptTax,
        date: dto.receivedAt ? new Date(dto.receivedAt) : new Date(),
        sourceType: 'goods_receipt',
        sourceId: grn.id,
        description: `Goods received ${receiptNumber} · PO ${po.orderNumber}`,
        tx,
      });

      // (PO status already advanced by applyReceiptToPO in step 2.)

      // 7. If cash purchase, auto-settle payment. Only settle the portion just
      //    received (goods can arrive across several partial receipts), so the
      //    cash out never exceeds what has been vouchered to AP.
      if (po.paymentType === 'cash') {
        const settleAmount = receiptNet.plus(receiptTax);
        if (settleAmount.gt(ZERO)) {
          await tx.purchaseOrder.update({
            where: { id },
            data: {
              totalPaid: { increment: settleAmount.toNumber() },
              paymentStatus:
                dec(po.totalPaid).plus(settleAmount).gte(dec(po.totalAmount)) ? 'paid' : 'partial',
            },
          });
          await tx.purchasePayment.create({
            data: {
              organizationId: orgId,
              purchaseOrderId: id,
              amount: settleAmount.toNumber(),
              paidAt: new Date(),
              paidById: this.tenant.userId ?? null,
              reference: `auto:GRN ${receiptNumber}`,
            },
          });
          // GL: Dr AP / Cr Cash — relieve the payable the voucher just raised.
          await this.stockPosting.postPurchasePayment({
            partnerId: po.partnerId,
            amount: settleAmount,
            method: 'cash',
            date: dto.receivedAt ? new Date(dto.receivedAt) : new Date(),
            sourceType: 'purchase_order',
            sourceId: id,
            description: `Cash purchase ${po.orderNumber} · GRN ${receiptNumber}`,
            tx,
          });
          // Drawer artifact (best-effort): record the pay-out on an open session
          // so the till's expected cash reflects the withdrawal. GL already done.
          const session = await this.cashSession.findOpen();
          if (session) {
            await this.cashSession.recordExternalPayOut(
              tx, session.id, settleAmount, `Cash purchase PO ${po.orderNumber}`,
            );
          }
        }
      }

      // F3 fix: write the audit row inside the TX so an audit failure rolls
      // the whole receive back (and we never end up with a GRN that no audit
      // row references).
      await this.audit.recordInTx(tx, {
        entity: 'PurchaseOrder',
        entityId: id,
        action: 'receive',
        newValues: {
          receiptNumber,
          status: newStatus,
          linesReceived: dto.lines.length,
        },
      });

      return { grn, status: newStatus };
    });

    this.events.publish('purchase_order.received' as any, {
      organizationId: orgId,
      orderId: id,
      receiptNumber,
      status: result.status,
    });

    return result;
  }

  // ── Step 3: Register Payment (credit purchases only) ───────────────────

  async pay(id: string, dto: PayPODto) {
    const orgId = this.tenant.organizationId;
    const po = await this.requireOwned(id);

    if (po.paymentType !== 'credit')
      throw new BadRequestException(
        'Only credit purchases can accept manual payments',
      );
    if (po.status === 'cancelled')
      throw new BadRequestException('Cannot pay a cancelled PO');

    const amount = dto.amount ?? Number(po.totalAmount) - Number(po.totalPaid);
    if (amount <= 0)
      throw new BadRequestException('Payment amount must be positive');

    const remaining = Number(po.totalAmount) - Number(po.totalPaid);
    if (amount > remaining) {
      throw new BadRequestException(
        `Payment of ${amount} exceeds remaining balance of ${remaining}`,
      );
    }

    const newTotalPaid = Number(po.totalPaid) + amount;
    const newPaymentStatus =
      newTotalPaid >= Number(po.totalAmount) ? 'paid' : 'partial';

    const result = await this.prisma.client.$transaction(async (tx) => {
      // 1. Record payment
      const payment = await tx.purchasePayment.create({
        data: {
          organizationId: orgId,
          purchaseOrderId: id,
          amount,
          paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
          paidById: this.tenant.userId ?? null,
          reference: dto.reference ?? null,
          notes: dto.notes ?? null,
        },
      });

      // 2. Update PO totalPaid and paymentStatus
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          totalPaid: newTotalPaid,
          paymentStatus: newPaymentStatus,
          version: { increment: 1 },
        },
      });

      // 3. GL: Dr AP / Cr Cash|Bank — relieve the payable the receipt vouchered.
      //    Bank is the default for a manual credit-PO settlement.
      const method = dto.method ?? 'bank';
      await this.stockPosting.postPurchasePayment({
        partnerId: po.partnerId,
        amount,
        method,
        date: dto.paidAt ? new Date(dto.paidAt) : new Date(),
        sourceType: 'purchase_order',
        sourceId: id,
        description: `Payment PO ${po.orderNumber}${dto.reference ? ` · ${dto.reference}` : ''}`,
        tx,
      });
      // Cash method: also record the drawer pay-out (best-effort, no GL — the
      // journal above owns the cash credit).
      if (method === 'cash') {
        const session = await this.cashSession.findOpen(dto.cashRegisterId);
        if (session) {
          await this.cashSession.recordExternalPayOut(
            tx, session.id, dec(amount), `Payment PO ${po.orderNumber}`,
          );
        }
      }

      // F3 fix: write the audit row inside the TX so an audit failure rolls
      // the whole payment back.
      await this.audit.recordInTx(tx, {
        entity: 'PurchaseOrder',
        entityId: id,
        action: 'update',
        newValues: {
          paymentStatus: newPaymentStatus,
          amountPaid: amount,
          method,
        },
      });

      return payment;
    });

    this.events.publish('purchase_order.paid' as any, {
      organizationId: orgId,
      orderId: id,
      amount,
    });

    return result;
  }

  // ── Cancel (simple flow: no approval needed) ───────────────────────────

  async update(id: string, dto: UpdatePODto) {
    return this.prisma.client.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findFirst({ where: { id, organizationId: this.tenant.organizationId } });
      if (!po) throw new NotFoundException('Purchase order not found');
      if (po.status !== 'active')
        throw new BadRequestException('Only active POs can be updated');

      // F4 fix: bump `version` so concurrent updates race-serialise instead of
      // last-write-wins.
      const updated = await tx.purchaseOrder.updateMany({
        where: { id, organizationId: this.tenant.organizationId, version: po.version },
        data: {
          description: dto.description,
          expectedDeliveryDate: dto.expectedDeliveryDate
            ? new Date(dto.expectedDeliveryDate)
            : null,
          notes: dto.notes,
          terms: dto.terms,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new BadRequestException(
          'Purchase order was modified by another user. Please refresh and try again.',
        );
      }
      return tx.purchaseOrder.findFirst({ where: { id } });
    });
  }

  async cancel(id: string, reason?: string) {
    return this.prisma.client.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findFirst({ where: { id, organizationId: this.tenant.organizationId } });
      if (!po) throw new NotFoundException('Purchase order not found');
      if (['received', 'cancelled', 'billed', 'closed'].includes(po.status))
        throw new BadRequestException(`Cannot cancel PO in status ${po.status}`);

      // F4 fix: bump `version` + run inside a TX so concurrent cancel/receive/activate
      // calls don't race the status flip.
      const updated = await tx.purchaseOrder.updateMany({
        where: { id, organizationId: this.tenant.organizationId, version: po.version },
        data: {
          status: 'cancelled',
          notes: reason ?? po.notes,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new BadRequestException(
          'Purchase order was modified by another user. Please refresh and try again.',
        );
      }
      const cancelled = await tx.purchaseOrder.findFirst({ where: { id } });
      this.events.publish('purchase_order.cancelled' as any, {
        organizationId: this.tenant.organizationId,
        orderId: id,
        reason: reason ?? '',
      });
      return cancelled;
    });
  }

  // ── Delete (draft PO only) ─────────────────────────────────────────────

  async remove(id: string) {
    const po = await this.requireOwned(id);
    if (po.status === 'received' || po.status === 'cancelled') {
      throw new BadRequestException(
        'Cannot delete a received or cancelled PO',
      );
    }
    await this.prisma.client.purchaseOrder.delete({ where: { id } });
    return { ok: true };
  }

  // ── Submit (approval gate) ────────────────────────────────────────────

  /**
   * Activate a draft PO after approval is granted (or if no approval is needed).
   * Called after the approval request (if any) has been decided.
   */
  async activate(id: string) {
    const po = await this.requireOwned(id);
    if (po.status !== 'draft')
      throw new BadRequestException(`Only draft POs can be activated, current status: ${po.status}`);

    // Check there's no pending approval request
    const pending = await this.prisma.raw.approvalRequest.findFirst({
      where: {
        organizationId: this.tenant.organizationId,
        entityType: 'purchase_order',
        entityId: id,
        status: 'pending',
      },
    });
    if (pending) {
      throw new ForbiddenException(
        'This purchase order is awaiting approval. Approve or reject the request first.',
      );
    }

    const updated = await this.prisma.client.purchaseOrder.update({
      where: { id },
      data: {
        status: 'active',
        approvedAt: new Date(),
        approvedById: this.tenant.userId ?? null,
      },
    });

    await this.audit.record({
      entity: 'PurchaseOrder',
      entityId: id,
      action: 'approve',
      newValues: { status: 'active' },
    });

    this.events.publish('purchase_order.activated' as any, {
      organizationId: this.tenant.organizationId,
      orderId: id,
      orderNumber: po.orderNumber,
    });

    return updated;
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private async requireOwned(id: string) {
    const order = await this.prisma.client.purchaseOrder.findFirst({
      where: { id, organizationId: this.tenant.organizationId },
    });
    if (!order) throw new NotFoundException('Purchase order not found');
    return order;
  }
}
