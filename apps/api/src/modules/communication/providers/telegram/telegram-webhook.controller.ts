import { Body, Controller, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../../../kernel/auth/decorators/public.decorator';
import { PrismaService } from '../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../kernel/tenancy/tenant-context.service';
import { InboundMessageService } from '../../inbound/inbound-message.service';

interface TelegramUpdate {
  message?: {
    message_id: number;
    date: number;
    text?: string;
    caption?: string;
    from?: { id: number; first_name?: string; last_name?: string; username?: string };
    chat: { id: number; title?: string; first_name?: string; username?: string };
  };
}

/**
 * Inbound webhook for Telegram. `@Public()` because Telegram cannot present a JWT;
 * authenticity is verified against the per-channel secret in the
 * `X-Telegram-Bot-Api-Secret-Token` header (set when the webhook is registered
 * via setWebhook). The channel id is in the path, which resolves the org, and all
 * work runs inside `tenant.run` — the request carries no tenant context of its own.
 */
@ApiExcludeController()
@Controller('communication/webhooks/telegram')
export class TelegramWebhookController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly inbound: InboundMessageService,
  ) {}

  @Post(':channelId')
  @Public()
  @HttpCode(200)
  async receive(
    @Param('channelId') channelId: string,
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() update: TelegramUpdate,
  ): Promise<{ ok: boolean }> {
    const channel = await this.prisma.raw.communicationChannel.findUnique({
      where: { id: channelId },
      select: { organizationId: true, providerId: true, config: true, disabledAt: true },
    });
    // Silently 200 on anything we can't authenticate — never reveal which channel
    // ids exist, and never let Telegram retry a request we will always reject.
    if (!channel || channel.providerId !== 'telegram' || channel.disabledAt) return { ok: true };
    const expected = (channel.config as { webhookSecret?: string })?.webhookSecret;
    if (expected && secret !== expected) return { ok: true };

    const m = update.message;
    if (!m || (!m.text && !m.caption)) return { ok: true };

    const from = m.from;
    const displayName = from ? [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || null : null;

    await this.tenant.run({ organizationId: channel.organizationId }, () =>
      this.inbound.ingest({
        organizationId: channel.organizationId,
        channelId,
        providerId: 'telegram',
        externalConversationId: String(m.chat.id),
        externalMessageId: `${m.chat.id}:${m.message_id}`,
        externalSenderId: String(from?.id ?? m.chat.id),
        senderAddress: from?.username ? `@${from.username}` : null,
        senderDisplayName: displayName,
        body: m.text ?? m.caption ?? '',
        contentType: 'text',
        occurredAt: new Date((m.date ?? Date.now() / 1000) * 1000),
        raw: update,
      }),
    );
    return { ok: true };
  }
}
