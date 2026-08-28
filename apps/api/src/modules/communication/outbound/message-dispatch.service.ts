import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { EVENTS } from '@erp/shared';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { EventOutboxService } from '../../../kernel/events/event-outbox.service';
import { NotificationsService } from '../../../kernel/notifications/notifications.service';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import { ProviderSendError, type OutboundMessage } from '../providers/messaging-provider.interface';
import { DeliveryStatusService } from '../inbound/delivery-status.service';
import { ConsentService } from '../consent/consent.service';
import { OutboundFanoutService } from './outbound-fanout.service';
import type { ChannelPolicyStep } from './channel-policy';

/** Retry backoff by attempt number (attempt 1 = index 0). ±20% jitter applied. */
const BACKOFF_MS = [0, 30_000, 120_000, 600_000, 3_600_000, 21_600_000];

export interface DeliveryTarget {
  conversationChannelId?: string | null;
  channelId: string;
  providerId: string;
  recipientAddress: string;
  recipientUserId?: string | null;
  recipientExternalIdentityId?: string | null;
}

export interface EnqueueInput {
  organizationId: string;
  messageId: string;
  conversationId: string;
  body: string;
  targets: DeliveryTarget[];
}

/**
 * Outbound delivery logic. `enqueue` writes `MessageDelivery` rows (the durable
 * work queue); `processDelivery` is called by the worker per claimed row.
 *
 * Delivery guarantee: at-least-once internally, with provider-dependent
 * deduplication externally. `providerRequestId` is minted once at enqueue and
 * replayed on every attempt, so a retry after an ambiguous timeout dedupes
 * provider-side where the provider supports a caller-supplied id (WhatsApp).
 */
@Injectable()
export class MessageDispatchService {
  private readonly logger = new Logger('MessageDispatch');

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: EventOutboxService,
    private readonly providers: ProviderRegistryService,
    private readonly deliveryStatus: DeliveryStatusService,
    private readonly notifications: NotificationsService,
    private readonly consent: ConsentService,
    // Circular by nature: the fan-out enqueues deliveries, and a failed delivery
    // asks the fan-out for the next transport. Broken with forwardRef rather than
    // by duplicating the channel-selection logic in two places.
    @Inject(forwardRef(() => OutboundFanoutService))
    private readonly fanout: OutboundFanoutService,
  ) {}

  static idempotencyKey(providerId: string, channelId: string, messageId: string, recipientAddress: string): string {
    return `${providerId}:${channelId}:${messageId}:${recipientAddress}`;
  }

  /**
   * WhatsApp accepts a caller-supplied message id and dedupes on it, so we mint a
   * WA-shaped id deterministically from the idempotency key. Everywhere else the
   * opaque key is fine (unique per provider via @@unique([providerId, providerRequestId])).
   */
  static providerRequestId(providerId: string, idempotencyKey: string): string {
    if (providerId === 'whatsapp') {
      const hash = createHash('sha256').update(idempotencyKey).digest('hex');
      // 22 uppercase hex chars — WhatsApp message ids are uppercase hex/base32-ish.
      return hash.slice(0, 22).toUpperCase();
    }
    return idempotencyKey;
  }

  /** Create delivery rows for a message. Pass the message-creation tx for atomicity. */
  async enqueue(tx: Prisma.TransactionClient, input: EnqueueInput): Promise<void> {
    for (const t of input.targets) {
      const idempotencyKey = MessageDispatchService.idempotencyKey(
        t.providerId,
        t.channelId,
        input.messageId,
        t.recipientAddress,
      );
      const providerRequestId = MessageDispatchService.providerRequestId(t.providerId, idempotencyKey);
      // Upsert so a double-enqueue (retry of the caller) cannot create two rows.
      await tx.messageDelivery.upsert({
        where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } },
        update: {},
        create: {
          organizationId: input.organizationId,
          messageId: input.messageId,
          conversationChannelId: t.conversationChannelId ?? null,
          channelId: t.channelId,
          providerId: t.providerId,
          recipientAddress: t.recipientAddress,
          recipientUserId: t.recipientUserId ?? null,
          recipientExternalIdentityId: t.recipientExternalIdentityId ?? null,
          status: 'queued',
          nextAttemptAt: new Date(),
          idempotencyKey,
          providerRequestId,
        },
      });
    }
  }

  /** Process one claimed delivery. Runs inside the row's tenant scope. */
  async processDelivery(deliveryId: string): Promise<void> {
    const d = await this.prisma.raw.messageDelivery.findUnique({ where: { id: deliveryId } });
    if (!d) return;
    if (['delivered', 'read', 'failed', 'cancelled'].includes(d.status)) return;

    // Provider not registered (its flag is off) → terminal failure with a reason.
    if (!this.providers.has(d.providerId)) {
      await this.fail(deliveryId, d.attempts, 'provider_disabled', `Provider '${d.providerId}' is not enabled.`, false);
      return;
    }
    const provider = this.providers.for(d.providerId);

    // Not ready (socket down / lease elsewhere) → defer without consuming an attempt.
    if (!(await provider.isReady(d.channelId))) {
      await this.defer(deliveryId, new Date(Date.now() + 30_000), 'channel_not_ready');
      return;
    }

    // CONSENT GATE. Checked here — the one point every outbound send funnels
    // through — rather than at each producer, so a new feature inherits opt-out
    // handling and cannot forget it. Checked at SEND time, not enqueue time,
    // because a parent may reply STOP after a broadcast is queued but before it
    // drains; the last word before the message leaves must win.
    //
    // Terminal `cancelled`, never `failed`: an opt-out is a correct outcome, not
    // an error. It must not retry, must not alert the sender, and must read as
    // "suppressed" in the delivery report.
    const suppression = await this.consent.isSuppressed(d.organizationId, d.providerId, d.recipientAddress);
    if (suppression.suppressed) {
      await this.cancel(
        deliveryId,
        'opted_out',
        `Recipient opted out of ${suppression.scope === 'all' ? 'all messaging' : suppression.scope} messages.`,
      );
      return;
    }

    const msg = await this.prisma.raw.message.findUnique({ where: { id: d.messageId }, select: { body: true } });
    const outbound: OutboundMessage = {
      organizationId: d.organizationId,
      channelId: d.channelId,
      conversationId: '', // not needed by providers today
      conversationChannelId: d.conversationChannelId,
      messageId: d.messageId,
      providerRequestId: d.providerRequestId,
      toAddress: d.recipientAddress,
      body: msg?.body ?? '',
      contentType: 'text',
    };

    try {
      const outcome = await provider.send(outbound);
      if (outcome.kind === 'deferred') {
        await this.defer(deliveryId, outcome.deferUntil, outcome.reason ?? 'paced');
        return;
      }
      await this.deliveryStatus.markSent(deliveryId, outcome.externalMessageId, outcome.sentAt, outcome.deliveredAt);
      await this.outbox.publish(undefined, EVENTS.CommunicationMessageDelivered, {
        organizationId: d.organizationId,
        messageId: d.messageId,
        deliveryId,
        providerId: d.providerId,
        status: outcome.deliveredAt ? 'delivered' : 'sent',
      });
    } catch (err) {
      if (err instanceof ProviderSendError) {
        if (!err.retryable) {
          await this.fail(deliveryId, d.attempts, err.code, err.message, err.ambiguous);
          return;
        }
        // Retryable. An ambiguous send is clamped so we don't keep risking dupes.
        const maxAttempts = err.ambiguous ? Math.min(d.maxAttempts, 3) : d.maxAttempts;
        await this.retryOrFail(deliveryId, d.attempts, maxAttempts, err.code, err.message, err.ambiguous, err.retryAfterMs);
        return;
      }
      // Unknown error → retryable, unambiguous.
      await this.retryOrFail(deliveryId, d.attempts, d.maxAttempts, 'unknown', String(err), false);
    }
  }

  /**
   * Terminal, non-error stop. Distinct from `fail`: no retry, no failure event,
   * no "could not be delivered" notification to the sender — nothing went wrong.
   */
  private async cancel(deliveryId: string, errorCode: string, reason: string): Promise<void> {
    await this.prisma.raw.messageDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'cancelled',
        errorCode,
        lastError: reason.slice(0, 500),
        claimToken: null,
        claimedAt: null,
      },
    });
    this.logger.log(`delivery ${deliveryId} cancelled: ${errorCode}`);
  }

  private async defer(deliveryId: string, deferUntil: Date, reason: string): Promise<void> {
    await this.prisma.raw.messageDelivery.update({
      where: { id: deliveryId },
      data: { status: 'queued', nextAttemptAt: deferUntil, claimToken: null, claimedAt: null, lastError: reason },
    });
  }

  private async retryOrFail(
    deliveryId: string,
    attempts: number,
    maxAttempts: number,
    errorCode: string,
    lastError: string,
    ambiguous: boolean,
    retryAfterMs?: number,
  ): Promise<void> {
    const nextAttempts = attempts + 1;
    if (nextAttempts >= maxAttempts) {
      await this.fail(deliveryId, attempts, errorCode, lastError, ambiguous);
      return;
    }
    const base = retryAfterMs ?? BACKOFF_MS[Math.min(nextAttempts, BACKOFF_MS.length - 1)];
    const jitter = base * (Math.random() * 0.4 - 0.2);
    await this.prisma.raw.messageDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'queued',
        attempts: nextAttempts,
        maxAttempts,
        nextAttemptAt: new Date(Date.now() + base + jitter),
        claimToken: null,
        claimedAt: null,
        errorCode,
        lastError: lastError.slice(0, 500),
        ambiguous,
      },
    });
  }

  private async fail(
    deliveryId: string,
    attempts: number,
    errorCode: string,
    lastError: string,
    ambiguous: boolean,
  ): Promise<void> {
    const d = await this.prisma.raw.messageDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'failed',
        attempts: attempts + 1,
        failedAt: new Date(),
        claimToken: null,
        claimedAt: null,
        errorCode,
        lastError: lastError.slice(0, 500),
        ambiguous,
      },
      select: {
        organizationId: true,
        messageId: true,
        providerId: true,
        recipientUserId: true,
        recipientAddress: true,
        fallbackPolicy: true,
        broadcastId: true,
        broadcastRecipientId: true,
      },
    });
    await this.outbox.publish(undefined, EVENTS.CommunicationMessageFailed, {
      organizationId: d.organizationId,
      messageId: d.messageId,
      deliveryId,
      providerId: d.providerId,
      status: 'failed',
    });

    // FALLBACK ESCALATION. A terminal failure on one transport is exactly when
    // the next one should be tried — a parent whose WhatsApp number is dead
    // still has a handset. Deliberately NOT reached from `cancel()`: an opt-out
    // must never be "retried" on another channel.
    //
    // An ambiguous failure is excluded too. We could not tell whether the first
    // transport delivered, so escalating risks telling the parent twice; the
    // delivery is left visibly ambiguous for a human to judge instead.
    const escalated = ambiguous ? null : await this.tryEscalate(deliveryId, d);
    if (escalated) return;

    // Tell the sender their message could not be delivered (in-app only).
    const sender = await this.prisma.raw.message.findFirst({
      where: { id: d.messageId },
      select: { senderUserId: true },
    });
    if (sender?.senderUserId) {
      await this.notifications
        .send({
          organizationId: d.organizationId,
          userId: sender.senderUserId,
          channel: 'in_app',
          category: 'communication',
          title: 'Message could not be delivered',
          body: `A message failed to send (${errorCode}).`,
          payload: { dedupeKey: `comm.delivery.failed:${deliveryId}`, deliveryId, href: '/communication' },
        })
        .catch(() => undefined);
    }
  }

  /**
   * Hand the failed delivery's remaining policy steps to the fan-out. Returns
   * true when a replacement delivery was queued, in which case the sender is NOT
   * told the message failed — from their point of view it is still in flight.
   */
  private async tryEscalate(
    deliveryId: string,
    d: {
      organizationId: string;
      messageId: string;
      recipientAddress: string;
      recipientUserId: string | null;
      fallbackPolicy: unknown;
      broadcastId: string | null;
      broadcastRecipientId: string | null;
    },
  ): Promise<boolean> {
    const steps = Array.isArray(d.fallbackPolicy) ? (d.fallbackPolicy as ChannelPolicyStep[]) : [];
    if (steps.length === 0) return false;

    const message = await this.prisma.raw.message.findUnique({
      where: { id: d.messageId },
      select: { body: true },
    });
    if (!message) return false;

    // The failed row's address is only meaningful for its own transport (a user
    // id for internal, a phone elsewhere), so both are offered to the next step
    // and `stepCanAddress` decides which ones are usable.
    const recipient = {
      address: d.recipientAddress.startsWith('+') ? d.recipientAddress : null,
      userId: d.recipientUserId,
    };

    try {
      const next = await this.fanout.escalate({
        organizationId: d.organizationId,
        failedDeliveryId: deliveryId,
        messageId: d.messageId,
        body: message.body,
        recipient,
        remainingSteps: steps,
        broadcastId: d.broadcastId,
        broadcastRecipientId: d.broadcastRecipientId,
      });
      if (!next) return false;
      if (d.broadcastRecipientId) {
        await this.prisma.raw.broadcastRecipient.update({
          where: { id: d.broadcastRecipientId },
          data: { status: 'queued', providerId: next.providerId, deliveryId: next.deliveryId, lastError: null },
        });
      }
      return true;
    } catch (err) {
      this.logger.warn(`escalation of delivery ${deliveryId} failed: ${String(err)}`);
      return false;
    }
  }
}
