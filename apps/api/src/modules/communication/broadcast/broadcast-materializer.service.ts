import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { AudienceResolverService, type AudienceMember } from '../audience/audience-resolver.service';
import { parseAudienceSelector } from '../audience/audience-selector';
import { parseChannelPolicy } from '../outbound/channel-policy';
import { OutboundFanoutService } from '../outbound/outbound-fanout.service';
import { ConsentService } from '../consent/consent.service';
import { TemplateRenderService } from '../rules/template-render.service';
import { countSegments } from '../providers/sms/sms-segments';

/**
 * Turns a scheduled broadcast into recipient rows and queued deliveries.
 *
 * Runs in two passes, on purpose:
 *
 *   PASS 1 resolves the audience and writes every BroadcastRecipient — including
 *   the ones that will never receive anything. Doing this first means the report
 *   is complete and accurate the moment sending starts, and that a crash halfway
 *   through fan-out cannot lose the fact that a parent was meant to be reached.
 *
 *   PASS 2 walks those rows in batches and hands each to the fan-out. It is
 *   restartable: rows are claimed by status, so a worker that dies mid-broadcast
 *   resumes exactly where it stopped without re-messaging anyone.
 *
 * Idempotency rests on `BroadcastRecipient.dedupeKey` being unique per broadcast.
 * Re-running pass 1 cannot duplicate a person, and pass 2 only ever touches rows
 * still in `pending`.
 */

/** Recipients handled per fan-out batch. Bounded so one broadcast cannot hold a
 *  transaction slot or the event loop for the length of a whole school roster. */
const FANOUT_BATCH = 100;

@Injectable()
export class BroadcastMaterializerService {
  private readonly logger = new Logger('BroadcastMaterializer');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audience: AudienceResolverService,
    private readonly fanout: OutboundFanoutService,
    private readonly consent: ConsentService,
    private readonly templates: TemplateRenderService,
  ) {}

  /**
   * Pass 1. Resolve the audience and persist one row per intended recipient.
   * Returns the number of rows written (0 when already materialized).
   */
  async materialize(organizationId: string, broadcastId: string): Promise<number> {
    const broadcast = await this.prisma.raw.messageBroadcast.findUnique({ where: { id: broadcastId } });
    if (!broadcast || broadcast.status === 'cancelled') return 0;

    const selector = parseAudienceSelector(broadcast.audience);
    const resolved = await this.audience.resolve(organizationId, selector);
    const seg = countSegments(broadcast.body);

    const rows = [
      ...resolved.members.map((m) => this.toRow(organizationId, broadcastId, m, 'pending')),
      // Unreachable people are persisted too — see the class comment. They are the
      // registrar's to-do list, and omitting them is how "sent to 380 of 400"
      // becomes a number nobody questions.
      ...resolved.unreachable.map((m) => this.toRow(organizationId, broadcastId, m, 'unreachable', 'no_address')),
    ];

    // Apply the suppression list up front, in ONE query, so opted-out parents are
    // reported as suppressed rather than queued-then-cancelled.
    const addresses = rows.map((r) => r.address).filter((a): a is string => !!a);
    const policy = parseChannelPolicy(broadcast.channelPolicy);
    const externalProvider = policy.steps.find((s) => s.providerId !== 'internal')?.providerId ?? 'sms';
    const suppressed = await this.consent.suppressedAddresses(organizationId, externalProvider, addresses);
    for (const r of rows) {
      if (r.address && suppressed.has(r.address)) {
        r.status = 'suppressed';
        r.suppressionReason = 'opted_out';
      }
    }

    let written = 0;
    for (let i = 0; i < rows.length; i += FANOUT_BATCH) {
      const batch = rows.slice(i, i + FANOUT_BATCH);
      const result = await this.prisma.raw.broadcastRecipient.createMany({
        data: batch,
        // A re-run after a crash must not duplicate anyone. The unique
        // (broadcastId, dedupeKey) makes this a no-op for rows already present.
        skipDuplicates: true,
      });
      written += result.count;
    }

    await this.prisma.raw.messageBroadcast.update({
      where: { id: broadcastId },
      data: {
        status: 'sending',
        materializedAt: new Date(),
        startedAt: new Date(),
        totalRecipients: rows.length,
        suppressedCount: rows.filter((r) => r.status === 'suppressed').length,
        unreachableCount: rows.filter((r) => r.status === 'unreachable').length,
        estimatedSegments: seg.segments * rows.filter((r) => r.status === 'pending').length,
        lastError: null,
      },
    });

    this.logger.log(
      `broadcast ${broadcastId} materialized: ${rows.length} recipients (${written} new), ` +
        `${rows.filter((r) => r.status === 'suppressed').length} suppressed, ` +
        `${rows.filter((r) => r.status === 'unreachable').length} unreachable`,
    );
    return written;
  }

  /**
   * Pass 2. Fan out one batch of pending recipients. Returns how many were
   * processed, so the worker can keep calling until it returns 0.
   */
  async fanoutBatch(organizationId: string, broadcastId: string): Promise<number> {
    const broadcast = await this.prisma.raw.messageBroadcast.findUnique({ where: { id: broadcastId } });
    if (!broadcast || broadcast.status !== 'sending') return 0;

    const pending = await this.prisma.raw.broadcastRecipient.findMany({
      where: { broadcastId, status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: FANOUT_BATCH,
    });
    if (pending.length === 0) return 0;

    const policy = parseChannelPolicy(broadcast.channelPolicy);
    this.fanout.resetCache();

    for (const r of pending) {
      try {
        // Per-recipient rendering. `{{student.name}}` is why a fee reminder is
        // worth sending per student rather than per parent.
        const body = this.templates.render(broadcast.body, {
          student: { name: r.studentName ?? '', className: r.className ?? '' },
          recipient: { name: r.displayName, relationship: r.relationship ?? '' },
          guardian: { name: r.displayName },
          school: { name: '' },
        });

        const outcome = await this.fanout.fanoutOne({
          organizationId,
          recipient: {
            address: r.address,
            userId: r.userId,
            displayName: r.displayName,
            contextType: r.studentProfileId ? 'StudentProfile' : null,
            contextId: r.studentProfileId,
          },
          body,
          policy,
          broadcastId,
          broadcastRecipientId: r.id,
          senderUserId: broadcast.createdById,
        });

        await this.prisma.raw.broadcastRecipient.update({
          where: { id: r.id },
          data:
            outcome.kind === 'queued'
              ? {
                  status: 'queued',
                  providerId: outcome.providerId,
                  messageId: outcome.messageId,
                  deliveryId: outcome.deliveryId,
                }
              : outcome.kind === 'suppressed'
                ? { status: 'suppressed', suppressionReason: 'opted_out', providerId: outcome.providerId }
                : { status: 'unreachable', suppressionReason: outcome.reason },
        });
      } catch (err) {
        // One bad row must not stop the broadcast. It is marked failed with the
        // reason and shows up in the report; the rest of the class still gets told.
        this.logger.warn(`broadcast ${broadcastId} recipient ${r.id} failed: ${String(err)}`);
        await this.prisma.raw.broadcastRecipient.update({
          where: { id: r.id },
          data: { status: 'failed', lastError: String(err).slice(0, 500) },
        });
      }
    }
    return pending.length;
  }

  /**
   * Roll the delivery outcomes back up onto the recipient rows and the
   * broadcast's counters, and close the broadcast when nothing is in flight.
   *
   * Counters are recomputed from scratch each pass rather than incremented.
   * Incrementing would drift the moment a delivery is retried, escalated to a
   * fallback transport, or cancelled — and a progress bar that lies is worse
   * than no progress bar.
   */
  async reconcile(organizationId: string, broadcastId: string): Promise<{ done: boolean }> {
    const broadcast = await this.prisma.raw.messageBroadcast.findUnique({ where: { id: broadcastId } });
    if (!broadcast) return { done: true };
    if (['completed', 'cancelled', 'failed'].includes(broadcast.status)) return { done: true };

    // Latest delivery per recipient wins: after an escalation there are two rows
    // for one person, and the newer one is the live attempt.
    const deliveries = await this.prisma.raw.messageDelivery.findMany({
      where: { broadcastId, broadcastRecipientId: { not: null } },
      select: {
        broadcastRecipientId: true,
        status: true,
        providerId: true,
        lastError: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    const latest = new Map<string, (typeof deliveries)[number]>();
    for (const d of deliveries) latest.set(d.broadcastRecipientId!, d);

    for (const [recipientId, d] of latest) {
      const status =
        d.status === 'read' ? 'delivered' : ['queued', 'sending'].includes(d.status) ? 'queued' : d.status;
      await this.prisma.raw.broadcastRecipient.updateMany({
        where: { id: recipientId, status: { notIn: ['suppressed', 'unreachable', 'cancelled'] } },
        data: { status, providerId: d.providerId, lastError: d.lastError },
      });
    }

    const grouped = await this.prisma.raw.broadcastRecipient.groupBy({
      by: ['status'],
      where: { broadcastId },
      _count: { _all: true },
    });
    const count = (s: string) => grouped.find((g) => g.status === s)?._count._all ?? 0;

    const cost = await this.prisma.raw.messageDelivery.aggregate({
      where: { broadcastId },
      _sum: { costMicros: true },
    });

    const inFlight = count('pending') + count('queued');
    const done = inFlight === 0;

    await this.prisma.raw.messageBroadcast.update({
      where: { id: broadcastId },
      data: {
        queuedCount: count('queued'),
        sentCount: count('sent'),
        deliveredCount: count('delivered'),
        failedCount: count('failed'),
        suppressedCount: count('suppressed'),
        unreachableCount: count('unreachable'),
        costMicros: cost._sum.costMicros ?? BigInt(0),
        ...(done ? { status: 'completed', completedAt: new Date(), claimToken: null, claimedAt: null } : {}),
      },
    });
    return { done };
  }

  private toRow(
    organizationId: string,
    broadcastId: string,
    m: AudienceMember,
    status: string,
    suppressionReason?: string,
  ) {
    const address = m.phone ?? null;
    const key = `${address ?? (m.userId ? `user:${m.userId}` : `${m.subjectType}:${m.subjectId}`)}|${m.studentProfileId ?? ''}`;
    return {
      organizationId,
      broadcastId,
      kind: m.kind,
      subjectType: m.subjectType,
      subjectId: m.subjectId,
      displayName: m.displayName,
      address,
      userId: m.userId,
      studentProfileId: m.studentProfileId,
      studentName: m.studentName,
      className: m.className,
      relationship: m.relationship,
      dedupeKey: key,
      status,
      suppressionReason: suppressionReason ?? null,
    };
  }
}
