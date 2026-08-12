import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';
import { LifecycleRegistry } from '../../kernel/lifecycle/lifecycle.registry';
import { REPAIR_ORDER_LIFECYCLE } from './repair-lifecycles';
import { NotificationsService } from '../../kernel/notifications/notifications.service';
import { RepairPostingService } from './repair-posting.service';
import type { RepairOrderStatus, RepairOrderType } from '@prisma/client';

/**
 * RepairService — the RMMS spine: repair orders, their lifecycle transitions
 * and the status-history audit trail.
 *
 * Financial effects never touch JournalLine directly: billing goes through
 * RepairPostingService (→ Order → Invoice spine), parts go through
 * StockService.issue at issue-time. This service owns the document and the
 * state machine only.
 */
@Injectable()
export class RepairService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly seq: SequenceService,
    private readonly lifecycles: LifecycleRegistry,
    private readonly notifications: NotificationsService,
    private readonly posting: RepairPostingService,
  ) {}

  // ── Orders ────────────────────────────────────────────────────────────────

  async listOrders(query: any = {}) {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId };
    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.orderType) where.orderType = query.orderType;
    if (query.partnerId) where.partnerId = query.partnerId;
    if (query.technicianId) where.technicianId = query.technicianId;
    if (query.search) {
      const term = `%${query.search}%`;
      where.OR = [
        { repairNumber: { contains: query.search, mode: 'insensitive' } },
        { serialNumber: { contains: query.search, mode: 'insensitive' } },
        { imei: { contains: query.search, mode: 'insensitive' } },
        { brand: { contains: query.search, mode: 'insensitive' } },
        { model: { contains: query.search, mode: 'insensitive' } },
        { itemType: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.client.repairOrder.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        take: Math.min(Number(query.take ?? 50), 200),
        skip: Number(query.skip ?? 0),
        include: { items: true },
      }),
      this.prisma.client.repairOrder.count({ where }),
    ]);
    return { rows, total };
  }

  async getOrder(id: string) {
    const orgId = this.tenant.organizationId;
    const order = await this.prisma.client.repairOrder.findFirst({
      where: { id, organizationId: orgId },
      include: {
        items: { orderBy: { lineNumber: 'asc' } },
        diagnosis: { orderBy: { diagnosedAt: 'desc' } },
        quotations: { include: { lines: { orderBy: { lineNumber: 'asc' } } }, orderBy: { createdAt: 'desc' } },
        jobs: { orderBy: { createdAt: 'desc' } },
        parts: { orderBy: { createdAt: 'desc' } },
        statusHistory: { orderBy: { changedAt: 'desc' } },
        attachments: { orderBy: { createdAt: 'desc' } },
        warranties: { include: { claims: true } },
      },
    });
    if (!order) throw new NotFoundException('Repair order not found');
    return order;
  }

  async createOrder(dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const repairNumber = await this.seq.next('repair_order', { prefix: 'RPR-', padding: 6 });
    const data: any = {
      organizationId: orgId,
      repairNumber,
      partnerId: dto.partnerId ?? null,
      branchId: dto.branchId ?? null,
      priority: dto.priority ?? 'medium',
      orderType: dto.orderType ?? 'repair',
      itemType: dto.itemType ?? null,
      brand: dto.brand ?? null,
      model: dto.model ?? null,
      serialNumber: dto.serialNumber ?? null,
      imei: dto.imei ?? null,
      assetTag: dto.assetTag ?? null,
      plateNumber: dto.plateNumber ?? null,
      vin: dto.vin ?? null,
      mileage: dto.mileage ?? null,
      color: dto.color ?? null,
      storage: dto.storage ?? null,
      condition: dto.condition ?? null,
      accessories: dto.accessories ?? [],
      problemDescription: dto.problemDescription ?? null,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      technicianId: dto.technicianId ?? null,
      notes: dto.notes ?? null,
      createdBy: userId,
    };
    const order = await this.prisma.client.$transaction(async (tx: any) => {
      const created = await tx.repairOrder.create({ data });
      if (Array.isArray(dto.items) && dto.items.length > 0) {
        await tx.repairOrderItem.createMany({
          data: dto.items.map((it: any, idx: number) => ({
            organizationId: orgId,
            repairOrderId: created.id,
            itemType: it.itemType ?? null,
            brand: it.brand ?? null,
            model: it.model ?? null,
            serialNumber: it.serialNumber ?? null,
            imei: it.imei ?? null,
            assetTag: it.assetTag ?? null,
            plateNumber: it.plateNumber ?? null,
            vin: it.vin ?? null,
            mileage: it.mileage ?? null,
            color: it.color ?? null,
            storage: it.storage ?? null,
            condition: it.condition ?? null,
            accessories: it.accessories ?? [],
            problemDescription: it.problemDescription ?? null,
            lineNumber: idx,
          })),
        });
      }
      await tx.repairStatusHistory.create({
        data: {
          organizationId: orgId,
          repairOrderId: created.id,
          toStatus: 'received',
          action: 'create',
          note: 'Order received',
          changedBy: userId,
        },
      });
      return created;
    });

    await this.notifications.send({
      organizationId: orgId,
      channel: 'in_app',
      category: 'repair',
      title: `Repair order ${repairNumber}`,
      body: `Item received — ${dto.itemType ?? 'item'} (${dto.serialNumber ?? 'no serial'})`,
      payload: { repairOrderId: order.id, repairNumber },
    });
    return this.getOrder(order.id);
  }

  // ── Lifecycle transitions ─────────────────────────────────────────────────

  private async transition(id: string, to: string, action: string, note?: string, extra: any = {}) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const order = await this.prisma.client.repairOrder.findFirst({ where: { id, organizationId: orgId } });
    if (!order) throw new NotFoundException('Repair order not found');
    this.lifecycles.assertTransition('repair.order', order.status, to, action);
    return this.prisma.client.$transaction(async (tx: any) => {
      const stamp: any = {
        received: undefined,
        diagnosedAt: to === 'diagnosis' ? new Date() : undefined,
        quotedAt: to === 'waiting_approval' ? new Date() : undefined,
        approvedAt: to === 'approved' ? new Date() : undefined,
        startedAt: to === 'repairing' ? new Date() : undefined,
        testedAt: to === 'testing' ? new Date() : undefined,
        readyAt: to === 'ready_pickup' ? new Date() : undefined,
        deliveredAt: to === 'delivered' ? new Date() : undefined,
        closedAt: to === 'closed' ? new Date() : undefined,
        cancelledAt: to === 'cancelled' ? new Date() : undefined,
      };
      delete stamp.received;
      const updated = await tx.repairOrder.update({
        where: { id },
        data: {
          status: to,
          updatedBy: userId,
          ...stamp,
          ...extra,
        },
      });
      await tx.repairStatusHistory.create({
        data: {
          organizationId: orgId,
          repairOrderId: id,
          fromStatus: order.status,
          toStatus: to,
          action,
          note: note ?? null,
          changedBy: userId,
        },
      });
      return updated;
    });
  }

  async transitionOrder(id: string, dto: { status?: string; to?: string; action?: string; note?: string; extra?: any }) {
    // Accept both `status` (frontend) and `to` (lifecycle-style) spellings.
    const to = dto.status ?? dto.to;
    if (!to) throw new BadRequestException('status is required');
    // Resolve the canonical lifecycle action for (from → to) when the caller
    // did not pass one explicitly — keeps the frontend contract simple while
    // staying strict about what the registry accepts.
    let action = dto.action;
    if (!action) {
      const order = await this.prisma.client.repairOrder.findFirst({
        where: { id, organizationId: this.tenant.organizationId },
      });
      const found = (REPAIR_ORDER_LIFECYCLE.transitions ?? []).find(
        (t) => (t.from === null || t.from === order?.status) && t.to === to,
      );
      action = found?.action ?? `transition_to_${to}`;
    }
    const updated = await this.transition(id, to, action, dto.note, dto.extra ?? {});
    const order = await this.getOrder(id);
    const partner = order.partnerId
      ? await this.prisma.client.partner.findFirst({ where: { id: order.partnerId } }).catch(() => null)
      : null;
    await this.notifications.send({
      organizationId: this.tenant.organizationId,
      channel: 'in_app',
      category: 'repair',
      title: `${order.repairNumber} → ${to.replace('_', ' ')}`,
      body: (partner?.name ? `${partner.name} — ${dto.note ?? dto.action}` : dto.note ?? dto.action) ?? '',
      payload: { repairOrderId: id, repairNumber: order.repairNumber, status: dto.to },
    });
    return updated;
  }

  async assignTechnician(id: string, dto: { technicianId: string }) {
    const orgId = this.tenant.organizationId;
    const order = await this.prisma.client.repairOrder.findFirst({ where: { id, organizationId: orgId } });
    if (!order) throw new NotFoundException('Repair order not found');
    return this.prisma.client.repairOrder.update({
      where: { id },
      data: { technicianId: dto.technicianId, updatedBy: this.tenant.userId },
    });
  }

  // ── Items ─────────────────────────────────────────────────────────────────

  async addItem(orderId: string, dto: any) {
    const orgId = this.tenant.organizationId;
    const order = await this.prisma.client.repairOrder.findFirst({ where: { id: orderId, organizationId: orgId } });
    if (!order) throw new NotFoundException('Repair order not found');
    const lineNumber = await this.prisma.client.repairOrderItem.count({
      where: { repairOrderId: orderId },
    });
    return this.prisma.client.repairOrderItem.create({
      data: { organizationId: orgId, repairOrderId: orderId, lineNumber, ...dto },
    });
  }

  async removeItem(itemId: string) {
    const orgId = this.tenant.organizationId;
    return this.prisma.client.repairOrderItem.deleteMany({ where: { id: itemId, organizationId: orgId } });
  }

  // ── Attachments ───────────────────────────────────────────────────────────

  async addAttachment(orderId: string, dto: any) {
    const orgId = this.tenant.organizationId;
    return this.prisma.client.repairAttachment.create({
      data: {
        organizationId: orgId,
        repairOrderId: orderId,
        kind: dto.kind ?? 'receipt',
        fileId: dto.fileId ?? null,
        caption: dto.caption ?? null,
        url: dto.url ?? null,
        createdBy: this.tenant.userId,
      },
    });
  }

  async removeAttachment(id: string) {
    const orgId = this.tenant.organizationId;
    return this.prisma.client.repairAttachment.deleteMany({ where: { id, organizationId: orgId } });
  }

  async addNote(id: string, dto: { note: string }) {
    if (!dto.note?.trim()) throw new BadRequestException('Note is required');
    const orgId = this.tenant.organizationId;
    return this.prisma.client.repairStatusHistory.create({
      data: {
        organizationId: orgId,
        repairOrderId: id,
        toStatus: (await this.prisma.client.repairOrder.findFirst({ where: { id, organizationId: orgId } }))?.status ?? 'received',
        action: 'note',
        note: dto.note,
        changedBy: this.tenant.userId,
      },
    });
  }
}
