import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { ConversationAccessService } from './conversation-access.service';

export interface CreateConversationInput {
  kind?: 'direct' | 'group' | 'channel';
  name?: string;
  participantUserIds?: string[];
  contextType?: string;
  contextId?: string;
  visibility?: 'private' | 'org' | 'role';
  visibleToPermissions?: string[];
  syncToDevices?: boolean;
}

/**
 * Conversation lifecycle. A conversation is transport-independent; on creation
 * it always gets an internal `ConversationChannel` so staff can talk on it
 * immediately, and external channels are attached later by the provider layer.
 */
@Injectable()
export class ConversationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly access: ConversationAccessService,
  ) {}

  /** Get (or lazily create) the org's singleton internal CommunicationChannel. */
  async ensureInternalChannel(): Promise<string> {
    const orgId = this.tenant.organizationId;
    const existing = await this.prisma.client.communicationChannel.findFirst({
      where: { providerId: 'internal' },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await this.prisma.client.communicationChannel.create({
      data: {
        organizationId: orgId,
        providerId: 'internal',
        transport: 'internal',
        name: 'Internal',
        status: 'connected',
        desiredState: 'connected',
      },
      select: { id: true },
    });
    return created.id;
  }

  async create(input: CreateConversationInput): Promise<{ id: string }> {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId ?? null;
    const kind = input.kind ?? 'direct';
    if (input.syncToDevices && kind !== 'channel') {
      throw new BadRequestException('Only channel conversations may be synced to POS devices.');
    }
    const visibility = input.visibility ?? (kind === 'channel' ? 'role' : 'private');

    const internalChannelId = await this.ensureInternalChannel();

    // Deduplicate participants; always include the creator.
    const participantIds = new Set<string>(input.participantUserIds ?? []);
    if (userId) participantIds.add(userId);

    const conv = await this.prisma.client.$transaction(async (tx) => {
      const c = await tx.conversation.create({
        data: {
          organizationId: orgId,
          kind,
          name: input.name ?? null,
          contextType: input.contextType ?? null,
          contextId: input.contextId ?? null,
          visibility,
          visibleToPermissions: input.visibleToPermissions ?? [],
          syncToDevices: input.syncToDevices ?? false,
          createdById: userId,
        },
      });
      const cc = await tx.conversationChannel.create({
        data: { organizationId: orgId, conversationId: c.id, channelId: internalChannelId, active: true },
      });
      await tx.conversation.update({ where: { id: c.id }, data: { defaultConversationChannelId: cc.id } });
      if (participantIds.size > 0) {
        await tx.conversationParticipant.createMany({
          data: [...participantIds].map((uid) => ({
            organizationId: orgId,
            conversationId: c.id,
            participantType: 'user',
            userId: uid,
            role: uid === userId ? 'owner' : 'member',
          })),
        });
      }
      return c;
    });
    return { id: conv.id };
  }

  /** Conversations the current user can access, newest first, with unread counts. */
  async list(): Promise<unknown[]> {
    const userId = this.tenant.userId;
    if (!userId) return [];
    const perms = this.tenant.permissions;
    const readAll = perms.includes('communication:conversation:read_all');

    // Base set: conversations the user participates in, plus org/role-visible ones
    // (and everything when read_all). The pure rule still gates each below.
    const convs = await this.prisma.client.conversation.findMany({
      where: {
        deletedAt: null,
        OR: [
          { participants: { some: { userId, participantType: 'user', leftAt: null } } },
          { visibility: 'org' },
          { visibility: 'role' },
          ...(readAll ? [{}] : []),
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: {
        participants: { where: { participantType: 'user', leftAt: null }, select: { userId: true, lastReadMessageId: true } },
        channels: { select: { id: true, channelId: true, externalConversationId: true } },
      },
    });

    const visible = convs.filter((c) =>
      ConversationAccessService.canAccess(
        c,
        c.participants.some((p) => p.userId === userId),
        { userId, permissions: perms },
      ),
    );

    // Last message + unread per conversation.
    const result = [];
    for (const c of visible) {
      const last = await this.prisma.client.message.findFirst({
        where: { conversationId: c.id, deletedAt: null },
        orderBy: { occurredAt: 'desc' },
        select: { id: true, body: true, occurredAt: true, senderUserId: true },
      });
      const me = c.participants.find((p) => p.userId === userId);
      const unread = await this.unreadCount(c.id, me?.lastReadMessageId ?? null, userId);
      result.push({
        id: c.id,
        kind: c.kind,
        name: c.name,
        contextType: c.contextType,
        contextId: c.contextId,
        visibility: c.visibility,
        updatedAt: c.updatedAt,
        lastMessage: last ? { id: last.id, body: last.body, occurredAt: last.occurredAt } : null,
        unread,
      });
    }
    return result;
  }

  async getOrCreateForContext(contextType: string, contextId: string): Promise<{ id: string }> {
    const existing = await this.prisma.client.conversation.findFirst({
      where: { contextType, contextId, deletedAt: null },
      select: { id: true },
    });
    if (existing) return existing;
    return this.create({
      kind: 'direct',
      contextType,
      contextId,
      visibility: 'org',
      name: `${contextType} ${contextId}`,
    });
  }

  async get(conversationId: string): Promise<unknown> {
    await this.access.assertCanRead(conversationId);
    const c = await this.prisma.client.conversation.findFirst({
      where: { id: conversationId, deletedAt: null },
      include: {
        participants: { where: { leftAt: null }, select: { participantType: true, userId: true, partnerId: true, role: true } },
        channels: { select: { id: true, channelId: true, externalConversationId: true, active: true } },
      },
    });
    if (!c) throw new NotFoundException('Conversation not found.');
    return c;
  }

  /** Advance the caller's read cursor to the given (or latest) message. */
  async markRead(conversationId: string, messageId?: string): Promise<{ ok: true }> {
    await this.access.assertCanRead(conversationId);
    const userId = this.tenant.userId;
    if (!userId) return { ok: true };
    let lastReadMessageId = messageId;
    if (!lastReadMessageId) {
      const last = await this.prisma.client.message.findFirst({
        where: { conversationId, deletedAt: null },
        orderBy: { occurredAt: 'desc' },
        select: { id: true },
      });
      lastReadMessageId = last?.id;
    }
    if (!lastReadMessageId) return { ok: true };
    await this.prisma.client.conversationParticipant.updateMany({
      where: { conversationId, userId, participantType: 'user' },
      data: { lastReadMessageId },
    });
    return { ok: true };
  }

  private async unreadCount(conversationId: string, lastReadMessageId: string | null, userId: string): Promise<number> {
    let after: Date | null = null;
    if (lastReadMessageId) {
      const m = await this.prisma.client.message.findFirst({ where: { id: lastReadMessageId }, select: { occurredAt: true } });
      after = m?.occurredAt ?? null;
    }
    return this.prisma.client.message.count({
      where: {
        conversationId,
        deletedAt: null,
        senderUserId: { not: userId },
        ...(after ? { occurredAt: { gt: after } } : {}),
      },
    });
  }
}
