import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { AudienceResolverService } from '../audience/audience-resolver.service';
import { parseAudienceSelector, type AudienceSelector } from '../audience/audience-selector';
import { describePolicy, parseChannelPolicy } from '../outbound/channel-policy';
import { countSegments } from '../providers/sms/sms-segments';
import { TemplateRenderService } from '../rules/template-render.service';

/**
 * Compose, schedule, cancel and report on broadcasts.
 *
 * The lifecycle is deliberately explicit:
 *
 *   draft ──submit──▶ scheduled ──worker──▶ materializing ──▶ sending ──▶ completed
 *      └──────────────────── cancel ────────────────────────────┘
 *
 * `scheduled` covers "send now" too (with `scheduledAt = now`), so there is ONE
 * path into sending rather than an immediate path and a deferred path that drift
 * apart. Cancelling is honoured at every stage before `completed`, including
 * mid-drain — a wrongly-worded message to 400 parents is the failure everyone
 * remembers, so stopping it must not depend on catching it before the worker.
 */

export interface CreateBroadcastInput {
  title?: string;
  body: string;
  templateKey?: string;
  audience: AudienceSelector;
  channelPolicy?: unknown;
  /** ISO timestamp. Omit for "send on submit". */
  scheduledAt?: string;
}

/** Statuses past which a broadcast can no longer be edited or re-submitted. */
const TERMINAL = ['completed', 'cancelled', 'failed'];

/**
 * `costMicros` is a BigInt, which `JSON.stringify` refuses to serialize — an
 * un-serialized broadcast row is a 500, not a rounding bug. Emitted as a string
 * for the same reason `Message.seq` is: a cost in micro-units can exceed
 * `Number.MAX_SAFE_INTEGER` for a large enough campaign, and silently losing
 * precision on money is worse than making the client parse a string.
 */
function serializeBroadcast<T extends { costMicros: bigint }>(b: T): Omit<T, 'costMicros'> & { costMicros: string } {
  return { ...b, costMicros: b.costMicros.toString() };
}

@Injectable()
export class BroadcastService {
  private readonly logger = new Logger('Broadcast');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly audience: AudienceResolverService,
    private readonly templates: TemplateRenderService,
  ) {}

  /* ── Compose ──────────────────────────────────────────────────────────── */

  /**
   * Dry-run an audience: how many people, how many are unreachable, what it will
   * cost. Called by the composer on every audience change, so it must stay a
   * read — nothing here writes.
   */
  async preview(input: { audience: AudienceSelector; body: string; channelPolicy?: unknown }) {
    const selector = parseAudienceSelector(input.audience);
    const policy = parseChannelPolicy(input.channelPolicy);
    const resolved = await this.audience.resolve(this.tenant.organizationId, selector);
    const seg = countSegments(input.body ?? '');

    return {
      description: resolved.description,
      policy: describePolicy(policy),
      counts: resolved.counts,
      segments: seg,
      /** Worst case: every recipient goes out over SMS at this segment count. */
      estimatedSmsSegments: seg.segments * resolved.counts.reachableByPhone,
      /** First 25 names, so the operator can sanity-check WHO before sending. */
      sample: resolved.members.slice(0, 25).map((m) => ({
        kind: m.kind,
        displayName: m.displayName,
        address: m.phone,
        studentName: m.studentName,
        className: m.className,
        relationship: m.relationship,
      })),
      unreachableSample: resolved.unreachable.slice(0, 25).map((m) => ({
        kind: m.kind,
        displayName: m.displayName,
        studentName: m.studentName,
        className: m.className,
      })),
    };
  }

  async create(input: CreateBroadcastInput) {
    const orgId = this.tenant.organizationId;
    if (!input.body?.trim()) throw new BadRequestException('Message body is required.');

    // Validate both descriptors NOW. A selector or policy that only fails at 6am
    // on the worker is a broadcast that silently never happened.
    const selector = parseAudienceSelector(input.audience);
    const policy = parseChannelPolicy(input.channelPolicy);

    const created = await this.prisma.client.messageBroadcast.create({
      data: {
        organizationId: orgId,
        title: input.title?.trim() || null,
        body: input.body.trim(),
        templateKey: input.templateKey ?? null,
        audience: selector as object,
        channelPolicy: policy as object,
        status: 'draft',
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        createdById: this.tenant.userId ?? null,
      },
    });
    await this.audit.record({
      entity: 'MessageBroadcast',
      entityId: created.id,
      action: 'create',
      newValues: { title: created.title, audience: selector, policy: describePolicy(policy) },
    });
    return serializeBroadcast(created);
  }

  async update(id: string, input: Partial<CreateBroadcastInput>) {
    const existing = await this.require(id);
    if (existing.status !== 'draft') {
      throw new BadRequestException(`A broadcast in status '${existing.status}' can no longer be edited.`);
    }
    const selector = input.audience ? parseAudienceSelector(input.audience) : undefined;
    const policy = input.channelPolicy !== undefined ? parseChannelPolicy(input.channelPolicy) : undefined;

    const updated = await this.prisma.client.messageBroadcast.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title?.trim() || null } : {}),
        ...(input.body !== undefined ? { body: input.body.trim() } : {}),
        ...(input.templateKey !== undefined ? { templateKey: input.templateKey ?? null } : {}),
        ...(selector ? { audience: selector as object } : {}),
        ...(policy ? { channelPolicy: policy as object } : {}),
        ...(input.scheduledAt !== undefined
          ? { scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null }
          : {}),
      },
    });
    return serializeBroadcast(updated);
  }

  /* ── Lifecycle ────────────────────────────────────────────────────────── */

  /**
   * Hand the broadcast to the worker. `scheduledAt` in the past (or absent) means
   * the next tick picks it up, so "send now" and "send at 6am" are the same code
   * path and cannot behave differently.
   */
  async submit(id: string, scheduledAt?: string) {
    const existing = await this.require(id);
    if (existing.status !== 'draft') {
      throw new BadRequestException(`Only a draft can be submitted (this one is '${existing.status}').`);
    }
    const when = scheduledAt ? new Date(scheduledAt) : (existing.scheduledAt ?? new Date());
    if (Number.isNaN(when.getTime())) throw new BadRequestException('scheduledAt is not a valid date.');

    const updated = await this.prisma.client.messageBroadcast.update({
      where: { id },
      data: { status: 'scheduled', scheduledAt: when, lastError: null },
    });
    await this.audit.record({
      entity: 'MessageBroadcast',
      entityId: id,
      action: 'update',
      newValues: { status: 'scheduled', scheduledAt: when.toISOString() },
    });
    return serializeBroadcast(updated);
  }

  /**
   * Stop a broadcast.
   *
   * Cancels the broadcast, every recipient not yet sent, AND every queued
   * delivery already handed to the dispatcher. That last part is what makes this
   * a real stop button rather than a flag: without it the worker keeps draining
   * a queue nobody wants any more.
   *
   * Already-sent messages are left alone — they are gone, and pretending
   * otherwise in the report would be a lie.
   */
  async cancel(id: string, reason?: string) {
    const existing = await this.require(id);
    if (TERMINAL.includes(existing.status)) {
      throw new BadRequestException(`This broadcast is already '${existing.status}'.`);
    }
    const now = new Date();
    const result = await this.prisma.client.$transaction(async (tx) => {
      const deliveries = await tx.messageDelivery.updateMany({
        where: { broadcastId: id, status: { in: ['queued', 'sending'] } },
        data: {
          status: 'cancelled',
          errorCode: 'broadcast_cancelled',
          lastError: reason ?? 'Broadcast cancelled by an operator.',
          claimToken: null,
          claimedAt: null,
        },
      });
      const recipients = await tx.broadcastRecipient.updateMany({
        where: { broadcastId: id, status: { in: ['pending', 'queued'] } },
        data: { status: 'cancelled', lastError: reason ?? null },
      });
      const b = await tx.messageBroadcast.update({
        where: { id },
        data: {
          status: 'cancelled',
          cancelledAt: now,
          cancelledBy: this.tenant.userId ?? null,
          claimToken: null,
          claimedAt: null,
        },
      });
        return { broadcast: b, cancelledDeliveries: deliveries.count, cancelledRecipients: recipients.count };
    });
    await this.audit.record({
      entity: 'MessageBroadcast',
      entityId: id,
      action: 'update',
      newValues: {
        status: 'cancelled',
        reason: reason ?? null,
        cancelledDeliveries: result.cancelledDeliveries,
      },
    });
    this.logger.warn(
      `broadcast ${id} cancelled — ${result.cancelledDeliveries} queued deliveries stopped, ${result.cancelledRecipients} recipients dropped`,
    );
    return { ...result, broadcast: serializeBroadcast(result.broadcast) };
  }

  /* ── Read ─────────────────────────────────────────────────────────────── */

  async list(params: { status?: string; limit?: number } = {}) {
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
    const rows = await this.prisma.client.messageBroadcast.findMany({
      where: { ...(params.status ? { status: params.status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(serializeBroadcast);
  }

  async get(id: string) {
    const b = await this.require(id);
    return { ...serializeBroadcast(b), policyDescription: describePolicy(parseChannelPolicy(b.channelPolicy)) };
  }

  /**
   * The delivery report.
   *
   * Counts come from BroadcastRecipient, not MessageDelivery, because the
   * question is "did the school reach this parent?" — and a parent with no phone
   * number on file has no delivery row at all. Grouping over deliveries would
   * make exactly the people who most need chasing invisible.
   */
  async report(id: string) {
    const b = await this.require(id);
    const byStatus = await this.prisma.client.broadcastRecipient.groupBy({
      by: ['status'],
      where: { broadcastId: id },
      _count: { _all: true },
    });
    const byProvider = await this.prisma.client.broadcastRecipient.groupBy({
      by: ['providerId', 'status'],
      where: { broadcastId: id, providerId: { not: null } },
      _count: { _all: true },
    });
    const cost = await this.prisma.client.messageDelivery.aggregate({
      where: { broadcastId: id },
      _sum: { segments: true, costMicros: true },
    });
    return {
      broadcast: { ...serializeBroadcast(b), policyDescription: describePolicy(parseChannelPolicy(b.channelPolicy)) },
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
      byProvider: byProvider.map((r) => ({ providerId: r.providerId, status: r.status, count: r._count._all })),
      totals: {
        segments: cost._sum.segments ?? 0,
        costMicros: (cost._sum.costMicros ?? BigInt(0)).toString(),
      },
    };
  }

  /** Paged recipient list for the report table. */
  async recipients(id: string, params: { status?: string; search?: string; limit?: number; cursor?: string }) {
    await this.require(id);
    const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
    const rows = await this.prisma.client.broadcastRecipient.findMany({
      where: {
        broadcastId: id,
        ...(params.status ? { status: params.status } : {}),
        ...(params.search
          ? {
              OR: [
                { displayName: { contains: params.search, mode: 'insensitive' as const } },
                { address: { contains: params.search } },
                { studentName: { contains: params.search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    return { rows: rows.slice(0, limit), nextCursor: hasMore ? rows[limit - 1].id : null };
  }

  private async require(id: string) {
    const b = await this.prisma.client.messageBroadcast.findFirst({ where: { id } });
    if (!b) throw new NotFoundException('Broadcast not found.');
    return b;
  }
}
