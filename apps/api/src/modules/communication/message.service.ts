import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { EVENTS } from '@erp/shared';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { EventOutboxService } from '../../kernel/events/event-outbox.service';
import { ConversationAccessService } from './conversation-access.service';
import { CommunicationStreamService } from './communication-stream.service';
import { MessageDispatchService, type DeliveryTarget } from './outbound/message-dispatch.service';

export interface SendMessageInput {
  conversationId: string;
  body: string;
  replyToMessageId?: string;
  /** Which transports to send over. Defaults to the reply's channel, else the
   * conversation's default channel. */
  targetConversationChannelIds?: string[];
}

/** Serialized message — `seq` becomes `syncSequence` (string). */
export interface MessageView {
  id: string;
  conversationId: string;
  senderType: string;
  senderUserId: string | null;
  contentType: string;
  body: string;
  replyToMessageId: string | null;
  status: string;
  occurredAt: string;
  editedAt: string | null;
  syncSequence: string;
}

@Injectable()
export class MessageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly access: ConversationAccessService,
    private readonly outbox: EventOutboxService,
    private readonly dispatch: MessageDispatchService,
    private readonly stream: CommunicationStreamService,
  ) {}

  static serialize(m: {
    id: string;
    conversationId: string;
    senderType: string;
    senderUserId: string | null;
    contentType: string;
    body: string;
    replyToMessageId: string | null;
    status: string;
    occurredAt: Date;
    editedAt: Date | null;
    seq: bigint;
  }): MessageView {
    return {
      id: m.id,
      conversationId: m.conversationId,
      senderType: m.senderType,
      senderUserId: m.senderUserId,
      contentType: m.contentType,
      body: m.body,
      replyToMessageId: m.replyToMessageId,
      status: m.status,
      occurredAt: m.occurredAt.toISOString(),
      editedAt: m.editedAt ? m.editedAt.toISOString() : null,
      syncSequence: m.seq.toString(),
    };
  }

  /** Chronological page of a conversation's messages (ascending occurredAt). */
  async list(conversationId: string, opts: { beforeSeq?: string; limit?: number } = {}): Promise<MessageView[]> {
    await this.access.assertCanRead(conversationId);
    const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
    const rows = await this.prisma.client.message.findMany({
      where: {
        conversationId,
        deletedAt: null,
        ...(opts.beforeSeq ? { seq: { lt: BigInt(opts.beforeSeq) } } : {}),
      },
      orderBy: { seq: 'desc' },
      take: limit,
      select: this.selection(),
    });
    // Return ascending for display.
    return rows.reverse().map((m) => MessageService.serialize(m));
  }

  async send(input: SendMessageInput): Promise<MessageView> {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    if (!userId) throw new ForbiddenException('Authentication required to send a message.');
    if (!input.body?.trim()) throw new BadRequestException('Message body is required.');
    await this.access.assertCanRead(input.conversationId);

    const conv = await this.prisma.client.conversation.findFirst({
      where: { id: input.conversationId, deletedAt: null },
      include: { channels: { where: { active: true } } },
    });
    if (!conv) throw new BadRequestException('Conversation not found.');

    // Resolve target channels: explicit → reply's channel → default → all internal.
    const targetChannels = await this.resolveTargets(conv, input);
    if (targetChannels.length === 0) {
      throw new BadRequestException('No active channel to send on.');
    }

    // Build a DeliveryTarget per channel. Internal is a single broadcast row;
    // external channels address the external thread.
    const channelRows = await this.prisma.client.communicationChannel.findMany({
      where: { id: { in: targetChannels.map((t) => t.channelId) } },
      select: { id: true, providerId: true },
    });
    const providerById = new Map(channelRows.map((c) => [c.id, c.providerId]));
    const targets: DeliveryTarget[] = targetChannels.map((cc) => {
      const providerId = providerById.get(cc.channelId) ?? 'internal';
      return {
        conversationChannelId: cc.id,
        channelId: cc.channelId,
        providerId,
        recipientAddress: providerId === 'internal' ? cc.channelId : cc.externalConversationId ?? cc.channelId,
      };
    });

    const message = await this.prisma.client.$transaction(async (tx) => {
      const m = await tx.message.create({
        data: {
          organizationId: orgId,
          conversationId: input.conversationId,
          senderType: 'user',
          senderUserId: userId,
          contentType: 'text',
          body: input.body.trim(),
          replyToMessageId: input.replyToMessageId ?? null,
          occurredAt: new Date(),
        },
        select: this.selection(),
      });
      await tx.conversation.update({ where: { id: input.conversationId }, data: { updatedAt: new Date() } });
      await this.dispatch.enqueue(tx, {
        organizationId: orgId,
        messageId: m.id,
        conversationId: input.conversationId,
        body: m.body,
        targets,
      });
      // The sender has read their own message.
      await tx.conversationParticipant.updateMany({
        where: { conversationId: input.conversationId, userId, participantType: 'user' },
        data: { lastReadMessageId: m.id },
      });
      await this.outbox.publish(tx, EVENTS.CommunicationMessageCreated, {
        organizationId: orgId,
        messageId: m.id,
        conversationId: input.conversationId,
        providerId: 'internal',
        direction: 'outbound',
      });
      return m;
    });

    const view = MessageService.serialize(message);
    await this.emitCreated(input.conversationId, view);
    return view;
  }

  /**
   * Persist a system-authored message (no acting user) and enqueue delivery. Used
   * by the rule engine (event → message) and by inbound ingestion for provider
   * system notices. Bypasses the participant read-cursor and the per-user access
   * check — the caller is the platform, not a user. Runs inside the current tenant
   * scope (the caller establishes it via `tenant.run`).
   */
  async postSystemMessage(input: {
    conversationId: string;
    body: string;
    /** Restrict delivery to one provider's channels (e.g. 'internal'); default: all active. */
    providerFilter?: string;
    /** Attach a rule dedupe key on the created MessageDelivery event chain. */
    dedupeKey?: string;
  }): Promise<MessageView | null> {
    const orgId = this.tenant.organizationId;
    if (!input.body?.trim()) return null;

    const conv = await this.prisma.client.conversation.findFirst({
      where: { id: input.conversationId, deletedAt: null },
      include: { channels: { where: { active: true } } },
    });
    if (!conv) return null;

    let channels = conv.channels;
    if (input.providerFilter) {
      const chIds = await this.prisma.client.communicationChannel.findMany({
        where: { providerId: input.providerFilter },
        select: { id: true },
      });
      const allow = new Set(chIds.map((c) => c.id));
      channels = channels.filter((c) => allow.has(c.channelId));
    }
    if (channels.length === 0) return null;

    const channelRows = await this.prisma.client.communicationChannel.findMany({
      where: { id: { in: channels.map((c) => c.channelId) } },
      select: { id: true, providerId: true },
    });
    const providerById = new Map(channelRows.map((c) => [c.id, c.providerId]));
    const targets: DeliveryTarget[] = channels.map((cc) => {
      const providerId = providerById.get(cc.channelId) ?? 'internal';
      return {
        conversationChannelId: cc.id,
        channelId: cc.channelId,
        providerId,
        recipientAddress: providerId === 'internal' ? cc.channelId : cc.externalConversationId ?? cc.channelId,
      };
    });

    const message = await this.prisma.client.$transaction(async (tx) => {
      const m = await tx.message.create({
        data: {
          organizationId: orgId,
          conversationId: input.conversationId,
          senderType: 'system',
          contentType: 'text',
          body: input.body.trim(),
          occurredAt: new Date(),
        },
        select: this.selection(),
      });
      await tx.conversation.update({ where: { id: input.conversationId }, data: { updatedAt: new Date() } });
      await this.dispatch.enqueue(tx, {
        organizationId: orgId,
        messageId: m.id,
        conversationId: input.conversationId,
        body: m.body,
        targets,
      });
      await this.outbox.publish(tx, EVENTS.CommunicationMessageCreated, {
        organizationId: orgId,
        messageId: m.id,
        conversationId: input.conversationId,
        providerId: 'internal',
        direction: 'outbound',
      });
      return m;
    });

    const view = MessageService.serialize(message);
    await this.emitCreated(input.conversationId, view);
    return view;
  }

  /** Push a `message.created` SSE event to the conversation's audience. */
  private async emitCreated(conversationId: string, view: MessageView): Promise<void> {
    const conv = await this.prisma.client.conversation.findFirst({
      where: { id: conversationId },
      select: { visibility: true, visibleToPermissions: true },
    });
    if (!conv) return;
    const participants = await this.access.participantUserIds(conversationId);
    this.stream.emit(
      this.tenant.organizationId,
      { conversation: conv, participantUserIds: participants },
      { type: 'message.created', conversationId, messageId: view.id, syncSequence: view.syncSequence, message: view },
    );
  }

  private async resolveTargets(
    conv: { defaultConversationChannelId: string | null; channels: Array<{ id: string; channelId: string; externalConversationId: string | null }> },
    input: SendMessageInput,
  ): Promise<Array<{ id: string; channelId: string; externalConversationId: string | null }>> {
    if (input.targetConversationChannelIds?.length) {
      return conv.channels.filter((c) => input.targetConversationChannelIds!.includes(c.id));
    }
    if (input.replyToMessageId) {
      // A reply follows the channel of the message it replies to (via its delivery).
      const replyDelivery = await this.prisma.client.messageDelivery.findFirst({
        where: { messageId: input.replyToMessageId },
        select: { conversationChannelId: true },
      });
      if (replyDelivery?.conversationChannelId) {
        const match = conv.channels.find((c) => c.id === replyDelivery.conversationChannelId);
        if (match) return [match];
      }
    }
    if (conv.defaultConversationChannelId) {
      const def = conv.channels.find((c) => c.id === conv.defaultConversationChannelId);
      if (def) return [def];
    }
    // Fallback: the internal channel(s).
    return conv.channels;
  }

  private selection() {
    return {
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
  }
}
