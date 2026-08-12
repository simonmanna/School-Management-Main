/**
 * POS Phase A — Held orders / open tabs.
 *
 * A PosHold is a lightweight parking spot for a partially-built cart. The
 * cashier builds lines, taps "Hold", and the cart is parked under a friendly
 * name ("Sarah / table 3") until it's recalled and tendered. At recall time
 * the POS vertical materialises the hold into a real sales_invoice + payment
 * via the existing DocumentBuilderService — no new money primitives.
 *
 * The service does NOT touch Document/Payment; it only manages the parking
 * metadata. Recall returns the hold + lines so the frontend can rehydrate
 * the cart and re-submit through the existing /pos/checkout endpoint.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { EventBus } from '../../kernel/events/event-bus';
import { EVENTS } from '@erp/shared';

export interface PosHoldLineInput {
  productId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
  taxId?: string;
  note?: string;
}

export interface CreatePosHoldDto {
  name: string;
  partnerId?: string;
  branchId?: string;
  cashSessionId?: string;
  notes?: string;
  lines: PosHoldLineInput[];
}

@Injectable()
export class PosHoldsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  /** Create a new hold. Lines are required (an empty hold is just noise). */
  async create(dto: CreatePosHoldDto) {
    const organizationId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    if (!dto.lines?.length) {
      throw new BadRequestException('Hold must contain at least one line');
    }
    if (!dto.name?.trim()) {
      throw new BadRequestException('Hold name is required');
    }
    return this.prisma.client.$transaction(async (tx: any) => {
      const totalAmount = this.computeTotal(dto.lines);
      const hold = await tx.posHold.create({
        data: {
          organizationId,
          name: dto.name.trim(),
          partnerId: dto.partnerId ?? null,
          branchId: dto.branchId ?? null,
          cashSessionId: dto.cashSessionId ?? null,
          notes: dto.notes ?? null,
          totalAmount,
          heldById: userId ?? null,
          lines: {
            create: dto.lines.map((ln, i) => ({
              organizationId,
              productId: ln.productId ?? null,
              description: ln.description,
              quantity: ln.quantity,
              unitPrice: ln.unitPrice,
              discountPercent: ln.discountPercent ?? 0,
              taxId: ln.taxId ?? null,
              lineNumber: i + 1,
              note: ln.note ?? null,
            })),
          },
        },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      await this.audit.recordInTx(tx, {
        entity: 'PosHold',
        entityId: hold.id,
        action: 'create',
        newValues: { name: hold.name, totalAmount: totalAmount.toString() },
      });
      this.events.publish(EVENTS.PosHoldCreated, {
        organizationId,
        holdId: hold.id,
        name: hold.name,
        total: totalAmount.toString(),
        heldById: userId ?? '',
      });
      return hold;
    });
  }

  /** List holds, optionally filtered. Default scope = open holds only. */
  async list(params: { status?: 'open' | 'recalled' | 'cancelled'; branchId?: string; cashSessionId?: string } = {}) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.posHold.findMany({
      where: {
        organizationId,
        ...(params.status ? { status: params.status } : { status: 'open' }),
        ...(params.branchId ? { branchId: params.branchId } : {}),
        ...(params.cashSessionId ? { cashSessionId: params.cashSessionId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
      take: 100,
    });
  }

  /** Get a single hold with lines. */
  async get(id: string) {
    const organizationId = this.tenant.organizationId;
    const hold = await this.prisma.client.posHold.findFirst({
      where: { id, organizationId },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!hold) throw new NotFoundException('Hold not found');
    return hold;
  }

  /**
   * Mark a hold as recalled. The cashier is expected to immediately follow
   * up by POSTing /pos/checkout with the recalled lines. Recall just unparks
   * the snapshot; it does NOT create any accounting effect.
   */
  async recall(id: string) {
    const organizationId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const existing = await tx.posHold.findFirst({ where: { id, organizationId } });
      if (!existing) throw new NotFoundException('Hold not found');
      if (existing.status !== 'open') {
        throw new BadRequestException(`Hold is ${existing.status}, not open`);
      }
      const updated = await tx.posHold.update({
        where: { id },
        data: {
          status: 'recalled',
          recalledById: userId ?? null,
          recalledAt: new Date(),
        },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      await this.audit.recordInTx(tx, {
        entity: 'PosHold',
        entityId: id,
        action: 'update',
        oldValues: { status: 'open' },
        newValues: { status: 'recalled', recalledById: userId ?? null },
      });
      this.events.publish(EVENTS.PosHoldRecalled, {
        organizationId,
        holdId: id,
        recalledById: userId ?? '',
      });
      return updated;
    });
  }

  /** Cancel (abandon) a hold. The hold is NOT deleted — it stays for audit. */
  async cancel(id: string) {
    const organizationId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const existing = await tx.posHold.findFirst({ where: { id, organizationId } });
      if (!existing) throw new NotFoundException('Hold not found');
      if (existing.status !== 'open') {
        throw new BadRequestException(`Hold is ${existing.status}, not open`);
      }
      const updated = await tx.posHold.update({
        where: { id },
        data: {
          status: 'cancelled',
          cancelledById: userId ?? null,
          cancelledAt: new Date(),
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'PosHold',
        entityId: id,
        action: 'update',
        oldValues: { status: 'open' },
        newValues: { status: 'cancelled', cancelledById: userId ?? null },
      });
      this.events.publish(EVENTS.PosHoldDeleted, { organizationId, holdId: id });
      return updated;
    });
  }

  /** Update notes on an open hold (e.g. "called away, will return"). */
  async updateNotes(id: string, notes: string) {
    const organizationId = this.tenant.organizationId;
    const hold = await this.prisma.client.posHold.findFirst({ where: { id, organizationId } });
    if (!hold) throw new NotFoundException('Hold not found');
    if (hold.status !== 'open') throw new BadRequestException('Hold is not open');
    return this.prisma.client.posHold.update({ where: { id }, data: { notes } });
  }

  // ─── helpers ─────────────────────────────────────────────────────────────
  private computeTotal(lines: PosHoldLineInput[]): number {
    return lines.reduce((sum, ln) => {
      const gross = Number(ln.quantity) * Number(ln.unitPrice);
      const discounted = gross * (1 - Number(ln.discountPercent ?? 0) / 100);
      return sum + discounted;
    }, 0);
  }
}