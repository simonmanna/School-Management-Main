import { Injectable, Logger } from '@nestjs/common';
import { EVENTS } from '@erp/shared';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventOutboxService } from '../../../kernel/events/event-outbox.service';
import { CommunicationStreamService } from '../communication-stream.service';
import { MessageService } from '../message.service';

export interface InboundMessageInput {
  organizationId: string;
  channelId: string;
  providerId: string;
  /** Provider-native thread id (WA remoteJid, Telegram chat id). */
  externalConversationId: string;
  /** Provider-native message id — the replay guard. */
  externalMessageId: string;
  /** Provider-native sender id (jid/user id). */
  externalSenderId: string;
  senderAddress?: string | null;
  senderDisplayName?: string | null;
  body: string;
  contentType?: string;
  occurredAt: Date;
  raw?: unknown;
}

/**
 * The SINGLE write path for inbound messages across every external provider.
 * Baileys' event emitter and the Telegram webhook both funnel here.
 *
 * Idempotency is structural, not checked-then-written: the conversation is
 * upserted on `ConversationChannel`'s unique `(org, channel, externalConvId)`,
 * and the message on `ExternalMessage`'s unique `(org, provider, externalMsgId)`.
 * A P2002 on the latter is a REPLAY (providers redeliver on reconnect), not an
 * error — we return the already-stored message.
 *
 * The caller must have established the tenant scope (`tenant.run`) — inbound
 * events fire outside any HTTP request.
 */
@Injectable()
export class InboundMessageService {
  private readonly logger = new Logger('InboundMessage');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly outbox: EventOutboxService,
    private readonly stream: CommunicationStreamService,
  ) {}

  /** E.164-ish normalization: keep a leading +, strip everything non-digit. */
  static normalizePhone(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const digits = raw.replace(/[^\d+]/g, '');
    if (!digits) return null;
    return digits.startsWith('+') ? digits : `+${digits}`;
  }

  async ingest(input: InboundMessageInput): Promise<{ messageId: string; deduped: boolean } | null> {
    const orgId = input.organizationId;

    // 1. Resolve (or create) the external identity. Never auto-create a Partner —
    //    an unknown sender is a first-class unresolved identity.
    const identity = await this.resolveIdentity(orgId, input);

    // 2. Resolve (or create) the conversation + its external channel binding.
    const conversationId = await this.resolveConversation(orgId, input, identity);

    // 3. Insert the message + sidecar. Replay-safe on ExternalMessage's unique.
    try {
      const result = await this.prisma.client.$transaction(async (tx) => {
        const m = await tx.message.create({
          data: {
            organizationId: orgId,
            conversationId,
            senderType: 'external',
            senderExternalIdentityId: identity?.id ?? null,
            contentType: input.contentType ?? 'text',
            body: input.body,
            occurredAt: input.occurredAt,
          },
          select: { id: true },
        });
        await tx.externalMessage.create({
          data: {
            organizationId: orgId,
            messageId: m.id,
            providerId: input.providerId,
            externalMessageId: input.externalMessageId,
            externalConversationId: input.externalConversationId,
            externalSenderId: input.externalSenderId,
            rawMetadata: (input.raw ?? {}) as object,
          },
        });
        await tx.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
        await tx.conversationChannel.updateMany({
          where: { conversationId, channelId: input.channelId },
          data: { lastInboundAt: input.occurredAt },
        });
        await this.outbox.publish(tx, EVENTS.CommunicationMessageReceived, {
          organizationId: orgId,
          messageId: m.id,
          conversationId,
          providerId: input.providerId,
          direction: 'inbound',
        });
        return m.id;
      });

      await this.emit(orgId, conversationId, result, input);
      return { messageId: result, deduped: false };
    } catch (err) {
      if (typeof err === 'object' && err && (err as { code?: string }).code === 'P2002') {
        const existing = await this.prisma.client.externalMessage.findFirst({
          where: { organizationId: orgId, providerId: input.providerId, externalMessageId: input.externalMessageId },
          select: { messageId: true },
        });
        return existing ? { messageId: existing.messageId, deduped: true } : null;
      }
      throw err;
    }
  }

  private async resolveIdentity(
    orgId: string,
    input: InboundMessageInput,
  ): Promise<{ id: string; partnerId: string | null } | null> {
    const phone = InboundMessageService.normalizePhone(input.senderAddress);
    // Try to link to a Partner ONLY when exactly one matches — ambiguity stays unresolved.
    let partnerId: string | null = null;
    if (phone) {
      const matches = await this.prisma.client.partner.findMany({
        where: { phoneE164: phone },
        select: { id: true },
        take: 2,
      });
      if (matches.length === 1) partnerId = matches[0].id;
    }
    const identity = await this.prisma.client.externalIdentity.upsert({
      where: {
        organizationId_providerId_externalUserId: {
          organizationId: orgId,
          providerId: input.providerId,
          externalUserId: input.externalSenderId,
        },
      },
      update: {
        address: phone ?? input.senderAddress ?? undefined,
        displayName: input.senderDisplayName ?? undefined,
        ...(partnerId ? { partnerId } : {}),
      },
      create: {
        organizationId: orgId,
        providerId: input.providerId,
        externalUserId: input.externalSenderId,
        address: phone ?? input.senderAddress ?? null,
        displayName: input.senderDisplayName ?? null,
        partnerId,
      },
      select: { id: true, partnerId: true },
    });
    return identity;
  }

  private async resolveConversation(
    orgId: string,
    input: InboundMessageInput,
    identity: { id: string; partnerId: string | null } | null,
  ): Promise<string> {
    const existing = await this.prisma.client.conversationChannel.findFirst({
      where: { channelId: input.channelId, externalConversationId: input.externalConversationId },
      select: { conversationId: true },
    });
    if (existing) return existing.conversationId;

    return this.prisma.client.$transaction(async (tx) => {
      const conv = await tx.conversation.create({
        data: {
          organizationId: orgId,
          kind: 'direct',
          name: input.senderDisplayName ?? input.senderAddress ?? 'External contact',
          contextType: identity?.partnerId ? 'Partner' : null,
          contextId: identity?.partnerId ?? null,
          // External customer threads are visible to anyone who can read customer
          // comms (support/managers). Not private — no single staff owner.
          visibility: 'org',
        },
      });
      const cc = await tx.conversationChannel.create({
        data: {
          organizationId: orgId,
          conversationId: conv.id,
          channelId: input.channelId,
          externalConversationId: input.externalConversationId,
          lastInboundAt: input.occurredAt,
        },
      });
      await tx.conversation.update({ where: { id: conv.id }, data: { defaultConversationChannelId: cc.id } });
      if (identity) {
        await tx.conversationParticipant.create({
          data: {
            organizationId: orgId,
            conversationId: conv.id,
            participantType: 'external',
            externalIdentityId: identity.id,
          },
        });
      }
      return conv.id;
    });
  }

  private async emit(orgId: string, conversationId: string, messageId: string, input: InboundMessageInput): Promise<void> {
    const msg = await this.prisma.client.message.findFirst({
      where: { id: messageId },
      select: MESSAGE_SELECT,
    });
    if (!msg) return;
    const conv = await this.prisma.client.conversation.findFirst({
      where: { id: conversationId },
      select: { visibility: true, visibleToPermissions: true },
    });
    if (!conv) return;
    const participants = await this.prisma.client.conversationParticipant.findMany({
      where: { conversationId, participantType: 'user', leftAt: null, userId: { not: null } },
      select: { userId: true },
    });
    this.stream.emit(
      orgId,
      { conversation: conv, participantUserIds: participants.map((p) => p.userId!).filter(Boolean) },
      {
        type: 'message.created',
        conversationId,
        messageId,
        syncSequence: msg.seq.toString(),
        message: MessageService.serialize(msg),
      },
    );
  }
}

const MESSAGE_SELECT = {
  id: true,
  conversationId: true,
  senderType: true,
  senderUserId: true,
  contentType: true,
  body: true,
  replyToMessageId: true,
  status: true,
  occurredAt: true,
  editedAt: true,
  seq: true,
} as const;
