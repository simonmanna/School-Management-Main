/**
 * POS P5 — Kitchen Display System.
 *
 * A sale creates one KitchenTicket per (station) in pos.checkout. The KDS
 * page polls /pos/kds/tickets?station=BAR or subscribes to the SSE stream
 * at /pos/kds/stream?station=BAR for real-time updates.
 *
 * Lifecycle:
 *   new (created at sale time, shown in KDS)
 *   ↓
 *   preparing (kitchen taps "Start")
 *   ↓
 *   ready    (kitchen taps "Ready" — optional audio chime on the KDS page)
 *   ↓
 *   served   (runner / customer picks it up)
 *
 * Items are stored as denormalised JSON in the KitchenTicket row so the
 * KDS renders without N+1 joins.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../kernel/events/event-bus';
import { EVENTS } from '@erp/shared';
import { AuditService } from '../../kernel/audit/audit.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';

export type KdsPriority = 'normal' | 'rush' | 'vip';

export interface KdsTicketItem {
  productId: string;
  productName: string;
  quantity: number;
  modifiers: Array<{ name: string; kitchenPrintName?: string | null; priceDelta?: number }>;
  notes: string | null;
  /** Configurable KitchenStation.code (was the fixed bar/kitchen/cafe enum). */
  station: string;
  variantName?: string;
  accompanimentNames?: string[];
  /** Prep-time hint (minutes) for expected-ready display. */
  prepTime?: number | null;
  /** Course grouping (1=starter, 2=main, …) for fire/hold display. */
  course?: number | null;
}

export interface KdsTicket {
  id: string;
  invoiceId: string;
  label: string;
  /** Short kitchen queue number (K-001). */
  ticketNo: string | null;
  station: string;
  status: 'new' | 'preparing' | 'ready' | 'served' | 'cancelled';
  priority: KdsPriority;
  orderType: string | null;
  items: KdsTicketItem[];
  startedAt: string | null;
  readyAt: string | null;
  servedAt: string | null;
  startedBy: string | null;
  readyBy: string | null;
  assignedTo: string | null;
  recallCount: number;
  recallReason: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class PosKdsService {
  private readonly logger = new Logger(PosKdsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly sequence: SequenceService,
  ) {}

  /** K-### daily-reset queue number. New sequence key per day → restarts at 1. */
  private async nextTicketNo(): Promise<string> {
    const d = new Date();
    const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    try {
      return await this.sequence.next(`kds_ticket:${ymd}`, { prefix: 'K-', padding: 3 });
    } catch (e: any) {
      this.logger.warn(`KDS ticket number allocation failed: ${e?.message}`);
      return '';
    }
  }

  /**
   * Create one ticket per distinct station that has items. Called from
   * pos.checkout after the invoice posts. Returns the created ticket ids.
   */
  async createTicketsForSale(args: {
    invoiceId?: string;
    /** POS Order→Invoice split: the operational Order that fired these tickets. */
    orderId?: string;
    label: string;
    /** Denormalised Order.orderType (dine_in/takeaway/delivery) for a screen tag. */
    orderType?: string | null;
    /** Initial urgency (defaults to normal). */
    priority?: KdsPriority;
    items: KdsTicketItem[];
  }): Promise<string[]> {
    // Group items by station.
    const groups = new Map<string, KdsTicketItem[]>();
    for (const it of args.items) {
      const arr = groups.get(it.station) ?? [];
      arr.push(it);
      groups.set(it.station, arr);
    }
    const orgId = this.tenant.organizationId;
    const ids: string[] = [];
    for (const [station, items] of groups) {
      const ticketNo = await this.nextTicketNo();
      const ticket = await this.prisma.client.kitchenTicket.create({
        data: {
          organizationId: orgId,
          invoiceId: args.invoiceId ?? null,
          orderId: args.orderId ?? null,
          label: args.label,
          ticketNo: ticketNo || null,
          station,
          status: 'new',
          priority: (args.priority ?? 'normal') as any,
          orderType: args.orderType ?? null,
          items: items as any,
        },
      });
      ids.push(ticket.id);
      this.events.publish('pos.kds.ticket_created' as any, {
        organizationId: orgId,
        ticketId: ticket.id,
        station,
      });
    }
    return ids;
  }

  /**
   * Pre-payment "Send To Kitchen" — creates tickets from cart items before
   * the sale is settled. Looks up each product's station from the DB and
   * groups tickets by station.
   */
  async createTicketsFromCart(args: {
    label: string;
    tableId?: string;
    items: Array<{
      productId: string;
      productName: string;
      quantity?: number;
      notes?: string | null;
      variantName?: string;
      accompanimentNames?: string[];
      modifiers?: Array<{ name: string; kitchenPrintName?: string | null; priceDelta?: number }>;
    }>;
  }): Promise<string[]> {
    const orgId = this.tenant.organizationId;

    // P5 — KOT reprint guard: if a tableId is provided, check whether any of
    // the items have already been kitchen-printed. If so, refuse the reprint.
    if (args.tableId) {
      const tableOrder = await this.prisma.client.posTableOrder.findFirst({
        where: { tableId: args.tableId, organizationId: orgId, closedAt: null },
        include: { order: { include: { items: { select: { productId: true, kitchenPrintCount: true } } } } },
      });
      if (tableOrder?.order?.items) {
        const printedProductIds = new Set(
          tableOrder.order.items
            .filter((l: any) => (l.kitchenPrintCount ?? 0) > 0)
            .map((l: any) => l.productId),
        );
        if (printedProductIds.size > 0) {
          const alreadyPrinted = args.items.filter((it) => printedProductIds.has(it.productId));
          if (alreadyPrinted.length > 0) {
            throw new BadRequestException(
              `KOT cannot be reprinted. Items already sent to kitchen for table: ${alreadyPrinted.map((i) => i.productName).join(', ')}. Use the order panel to add new items.`,
            );
          }
        }
      }
    }

    // Batch-lookup product stations.
    const productIds = [...new Set(args.items.map((i) => i.productId))];
    const products = await this.prisma.client.product.findMany({
      where: { id: { in: productIds }, organizationId: orgId },
      select: { id: true, station: true },
    });
    const stationMap = new Map(products.map((p) => [p.id, (p as any).station ?? 'cafe']));

    const kdsItems: KdsTicketItem[] = args.items.map((it) => ({
      productId: it.productId,
      productName: it.productName,
      quantity: Math.max(1, Number(it.quantity ?? 1)),
      modifiers: (it.modifiers ?? []).map((m) => ({ name: m.name, kitchenPrintName: (m as any).kitchenPrintName ?? null, priceDelta: Number(m.priceDelta) })),
      notes: it.notes ?? null,
      station: stationMap.get(it.productId) ?? 'cafe',
      variantName: it.variantName,
      accompanimentNames: it.accompanimentNames,
    }));
    return this.createTicketsForSale({
      label: args.label,
      items: kdsItems,
    });
  }

  /** List tickets for a station, newest first. */
  async listTickets(station?: string, status?: string): Promise<KdsTicket[]> {
    const orgId = this.tenant.organizationId;
    const tickets = await this.prisma.client.kitchenTicket.findMany({
      where: {
        organizationId: orgId,
        ...(station ? { station } : {}),
        ...(status ? { status: status as any } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return (tickets as any[]).map(this.serialize);
  }

  async getTicket(id: string): Promise<KdsTicket> {
    const orgId = this.tenant.organizationId;
    const t = await this.prisma.client.kitchenTicket.findFirst({ where: { id, organizationId: orgId } });
    if (!t) throw new NotFoundException('KDS ticket not found');
    return this.serialize(t);
  }

  async transition(
    id: string,
    action: 'start' | 'ready' | 'serve' | 'cancel' | 'recall',
    reason?: string,
  ): Promise<KdsTicket> {
    const orgId = this.tenant.organizationId;
    const t = await this.prisma.client.kitchenTicket.findFirst({ where: { id, organizationId: orgId } });
    if (!t) throw new NotFoundException('KDS ticket not found');
    const now = new Date();
    const userId = this.tenant.userId ?? null;

    // M6 — enforce the lifecycle new → preparing → ready → served; any live
    // state may be cancelled; a ready ticket may be RECALLED back to preparing.
    const ALLOWED: Record<string, string[]> = {
      new: ['preparing', 'cancelled'],
      preparing: ['ready', 'cancelled'],
      ready: ['served', 'preparing', 'cancelled'], // preparing here = recall
      served: [],
      cancelled: [],
    };

    const data: any = {};
    let nextStatus: string;
    switch (action) {
      case 'start': nextStatus = 'preparing'; data.startedAt = now; data.startedBy = userId; break;
      case 'ready': nextStatus = 'ready'; data.readyAt = now; data.readyBy = userId; break;
      case 'serve': nextStatus = 'served'; data.servedAt = now; break;
      case 'cancel': nextStatus = 'cancelled'; break;
      case 'recall':
        if (t.status !== 'ready') throw new BadRequestException('Only a ready ticket can be recalled');
        nextStatus = 'preparing';
        data.readyAt = null; data.readyBy = null;
        data.recallCount = { increment: 1 };
        data.recallReason = reason ?? null;
        break;
      default: throw new BadRequestException('Invalid KDS action');
    }
    if (!(ALLOWED[t.status as string] ?? []).includes(nextStatus)) {
      throw new BadRequestException(`Cannot ${action} a ${t.status} ticket`);
    }
    data.status = nextStatus;
    const updated = await this.prisma.client.kitchenTicket.update({ where: { id }, data });

    // Business facts (Phase A). The kitchen is a fulfillment strategy: it
    // reports progress INTO the order, it does not model the order's state.
    // Emitted here rather than derived from the columns below because those
    // columns are lossy — `readyAt`/`kitchenCompletedAt` are NULLED on recall,
    // so the history is destroyed the moment a ticket is sent back.
    if (t.orderId) {
      const fulfillmentFact = {
        organizationId: orgId,
        orderId: t.orderId,
        strategy: 'kitchen',
        documentType: 'kitchen_ticket',
        documentId: id,
        station: t.station,
        ...(reason ? { reason } : {}),
      };
      if (action === 'start') {
        this.events.publish(EVENTS.FulfillmentStarted, fulfillmentFact);
      } else if (nextStatus === 'ready' || nextStatus === 'served') {
        this.events.publish(EVENTS.FulfillmentCompleted, { ...fulfillmentFact, kdsStatus: nextStatus });
      }
    }

    // NOTE: the former "sync kitchen timestamps onto the parent Order" block
    // (Order.kitchenStartedAt/By, kitchenCompletedAt/By) was removed here. Those
    // columns had two writers and zero readers, and the recall path NULLED them,
    // destroying history. The kitchen timeline is now the fulfillment facts above,
    // projected as milestones (Phase B). The columns are dropped by the P1.6
    // cleanup migration.
    await this.audit.record({
      entity: 'KitchenTicket',
      entityId: id,
      action: 'update' as any,
      newValues: { kdsAction: action, status: nextStatus, ...(reason ? { reason } : {}) },
    });
    this.events.publish('pos.kds.ticket_updated' as any, {
      organizationId: orgId,
      ticketId: id,
      action,
      status: nextStatus,
    });
    return this.serialize(updated);
  }

  /** Advance many tickets at once (peak-hour "Mark Ready"). Skips illegal moves. */
  async bulkTransition(
    ids: string[],
    action: 'start' | 'ready' | 'serve' | 'cancel' | 'recall',
    reason?: string,
  ): Promise<{ updated: KdsTicket[]; skipped: string[] }> {
    const updated: KdsTicket[] = [];
    const skipped: string[] = [];
    for (const id of ids) {
      try {
        updated.push(await this.transition(id, action, reason));
      } catch {
        skipped.push(id);
      }
    }
    return { updated, skipped };
  }

  /** Set ticket urgency (rush/vip/normal). */
  async setPriority(id: string, priority: KdsPriority): Promise<KdsTicket> {
    const orgId = this.tenant.organizationId;
    const t = await this.prisma.client.kitchenTicket.findFirst({ where: { id, organizationId: orgId } });
    if (!t) throw new NotFoundException('KDS ticket not found');
    const updated = await this.prisma.client.kitchenTicket.update({ where: { id }, data: { priority: priority as any } });
    await this.audit.record({ entity: 'KitchenTicket', entityId: id, action: 'update' as any, newValues: { priority } });
    this.events.publish('pos.kds.ticket_updated' as any, { organizationId: orgId, ticketId: id, action: 'priority', status: t.status });
    return this.serialize(updated);
  }

  /** Claim / assign a ticket to a chef (userId), or clear with null. */
  async assignChef(id: string, chefUserId: string | null): Promise<KdsTicket> {
    const orgId = this.tenant.organizationId;
    const t = await this.prisma.client.kitchenTicket.findFirst({ where: { id, organizationId: orgId } });
    if (!t) throw new NotFoundException('KDS ticket not found');
    const updated = await this.prisma.client.kitchenTicket.update({ where: { id }, data: { assignedTo: chefUserId } });
    this.events.publish('pos.kds.ticket_updated' as any, { organizationId: orgId, ticketId: id, action: 'assign', status: t.status });
    return this.serialize(updated);
  }

  /**
   * SSE stream. Emits one `data: {json}\n\n` snapshot every second. Lightweight
   * polling — the cashier terminal is the only thing writing, and the
   * KDS page is one of at most 3 monitors (bar, kitchen, cafe), so the
   * load is trivial.
   */
  async streamTickets(res: Response, station?: string): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(`retry: 5000\n\n`);

    let alive = true;
    const send = async () => {
      if (!alive) return;
      try {
        const tickets = await this.listTickets(station);
        res.write(`data: ${JSON.stringify({ type: 'snapshot', tickets })}\n\n`);
      } catch (e: any) { this.logger.warn(`KDS stream ticket fetch failed: ${e?.message}`); }
    };
    await send();
    const id = setInterval(send, 1_000);

    res.on('close', () => {
      alive = false;
      clearInterval(id);
    });
  }

  private serialize = (t: any): KdsTicket => ({
    id: t.id,
    invoiceId: t.invoiceId,
    label: t.label,
    ticketNo: t.ticketNo ?? null,
    station: t.station,
    status: t.status,
    priority: (t.priority ?? 'normal') as KdsPriority,
    orderType: t.orderType ?? null,
    items: Array.isArray(t.items) ? t.items : [],
    startedAt: t.startedAt?.toISOString?.() ?? null,
    readyAt: t.readyAt?.toISOString?.() ?? null,
    servedAt: t.servedAt?.toISOString?.() ?? null,
    startedBy: t.startedBy ?? null,
    readyBy: t.readyBy ?? null,
    assignedTo: t.assignedTo ?? null,
    recallCount: t.recallCount ?? 0,
    recallReason: t.recallReason ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  });
}