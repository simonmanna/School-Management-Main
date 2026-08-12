import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';
import { EventBus } from '../../kernel/events/event-bus';
import { AuditService } from '../../kernel/audit/audit.service';
import type { DocumentEventPayload } from '@erp/shared';

export const DEAL_STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const ACTIVITY_TYPES = ['call', 'email', 'meeting', 'note', 'task', 'deal_stage_change'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_STATUSES = ['todo', 'in_progress', 'done', 'cancelled'] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

/** Default page size for CRM lists (matches the rest of the platform). */
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

interface CreateDealInput {
  name: string;
  partnerId: string;
  ownerId?: string;
  stage?: DealStage;
  amount?: number;
  currencyCode?: string;
  expectedClose?: string;
  notes?: string;
}

interface UpdateDealInput {
  name?: string;
  stage?: DealStage;
  amount?: number;
  expectedClose?: string;
  notes?: string;
  ownerId?: string;
}

interface CreateActivityInput {
  type: 'call' | 'email' | 'meeting' | 'note' | 'task';
  title: string;
  body?: string;
  subjectType?: string;
  subjectId?: string;
  dealId?: string;
  partnerId?: string;
  dueAt?: string;
  duration?: number;
}

interface UpdateActivityInput {
  title?: string;
  body?: string;
  dueAt?: string;
  status?: ActivityStatus;
  completed?: boolean;
}

@Injectable()
export class CrmService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly seq: SequenceService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
  ) {}

  /**
   * C2 — Deal ↔ invoice link. Subscribe to `invoice.created` (outbox) and
   * auto-log a timeline activity on the partner's open deal. The outbox worker
   * runs WITHOUT a tenant ALS context, so every query here uses `prisma.raw`
   * with an explicit `organizationId`, and the handler is idempotent on
   * (subjectType, subjectId) so outbox replays can't duplicate activities.
   */
  onModuleInit(): void {
    this.events.subscribe('invoice.created', (payload) => this.handleInvoiceCreated(payload));
  }

  private async handleInvoiceCreated(payload: DocumentEventPayload): Promise<void> {
    const { organizationId, documentId } = payload;
    const doc = await this.prisma.raw.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true, documentNumber: true, partnerId: true },
    });
    if (!doc?.partnerId) return;

    const existing = await this.prisma.raw.activity.findFirst({
      where: { organizationId, subjectType: 'Invoice', subjectId: doc.id, type: 'note' },
      select: { id: true },
    });
    if (existing) return;

    const openDeal = await this.prisma.raw.deal.findFirst({
      where: {
        organizationId,
        partnerId: doc.partnerId,
        deletedAt: null,
        stage: { in: ['lead', 'qualified', 'proposal', 'negotiation'] },
      },
      select: { id: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (!openDeal) return;

    await this.prisma.raw.activity.create({
      data: {
        organizationId,
        type: 'note',
        subjectType: 'Invoice',
        subjectId: doc.id,
        dealId: openDeal.id,
        partnerId: doc.partnerId,
        title: `Invoice ${doc.documentNumber} created`,
        body: `Invoice ${doc.documentNumber} was created for this partner — see the linked document in Timeline.`,
      },
    });
  }

  // ──────────────── Deals ────────────────

  async createDeal(input: CreateDealInput) {
    const orgId = this.tenant.organizationId;
    const partner = await this.prisma.raw.partner.findFirst({
      where: { organizationId: orgId, id: input.partnerId },
    });
    if (!partner) throw new NotFoundException('Partner not found');
    const deal = await this.prisma.client.deal.create({
      data: {
        organizationId: orgId,
        name: input.name,
        partnerId: input.partnerId,
        ownerId: input.ownerId ?? this.tenant.userId,
        stage: input.stage ?? 'lead',
        amount: input.amount ?? 0,
        currencyCode: input.currencyCode ?? 'USD',
        expectedClose: input.expectedClose ? new Date(input.expectedClose) : null,
        notes: input.notes,
      },
    });
    await this.audit.record({
      entity: 'Deal',
      entityId: deal.id,
      action: 'create',
      newValues: { name: deal.name, stage: deal.stage, amount: Number(deal.amount) },
    });
    this.events.publish('crm.deal.created' as any, {
      organizationId: orgId,
      dealId: deal.id,
      name: deal.name,
      stage: deal.stage,
    });
    return deal;
  }

  async updateDeal(id: string, input: UpdateDealInput) {
    const deal = await this.requireDeal(id);
    const updated = await this.prisma.client.deal.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.stage !== undefined ? { stage: input.stage } : {}),
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(input.expectedClose !== undefined ? { expectedClose: input.expectedClose ? new Date(input.expectedClose) : null } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
      },
    });
    await this.audit.record({
      entity: 'Deal',
      entityId: id,
      action: 'update',
      newValues: input as any,
    });
    return updated;
  }

  async changeStage(id: string, stage: DealStage) {
    const deal = await this.requireDeal(id);
    if (deal.stage === stage) return deal;
    const updated = await this.prisma.client.deal.update({
      where: { id },
      data: { stage },
    });

    // F24 — a won deal converts the partner into a customer (one-time).
    if (stage === 'won') {
      const partner = await this.prisma.raw.partner.findFirst({
        where: { id: deal.partnerId, organizationId: this.tenant.organizationId },
        select: { id: true, isCustomer: true },
      });
      if (partner && !partner.isCustomer) {
        await this.prisma.raw.partner.update({
          where: { id: partner.id },
          data: { isCustomer: true },
        });
      }
    }
    // Auto-create a deal_stage_change activity so the timeline is complete.
    await this.prisma.client.activity.create({
      data: {
        organizationId: this.tenant.organizationId,
        type: 'deal_stage_change',
        title: `Stage: ${deal.stage} → ${stage}`,
        dealId: id,
        partnerId: deal.partnerId,
        occurredAt: new Date(),
        createdById: this.tenant.userId ?? null,
      },
    });
    this.events.publish('crm.deal.stage_changed' as any, {
      organizationId: this.tenant.organizationId,
      dealId: id,
      fromStage: deal.stage,
      toStage: stage,
    });
    return updated;
  }

  /**
   * Paginated deal list. Filters: stage, partnerId, ownerId (my pipeline),
   * free-text `q` on the deal name. Owner is resolved in a second query so the
   * response carries `owner: { id, email, name }` without a schema relation.
   */
  async listDeals(query: { stage?: string; partnerId?: string; ownerId?: string; q?: string; page?: number; pageSize?: number }) {
    const where: any = {};
    if (query.stage) where.stage = query.stage;
    if (query.partnerId) where.partnerId = query.partnerId;
    if (query.ownerId) where.ownerId = query.ownerId;
    if (query.q) where.name = { contains: query.q, mode: 'insensitive' };

    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE));

    const [items, total] = await Promise.all([
      this.prisma.client.deal.findMany({
        where,
        include: { partner: { select: { name: true, code: true } } },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.deal.count({ where }),
    ]);

    return {
      data: await this.attachUsers(items.map((d) => ({ ...d, amount: Number(d.amount) }))),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  async findDeal(id: string) {
    const deal = await this.prisma.client.deal.findFirst({
      where: { id, organizationId: this.tenant.organizationId },
      include: {
        partner: { include: { contacts: true } },
        activities: { orderBy: { occurredAt: 'desc' }, take: 50 },
      },
    });
    if (!deal) throw new NotFoundException('Deal not found');
    const [enriched] = await this.attachUsers([{ ...deal, amount: Number(deal.amount) }]);
    return enriched;
  }

  /** Soft delete — sets deletedAt; the tenancy extension hides it from reads. */
  async removeDeal(id: string) {
    const deal = await this.requireDeal(id);
    if (deal.stage === 'won') throw new BadRequestException('Cannot delete a won deal; archive it instead');
    const updated = await this.prisma.client.deal.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit.record({
      entity: 'Deal',
      entityId: id,
      action: 'delete',
      newValues: { deletedAt: updated.deletedAt },
    });
    this.events.publish('crm.deal.deleted' as any, {
      organizationId: this.tenant.organizationId,
      dealId: id,
    });
    return { ok: true };
  }

  /** Restore a soft-deleted deal. `deletedAt: { not: null }` overrides the
   *  extension's auto-injected `deletedAt: null` so the update targets the row. */
  async restoreDeal(id: string) {
    const existing = await this.prisma.client.deal.findFirst({ where: { id, deletedAt: { not: null } } });
    if (!existing) throw new NotFoundException('Archived deal not found');
    const restored = await this.prisma.client.deal.update({
      where: { id, deletedAt: { not: null } },
      data: { deletedAt: null },
    });
    await this.audit.record({ entity: 'Deal', entityId: id, action: 'restore', newValues: { stage: restored.stage } });
    return restored;
  }

  async listDeletedDeals() {
    const items = await this.prisma.client.deal.findMany({
      where: { deletedAt: { not: null } },
      include: { partner: { select: { name: true, code: true } } },
      orderBy: { deletedAt: 'desc' },
      take: 200,
    });
    return this.attachUsers(items.map((d) => ({ ...d, amount: Number(d.amount) })));
  }

  // ──────────────── Activities ────────────────

  async createActivity(input: CreateActivityInput) {
    const orgId = this.tenant.organizationId;
    if (input.dealId) {
      const deal = await this.prisma.raw.deal.findFirst({ where: { id: input.dealId, organizationId: orgId } });
      if (!deal) throw new NotFoundException('Deal not found');
    }
    if (input.partnerId) {
      const partner = await this.prisma.raw.partner.findFirst({ where: { id: input.partnerId, organizationId: orgId } });
      if (!partner) throw new NotFoundException('Partner not found');
    }
    const activity = await this.prisma.client.activity.create({
      data: {
        organizationId: orgId,
        type: input.type,
        title: input.title,
        body: input.body,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        dealId: input.dealId,
        partnerId: input.partnerId,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        duration: input.duration,
        status: 'todo',
        createdById: this.tenant.userId ?? null,
      },
    });
    return activity;
  }

  async updateActivity(id: string, input: UpdateActivityInput) {
    await this.requireActivity(id);
    const updated = await this.prisma.client.activity.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.dueAt !== undefined ? { dueAt: input.dueAt ? new Date(input.dueAt) : null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.completed !== undefined ? { completed: input.completed, completedAt: input.completed ? new Date() : null } : {}),
      },
    });
    return updated;
  }

  async completeActivity(id: string) {
    await this.requireActivity(id);
    return this.prisma.client.activity.update({
      where: { id },
      data: { status: 'done', completed: true, completedAt: new Date() },
    });
  }

  /** Paginated activity list. Filters: type, dealId, partnerId, status. */
  async listActivities(query: { type?: string; dealId?: string; partnerId?: string; status?: string; page?: number; pageSize?: number }) {
    const where: any = {};
    if (query.type) where.type = query.type;
    if (query.dealId) where.dealId = query.dealId;
    if (query.partnerId) where.partnerId = query.partnerId;
    if (query.status) where.status = query.status;

    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE));

    const [items, total] = await Promise.all([
      this.prisma.client.activity.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.activity.count({ where }),
    ]);

    return {
      data: await this.attachUsers(items),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  /** Open task follow-ups (status todo/in_progress), nearest due date first. */
  async upcomingTasks(limit: number) {
    const items = await this.prisma.client.activity.findMany({
      where: {
        type: 'task',
        status: { in: ['todo', 'in_progress'] },
        OR: [{ dueAt: null }, { dueAt: { gte: new Date() } }],
      },
      orderBy: { dueAt: 'asc' },
      take: Math.min(100, Math.max(1, limit)),
    });
    return this.attachUsers(items);
  }

  /** Soft delete — sets deletedAt; the tenancy extension hides it from reads. */
  async removeActivity(id: string) {
    await this.requireActivity(id);
    await this.prisma.client.activity.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({ entity: 'Activity', entityId: id, action: 'delete', newValues: {} });
    return { ok: true };
  }

  async restoreActivity(id: string) {
    const existing = await this.prisma.client.activity.findFirst({ where: { id, deletedAt: { not: null } } });
    if (!existing) throw new NotFoundException('Archived activity not found');
    const restored = await this.prisma.client.activity.update({
      where: { id, deletedAt: { not: null } },
      data: { deletedAt: null },
    });
    await this.audit.record({ entity: 'Activity', entityId: id, action: 'restore', newValues: {} });
    return restored;
  }

  async listDeletedActivities() {
    return this.prisma.client.activity.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      take: 200,
    });
  }

  // ──────────────── Helpers ────────────────

  private async requireDeal(id: string) {
    const deal = await this.prisma.client.deal.findFirst({
      where: { id, organizationId: this.tenant.organizationId },
    });
    if (!deal) throw new NotFoundException('Deal not found');
    return deal;
  }

  private async requireActivity(id: string) {
    const a = await this.prisma.client.activity.findFirst({
      where: { id, organizationId: this.tenant.organizationId },
    });
    if (!a) throw new NotFoundException('Activity not found');
    return a;
  }

  /**
   * Resolve `ownerId` → `owner` and `createdById` → `createdBy` for a list of
   * rows in a single extra query (Deal has no Prisma `owner` relation, so the
   * join cannot be expressed in `include`). Rows are returned with the same
   * shape plus the resolved user objects.
   */
  private async attachUsers<T extends Record<string, any>>(rows: T[]): Promise<T[]> {
    const userIds = new Set<string>();
    for (const r of rows) {
      if (r.ownerId) userIds.add(r.ownerId);
      if (r.createdById) userIds.add(r.createdById);
    }
    if (userIds.size === 0) return rows;

    const users = await this.prisma.client.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    return rows.map((r) => {
      const clone: Record<string, any> = { ...r };
      if (r.ownerId && byId.has(r.ownerId)) {
        const u = byId.get(r.ownerId)!;
        clone.owner = { id: u.id, email: u.email, name: [u.firstName, u.lastName].filter(Boolean).join(' ') };
      }
      if (r.createdById && byId.has(r.createdById)) {
        const u = byId.get(r.createdById)!;
        clone.createdBy = { id: u.id, email: u.email, name: [u.firstName, u.lastName].filter(Boolean).join(' ') };
      }
      return clone as T;
    });
  }
}
