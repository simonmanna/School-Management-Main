/**
 * POS Phase T1 — Table Reservations (ADR-012).
 *
 * A PosTableReservation captures a booking (party size, time window,
 * contact info). Lifecycle:
 *   pending  → seated (opens an empty Document + flips table to OCCUPIED)
 *   pending  → cancelled (frees the table back to AVAILABLE)
 *   pending  → no_show (cron after 30-minute grace window)
 *   seated   → completed (when the guest leaves; flips table to DIRTY)
 *
 * The reservation worker (kernel/workers/reservation-worker.ts) handles
 * automatic PENDING → NO_SHOW after the start time + grace window.
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
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { EventBus } from '../../kernel/events/event-bus';
import { EVENTS } from '@erp/shared';
import { PosTablesService } from './pos-tables.service';

export interface CreateReservationDto {
  /** Offline-first: a client-minted uuid becomes the row id so a device that
   *  booked offline can seat/cancel it by the same id (no server remap). */
  id?: string;
  tableId: string;
  customerName: string;
  phone?: string;
  email?: string;
  partySize?: number;
  startAt: string;
  endAt: string;
  notes?: string;
}

export interface UpdateReservationDto {
  customerName?: string;
  phone?: string;
  email?: string;
  partySize?: number;
  startAt?: string;
  endAt?: string;
  notes?: string;
}

export interface SeatReservationDto {
  /** Optional pre-existing open Order to attach the table to. */
  orderId?: string;
}

const SEATABLE_GRACE_MS = 30 * 60 * 1000; // 30 minutes

@Injectable()
export class PosReservationsService {
  private readonly logger = new Logger(PosReservationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly tables: PosTablesService,
  ) {}

  async list(filter: { date?: string; status?: string; tableId?: string } = {}) {
    const organizationId = this.tenant.organizationId;
    const where: any = { organizationId };
    const statusVal = filter.status;
    if (statusVal && statusVal !== 'all') where.status = statusVal;
    if (filter.tableId) where.tableId = filter.tableId;
    if (filter.date) {
      const d = new Date(filter.date);
      if (!Number.isNaN(d.getTime())) {
        const start = new Date(d);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        where.startAt = { gte: start, lt: end };
      }
    }
    return this.prisma.client.posTableReservation.findMany({
      where,
      orderBy: { startAt: 'asc' },
      include: { table: { select: { id: true, number: true, name: true, status: true } } },
      take: 200,
    });
  }

  async get(id: string) {
    const organizationId = this.tenant.organizationId;
    const r = await this.prisma.client.posTableReservation.findFirst({
      where: { id, organizationId },
      include: { table: true },
    });
    if (!r) throw new NotFoundException('Reservation not found');
    return r;
  }

  async create(dto: CreateReservationDto) {
    const organizationId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    if (!dto.customerName?.trim()) {
      throw new BadRequestException('Customer name is required');
    }
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      throw new BadRequestException('Invalid startAt / endAt');
    }
    if (endAt <= startAt) {
      throw new BadRequestException('endAt must be after startAt');
    }

    return this.prisma.client.$transaction(async (tx: any) => {
      // Lock the table row to avoid overlapping reservations racing.
      await tx.$queryRawUnsafe(
        `SELECT id FROM "PosTable" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE`,
        dto.tableId,
        organizationId,
      );
      const table = await tx.posTable.findFirst({
        where: { id: dto.tableId, organizationId },
      });
      if (!table) throw new NotFoundException('Table not found');
      if (!table.active) throw new ConflictException('Cannot reserve an archived table');

      // Reject overlapping reservations on the same table.
      const overlap = await tx.posTableReservation.findFirst({
        where: {
          tableId: dto.tableId,
          status: { in: ['pending', 'seated'] },
          AND: [
            { startAt: { lt: endAt } },
            { endAt: { gt: startAt } },
          ],
        },
      });
      if (overlap) {
        throw new ConflictException(
          `Table T${table.number} is already reserved from ${overlap.startAt.toISOString()} to ${overlap.endAt.toISOString()}`,
        );
      }

      const created = await tx.posTableReservation.create({
        data: {
          ...(dto.id ? { id: dto.id } : {}),
          tableId: dto.tableId,
          customerName: dto.customerName.trim(),
          phone: dto.phone ?? null,
          email: dto.email ?? null,
          partySize: dto.partySize ?? 2,
          startAt,
          endAt,
          notes: dto.notes ?? null,
          status: 'pending',
        },
      });
      // If startAt is within 60 minutes, flip the table to RESERVED right
      // away so the picker shows it. Otherwise leave AVAILABLE.
      const soon = startAt.getTime() - Date.now() < 60 * 60 * 1000;
      if (soon && table.status === 'available') {
        await tx.posTable.update({
          where: { id: dto.tableId },
          data: { status: 'reserved' as any },
        });
      }
      await this.audit.recordInTx(tx, {
        entity: 'PosTableReservation',
        entityId: created.id,
        action: 'reserve' as any,
        newValues: {
          tableId: dto.tableId,
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          customerName: created.customerName,
        },
      });
      return created;
    }).then((created) => {
      this.events.publish(EVENTS.PosTableReservationCreated, {
        organizationId,
        reservationId: created.id,
        tableId: created.tableId,
        startAt: created.startAt.toISOString(),
        endAt: created.endAt.toISOString(),
      });
      return created;
    });
  }

  async update(id: string, dto: UpdateReservationDto) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const existing = await tx.posTableReservation.findFirst({
        where: { id, organizationId },
      });
      if (!existing) throw new NotFoundException('Reservation not found');
      if (existing.status !== 'pending') {
        throw new BadRequestException(`Cannot edit a ${existing.status} reservation`);
      }
      const startAt = dto.startAt ? new Date(dto.startAt) : existing.startAt;
      const endAt = dto.endAt ? new Date(dto.endAt) : existing.endAt;
      if (endAt <= startAt) {
        throw new BadRequestException('endAt must be after startAt');
      }
      const updated = await tx.posTableReservation.update({
        where: { id },
        data: {
          customerName: dto.customerName ?? existing.customerName,
          phone: dto.phone ?? existing.phone,
          email: dto.email ?? existing.email,
          partySize: dto.partySize ?? existing.partySize,
          startAt,
          endAt,
          notes: dto.notes ?? existing.notes,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'PosTableReservation',
        entityId: id,
        action: 'update',
        oldValues: { startAt: existing.startAt, endAt: existing.endAt, partySize: existing.partySize },
        newValues: { startAt, endAt, partySize: updated.partySize },
      });
      return updated;
    });
  }

  /**
   * Mark a reservation as seated. If a Document is supplied, the table is
   * attached to it; otherwise the table flips to OCCUPIED without opening a
   * ticket (the cashier will open one when the guest orders).
   */
  async seat(id: string, dto: SeatReservationDto = {}) {
    const organizationId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const existing = await tx.posTableReservation.findFirst({
        where: { id, organizationId },
      });
      if (!existing) throw new NotFoundException('Reservation not found');
      if (existing.status !== 'pending') {
        throw new BadRequestException(`Reservation is already ${existing.status}`);
      }
      const updated = await tx.posTableReservation.update({
        where: { id },
        data: {
          status: 'seated',
          seatedAt: new Date(),
          seatedOrderId: dto.orderId ?? null,
        },
      });
      // When seated, table becomes occupied (no open orders yet, but reservation holds it)
      await this.tables.syncTableStatus(existing.tableId, tx);
      const table = await tx.posTable.findFirst({ where: { id: existing.tableId } });
      if (table && table.status === 'available') {
        await tx.posTable.update({
          where: { id: existing.tableId },
          data: { status: 'occupied' as any },
        });
      }
      await this.audit.recordInTx(tx, {
        entity: 'PosTableReservation',
        entityId: id,
        action: 'update',
        oldValues: { status: 'pending' },
        newValues: { status: 'seated', seatedOrderId: dto.orderId ?? null },
      });
      return updated;
    }).then(async (updated) => {
      // If a Document was provided, attach the table to it (outside the
      // reservation tx is fine — attachSaleToTable has its own tx).
      if (dto.orderId) {
        await this.tables.attachSaleToTable({
          tableId: updated.tableId,
          orderId: dto.orderId,
          customerName: updated.customerName,
          guestCount: updated.partySize,
        });
      }
      this.events.publish(EVENTS.PosTableReservationSeated, {
        organizationId,
        reservationId: id,
        tableId: updated.tableId,
        orderId: dto.orderId,
      });
      return updated;
    });
  }

  async cancel(id: string) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const existing = await tx.posTableReservation.findFirst({
        where: { id, organizationId },
      });
      if (!existing) throw new NotFoundException('Reservation not found');
      if (existing.status !== 'pending') {
        throw new BadRequestException(`Reservation is already ${existing.status}`);
      }
      const updated = await tx.posTableReservation.update({
        where: { id },
        data: { status: 'cancelled', cancelledAt: new Date() },
      });
      await this.audit.recordInTx(tx, {
        entity: 'PosTableReservation',
        entityId: id,
        action: 'cancel',
        oldValues: { status: 'pending' },
        newValues: { status: 'cancelled' },
      });
      // Sync table status based on open orders + remaining reservations
      await this.tables.syncTableStatus(existing.tableId, tx);
      return updated;
    }).then((r) => {
      this.events.publish(EVENTS.PosTableReservationCancelled, {
        organizationId,
        reservationId: id,
        tableId: r.tableId,
      });
      return r;
    });
  }

  /** Called by the reservation worker when a pending booking lapses. */
  async markNoShow(id: string) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const existing = await tx.posTableReservation.findFirst({
        where: { id, organizationId },
      });
      if (!existing) throw new NotFoundException('Reservation not found');
      if (existing.status !== 'pending') return existing;
      const updated = await tx.posTableReservation.update({
        where: { id },
        data: { status: 'no_show', noShowAt: new Date() },
      });
      await this.audit.recordInTx(tx, {
        entity: 'PosTableReservation',
        entityId: id,
        action: 'update',
        oldValues: { status: 'pending' },
        newValues: { status: 'no_show' },
      });
      // Sync table status based on open orders + remaining reservations
      await this.tables.syncTableStatus(existing.tableId, tx);
      return updated;
    }).then((r) => {
      this.events.publish(EVENTS.PosTableReservationNoShow, {
        organizationId,
        reservationId: id,
        tableId: r.tableId,
      });
      return r;
    });
  }

  async complete(id: string) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const existing = await tx.posTableReservation.findFirst({
        where: { id, organizationId },
      });
      if (!existing) throw new NotFoundException('Reservation not found');
      if (existing.status !== 'seated') {
        throw new BadRequestException(`Reservation is ${existing.status}, not seated`);
      }
      const updated = await tx.posTableReservation.update({
        where: { id },
        data: { status: 'completed' },
      });
      // Sync table status based on remaining open orders
      await this.tables.syncTableStatus(existing.tableId, tx);
      return updated;
    });
  }

  /**
   * Worker entry point — flip every pending reservation whose startAt is
   * older than (now - SEATABLE_GRACE_MS) to no_show, and free the table
   * if no other pending booking covers it.
   */
  async sweepNoShows(): Promise<number> {
    const cutoff = new Date(Date.now() - SEATABLE_GRACE_MS);
    const stale = await this.prisma.client.posTableReservation.findMany({
      where: { status: 'pending', startAt: { lt: cutoff } },
      select: { id: true },
    });
    for (const s of stale) {
      try { await this.markNoShow(s.id); } catch (e: any) { this.logger.warn(`No-show mark failed: ${e?.message}`); }
    }
    return stale.length;
  }

    /**
     * Worker entry point — flip pending reservations whose startAt is within
     * 60 minutes and the table is AVAILABLE → RESERVED. Ensures the picker
     * always reflects upcoming bookings. Respects open orders (table stays occupied).
     */
    async refreshReservedFlags(): Promise<number> {
      const soon = new Date(Date.now() + 60 * 60 * 1000);
      const upcoming = await this.prisma.client.posTableReservation.findMany({
        where: { status: 'pending', startAt: { lt: soon } },
        select: { id: true, tableId: true },
      });
      let flipped = 0;
      for (const u of upcoming) {
        const openCount = await this.prisma.client.posTableOrder.count({
          where: { tableId: u.tableId, closedAt: null },
        });
        if (openCount > 0) continue; // table is occupied, don't override
        const table = await this.prisma.client.posTable.findFirst({ where: { id: u.tableId } });
        if (table && table.status === 'available') {
          await this.prisma.client.posTable.update({
            where: { id: u.tableId },
            data: { status: 'reserved' as any },
          });
          flipped += 1;
        }
      }
      return flipped;
    }
}