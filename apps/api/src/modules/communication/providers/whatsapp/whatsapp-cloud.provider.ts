import { Injectable, Logger } from '@nestjs/common';
import type {
  ChannelHealth,
  MessagingProvider,
  OutboundMessage,
  ProviderCapabilities,
  SendOutcome,
} from '../messaging-provider.interface';
import { ProviderSendError } from '../messaging-provider.interface';
import { PrismaService } from '../../../../kernel/prisma/prisma.service';

interface CloudConfig {
  phoneNumberId?: string;
  accessToken?: string;
  apiVersion?: string;
}

/**
 * The PRODUCTION-TARGET WhatsApp provider: Meta's official Cloud API. Selected
 * with `WHATSAPP_TRANSPORT=cloud`. Same MessagingProvider contract as the
 * experimental Baileys provider — swapping is a config flip, no schema/call-site
 * change, which is the whole point of keeping `baileys` out of `providerId`.
 *
 * Stateless HTTPS (no lease, no pairing). Config lives on
 * CommunicationChannel.config; inbound + delivery receipts arrive via Meta's
 * webhook (wired alongside Telegram's — see the webhook controller). This is a
 * working skeleton: outbound send is real; the webhook receiver is Phase 4+.
 */
@Injectable()
export class WhatsAppCloudProvider implements MessagingProvider {
  readonly id = 'whatsapp' as const;
  private readonly logger = new Logger('WhatsAppCloud');

  readonly capabilities: ProviderCapabilities = {
    outbound: true,
    inbound: true,
    attachments: false,
    deliveryReceipts: true,
    clientSuppliedMessageId: false, // Cloud API assigns the wamid; no client id
    requiresPairing: false,
    typingIndicator: false,
  };

  constructor(private readonly prisma: PrismaService) {}

  private async config(channelId: string): Promise<CloudConfig> {
    const row = await this.prisma.raw.communicationChannel.findUnique({
      where: { id: channelId },
      select: { config: true },
    });
    return (row?.config as CloudConfig) ?? {};
  }

  async isReady(channelId: string): Promise<boolean> {
    const cfg = await this.config(channelId);
    return !!(cfg.phoneNumberId && cfg.accessToken);
  }

  async health(channelId: string): Promise<ChannelHealth> {
    const ready = await this.isReady(channelId);
    return {
      status: ready ? 'connected' : 'disconnected',
      lastConnectedAt: ready ? new Date() : null,
      lastError: ready ? null : 'phoneNumberId/accessToken not configured',
      ownedByThisProcess: true, // stateless — any replica can send
    };
  }

  async send(msg: OutboundMessage): Promise<SendOutcome> {
    const cfg = await this.config(msg.channelId);
    if (!cfg.phoneNumberId || !cfg.accessToken) {
      throw new ProviderSendError('WhatsApp Cloud channel not configured', 'not_configured', false, false);
    }
    const version = cfg.apiVersion ?? 'v19.0';
    const url = `https://graph.facebook.com/${version}/${cfg.phoneNumberId}/messages`;
    const to = this.normalizeAddress(msg.toAddress);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: msg.body } }),
      });
      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        const retryable = res.status === 429 || res.status >= 500;
        const retryAfter = Number(res.headers.get('retry-after')) * 1000 || undefined;
        throw new ProviderSendError(
          `Cloud API ${res.status}: ${bodyText.slice(0, 200)}`,
          res.status === 429 ? 'rate_limited' : `http_${res.status}`,
          retryable,
          false,
          retryAfter,
        );
      }
      const json = (await res.json()) as { messages?: { id: string }[] };
      const wamid = json.messages?.[0]?.id;
      if (!wamid) throw new ProviderSendError('Cloud API returned no message id', 'no_message_id', true, true);
      return { kind: 'sent', externalMessageId: wamid, sentAt: new Date() };
    } catch (err) {
      if (err instanceof ProviderSendError) throw err;
      // Network-level failure — ambiguous (the request may have been received).
      throw new ProviderSendError(String(err), 'network', true, true);
    }
  }

  async markRead(channelId: string, _extConv: string, externalMessageId: string): Promise<void> {
    const cfg = await this.config(channelId);
    if (!cfg.phoneNumberId || !cfg.accessToken) return;
    const version = cfg.apiVersion ?? 'v19.0';
    await fetch(`https://graph.facebook.com/${version}/${cfg.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: externalMessageId }),
    }).catch((e) => this.logger.debug(`markRead failed: ${String(e)}`));
  }

  async connect(): Promise<void> {
    // Stateless — nothing to connect. Readiness is config presence.
  }

  async disconnect(): Promise<void> {
    // Stateless — nothing to disconnect.
  }

  normalizeAddress(raw: string): string {
    // Cloud API wants a bare E.164 number without '+' or jid suffix.
    const at = raw.indexOf('@');
    const base = at >= 0 ? raw.slice(0, at) : raw;
    return base.replace(/[^\d]/g, '');
  }
}
