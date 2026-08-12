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

interface TelegramConfig {
  botToken?: string;
  botUsername?: string;
  webhookSecret?: string;
}

/**
 * Telegram Bot API provider. Stateless HTTPS — no pairing, no lease. Much simpler
 * than WhatsApp: no templates, no 24h window, no approval.
 *
 * Honest capabilities: the Bot API sends NO delivery receipts for bot→user
 * messages and has NO client-supplied message id, so `deliveryReceipts` and
 * `clientSuppliedMessageId` are both false. Deliveries therefore stop at `sent`;
 * the UI must not render a tick it can never earn.
 */
@Injectable()
export class TelegramProvider implements MessagingProvider {
  readonly id = 'telegram' as const;
  private readonly logger = new Logger('TelegramProvider');

  readonly capabilities: ProviderCapabilities = {
    outbound: true,
    inbound: true,
    attachments: false,
    deliveryReceipts: false,
    clientSuppliedMessageId: false,
    requiresPairing: false,
    typingIndicator: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  private async token(channelId: string): Promise<string | null> {
    const row = await this.prisma.raw.communicationChannel.findUnique({
      where: { id: channelId },
      select: { config: true },
    });
    const cfg = (row?.config as TelegramConfig) ?? {};
    return cfg.botToken ?? process.env.TELEGRAM_BOT_TOKEN ?? null;
  }

  async isReady(channelId: string): Promise<boolean> {
    return !!(await this.token(channelId));
  }

  async health(channelId: string): Promise<ChannelHealth> {
    const ready = await this.isReady(channelId);
    return {
      status: ready ? 'connected' : 'disconnected',
      lastConnectedAt: ready ? new Date() : null,
      lastError: ready ? null : 'bot token not configured',
      ownedByThisProcess: true,
    };
  }

  async send(msg: OutboundMessage): Promise<SendOutcome> {
    const token = await this.token(msg.channelId);
    if (!token) throw new ProviderSendError('Telegram bot token not configured', 'not_configured', false, false);
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: this.normalizeAddress(msg.toAddress), text: msg.body }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        result?: { message_id?: number; chat?: { id?: number } };
        error_code?: number;
        description?: string;
        parameters?: { retry_after?: number };
      };
      if (res.ok && json.ok && json.result?.message_id != null) {
        // Composite id — Telegram message_id is unique only per chat.
        const externalMessageId = `${json.result.chat?.id ?? msg.toAddress}:${json.result.message_id}`;
        return { kind: 'sent', externalMessageId, sentAt: new Date() };
      }
      return this.classifyError(json.error_code, json.description ?? 'unknown', json.parameters?.retry_after);
    } catch (err) {
      // Network failure — ambiguous.
      throw new ProviderSendError(String(err), 'network', true, true);
    }
  }

  private classifyError(code: number | undefined, description: string, retryAfter?: number): never {
    // 400 chat not found / 403 bot blocked → terminal. 429 → honour retry_after.
    // 5xx → retryable, unambiguous (nothing accepted).
    if (code === 403 || (code === 400 && /chat not found/i.test(description))) {
      throw new ProviderSendError(description, code === 403 ? 'blocked' : 'chat_not_found', false, false);
    }
    if (code === 429) {
      throw new ProviderSendError(description, 'rate_limited', true, false, (retryAfter ?? 1) * 1000);
    }
    const retryable = code === undefined || code >= 500;
    throw new ProviderSendError(description, `telegram_${code ?? 'net'}`, retryable, false);
  }

  async markRead(): Promise<void> {
    // Bot API has no read-receipt endpoint.
  }

  async connect(): Promise<void> {
    // Stateless.
  }

  async disconnect(): Promise<void> {
    // Stateless.
  }

  normalizeAddress(raw: string): string {
    // Telegram chat_id — numeric or @username. Passed through.
    return raw;
  }
}
