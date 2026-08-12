/**
 * POS Phase T1 — Tables Management (ADR-012).
 *
 * A PosTable is a physical seat (e.g. "Table 7 / VIP 01"). It carries
 * lifecycle metadata (status, seats, zone, layout geometry) and is linked
 * to:
 *   - `PosTableOrder`        — the live Document being rung up on it
 *   - `PosTableReservation`  — a booking for a future time window
 *
 * Money still flows through `Document` / `Payment` / `KitchenTicket`. These
 * three PosTable* tables are operational metadata only and never hold
 * monetary amounts.
 *
 * Concurrency: every status-changing endpoint runs in a Prisma transaction
 * with a row-level `SELECT … FOR UPDATE` lock on the table so concurrent
 * merge / transfer / seat calls cannot race. Conflicts return 409.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { EventBus } from '../../kernel/events/event-bus';
import { DocumentBuilderService } from '../invoicing/document/document-builder.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';
import { recomputeTableStatus, TABLE_HELD_ORDER_STATUSES, isTableHeldOrderStatus } from './table-status.util';
import { WorkflowService } from '../../kernel/workflow/workflow.service';
import { PosTableZonesService } from './pos-table-zones.service';
import { EVENTS } from '@erp/shared';

// ─── DTOs ──────────────────────────────────────────────────────────────────

export interface CreateTableDto {
  name: string;
  number: number;
  seats?: number;
  /** Key of a PosTableZone (dining area) — validated against the org's catalog. */
  zone?: string;
  shape?: 'square' | 'rectangle' | 'circle';
  posX?: number;
  posY?: number;
  width?: number;
  height?: number;
  notes?: string;
  active?: boolean;
  assignedWaiterId?: string;
  sortOrder?: number;
  qrCodeUrl?: string;
}

export interface UpdateTableDto extends Partial<CreateTableDto> {}

export interface SetStatusDto {
  status: 'available' | 'occupied' | 'reserved' | 'out_of_service' | 'cleaning';
  reason?: string;
}

export interface AssignWaiterDto {
  waiterId: string | null;
}

@Injectable()
export class PosTablesService {
  private readonly logger = new Logger('PosTablesService');
  private readonly sseClients = new Set<Response>();
  private readonly SSE_SAFETY_NET_MS = 30_000;
  private sseTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly builder: DocumentBuilderService,
    private readonly sequence: SequenceService,
    private readonly zones: PosTableZonesService,
    private readonly workflows: WorkflowService,
  ) {
    const relevant = [
      EVENTS.PosTableCreated,
      EVENTS.PosTableUpdated,
      EVENTS.PosTableDeleted,
      EVENTS.PosTableStatusChanged,
      EVENTS.PosTableMerged,
      EVENTS.PosTableUnmerged,
      EVENTS.PosTableTransferred,
      EVENTS.PosTableSplit,
      EVENTS.PosTableCleaned,
      EVENTS.PosTableReservationCreated,
      EVENTS.PosTableReservationSeated,
      EVENTS.PosTableReservationCancelled,
      EVENTS.PosTableReservationNoShow,
      EVENTS.PosOrderCreated,
      EVENTS.PosOrderClosed,
      EVENTS.PosOrderInvoiced,
    ] as const;
    for (const evt of relevant) {
      this.events.subscribe(evt, () => this.pushToAll());
    }
  }

  /**
   * Sync table status based on open orders count - single source of truth.
   * - open orders > 0 → occupied
   * - open orders = 0 → available
   * out_of_service is preserved (admin override).
   * Called in same transaction as order create/close.
   */
  async syncTableStatus(
    tableId: string,
    tx: any = this.prisma.client,
  ): Promise<'available' | 'occupied' | 'reserved' | 'out_of_service' | 'cleaning'> {
    // Delegates to the single item-derived invariant (shared with the Order and
    // Invoice services) so transfer / merge / split all free or occupy the table
    // from the same rule: OCCUPIED iff ≥1 active order item, else AVAILABLE.
    const status = await recomputeTableStatus(tx, tableId);
    if (status === null) throw new NotFoundException('Table not found');
    return status;
  }

  // ─── Order helpers (tab lives on Order, not Document) ─────────────────────

  /** ORD-YYYYMMDD-NNNNNN sequence (mirrors PosOrdersService.nextOrderNumber). */
  private async nextOrderNumberTx(tx: any): Promise<string> {
    const d = new Date();
    const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    return this.sequence.next(`order:${ymd}`, { prefix: `ORD-${ymd}-`, padding: 6 }, tx);
  }

  /** Open a fresh tab Order for a table + its PosTableOrder link (in-tx). */
  private async createTabOrderInTx(
    tx: any,
    args: { tableId: string; partnerId: string; branchId?: string | null; orderType?: 'dine_in' | 'takeaway' | 'delivery' },
  ): Promise<any> {
    const orgId = this.tenant.organizationId;
    const orderNumber = await this.nextOrderNumberTx(tx);
    const order = await tx.order.create({
      data: {
        organizationId: orgId,
        orderNumber,
        orderType: args.orderType ?? 'dine_in',
        status: 'confirmed',
        tableId: args.tableId,
        partnerId: args.partnerId,
        waiterId: this.tenant.userId ?? null,
        branchId: args.branchId ?? null,
        createdBy: this.tenant.userId ?? null,
      },
    });
    await tx.posTableOrder.create({ data: { organizationId: orgId, tableId: args.tableId, orderId: order.id } });
    return order;
  }

  /**
   * Replace an order's items with `inputs` (priced through the tax engine) and
   * refresh its header totals. `modsList[i]` maps 1:1 onto `inputs[i]` (prepareLines
   * preserves order). Kitchen lifecycle is preserved by productId. Order-based
   * analogue of the former Document `rebuildDraftLines` + `attachLineModifiers`.
   */
  private async rebuildOrderItems(
    tx: any,
    organizationId: string,
    orderId: string,
    inputs: Array<{
      productId?: string; menuItemId?: string; description: string;
      quantity: number; unitPrice: number; taxId?: string; discountPercent: number; taxInclusive?: boolean;
    }>,
    modsList: Array<Array<{ modifierId: string | null; name: string; priceDelta: any }>> = [],
  ): Promise<void> {
    const oldItems = await tx.orderItem.findMany({
      where: { orderId },
      select: {
        productId: true, kitchenPrintCount: true, kitchenLastPrintedAt: true, kitchenPrintedQty: true,
        cancelPrintCount: true, cancelLastPrintedAt: true, lastKitchenPrintedById: true, kitchenStatus: true,
      },
    });
    const lifecycleByProductId = new Map<string, any>();
    for (const o of oldItems) if (o.productId) lifecycleByProductId.set(o.productId, o);

    const totals = await this.builder.prepareLines(tx, inputs);
    await tx.orderItem.deleteMany({ where: { orderId } });
    for (let i = 0; i < totals.prepared.length; i++) {
      const p = totals.prepared[i];
      const lc = p.productId ? lifecycleByProductId.get(p.productId) : null;
      const item = await tx.orderItem.create({
        data: {
          organizationId,
          orderId,
          productId: p.productId,
          menuItemId: p.menuItemId,
          variantId: p.variantId ?? undefined,
          variantName: p.variantName ?? undefined,
          description: p.description,
          quantity: p.quantity,
          unitPrice: p.unitPrice,
          discountPercent: p.discountPercent,
          taxId: p.taxId,
          taxInclusive: p.taxInclusive,
          lineNumber: p.lineNumber,
          kitchenStatus: lc?.kitchenStatus ?? 'pending',
          kitchenPrintCount: lc?.kitchenPrintCount ?? 0,
          kitchenLastPrintedAt: lc?.kitchenLastPrintedAt ?? null,
          kitchenPrintedQty: lc?.kitchenPrintedQty ?? null,
          cancelPrintCount: lc?.cancelPrintCount ?? 0,
          cancelLastPrintedAt: lc?.cancelLastPrintedAt ?? null,
          lastKitchenPrintedById: lc?.lastKitchenPrintedById ?? null,
        },
      });
      const mods = modsList[i];
      if (mods?.length) {
        await tx.orderItemModifier.createMany({
          data: mods.map((m) => ({ organizationId, orderItemId: item.id, modifierId: m.modifierId ?? null, name: m.name, priceDelta: m.priceDelta ?? 0 })),
        });
      }
    }
    await tx.order.update({
      where: { id: orderId },
      data: {
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxAmount: totals.taxAmount,
        totalAmount: totals.total,
        version: { increment: 1 },
      },
    });
  }

  // ─── Queries ─────────────────────────────────────────────────────────────

  /**
   * Self-heal the derived invariant: free any table stuck OCCUPIED that has no
   * active dine-in items left (occupancy left over from before the item-derived
   * rule shipped, an abandoned order, or a crash mid-flow). One-directional —
   * we only FREE here; occupying is always done synchronously by the order
   * mutation path (create/add/save), so this can never race a just-opened tab
   * to available. `reserved` / `out_of_service` are overrides and never touched.
   *
   * Runs on the floor-map fetch, so the map converges to the truth every poll
   * without a manual backfill. Three cheap set-based queries, no per-table loop;
   * steady state writes nothing (the updateMany matches no rows).
   */
  private async reconcileStuckTables(organizationId: string): Promise<void> {
    const held = await this.prisma.client.order.findMany({
      where: {
        status: { in: TABLE_HELD_ORDER_STATUSES as any },
        tableId: { not: null },
        items: { some: { cancelled: false } },
      },
      select: { tableId: true },
      distinct: ['tableId'],
    });
    const occupiedIds = held.map((o: any) => o.tableId).filter(Boolean) as string[];
    await this.prisma.client.posTable.updateMany({
      where: {
        organizationId,
        status: 'occupied',
        ...(occupiedIds.length ? { id: { notIn: occupiedIds } } : {}),
      },
      data: { status: 'available' },
    });
  }

  async list(filter: { status?: string; zone?: string; active?: boolean } = {}) {
    const organizationId = this.tenant.organizationId;
    // Converge stored status to the item-derived truth before returning the map.
    await this.reconcileStuckTables(organizationId).catch((e) =>
      this.logger.warn(`table reconcile skipped: ${String((e as any)?.message ?? e)}`),
    );
    const zoneMap = await this.zones.mapForOrganization(organizationId);
    const tables = await this.prisma.client.posTable.findMany({
          where: {
            organizationId,
            ...(filter.status ? { status: filter.status as any } : {}),
            ...(filter.zone ? { zone: filter.zone as any } : {}),
            ...(filter.active === undefined ? {} : { active: filter.active }),
          },
          orderBy: [{ sortOrder: 'asc' }, { number: 'asc' }],
          include: {
        orders: {
          where: { closedAt: null },
          include: {
            order: {
              select: {
                id: true,
                orderNumber: true,
                totalAmount: true,
                status: true,
                billPrintCount: true,
                billLastPrintedAt: true,
              },
            },
          },
        },
        reservations: {
          where: { status: { in: ['pending', 'seated'] } },
          orderBy: { startAt: 'asc' },
        },
      },
    });
    return tables.map((t: any) => ({
      ...t,
      zoneName: zoneMap.get(t.zone)?.name ?? t.zone,
      zoneColor: zoneMap.get(t.zone)?.color ?? null,
    }));
  }

  async get(id: string) {
    const organizationId = this.tenant.organizationId;
    const table = await this.prisma.client.posTable.findFirst({
      where: { id, organizationId },
      include: {
        orders: {
          orderBy: { openedAt: 'desc' },
          take: 50,
          include: {
            order: {
              select: {
                id: true,
                orderNumber: true,
                totalAmount: true,
                status: true,
                createdAt: true,
                billPrintCount: true,
                billLastPrintedAt: true,
              },
            },
          },
        },
        reservations: {
          orderBy: { startAt: 'desc' },
          take: 50,
        },
        mergedInto: { select: { id: true, number: true, name: true } },
      },
    });
    if (!table) throw new NotFoundException('Table not found');
    const zoneMap = await this.zones.mapForOrganization(organizationId);
    return {
      ...table,
      zoneName: zoneMap.get(table.zone)?.name ?? table.zone,
      zoneColor: zoneMap.get(table.zone)?.color ?? null,
    };
  }

  /** Aggregate counters used by the terminal top bar. */
  async stats() {
    const organizationId = this.tenant.organizationId;
    const groups = await this.prisma.client.posTable.groupBy({
      by: ['status'],
      where: { organizationId, active: true },
      _count: { _all: true },
    });
    const out: Record<string, number> = {
      total: 0,
      available: 0,
      occupied: 0,
      reserved: 0,
      out_of_service: 0,
      cleaning: 0,
    };
    for (const g of groups) {
      out.total += g._count._all;
      out[g.status] = g._count._all;
    }
    const denom = out.total - out.out_of_service;
    out.occupancyPct = denom > 0 ? Math.round(((out.occupied + out.reserved) / denom) * 100) : 0;
    return out;
  }

  // ─── Mutations ───────────────────────────────────────────────────────────

  /**
   * Resolve a requested zone key against the org's catalog. Lazy-seeds the
   * default zones first (orgs created before configurable zones shipped), then
   * returns the canonical key or throws 400 listing the available zones.
   */
  private async resolveZoneKey(organizationId: string, requested?: string): Promise<string> {
    await this.zones.ensureDefaults(organizationId);
    const wanted = requested?.trim().toLowerCase() || 'indoor';
    const zone = await this.zones.resolveKey(organizationId, wanted);
    if (zone) return zone.key;
    const available = await this.prisma.client.posTableZone.findMany({
      where: { organizationId, deletedAt: null, active: true },
      select: { key: true, name: true },
      orderBy: { sortOrder: 'asc' },
    });
    const list = available.map((z) => `${z.key} (${z.name})`).join(', ') || 'none';
    throw new BadRequestException(`Unknown zone "${wanted}" — available zones: ${list}`);
  }

  async create(dto: CreateTableDto) {
    const organizationId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    if (!dto.name?.trim()) throw new BadRequestException('Table name is required');
    if (!Number.isInteger(dto.number)) throw new BadRequestException('Table number is required');
    const zoneKey = await this.resolveZoneKey(organizationId, dto.zone);
    try {
      const created = await this.prisma.client.$transaction(async (tx: any) => {
        const t = await tx.posTable.create({
          data: {
            name: dto.name.trim(),
            number: dto.number,
            seats: dto.seats ?? 2,
            zone: zoneKey,
            shape: dto.shape ?? 'square',
            posX: dto.posX ?? 40,
            posY: dto.posY ?? 40,
            width: dto.width ?? 120,
            height: dto.height ?? 120,
            notes: dto.notes ?? null,
            active: dto.active ?? true,
            assignedWaiterId: dto.assignedWaiterId ?? null,
            sortOrder: dto.sortOrder ?? 0,
            qrCodeUrl: dto.qrCodeUrl ?? null,
          },
        });
        await this.audit.recordInTx(tx, {
          entity: 'PosTable',
          entityId: t.id,
          action: 'create',
          newValues: { name: t.name, number: t.number, zone: t.zone, seats: t.seats },
        });
        return t;
      });
      this.events.publish(EVENTS.PosTableCreated, {
        organizationId,
        tableId: created.id,
        number: created.number,
        name: created.name,
      });
      return created;
    } catch (e: any) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`Table number ${dto.number} already exists`);
      }
      throw e;
    }
  }

  async update(id: string, dto: UpdateTableDto) {
      const organizationId = this.tenant.organizationId;
      const userId = this.tenant.userId;
      // Resolve + validate the zone key before touching the row.
      const zoneKey = dto.zone !== undefined ? await this.resolveZoneKey(organizationId, dto.zone) : undefined;
      return this.prisma.client.$transaction(async (tx: any) => {
        const existing = await tx.posTable.findFirst({ where: { id, organizationId } });
        if (!existing) throw new NotFoundException('Table not found');

        // T3: Block rename when table is occupied.
        if (existing.status === 'occupied' && dto.name !== undefined && dto.name.trim() !== existing.name) {
          throw new BadRequestException('Cannot rename an occupied table');
        }

        // T4: Block seats reduction below max guestCount on open orders.
        if (dto.seats !== undefined && dto.seats < existing.seats) {
          const openOrders = await tx.posTableOrder.findMany({
            where: { tableId: id, closedAt: null },
            select: { guestCount: true },
          });
          const maxGuests = Math.max(0, ...openOrders.map((o: any) => o.guestCount ?? 0));
          if (maxGuests > dto.seats) {
            throw new BadRequestException(
              `Cannot reduce seats to ${dto.seats}: open orders have ${maxGuests} guests`,
            );
          }
        }

        const changes: Record<string, unknown> = {};
        const fields: (keyof UpdateTableDto)[] = [
          'name', 'number', 'seats', 'zone', 'shape',
          'posX', 'posY', 'width', 'height', 'notes', 'active',
          'assignedWaiterId', 'sortOrder', 'qrCodeUrl',
        ];
        for (const f of fields) {
          if (dto[f] !== undefined && (existing as any)[f] !== dto[f]) {
            changes[f as string] = { from: (existing as any)[f], to: dto[f] };
          }
        }
        try {
          const updated = await tx.posTable.update({
            where: { id },
            data: {
              ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
              ...(dto.number !== undefined ? { number: dto.number } : {}),
              ...(dto.seats !== undefined ? { seats: dto.seats } : {}),
              ...(zoneKey !== undefined ? { zone: zoneKey } : {}),
              ...(dto.shape !== undefined ? { shape: dto.shape } : {}),
              ...(dto.posX !== undefined ? { posX: dto.posX } : {}),
              ...(dto.posY !== undefined ? { posY: dto.posY } : {}),
              ...(dto.width !== undefined ? { width: dto.width } : {}),
              ...(dto.height !== undefined ? { height: dto.height } : {}),
              ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
              ...(dto.active !== undefined ? { active: dto.active } : {}),
              ...(dto.assignedWaiterId !== undefined ? { assignedWaiterId: dto.assignedWaiterId } : {}),
              ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
              ...(dto.qrCodeUrl !== undefined ? { qrCodeUrl: dto.qrCodeUrl } : {}),
            },
          });
          if (Object.keys(changes).length > 0) {
            await this.audit.recordInTx(tx, {
              entity: 'PosTable',
              entityId: id,
              action: 'update',
              oldValues: { ...changes },
              newValues: { updatedBy: userId ?? null },
            });
          }
          return updated;
        } catch (e: any) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            throw new ConflictException(`Table number ${dto.number} already exists`);
          }
          throw e;
        }
      }).then(async (updated) => {
        this.events.publish(EVENTS.PosTableUpdated, {
          organizationId,
          tableId: id,
          changes: { name: dto.name, number: dto.number, seats: dto.seats },
        });
        return updated;
      });
    }

  /** Soft-archive a table. Refused if it has open PosTableOrder rows. */
  async archive(id: string) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const existing = await tx.posTable.findFirst({ where: { id, organizationId } });
      if (!existing) throw new NotFoundException('Table not found');
      const open = await tx.posTableOrder.count({
        where: { tableId: id, closedAt: null },
      });
      if (open > 0) {
        throw new ConflictException(
          `Cannot archive table ${existing.number}: ${open} open order(s)`,
        );
      }
      const updated = await tx.posTable.update({
        where: { id },
        data: { active: false },
      });
      await this.audit.recordInTx(tx, {
        entity: 'PosTable',
        entityId: id,
        action: 'delete',
        newValues: { active: false },
      });
      return updated;
    }).then((t) => {
      this.events.publish(EVENTS.PosTableDeleted, { organizationId, tableId: id });
      return t;
    });
  }

  /**
   * Manual status flip. Used for "mark dirty → cleaned", "out of service",
   * etc. Lifecycle transitions that involve money (open a sale → OCCUPIED,
   * payment posted → DIRTY) are driven by the sales flow, not this method.
   */
  async setStatus(id: string, dto: SetStatusDto) {
    const organizationId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    return this.prisma.client.$transaction(async (tx: any) => {
      // Acquire a row-level lock so concurrent transfers/merges can't race.
      await tx.$queryRawUnsafe(
        `SELECT id FROM "PosTable" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE`,
        id,
        organizationId,
      );
      const existing = await tx.posTable.findFirst({ where: { id, organizationId } });
      if (!existing) throw new NotFoundException('Table not found');
      const updated = await tx.posTable.update({
        where: { id },
        data: { status: dto.status as any },
      });
      await this.audit.recordInTx(tx, {
        entity: 'PosTable',
        entityId: id,
        action: 'update',
        oldValues: { status: existing.status },
        newValues: { status: dto.status, reason: dto.reason ?? null },
      });
      return { previous: existing.status, current: updated };
    }).then(({ previous, current }) => {
      this.events.publish(EVENTS.PosTableStatusChanged, {
        organizationId,
        tableId: id,
        from: previous,
        to: current.status,
        reason: dto.reason,
      });
      return current;
    });
  }

  async assignWaiter(id: string, dto: AssignWaiterDto) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const existing = await tx.posTable.findFirst({ where: { id, organizationId } });
      if (!existing) throw new NotFoundException('Table not found');
      const updated = await tx.posTable.update({
        where: { id },
        data: { assignedWaiterId: dto.waiterId },
      });
      await this.audit.recordInTx(tx, {
        entity: 'PosTable',
        entityId: id,
        action: 'update',
        oldValues: { assignedWaiterId: existing.assignedWaiterId },
        newValues: { assignedWaiterId: dto.waiterId },
      });
      return updated;
    });
  }

  // ─── Merge / Transfer (Hard Move) ────────────────────────────────────────

  /**
   * Merge `sourceId` into `targetId`. Hard move:
   *   1. Acquire FOR UPDATE on both rows.
   *   2. Reassign all open `PosTableOrder.documentId` from source → target.
   *   3. Update `Document.tableId` for each affected doc.
   *   4. Source becomes AVAILABLE with `mergedIntoId=targetId`; target keeps
   *      OCCUPIED status if it was occupied, otherwise becomes OCCUPIED if
   *      the merged-in sale brought items.
   *   5. Audit + event.
   *
   * The whole operation is one transaction — partial failure leaves no
   * inconsistent state. Source `mergedFrom` rows (other tables merged into
   * the source) cascade the reassignment.
   */
  async merge(sourceId: string, targetId: string) {
    if (sourceId === targetId) {
      throw new BadRequestException('A table cannot be merged into itself');
    }
    const organizationId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    return this.prisma.client.$transaction(async (tx: any) => {
      // Lock both rows. Always lock the lower id first to avoid deadlock.
      const first = sourceId < targetId ? sourceId : targetId;
      const second = first === sourceId ? targetId : sourceId;
      await tx.$queryRaw`SELECT id FROM "PosTable" WHERE id IN (${first}, ${second}) AND "organizationId" = ${organizationId} ORDER BY id FOR UPDATE`;
      const source = await tx.posTable.findFirst({ where: { id: sourceId, organizationId } });
      const target = await tx.posTable.findFirst({ where: { id: targetId, organizationId } });
      if (!source) throw new NotFoundException('Source table not found');
      if (!target) throw new NotFoundException('Target table not found');
      if (source.mergedIntoId) {
        throw new ConflictException(`Source table is already merged into T${source.mergedIntoId}`);
      }
      if (!source.active || !target.active) {
        throw new ConflictException('Cannot merge an archived table');
      }
      if (source.status === 'out_of_service' || target.status === 'out_of_service') {
        throw new ConflictException('Cannot merge an out-of-service table');
      }
      // Settled-table guard (User Story 9): only OPEN (un-billed) orders may merge
      // — a billed sale has GL behind it and must never be re-tabled. We also
      // refuse a cross-branch merge (branch is carried on the Order, since a
      // PosTable itself is not branch-scoped).
      const involved = await tx.posTableOrder.findMany({
        where: { tableId: { in: [sourceId, targetId] }, closedAt: null },
        include: { order: { select: { status: true, branchId: true, invoiceId: true } } },
      });
      if (involved.some((o: any) => o.order && (o.order.invoiceId || ['closed', 'cancelled'].includes(o.order.status)))) {
        throw new ConflictException('Cannot merge settled tables');
      }
      const branches = new Set(involved.map((o: any) => o.order?.branchId).filter(Boolean));
      if (branches.size > 1) {
        throw new ConflictException('Cannot merge tables from different branches');
      }
      // Collect every table merged into source (cascade) — they all reassign too.
      const cascadedSourceIds = await tx.posTable.findMany({
        where: { mergedIntoId: sourceId },
        select: { id: true },
      });
      const allSourceIds = [sourceId, ...cascadedSourceIds.map((c: any) => c.id)];

      // Reassign open PosTableOrder rows + their Order.tableId cache.
      const reassigned = await tx.posTableOrder.findMany({
        where: { tableId: { in: allSourceIds }, closedAt: null },
        select: { id: true, orderId: true },
      });
      const docIds = reassigned.map((r: any) => r.orderId);
      if (docIds.length > 0) {
        await tx.posTableOrder.updateMany({
          where: { id: { in: reassigned.map((r: any) => r.id) } },
          data: { tableId: targetId },
        });
        await tx.order.updateMany({
          where: { id: { in: docIds } },
          data: { tableId: targetId },
        });
      }
      // Source is now drained → AVAILABLE + mergedInto pointer.
      await tx.posTable.update({
        where: { id: sourceId },
        data: {
          status: 'available',
          mergedIntoId: targetId,
          mergedAt: new Date(),
          mergedById: userId ?? null,
        },
      });
      // Cascade members also point at target.
      if (cascadedSourceIds.length > 0) {
        await tx.posTable.updateMany({
          where: { id: { in: cascadedSourceIds.map((c: any) => c.id) } },
          data: { mergedIntoId: targetId, status: 'available' },
        });
      }
      // Sync target status based on open orders (it absorbed the source's orders).
      await this.syncTableStatus(targetId, tx);
      await this.audit.recordInTx(tx, {
        entity: 'PosTable',
        entityId: sourceId,
        action: 'merge' as any,
        newValues: { targetId, reassignedDocs: docIds, actorId: userId ?? null },
      });
      return { source, target, reassigned: docIds };
    }).then(({ source, target, reassigned }) => {
      this.events.publish(EVENTS.PosTableMerged, {
        organizationId,
        sourceId,
        targetId,
        orderIds: reassigned,
        actorId: userId ?? '',
      });
      return { sourceId, targetId, mergedSource: source, target, reassignedDocuments: reassigned };
    });
  }

  /** Split a merged source back out. Only allowed when the source has no docs. */
  async unmerge(sourceId: string) {
    const organizationId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    return this.prisma.client.$transaction(async (tx: any) => {
      await tx.$queryRawUnsafe(
        `SELECT id FROM "PosTable" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE`,
        sourceId,
        organizationId,
      );
      const source = await tx.posTable.findFirst({ where: { id: sourceId, organizationId } });
      if (!source) throw new NotFoundException('Source table not found');
      if (!source.mergedIntoId) {
        throw new BadRequestException('Table is not merged');
      }
      const open = await tx.posTableOrder.count({
        where: { tableId: sourceId, closedAt: null },
      });
      if (open > 0) {
        throw new ConflictException(
          'Cannot unmerge: source table still has open orders (transfer first).',
        );
      }
      const updated = await tx.posTable.update({
        where: { id: sourceId },
        data: {
          mergedIntoId: null,
          mergedAt: null,
          mergedById: null,
        },
      });
      // Sync status based on open orders
      await this.syncTableStatus(sourceId, tx);
      await this.audit.recordInTx(tx, {
        entity: 'PosTable',
        entityId: sourceId,
        action: 'update',
        oldValues: { mergedIntoId: source.mergedIntoId },
        newValues: { mergedIntoId: null },
      });
      return updated;
    }).then((t) => {
      this.events.publish(EVENTS.PosTableUnmerged, { organizationId, tableId: sourceId, actorId: userId ?? '' });
      return t;
    });
  }

  /**
   * Transfer every open sale from `sourceId` to `targetId`. Unlike merge,
   * source becomes AVAILABLE (no merge pointer); target becomes OCCUPIED
   * (absorbing the transferred sales). All PosTableOrder rows + their
   * Order.tableId cache are reassigned in one tx.
   */
  async transfer(sourceId: string, targetId: string, orderIds?: string[]) {
    if (sourceId === targetId) {
      throw new BadRequestException('A table cannot transfer to itself');
    }
    const organizationId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const first = sourceId < targetId ? sourceId : targetId;
      const second = first === sourceId ? targetId : sourceId;
      await tx.$queryRaw`SELECT id FROM "PosTable" WHERE id IN (${first}, ${second}) AND "organizationId" = ${organizationId} ORDER BY id FOR UPDATE`;
      const source = await tx.posTable.findFirst({ where: { id: sourceId, organizationId } });
      const target = await tx.posTable.findFirst({ where: { id: targetId, organizationId } });
      if (!source) throw new NotFoundException('Source table not found');
      if (!target) throw new NotFoundException('Target table not found');
      if (!source.active || !target.active) {
        throw new ConflictException('Cannot transfer to/from an archived table');
      }
      if (target.status === 'occupied' || target.status === 'reserved') {
        throw new ConflictException(
          `Target table T${target.number} is ${target.status}; cannot transfer into it`,
        );
      }
      const where: any = { tableId: sourceId, closedAt: null };
      if (orderIds?.length) where.orderId = { in: orderIds };
      const orders = await tx.posTableOrder.findMany({
        where,
        select: { id: true, orderId: true },
      });
      const docIds = orders.map((o: any) => o.orderId);
      if (docIds.length === 0) {
        throw new BadRequestException('No open orders on the source table');
      }
      await tx.posTableOrder.updateMany({
        where: { id: { in: orders.map((o: any) => o.id) } },
        data: { tableId: targetId },
      });
      await tx.order.updateMany({
        where: { id: { in: docIds } },
        data: { tableId: targetId },
      });
      // Sync status for both tables based on open orders
      await this.syncTableStatus(sourceId, tx);
      await this.syncTableStatus(targetId, tx);
      await this.audit.recordInTx(tx, {
        entity: 'PosTable',
        entityId: sourceId,
        action: 'transfer',
        newValues: { targetId, documents: docIds, actorId: userId ?? null },
      });
      return { source, target, transferred: docIds };
    }).then(({ source, target, transferred }) => {
      this.events.publish(EVENTS.PosTableTransferred, {
        organizationId,
        sourceId,
        targetId,
        orderIds: transferred,
        actorId: userId ?? '',
      });
      return { sourceId, targetId, transferredDocuments: transferred };
    });
  }

  // ─── Transfer Items (soft move — split a draft between two tables) ────────

  /**
   * Transfer specific order ITEMS (lines, with optional partial quantities)
   * from `sourceId`'s open draft order into `targetId`'s. Unlike `transfer`
   * (which moves whole documents into an empty table), this splits a draft:
   * the chosen quantities leave the source line-set and are appended to the
   * target's draft (created on the fly if the target had none) — so it works
   * into an already-OCCUPIED table without losing its existing items. Totals on
   * both sides are recomputed by the tax engine; if the source is fully drained
   * it becomes AVAILABLE.
   *
   * KDS note: already-fired KitchenTicket rows reference the *source* document
   * and stay there — this operates on the live draft order only.
   */
  async transferItems(
    sourceId: string,
    targetId: string,
    items: Array<{ lineId: string; quantity: number }>,
  ) {
    if (sourceId === targetId) {
      throw new BadRequestException('A table cannot transfer items to itself');
    }
    if (!items?.length) throw new BadRequestException('No items selected to transfer');
    const organizationId = this.tenant.organizationId;
    const userId = this.tenant.userId;

    return this.prisma.client.$transaction(async (tx: any) => {
      // Lock both rows (lower id first) to keep concurrent moves deadlock-free.
      const first = sourceId < targetId ? sourceId : targetId;
      const second = first === sourceId ? targetId : sourceId;
      await tx.$queryRaw`SELECT id FROM "PosTable" WHERE id IN (${first}, ${second}) AND "organizationId" = ${organizationId} ORDER BY id FOR UPDATE`;
      const source = await tx.posTable.findFirst({ where: { id: sourceId, organizationId } });
      const target = await tx.posTable.findFirst({ where: { id: targetId, organizationId } });
      if (!source) throw new NotFoundException('Source table not found');
      if (!target) throw new NotFoundException('Target table not found');
      if (!source.active || !target.active) {
        throw new ConflictException('Cannot transfer to/from an archived table');
      }
      if (target.status === 'out_of_service') {
        throw new ConflictException(`Target table T${target.number} is out of service`);
      }

      // Source open order + items (with modifier rows, to re-attach later).
      const sourceLink = await tx.posTableOrder.findFirst({
        where: { tableId: sourceId, closedAt: null },
        include: {
          order: { include: { items: { where: { cancelled: false }, include: { modifiers: true }, orderBy: { lineNumber: 'asc' } } } },
        },
      });
      const sourceOrder = sourceLink?.order;
      if (!sourceOrder || sourceOrder.invoiceId || !isTableHeldOrderStatus(sourceOrder.status)) {
        throw new BadRequestException('No open order on the source table');
      }

      // Tally requested quantities per source item.
      const byLine = new Map<string, number>();
      for (const it of items) {
        if (!(it.quantity > 0)) throw new BadRequestException('Transfer quantity must be greater than zero');
        byLine.set(it.lineId, (byLine.get(it.lineId) ?? 0) + it.quantity);
      }

      const toInput = (l: any, quantity: number) => ({
        productId: l.productId ?? undefined,
        menuItemId: l.menuItemId ?? undefined,
        description: l.description,
        quantity,
        unitPrice: Number(l.unitPrice),
        taxId: l.taxId ?? undefined,
        discountPercent: Number(l.discountPercent),
        taxInclusive: l.taxInclusive,
      });
      const modsOf = (l: any) =>
        (l.modifiers ?? []).map((m: any) => ({ modifierId: m.modifierId, name: m.name, priceDelta: m.priceDelta }));

      // Split each source item into remaining (stays) + moved (goes to target).
      const remainingInputs: any[] = [];
      const remainingMods: any[][] = [];
      const movedInputs: any[] = [];
      const movedMods: any[][] = [];
      const movedSummary: Array<{ description: string; quantity: number }> = [];
      for (const l of sourceOrder.items as any[]) {
        const moveQty = byLine.get(l.id) ?? 0;
        const have = Number(l.quantity);
        if (moveQty === 0) {
          remainingInputs.push(toInput(l, have));
          remainingMods.push(modsOf(l));
          continue;
        }
        if (moveQty > have + 1e-6) {
          throw new BadRequestException(
            `Cannot transfer ${moveQty} of "${l.description}" — only ${have} on the order`,
          );
        }
        const keep = have - moveQty;
        if (keep > 1e-6) {
          remainingInputs.push(toInput(l, keep));
          remainingMods.push(modsOf(l));
        }
        movedInputs.push(toInput(l, moveQty));
        movedMods.push(modsOf(l));
        movedSummary.push({ description: l.description, quantity: moveQty });
        byLine.delete(l.id);
      }
      if (byLine.size > 0) {
        throw new BadRequestException("One or more selected items are not on this table's order");
      }
      if (movedInputs.length === 0) throw new BadRequestException('No items selected to transfer');

      // ── Source side ──────────────────────────────────────────────────────
      if (remainingInputs.length === 0) {
        // Fully drained → cancel the order, close the tab link, free the table.
        await tx.orderItem.deleteMany({ where: { orderId: sourceOrder.id } });
        await tx.order.update({
          where: { id: sourceOrder.id },
          data: {
            status: 'cancelled',
            cancelledAt: new Date(),
            cancelReason: `Items transferred to T${target.number}`,
            subtotal: 0, discountTotal: 0, taxAmount: 0, totalAmount: 0,
            version: { increment: 1 },
          },
        });
        await tx.posTableOrder.updateMany({ where: { id: sourceLink.id }, data: { closedAt: new Date() } });
      } else {
        await this.rebuildOrderItems(tx, organizationId, sourceOrder.id, remainingInputs, remainingMods);
      }
      await this.syncTableStatus(sourceId, tx);

      // ── Target side ──────────────────────────────────────────────────────
      const targetLink = await tx.posTableOrder.findFirst({
        where: { tableId: targetId, closedAt: null },
        include: {
          order: { include: { items: { where: { cancelled: false }, include: { modifiers: true }, orderBy: { lineNumber: 'asc' } } } },
        },
      });
      const targetExisting = targetLink?.order;
      const targetIsOpen = targetExisting && !targetExisting.invoiceId && isTableHeldOrderStatus(targetExisting.status);
      let targetOrderId: string;
      if (targetIsOpen) {
        // Append moved items to the existing order; preserve its current items
        // and their modifier rows (rebuild cascade-deletes them).
        targetOrderId = targetExisting.id;
        const existing = (targetExisting.items as any[]).map((l) => toInput(l, Number(l.quantity)));
        const existingMods = (targetExisting.items as any[]).map((l) => modsOf(l));
        await this.rebuildOrderItems(tx, organizationId, targetOrderId, [...existing, ...movedInputs], [...existingMods, ...movedMods]);
      } else {
        const newOrder = await this.createTabOrderInTx(tx, {
          tableId: targetId,
          partnerId: sourceOrder.partnerId,
          branchId: target.branchId ?? undefined,
        });
        targetOrderId = newOrder.id;
        await this.rebuildOrderItems(tx, organizationId, targetOrderId, movedInputs, movedMods);
      }
      if (target.status !== 'occupied' && target.status !== 'reserved') {
        await tx.posTable.update({ where: { id: targetId }, data: { status: 'occupied' } });
      }
      await this.syncTableStatus(targetId, tx);

      // ── Audit trail (User Story 5) ───────────────────────────────────────
      await this.audit.recordInTx(tx, {
        entity: 'PosTable',
        entityId: sourceId,
        action: 'transfer' as any,
        newValues: { kind: 'transfer_items', targetId, items: movedSummary, actorId: userId ?? null },
      });

      const [sourceFresh, targetFresh] = await Promise.all([
        tx.order.findFirst({ where: { id: sourceOrder.id }, include: { items: { orderBy: { lineNumber: 'asc' } } } }),
        tx.order.findFirst({ where: { id: targetOrderId }, include: { items: { orderBy: { lineNumber: 'asc' } } } }),
      ]);
      return { sourceId, targetId, targetOrderId, movedSummary, source: sourceFresh, target: targetFresh };
    }).then((res) => {
      this.events.publish(EVENTS.PosTableTransferred, {
        organizationId,
        sourceId,
        targetId,
        orderIds: [res.targetOrderId],
        actorId: userId ?? '',
      });
      return res;
    });
  }

  /**
   * Split a single open tab Order into N Orders (one per "guest check"). Each
   * new Order inherits a subset of OrderItems from the original. The source
   * Order is cancelled (kept for audit) and the new Orders become separate
   * PosTableOrder rows on the same table.
   *
   * The caller passes `splits` — an array of `{ label, lines: { sourceItemId,
   * quantity } }`. The backend re-prices each child through the tax engine.
   */
  async splitBill(args: {
    tableId: string;
    sourceOrderId: string;
    splits: Array<{ label: string; lines: Array<{ sourceItemId: string; quantity: number }> }>;
    partnerId?: string;
  }) {
    const organizationId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    return this.prisma.client.$transaction(async (tx: any) => {
      await tx.$queryRawUnsafe(
        `SELECT id FROM "PosTable" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE`,
        args.tableId,
        organizationId,
      );
      const source = await tx.posTable.findFirst({ where: { id: args.tableId, organizationId } });
      if (!source) throw new NotFoundException('Table not found');
      const sourceOrder = await tx.order.findFirst({
        where: { id: args.sourceOrderId, organizationId },
        include: { items: { where: { cancelled: false }, include: { modifiers: true }, orderBy: { lineNumber: 'asc' } } },
      });
      if (!sourceOrder) throw new NotFoundException('Source order not found');
      // A billed sale has GL behind it; cancelling it to split would orphan those
      // entries. Only an open (un-billed) tab can be split.
      if (sourceOrder.invoiceId || !isTableHeldOrderStatus(sourceOrder.status)) {
        throw new BadRequestException(
          'Only an open (un-billed) bill can be split — a billed sale cannot be re-split',
        );
      }

      // Validate that the splits cover the original items exactly.
      const usedByItem = new Map<string, number>();
      for (const split of args.splits) {
        for (const ln of split.lines) {
          usedByItem.set(ln.sourceItemId, (usedByItem.get(ln.sourceItemId) ?? 0) + ln.quantity);
        }
      }
      for (const srcItem of sourceOrder.items) {
        const requested = Number(srcItem.quantity);
        const allocated = usedByItem.get(srcItem.id) ?? 0;
        if (Math.abs(requested - allocated) > 0.0001) {
          throw new BadRequestException(
            `Split quantities do not match source item ${srcItem.id} (have ${allocated}, need ${requested})`,
          );
        }
      }

      const itemById = new Map<string, any>((sourceOrder.items as any[]).map((i) => [i.id, i]));

      // Stash kitchen print lifecycle by product so split tickets don't re-print
      // items already sent to the kitchen.
      const srcLifecycle = new Map<string, any>();
      for (const it of sourceOrder.items as any[]) {
        if (!it.productId) continue;
        srcLifecycle.set(it.productId, {
          kitchenPrintCount: it.kitchenPrintCount ?? 0,
          kitchenLastPrintedAt: it.kitchenLastPrintedAt ?? null,
          kitchenPrintedQty: it.kitchenPrintedQty ?? null,
          cancelPrintCount: it.cancelPrintCount ?? 0,
          cancelLastPrintedAt: it.cancelLastPrintedAt ?? null,
          lastKitchenPrintedById: it.lastKitchenPrintedById ?? null,
          kitchenStatus: it.kitchenStatus ?? 'pending',
        });
      }

      // Close the source tab link — it is about to be cancelled and replaced.
      await tx.posTableOrder.updateMany({
        where: { tableId: args.tableId, orderId: args.sourceOrderId, closedAt: null },
        data: { closedAt: new Date() },
      });

      // One child Order per split (priced through the tax engine).
      const created: string[] = [];
      for (const split of args.splits) {
        const inputs = split.lines.map((ln) => {
          const src = itemById.get(ln.sourceItemId);
          if (!src) throw new BadRequestException(`Unknown source item ${ln.sourceItemId}`);
          return {
            productId: src.productId ?? undefined,
            menuItemId: src.menuItemId ?? undefined,
            description: src.description + (split.label ? ` (${split.label})` : ''),
            quantity: Number(ln.quantity),
            unitPrice: Number(src.unitPrice),
            discountPercent: Number(src.discountPercent),
            taxId: src.taxId ?? undefined,
            taxInclusive: (src as any).taxInclusive,
          };
        });
        const mods = split.lines.map((ln) => {
          const src = itemById.get(ln.sourceItemId);
          return (src?.modifiers ?? []).map((m: any) => ({ modifierId: m.modifierId, name: m.name, priceDelta: m.priceDelta }));
        });

        const orderNumber = await this.nextOrderNumberTx(tx);
        const child = await tx.order.create({
          data: {
            organizationId,
            orderNumber,
            orderType: sourceOrder.orderType,
            status: 'confirmed',
            tableId: args.tableId,
            partnerId: args.partnerId ?? sourceOrder.partnerId,
            waiterId: this.tenant.userId ?? null,
            branchId: sourceOrder.branchId ?? null,
            createdBy: this.tenant.userId ?? null,
          },
        });
        await tx.posTableOrder.create({
          data: {
            organizationId,
            tableId: args.tableId,
            orderId: child.id,
            customerName: split.label,
            notes: `Split from ${sourceOrder.orderNumber}`,
          },
        });
        await this.rebuildOrderItems(tx, organizationId, child.id, inputs, mods);

        // Inherit kitchen lifecycle by product so already-fired items aren't
        // re-sent to the kitchen on the split tickets.
        const childItems = await tx.orderItem.findMany({ where: { orderId: child.id } });
        for (const ci of childItems) {
          const lc = ci.productId ? srcLifecycle.get(ci.productId) : null;
          if (!lc) continue;
          await tx.orderItem.update({
            where: { id: ci.id },
            data: {
              kitchenPrintCount: lc.kitchenPrintCount,
              kitchenLastPrintedAt: lc.kitchenLastPrintedAt,
              kitchenPrintedQty: lc.kitchenPrintedQty,
              cancelPrintCount: lc.cancelPrintCount,
              cancelLastPrintedAt: lc.cancelLastPrintedAt,
              lastKitchenPrintedById: lc.lastKitchenPrintedById,
              kitchenStatus: lc.kitchenStatus,
            },
          });
        }
        created.push(child.id);
      }
      // Cancel the source order (kept for audit; cannot be billed). The new
      // orders become the live tickets for tender.
      // `supersede`, not `cancel`: this route is gated on the tables permission,
      // so the transition must not additionally demand `pos:checkout`.
      await this.workflows.transition({
        entityType: 'order', entityId: args.sourceOrderId, action: 'supersede',
        payload: { splitInto: created }, externalTx: tx,
      });
      await tx.order.update({
        where: { id: args.sourceOrderId },
        data: { cancelReason: `Split into ${created.length} ticket(s)`, version: { increment: 1 } },
      });
      // Sync table status after split (new open orders created)
      await this.syncTableStatus(args.tableId, tx);
      await this.audit.recordInTx(tx, {
        entity: 'PosTable',
        entityId: args.tableId,
        action: 'update',
        newValues: { kind: 'split', sourceOrderId: args.sourceOrderId, newOrderIds: created, actorId: userId ?? null },
      });
      return { sourceOrderId: args.sourceOrderId, newOrderIds: created };
    }).then((res) => {
      this.events.publish(EVENTS.PosTableSplit, {
        organizationId,
        sourceOrderId: res.sourceOrderId,
        newOrderIds: res.newOrderIds,
        actorId: userId ?? '',
      });
      return res;
    });
  }

  // ─── Link helpers (called from PosService.checkout) ──────────────────────

  /**
   * Mark the table OCCUPIED and create a PosTableOrder row for the new
   * Document. Called from /pos/checkout when the cashier assigns the sale
   * to a table.
   */
  async attachSaleToTable(args: {
    tableId: string;
    orderId: string;
    customerName?: string;
    guestCount?: number;
  }) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      await tx.$queryRawUnsafe(
        `SELECT id FROM "PosTable" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE`,
        args.tableId,
        organizationId,
      );
      const table = await tx.posTable.findFirst({ where: { id: args.tableId, organizationId } });
      if (!table) throw new NotFoundException('Table not found');
      if (table.status === 'out_of_service') {
        throw new ConflictException('Table is out of service');
      }
      await tx.posTableOrder.upsert({
        where: {
          tableId_orderId: { tableId: args.tableId, orderId: args.orderId },
        },
        create: {
          tableId: args.tableId,
          orderId: args.orderId,
          customerName: args.customerName ?? null,
          guestCount: args.guestCount ?? null,
        },
        update: {
          customerName: args.customerName ?? null,
          guestCount: args.guestCount ?? null,
        },
      });
      await tx.order.update({
        where: { id: args.orderId },
        data: { tableId: args.tableId },
      });
      // Sync status: occupied if open orders exist, available otherwise (reserved stays reserved)
      await this.syncTableStatus(args.tableId, tx);
      return { tableId: args.tableId, orderId: args.orderId };
    });
  }

  /**
   * Close the open PosTableOrder(s) on a table after payment.
   * Table status auto-synced: no open orders → available, else occupied.
   */
  async closeTableOrder(args: { tableId: string; orderId?: string }): Promise<{ closed: number; tableStatus: 'available' | 'occupied' | 'reserved' | 'out_of_service' | 'cleaning' }> {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      await tx.$queryRawUnsafe(
        `SELECT id FROM "PosTable" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE`,
        args.tableId,
        organizationId,
      );
      const existing = await tx.posTable.findFirst({ where: { id: args.tableId, organizationId } });
      if (!existing) throw new NotFoundException('Table not found');
      const where: any = { tableId: args.tableId, closedAt: null };
      if (args.orderId) where.orderId = args.orderId;
      const closed = await tx.posTableOrder.updateMany({
        where,
        data: { closedAt: new Date() },
      });
      // Sync status based on remaining open orders
      let tableStatus = await this.syncTableStatus(args.tableId, tx);
      // T2: After payment, set cleaning instead of available (unless overridden).
      if (tableStatus === 'available' && existing.status === 'occupied') {
        await tx.posTable.update({ where: { id: args.tableId }, data: { status: 'cleaning' } });
        tableStatus = 'cleaning';
      }
      return { closed: closed.count, tableStatus };
    });
  }

  // ─── SSE Stream (mirrors KDS pattern) ───────────────────────────────────

  async stream(res: Response, origin = '') {
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(`retry: 5000\n\n`);

    this.sseClients.add(res);
    res.on('close', () => {
      this.sseClients.delete(res);
      if (this.sseClients.size === 0 && this.sseTimer) {
        clearInterval(this.sseTimer);
        this.sseTimer = null;
      }
    });

    await this.pushToAll();
    if (!this.sseTimer) {
      this.sseTimer = setInterval(() => this.pushToAll(), this.SSE_SAFETY_NET_MS);
    }
  }

  private async pushToAll() {
    if (this.sseClients.size === 0) return;
    let tables: Awaited<ReturnType<typeof this.list>> | null = null;
    let stats: Awaited<ReturnType<typeof this.stats>> | null = null;
    try {
      [tables, stats] = await Promise.all([this.list({ active: true }), this.stats()]);
    } catch (e: any) {
      this.logger.warn(`SSE snapshot failed: ${String(e?.message ?? e)}`);
      return;
    }
    const payload = JSON.stringify({ type: 'snapshot', tables, stats });
    for (const client of this.sseClients) {
      try {
        client.write(`data: ${payload}\n\n`);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }
}