/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BadRequestException, ConflictException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { EVENTS } from '@erp/shared';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { EventBus } from '../../kernel/events/event-bus';
import { SequenceService } from '../../kernel/sequence/sequence.service';
import { DocumentBuilderService } from '../invoicing/document/document-builder.service';
import { WorkflowService } from '../../kernel/workflow/workflow.service';
import { PosInvoiceService } from '../pos/billing/pos-invoice.service';
import { dec } from '../../kernel/common/money';
import type {
  AddOrderItemsDto, BillOrderDto, CancelOrderDto, CreateOrderDto,
  SaveOrderItemsDto, UpdateOrderHeaderDto, UpdateOrderSettingsDto,
} from './dto/orders.dto';
import type { OrderLineInputDto } from './dto/orders.dto';
import type { OrderLineSource } from './dto/orders.dto';

/** A cart line ready for the tax engine (menu OR product source). */
interface ResolvedLine {
  productId: string | null;
  menuItemId: string | null;
  description: string;
  quantity: number;
  /** null/undefined = let the engine resolve from the catalog (salesPrice / menu basePrice). */
  unitPrice?: number | null;
  taxId: string | null;
  discountPercent: number;
  discountType?: 'percentage' | 'fixed_amount';
  discountAmount?: number;
  discountReason?: string | null;
  note: string | null;
  taxInclusive: boolean | undefined;
}

/**
 * Generic back-office Orders service. No terminal coupling (no tables/KDS/cash
 * sessions/merge-split): a plain operational order document over the shared
 * `Order` aggregate. Pricing runs through the DocumentBuilder tax engine, so
 * menu-item and product lines price identically and authoritative totals always
 * come from the server.
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger('OrdersService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly sequence: SequenceService,
    private readonly builder: DocumentBuilderService,
    private readonly workflows: WorkflowService,
    private readonly billing: PosInvoiceService,
  ) {}

  // ─── Line-source configuration (org-scoped) ─────────────────────────────────

  /**
   * Resolve the line source for the Orders pages. Explicit config wins;
   * `auto` derives from the POS module's `posMode` (cafe → menus, retail →
   * products). Copy of the posMode config pattern (pos.service.ts).
   */
  async getOrderSettings(): Promise<{ lineSource: OrderLineSource; resolved: 'menu' | 'products' | 'both'; posMode: string }> {
    const orgId = this.tenant.organizationId;
    const [ordersMod, posMod] = await Promise.all([
      this.prisma.client.organizationModule.findUnique({
        where: { organizationId_moduleName: { organizationId: orgId, moduleName: 'orders' } },
      }),
      this.prisma.client.organizationModule.findUnique({
        where: { organizationId_moduleName: { organizationId: orgId, moduleName: 'pos' } },
      }),
    ]);
    const lineSource: OrderLineSource = (ordersMod?.config as Record<string, unknown> | undefined)?.lineSource as OrderLineSource ?? 'auto';
    const posMode = String((posMod?.config as Record<string, unknown> | undefined)?.posMode ?? 'cafe');
    const resolved = lineSource !== 'auto' ? lineSource : (posMode === 'retail' || posMode === 'rental' ? 'products' : 'menu');
    return { lineSource, resolved, posMode };
  }

  async updateOrderSettings(dto: UpdateOrderSettingsDto): Promise<{ lineSource: OrderLineSource }> {
    const orgId = this.tenant.organizationId;
    const existing = await this.prisma.client.organizationModule.findUnique({
      where: { organizationId_moduleName: { organizationId: orgId, moduleName: 'orders' } },
    });
    const config = { ...((existing?.config as Record<string, unknown>) ?? {}), ...dto };
    await this.prisma.client.organizationModule.upsert({
      where: { organizationId_moduleName: { organizationId: orgId, moduleName: 'orders' } },
      update: { config: config as any },
      create: { organizationId: orgId, moduleName: 'orders', isActive: true, config: config as any },
    });
    // Mirror as a Setting so offline devices see it via sync pull (pos.mode parity).
    if (dto.lineSource) {
      await this.prisma.client.setting.upsert({
        where: {
          organizationId_scopeType_scopeId_key: {
            organizationId: orgId, scopeType: 'organization', scopeId: '', key: 'orders.lineSource',
          },
        },
        update: { value: dto.lineSource },
        create: {
          organizationId: orgId, scope: 'organization', scopeType: 'organization', scopeId: '',
          key: 'orders.lineSource', value: dto.lineSource,
        },
      });
    }
    return { lineSource: (dto.lineSource ?? config.lineSource) as OrderLineSource };
  }

  // ─── Queries ───────────────────────────────────────────────────────────────

  /** Paginated list mirroring the invoicing CRUD shape `{ rows, total }`. */
  async list(filter: {
    page?: number; pageSize?: number; search?: string;
    status?: string; orderType?: string; transactionKind?: string;
    dateFrom?: string; dateTo?: string;
  }) {
    const orgId = this.tenant.organizationId;
    const page = Math.max(1, Number(filter.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(filter.pageSize) || 25));

    const where: any = { organizationId: orgId };
    if (filter.status) where.status = filter.status;
    if (filter.orderType) where.orderType = filter.orderType;
    if (filter.transactionKind) where.transactionKind = filter.transactionKind;
    if (filter.dateFrom || filter.dateTo) {
      const dateFilter: any = {};
      if (filter.dateFrom) dateFilter.gte = new Date(filter.dateFrom);
      if (filter.dateTo) {
        const end = new Date(filter.dateTo);
        end.setHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }
      where.openedAt = dateFilter;
    }
    if (filter.search?.trim()) {
      const search = filter.search.trim();
      const matchingPartners = await this.prisma.client.partner.findMany({
        where: { organizationId: orgId, name: { contains: search, mode: 'insensitive' } },
        select: { id: true },
      });
      const pIds = matchingPartners.map((p: any) => p.id);
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        ...(pIds.length ? [{ partnerId: { in: pIds } }] : []),
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.client.order.findMany({
        where,
        orderBy: { openedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.order.count({ where }),
    ]);

    // Resolve partner names (loose refs → second pass, like the invoicing list).
    const partnerIds = [...new Set((rows as any[]).map((o: any) => o.partnerId).filter(Boolean))];
    const partners = partnerIds.length
      ? await this.prisma.client.partner.findMany({ where: { id: { in: partnerIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(partners.map((p: any) => [p.id, p.name]));

    const data = (rows as any[]).map((o: any) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      orderType: o.orderType,
      transactionKind: o.transactionKind,
      partnerId: o.partnerId,
      partnerName: o.partnerId ? (nameById.get(o.partnerId) ?? null) : null,
      openedAt: o.openedAt,
      totalAmount: Number(o.totalAmount),
      invoiceId: o.invoiceId,
    }));
    return { rows: data, total, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  async getOrder(orderId: string) {
    const orgId = this.tenant.organizationId;
    const order = await this.prisma.client.order.findFirst({
      where: { id: orderId, organizationId: orgId },
      include: { items: { where: { cancelled: false }, orderBy: { lineNumber: 'asc' }, include: { modifiers: true } }, invoice: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    return this.decorate(order);
  }

  // ─── Mutations ─────────────────────────────────────────────────────────────

  async createOrder(dto: CreateOrderDto) {
    const orgId = this.tenant.organizationId;
    const resolved: ResolvedLine[] = (dto.lines ?? []).map((l) => this.toResolved(l));

    return this.prisma.client.$transaction(async (tx: any) => {
      const orderNumber = await this.nextOrderNumber(tx);
      // Mirror POS: orders always carry a customer — billing/AR require partnerId.
      const partnerId = dto.partnerId ?? (await this.ensureWalkInCustomer(tx, orgId));
      const created = await tx.order.create({
        data: {
          organizationId: orgId,
          orderNumber,
          orderType: dto.orderType ?? 'takeaway',
          status: 'confirmed',
          transactionKind: dto.transactionKind ?? 'sale',
          partnerId,
          branchId: dto.branchId ?? null,
          guestCount: dto.guestCount ?? null,
          notes: dto.notes ?? null,
          paymentTermId: dto.paymentTermId ?? null,
          paymentMethod: dto.paymentMethod ?? null,
          openedAt: dto.openedAt ? new Date(dto.openedAt) : undefined,
          createdBy: this.tenant.userId ?? null,
        },
      });
      if (resolved.length) await this.writeItems(tx, created.id, resolved);
      const fresh = await this.reload(tx, created.id);
      this.events.publish(EVENTS.PosOrderCreated, {
        organizationId: orgId, orderId: created.id, orderNumber,
      });
      await this.audit.recordInTx(tx, {
        entity: 'Order', entityId: created.id, action: 'create',
        newValues: { orderNumber, lineCount: resolved.length },
      });
      return this.decorate(fresh);
    });
  }

  async updateHeader(orderId: string, dto: UpdateOrderHeaderDto) {
    const orgId = this.tenant.organizationId;
    const existing = await this.prisma.client.order.findFirst({ where: { id: orderId, organizationId: orgId } });
    if (!existing) throw new NotFoundException('Order not found');
    this.assertEditable(existing);
    const updated = await this.prisma.client.order.update({
      where: { id: orderId },
      data: {
        orderType: dto.orderType ?? existing.orderType,
        partnerId: dto.partnerId !== undefined ? dto.partnerId : existing.partnerId,
        guestCount: dto.guestCount !== undefined ? dto.guestCount : existing.guestCount,
        notes: dto.notes !== undefined ? dto.notes : existing.notes,
        paymentTermId: dto.paymentTermId !== undefined ? dto.paymentTermId : existing.paymentTermId,
        paymentMethod: dto.paymentMethod !== undefined ? dto.paymentMethod : existing.paymentMethod,
        openedAt: dto.openedAt ? new Date(dto.openedAt) : existing.openedAt,
        updatedBy: this.tenant.userId ?? null,
      },
    });
    await this.audit.record({ entity: 'Order', entityId: orderId, action: 'update', newValues: { ...dto } });
    return this.decorate(updated);
  }

  /** Replace the whole item set (auto-save semantics, like the POS order panel). */
  async saveItems(orderId: string, dto: SaveOrderItemsDto) {
    const orgId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const order = await tx.order.findFirst({ where: { id: orderId, organizationId: orgId } });
      if (!order) throw new NotFoundException('Order not found');
      this.assertEditable(order);
      this.assertVersion(order, dto.expectedVersion);
      await this.writeItems(tx, orderId, dto.lines.map((l) => this.toResolved(l)), { replace: true });
      const fresh = await this.reload(tx, orderId);
      this.events.publish(EVENTS.PosOrderUpdated, { organizationId: orgId, orderId, version: fresh.version });
      await this.audit.recordInTx(tx, { entity: 'Order', entityId: orderId, action: 'update', newValues: { kind: 'save_items', lineCount: fresh.items.length } });
      return this.decorate(fresh);
    });
  }

  /** Append lines to the existing item set. */
  async addItems(orderId: string, dto: AddOrderItemsDto) {
    const orgId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const order = await tx.order.findFirst({ where: { id: orderId, organizationId: orgId } });
      if (!order) throw new NotFoundException('Order not found');
      this.assertEditable(order);
      await this.writeItems(tx, orderId, dto.lines.map((l) => this.toResolved(l)), { append: true });
      const fresh = await this.reload(tx, orderId);
      this.events.publish(EVENTS.PosOrderUpdated, { organizationId: orgId, orderId, version: fresh.version });
      return this.decorate(fresh);
    });
  }

  /** Cancel the whole order (only while un-billed). */
  async cancelOrder(orderId: string, reason?: string) {
    const orgId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const order = await this.lockOrder(tx, orderId);
      if (order.invoiceId) throw new ConflictException('Order already billed — refund/void the invoice instead');
      if (order.status === 'cancelled' || order.status === 'closed') return order;
      // The workflow engine validates the transition and writes status +
      // cancelledAt/By, the AuditLog row and the domain event (ADR-007).
      await this.workflows.transition({
        entityType: 'order', entityId: orderId, action: 'cancel',
        entity: order, payload: { reason: reason ?? null }, externalTx: tx,
      });
      const updated = await tx.order.update({
        where: { id: orderId },
        data: { cancelReason: reason ?? null, version: { increment: 1 } },
      });
      this.events.publish(EVENTS.PosOrderCancelled, { organizationId: orgId, orderId, reason });
      return this.decorate(updated);
    });
  }

  /** Reopen a cancelled order (un-billed only). */
  async reopenOrder(orderId: string) {
    const orgId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const order = await this.lockOrder(tx, orderId);
      if (order.invoiceId) throw new ConflictException('Billed orders cannot be reopened');
      if (order.status !== 'cancelled') throw new BadRequestException('Only a cancelled order can be reopened');
      await this.workflows.transition({
        entityType: 'order', entityId: orderId, action: 'reopen', entity: order, externalTx: tx,
      });
      const updated = await tx.order.update({
        where: { id: orderId },
        data: { cancelledAt: null, cancelReason: null, cancelledBy: null, version: { increment: 1 } },
      });
      return this.decorate(updated);
    });
  }

  /** Bill the order through the shared spine: deduct stock, post AR. */
  async generateInvoice(orderId: string, dto: BillOrderDto = {}) {
    return this.billing.generateInvoice(orderId, dto as any);
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  /** ORD-YYYYMMDD-NNNNNN on the SHARED sequence key — unique across POS orders. */
  private async nextOrderNumber(tx: any): Promise<string> {
    const d = new Date();
    const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    return this.sequence.next(`order:${ymd}`, { prefix: `ORD-${ymd}-`, padding: 6 }, tx);
  }

  /** Walk-in customer fallback — same partner row POS orders use (code WALKIN). */
  private async ensureWalkInCustomer(tx: any, orgId: string): Promise<string> {
    const existing = await tx.partner.findFirst({ where: { organizationId: orgId, code: 'WALKIN' } });
    if (existing) return existing.id;
    const created = await tx.partner.create({
      data: { organizationId: orgId, code: 'WALKIN', name: 'Walk-in Customer', isCustomer: true, isCompany: false },
    });
    return created.id;
  }

  private toResolved(l: OrderLineInputDto): ResolvedLine {
    return {
      productId: l.productId ?? null,
      menuItemId: l.menuItemId ?? null,
      description: l.description ?? '',
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      taxId: l.taxId ?? null,
      discountPercent: l.discountPercent ?? 0,
      discountType: l.discountType,
      discountAmount: l.discountAmount,
      discountReason: l.discountReason ?? null,
      note: l.note ?? null,
      taxInclusive: l.taxInclusive,
    };
  }

  /**
   * Back-office lines may arrive as bare loose refs (menuItemId OR productId
   * with no client-side price/name — the picker doesn't know merchant prices).
   * Resolve missing metadata server-side from the catalog BEFORE the tax
   * engine runs, so both sources price identically:
   *  - menuItemId → MenuItem.name / basePrice / taxId
   *  - productId  → Product.name (price is resolved by the engine's salesPrice
   *    fallback; a client-sent unitPrice still wins)
   */
  private async resolveCatalog(tx: any, lines: ResolvedLine[]): Promise<void> {
    const menuIds = [...new Set(lines.map((l) => l.menuItemId).filter((x): x is string => !!x))];
    if (menuIds.length) {
      const menus: Array<{ id: string; name: string | null; basePrice: number | null; taxId: string | null }> =
        await tx.menuItem.findMany({
          where: { id: { in: menuIds } },
          select: { id: true, name: true, basePrice: true, taxId: true },
        });
      const byId = new Map(menus.map((m) => [m.id, m]));
      for (const l of lines) {
        const m = l.menuItemId ? byId.get(l.menuItemId) : undefined;
        if (!m) continue;
        if (!l.description) l.description = m.name ?? '';
        if (l.unitPrice == null) l.unitPrice = m.basePrice != null ? Number(m.basePrice) : 0;
        if (!l.taxId && m.taxId) l.taxId = m.taxId;
      }
    }

    const productIds = [...new Set(lines.map((l) => l.productId).filter((x): x is string => !!x))];
    if (productIds.length) {
      const products: Array<{ id: string; name: string | null }> =
        await tx.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, name: true },
        });
      const byId = new Map(products.map((p) => [p.id, p]));
      for (const l of lines) {
        const p = l.productId ? byId.get(l.productId) : undefined;
        if (p && !l.description) l.description = p.name ?? '';
      }
    }
  }

  /**
   * Persist resolved lines as OrderItems and recompute the order header totals.
   * Both line sources (productId for retail, menuItemId for menus) pass through
   * the same DocumentBuilder tax-engine pricing.
   */
  private async writeItems(
    tx: any,
    orderId: string,
    resolved: ResolvedLine[],
    opts: { replace?: boolean; append?: boolean } = {},
  ): Promise<void> {
    const orgId = this.tenant.organizationId;
    let baseline: ResolvedLine[] = [];
    if (opts.append) {
      const existing = await tx.orderItem.findMany({ where: { orderId, cancelled: false }, orderBy: { lineNumber: 'asc' } });
      baseline = existing.map((it: any) => ({
        productId: it.productId, menuItemId: it.menuItemId, description: it.description,
        quantity: Number(it.quantity), unitPrice: Number(it.unitPrice), taxId: it.taxId,
        discountPercent: Number(it.discountPercent), discountType: it.discountType,
        discountAmount: Number(it.discountAmount), discountReason: it.discountReason,
        note: it.note, taxInclusive: it.taxInclusive,
      }));
    }
    const all = [...baseline, ...resolved];

    // Server-side catalog resolution for bare loose refs (menu pick / product pick).
    await this.resolveCatalog(tx, all);

    // Price through the tax engine for authoritative subtotal/tax/total.
    const totals = await this.builder.prepareLines(tx, all.map((l) => ({
      productId: l.productId ?? undefined,
      menuItemId: l.menuItemId ?? undefined,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice ?? undefined,
      taxId: l.taxId ?? undefined,
      discountPercent: l.discountPercent,
      discountType: l.discountType,
      discountAmount: l.discountAmount,
      discountReason: l.discountReason ?? undefined,
      discountSource: 'manual' as const,
      taxInclusive: l.taxInclusive,
    })));

    if (opts.replace || opts.append) {
      await tx.orderItem.deleteMany({ where: { orderId } });
    }

    for (let i = 0; i < totals.prepared.length; i++) {
      const p = totals.prepared[i];
      const src = all[i];
      await tx.orderItem.create({
        data: {
          organizationId: orgId,
          orderId,
          productId: p.productId,
          menuItemId: p.menuItemId,
          description: p.description,
          quantity: p.quantity,
          unitPrice: p.unitPrice,
          discountPercent: p.discountPercent,
          discountType: (p as any).discountType ?? 'percentage',
          discountAmount: (p as any).discountAmount ?? 0,
          discountReason: (p as any).discountReason ?? null,
          taxId: p.taxId,
          taxInclusive: p.taxInclusive,
          note: src?.note ?? null,
          lineNumber: p.lineNumber,
        },
      });
    }

    const totalAmount = dec(totals.total);
    await tx.order.update({
      where: { id: orderId },
      data: {
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxAmount: totals.taxAmount,
        totalAmount,
        version: { increment: 1 },
      },
    });
  }

  private async reload(tx: any, orderId: string) {
    return tx.order.findFirst({
      where: { id: orderId },
      include: { items: { where: { cancelled: false }, orderBy: { lineNumber: 'asc' }, include: { modifiers: true } }, invoice: true },
    });
  }

  private async lockOrder(tx: any, orderId: string) {
    const orgId = this.tenant.organizationId;
    await tx.$queryRawUnsafe(`SELECT id FROM "Order" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE`, orderId, orgId);
    const order = await tx.order.findFirst({ where: { id: orderId, organizationId: orgId } });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  private assertEditable(order: any): void {
    if (order.invoiceId) throw new ConflictException('Order is already billed and cannot be edited');
    if (order.status === 'cancelled') throw new ConflictException('Order is cancelled');
    if (order.status === 'closed') throw new ConflictException('Order is closed');
  }

  private assertVersion(order: any, expected?: number): void {
    if (expected != null && order.version !== expected) {
      throw new ConflictException(`Order was modified by someone else (expected v${expected}, found v${order.version}). Reload and retry.`);
    }
  }

  /** Attach resolved partner/table/waiter names for display. */
  private async decorate(order: any) {
    const o = { ...order };
    const ids: string[] = [o.partnerId, o.waiterId, o.tableId].filter(Boolean);
    const nameById = new Map<string, string>();
    if (ids.length) {
      const partners = await this.prisma.client.partner.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
      for (const p of partners) nameById.set(p.id, p.name);
    }
    o.partnerName = o.partnerId ? (nameById.get(o.partnerId) ?? null) : null;
    o.waiterName = o.waiterId ? (nameById.get(o.waiterId) ?? null) : null;
    o.tableName = o.tableId ? (nameById.get(o.tableId) ?? null) : null;
    o.subtotal = Number(o.subtotal);
    o.discountTotal = Number(o.discountTotal);
    o.taxAmount = Number(o.taxAmount);
    o.totalAmount = Number(o.totalAmount);
    o.items = (o.items ?? []).map((it: any) => ({ ...it, quantity: Number(it.quantity), unitPrice: Number(it.unitPrice), discountPercent: Number(it.discountPercent), discountAmount: Number(it.discountAmount) }));
    return o;
  }
}