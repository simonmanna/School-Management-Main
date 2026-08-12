import { Injectable } from '@nestjs/common';
import type {
  ChannelHealth,
  MessagingProvider,
  OutboundMessage,
  ProviderCapabilities,
  SendOutcome,
} from '../../messaging-provider.interface';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { BaileysSessionManager } from './baileys-session.manager';
import { BaileysSendPolicy } from './baileys-send-policy';

/**
 * The experimental WhatsApp provider (Baileys transport). A thin adapter: the
 * live socket + lease live in BaileysSessionManager, the anti-ban pacing in
 * BaileysSendPolicy, and NOTHING Baileys-shaped crosses the MessagingProvider
 * boundary. Swapping to WhatsAppCloudProvider is `WHATSAPP_TRANSPORT=cloud` — no
 * change to conversations, messages, deliveries, or the dispatcher.
 */
@Injectable()
export class BaileysProvider implements MessagingProvider {
  readonly id = 'whatsapp' as const;

  readonly capabilities: ProviderCapabilities = {
    outbound: true,
    inbound: true,
    attachments: false, // v1 text-only
    deliveryReceipts: true,
    clientSuppliedMessageId: true, // WA dedupes on our supplied id
    requiresPairing: true,
    typingIndicator: true,
  };

  constructor(
    private readonly manager: BaileysSessionManager,
    private readonly policy: BaileysSendPolicy,
    private readonly prisma: PrismaService,
  ) {}

  async isReady(channelId: string): Promise<boolean> {
    return this.manager.isReady(channelId);
  }

  async health(channelId: string): Promise<ChannelHealth> {
    const row = await this.prisma.raw.communicationChannel.findUnique({
      where: { id: channelId },
      select: { status: true, lastConnectedAt: true, lastError: true },
    });
    const local = this.manager.channelHealth(channelId);
    return {
      status: (row?.status as ChannelHealth['status']) ?? 'disconnected',
      lastConnectedAt: row?.lastConnectedAt ?? null,
      lastError: row?.lastError ?? null,
      ownedByThisProcess: local.ownedByThisProcess,
    };
  }

  async send(msg: OutboundMessage): Promise<SendOutcome> {
    // Anti-ban pacing — provider-local. Returns a deferral the dispatcher honours.
    const decision = await this.policy.check(msg.channelId, msg.conversationChannelId ?? null);
    if (!decision.ok) {
      return { kind: 'deferred', deferUntil: decision.deferUntil ?? new Date(Date.now() + 30_000), reason: decision.reason };
    }
    const jid = this.manager.normalizeAddress(msg.toAddress);
    // The WA message id IS our providerRequestId, so a retry after an ambiguous
    // timeout is deduped by WhatsApp itself.
    const externalMessageId = await this.manager.send(msg.channelId, jid, msg.body, msg.providerRequestId);
    await this.policy.recordSend(msg.channelId, msg.conversationChannelId ?? null);
    // No deliveredAt — WhatsApp confirms delivery asynchronously via receipts.
    return { kind: 'sent', externalMessageId, sentAt: new Date() };
  }

  async markRead(channelId: string, externalConversationId: string, externalMessageId: string): Promise<void> {
    await this.manager.markRead(channelId, externalConversationId, externalMessageId);
  }

  async connect(channelId: string): Promise<void> {
    await this.manager.requestConnect(channelId);
  }

  async disconnect(channelId: string, opts?: { logout?: boolean }): Promise<void> {
    await this.manager.requestDisconnect(channelId, opts?.logout ?? false);
  }

  normalizeAddress(raw: string): string {
    return this.manager.normalizeAddress(raw);
  }
}
