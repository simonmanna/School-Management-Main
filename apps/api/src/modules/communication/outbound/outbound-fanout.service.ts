import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { MessageDispatchService } from './message-dispatch.service';
import { ConsentService } from '../consent/consent.service';
import { countSegments } from '../providers/sms/sms-segments';
import {
  DEFAULT_CHANNEL_POLICY,
  stepCanAddress,
  type ChannelPolicy,
  type ChannelPolicyStep,
} from './channel-policy';

/**
 * Turns "reach this person with this text" into a conversation, a message and a
 * queued delivery — choosing the transport from a channel policy.
 *
 * This is the single outbound path shared by the broadcast engine and the event
 * rule engine. Before it existed, a rule could only message someone who already
 * had an ExternalIdentity from a previous INBOUND message, which meant the
 * school could never start a conversation — only continue one. Here the address
 * itself is enough.
 *
 * Everything runs on `prisma.raw` with an explicit organizationId: both callers
 * execute on workers, outside any request.
 */

export interface FanoutRecipient {
  /** Normalized E.164 (external transports). Null when only reachable in-app. */
  address?: string | null;
  /** Login account (internal transport). */
  userId?: string | null;
  displayName?: string | null;
  /** Backlink for the conversation's business context. */
  contextType?: string | null;
  contextId?: string | null;
}

export type FanoutOutcome =
  | { kind: 'queued'; messageId: string; deliveryId: string; providerId: string; channelId: string; segments: number }
  | { kind: 'suppressed'; reason: 'opted_out'; providerId: string }
  | { kind: 'unreachable'; reason: 'no_address' | 'no_channel' };

interface ResolvedChannel {
  id: string;
  providerId: string;
  transport: string;
}

@Injectable()
export class OutboundFanoutService {
  private readonly logger = new Logger('OutboundFanout');

  /**
   * Channel lookups are per-org and change only when an admin edits them, but a
   * 4,000-recipient broadcast would otherwise repeat the same query 4,000 times.
   * Cleared whenever a materialization run starts, so an operator who fixes a
   * broken gateway and immediately retries is not served a stale answer.
   */
  private channelCache = new Map<string, ResolvedChannel[]>();

  constructor(
    private readonly prisma: PrismaService,
    // Both ends of the cycle need forwardRef: the fan-out enqueues deliveries,
    // and a failed delivery asks the fan-out for the next transport. Marking
    // only one side leaves the other resolving to `undefined` at boot.
    @Inject(forwardRef(() => MessageDispatchService))
    private readonly dispatch: MessageDispatchService,
    private readonly consent: ConsentService,
  ) {}

  resetCache(): void {
    this.channelCache.clear();
  }

  /**
   * Pick the transport for one recipient and queue the message on it.
   *
   * Consent is checked here as well as in the dispatcher. The dispatcher's check
   * is the guarantee (it is the last thing before the wire); this one is the
   * courtesy — it keeps an opted-out parent out of the delivery queue entirely,
   * so the broadcast report says "suppressed" rather than "queued, then
   * cancelled", and the queue does not fill with work that will be thrown away.
   */
  async fanoutOne(params: {
    organizationId: string;
    recipient: FanoutRecipient;
    body: string;
    policy?: ChannelPolicy;
    broadcastId?: string;
    broadcastRecipientId?: string;
    senderUserId?: string | null;
  }): Promise<FanoutOutcome> {
    const { organizationId, recipient, body } = params;
    const policy = params.policy ?? DEFAULT_CHANNEL_POLICY;

    if (!recipient.address && !recipient.userId) {
      return { kind: 'unreachable', reason: 'no_address' };
    }

    const chain = await this.resolveChain(organizationId, policy, recipient);
    if (chain.length === 0) {
      return { kind: 'unreachable', reason: 'no_channel' };
    }

    const [first, ...rest] = chain;
    const address = this.addressFor(first.channel, recipient);

    const suppression = await this.consent.isSuppressed(organizationId, first.channel.providerId, address);
    if (suppression.suppressed) {
      return { kind: 'suppressed', reason: 'opted_out', providerId: first.channel.providerId };
    }

    const conversation = await this.resolveConversation(organizationId, first.channel, recipient, address);

    const segments = first.channel.providerId === 'sms' ? countSegments(body).segments : 1;

    const result = await this.prisma.raw.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          organizationId,
          conversationId: conversation.conversationId,
          senderType: params.senderUserId ? 'user' : 'system',
          senderUserId: params.senderUserId ?? null,
          contentType: 'text',
          body,
          occurredAt: new Date(),
        },
        select: { id: true },
      });
      await tx.conversation.update({
        where: { id: conversation.conversationId },
        data: { updatedAt: new Date() },
      });
      await this.dispatch.enqueue(tx, {
        organizationId,
        messageId: message.id,
        conversationId: conversation.conversationId,
        body,
        targets: [
          {
            conversationChannelId: conversation.conversationChannelId,
            channelId: first.channel.id,
            providerId: first.channel.providerId,
            recipientAddress: address,
            recipientUserId: recipient.userId ?? null,
          },
        ],
      });
      // Stamp the fallback remainder + broadcast backlinks onto the row the
      // enqueue just created. Done here rather than by widening EnqueueInput so
      // the dispatcher's contract stays about delivery, not about broadcasts.
      const delivery = await this.stampDelivery(tx, {
        organizationId,
        messageId: message.id,
        providerId: first.channel.providerId,
        channelId: first.channel.id,
        address,
        remainingSteps: policy.fallbackOnFailure === false ? [] : rest.map((c) => c.step),
        broadcastId: params.broadcastId,
        broadcastRecipientId: params.broadcastRecipientId,
      });
      return { messageId: message.id, deliveryId: delivery };
    });

    return {
      kind: 'queued',
      messageId: result.messageId,
      deliveryId: result.deliveryId,
      providerId: first.channel.providerId,
      channelId: first.channel.id,
      segments,
    };
  }

  /**
   * Enqueue the NEXT step of a chain after a terminal failure. Called by the
   * dispatcher, and deliberately reusing the failed delivery's message: the
   * parent is being told one thing once, so the conversation must show one
   * message that was tried two ways — not two messages.
   */
  async escalate(params: {
    organizationId: string;
    failedDeliveryId: string;
    messageId: string;
    body: string;
    recipient: FanoutRecipient;
    remainingSteps: ChannelPolicyStep[];
    broadcastId?: string | null;
    broadcastRecipientId?: string | null;
  }): Promise<{ deliveryId: string; providerId: string } | null> {
    const { organizationId, remainingSteps, recipient } = params;
    if (remainingSteps.length === 0) return null;

    const chain = await this.resolveChain(
      organizationId,
      { steps: remainingSteps, fallbackOnFailure: true },
      recipient,
    );
    if (chain.length === 0) return null;

    const [next, ...rest] = chain;
    const address = this.addressFor(next.channel, recipient);

    // An opt-out recorded between the first attempt and this one must stop the
    // chain — escalation is a new send, not a retry of the old one.
    const suppression = await this.consent.isSuppressed(organizationId, next.channel.providerId, address);
    if (suppression.suppressed) return null;

    const conversation = await this.resolveConversation(organizationId, next.channel, recipient, address);

    const deliveryId = await this.prisma.raw.$transaction(async (tx) => {
      await this.dispatch.enqueue(tx, {
        organizationId,
        messageId: params.messageId,
        conversationId: conversation.conversationId,
        body: params.body,
        targets: [
          {
            conversationChannelId: conversation.conversationChannelId,
            channelId: next.channel.id,
            providerId: next.channel.providerId,
            recipientAddress: address,
            recipientUserId: recipient.userId ?? null,
          },
        ],
      });
      return this.stampDelivery(tx, {
        organizationId,
        messageId: params.messageId,
        providerId: next.channel.providerId,
        channelId: next.channel.id,
        address,
        remainingSteps: rest.map((c) => c.step),
        broadcastId: params.broadcastId ?? undefined,
        broadcastRecipientId: params.broadcastRecipientId ?? undefined,
        fallbackOfDeliveryId: params.failedDeliveryId,
      });
    });

    this.logger.log(
      `delivery ${params.failedDeliveryId} escalated to ${next.channel.providerId} (${deliveryId})`,
    );
    return { deliveryId, providerId: next.channel.providerId };
  }

  /* ── Internals ────────────────────────────────────────────────────────── */

  /** Attach the policy remainder + broadcast backlinks to the enqueued row. */
  private async stampDelivery(
    tx: Prisma.TransactionClient,
    params: {
      organizationId: string;
      messageId: string;
      providerId: string;
      channelId: string;
      address: string;
      remainingSteps: ChannelPolicyStep[];
      broadcastId?: string;
      broadcastRecipientId?: string;
      fallbackOfDeliveryId?: string;
    },
  ): Promise<string> {
    const idempotencyKey = MessageDispatchService.idempotencyKey(
      params.providerId,
      params.channelId,
      params.messageId,
      params.address,
    );
    const updated = await tx.messageDelivery.update({
      where: {
        organizationId_idempotencyKey: { organizationId: params.organizationId, idempotencyKey },
      },
      data: {
        fallbackPolicy: params.remainingSteps.length > 0 ? (params.remainingSteps as object) : undefined,
        broadcastId: params.broadcastId ?? undefined,
        broadcastRecipientId: params.broadcastRecipientId ?? undefined,
        fallbackOfDeliveryId: params.fallbackOfDeliveryId ?? undefined,
      },
      select: { id: true },
    });
    return updated.id;
  }

  /**
   * Walk the policy and keep the steps that resolve to a usable channel for this
   * recipient. The first is used now; the rest become the escalation chain.
   */
  private async resolveChain(
    organizationId: string,
    policy: ChannelPolicy,
    recipient: FanoutRecipient,
  ): Promise<{ step: ChannelPolicyStep; channel: ResolvedChannel }[]> {
    const channels = await this.channelsFor(organizationId);
    const out: { step: ChannelPolicyStep; channel: ResolvedChannel }[] = [];
    for (const step of policy.steps) {
      if (!stepCanAddress(step, recipient)) continue;
      const channel = channels.find(
        (c) =>
          c.providerId === step.providerId &&
          (!step.transport || c.transport === step.transport) &&
          (!step.channelId || c.id === step.channelId),
      );
      if (!channel) continue;
      if (out.some((o) => o.channel.id === channel.id)) continue;
      out.push({ step, channel });
    }
    return out;
  }

  private async channelsFor(organizationId: string): Promise<ResolvedChannel[]> {
    const cached = this.channelCache.get(organizationId);
    if (cached) return cached;
    const rows = await this.prisma.raw.communicationChannel.findMany({
      where: { organizationId, disabledAt: null },
      select: { id: true, providerId: true, transport: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    const mapped = rows.map((r) => ({ id: r.id, providerId: r.providerId, transport: r.transport }));
    this.channelCache.set(organizationId, mapped);
    return mapped;
  }

  /** Internal addresses are user ids; every external transport uses the phone. */
  private addressFor(channel: ResolvedChannel, recipient: FanoutRecipient): string {
    return channel.providerId === 'internal' ? (recipient.userId ?? '') : (recipient.address ?? '');
  }

  /**
   * Find or create the thread for (channel, address).
   *
   * Keyed on ConversationChannel's unique `(org, channelId, externalConversationId)`
   * — the same key the INBOUND path uses. That is what makes a parent's reply
   * land in the thread the broadcast came from, instead of opening a second one.
   */
  private async resolveConversation(
    organizationId: string,
    channel: ResolvedChannel,
    recipient: FanoutRecipient,
    address: string,
  ): Promise<{ conversationId: string; conversationChannelId: string }> {
    const externalConversationId = channel.providerId === 'internal' ? null : address;

    const existing = await this.prisma.raw.conversationChannel.findFirst({
      where: {
        organizationId,
        channelId: channel.id,
        ...(externalConversationId
          ? { externalConversationId }
          : // Internal: the thread is identified by its participant, not by an
            // external id, so match on the conversation's sole participant.
            {
              conversation: {
                participants: { some: { userId: recipient.userId ?? '', leftAt: null } },
                kind: 'direct',
                deletedAt: null,
              },
            }),
      },
      select: { id: true, conversationId: true },
    });
    if (existing) return { conversationId: existing.conversationId, conversationChannelId: existing.id };

    return this.prisma.raw.$transaction(async (tx) => {
      const conv = await tx.conversation.create({
        data: {
          organizationId,
          kind: 'direct',
          name: recipient.displayName ?? address,
          contextType: recipient.contextType ?? null,
          contextId: recipient.contextId ?? null,
          // Not private: a parent thread belongs to the school office, not to
          // whichever clerk happened to send the broadcast.
          visibility: 'org',
        },
        select: { id: true },
      });
      const cc = await tx.conversationChannel.create({
        data: {
          organizationId,
          conversationId: conv.id,
          channelId: channel.id,
          externalConversationId,
        },
        select: { id: true },
      });
      await tx.conversation.update({ where: { id: conv.id }, data: { defaultConversationChannelId: cc.id } });
      if (recipient.userId) {
        await tx.conversationParticipant.create({
          data: {
            organizationId,
            conversationId: conv.id,
            participantType: 'user',
            userId: recipient.userId,
          },
        });
      }
      return { conversationId: conv.id, conversationChannelId: cc.id };
    });
  }
}
