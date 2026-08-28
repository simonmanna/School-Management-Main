import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { Public } from '../../../../kernel/auth/decorators/public.decorator';
import { PrismaService } from '../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../kernel/tenancy/tenant-context.service';
import { InboundMessageService } from '../../inbound/inbound-message.service';
import { DeliveryStatusService } from '../../inbound/delivery-status.service';
import { ConsentService } from '../../consent/consent.service';
import { normalizeE164, parseGatewayConfig, readPath, type SmsGatewayConfig } from './sms-gateway.config';

/**
 * Gateway callbacks: delivery receipts (DLR) and inbound messages (MO).
 *
 * `@Public()` because an SMS aggregator cannot present a JWT. Authenticity rests
 * on two things: the channel id in the path (which selects the org — the request
 * carries no tenant context of its own) and a per-channel shared secret compared
 * in constant time.
 *
 * Every rejection returns 200 with `{ok:true}`, exactly like the Telegram
 * webhook. That is deliberate:
 *   - a non-200 makes most aggregators retry the same rejected payload for hours;
 *   - a 404 vs 401 distinction tells an unauthenticated caller which channel ids
 *     exist, which is a free tenant enumeration oracle.
 * Rejections are logged server-side, where an operator can see them.
 *
 * Both GET and POST are accepted: query-string callbacks are still common among
 * regional aggregators, and refusing them would mean the adapter is not actually
 * gateway-agnostic.
 */
@ApiExcludeController()
@Controller('communication/webhooks/sms')
export class SmsWebhookController {
  private readonly logger = new Logger('SmsWebhook');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly inbound: InboundMessageService,
    private readonly deliveryStatus: DeliveryStatusService,
    private readonly consent: ConsentService,
  ) {}

  /* ── Delivery receipts ────────────────────────────────────────────────── */

  @Post(':channelId/status')
  @Public()
  @HttpCode(200)
  async statusPost(
    @Param('channelId') channelId: string,
    @Headers('x-sms-webhook-secret') headerSecret: string | undefined,
    @Query() query: Record<string, string>,
    @Body() body: unknown,
  ): Promise<{ ok: boolean }> {
    return this.handleStatus(channelId, headerSecret ?? query.secret, this.merge(query, body));
  }

  @Get(':channelId/status')
  @Public()
  @HttpCode(200)
  async statusGet(
    @Param('channelId') channelId: string,
    @Headers('x-sms-webhook-secret') headerSecret: string | undefined,
    @Query() query: Record<string, string>,
  ): Promise<{ ok: boolean }> {
    return this.handleStatus(channelId, headerSecret ?? query.secret, query);
  }

  /* ── Inbound (MO) ─────────────────────────────────────────────────────── */

  @Post(':channelId/inbound')
  @Public()
  @HttpCode(200)
  async inboundPost(
    @Param('channelId') channelId: string,
    @Headers('x-sms-webhook-secret') headerSecret: string | undefined,
    @Query() query: Record<string, string>,
    @Body() body: unknown,
  ): Promise<{ ok: boolean }> {
    return this.handleInbound(channelId, headerSecret ?? query.secret, this.merge(query, body));
  }

  @Get(':channelId/inbound')
  @Public()
  @HttpCode(200)
  async inboundGet(
    @Param('channelId') channelId: string,
    @Headers('x-sms-webhook-secret') headerSecret: string | undefined,
    @Query() query: Record<string, string>,
  ): Promise<{ ok: boolean }> {
    return this.handleInbound(channelId, headerSecret ?? query.secret, query);
  }

  /* ── Internals ────────────────────────────────────────────────────────── */

  /**
   * Query params and body are merged into one payload so a config's dotted paths
   * work regardless of where the aggregator put the field. Body wins on a clash:
   * it is the richer, structured source.
   */
  private merge(query: Record<string, string>, body: unknown): Record<string, unknown> {
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      return { ...query, ...(body as Record<string, unknown>) };
    }
    return { ...query, ...(body === undefined || body === null ? {} : { body }) };
  }

  /**
   * Resolve the channel and verify the shared secret.
   *
   * A channel with NO configured `webhookSecret` is rejected outright rather than
   * treated as "no verification required" — an unauthenticated write into an
   * org's message history and consent ledger is not a default worth having.
   */
  private async authenticate(
    channelId: string,
    presented: string | undefined,
  ): Promise<{ organizationId: string; config: SmsGatewayConfig } | null> {
    const channel = await this.prisma.raw.communicationChannel.findUnique({
      where: { id: channelId },
      select: { organizationId: true, providerId: true, config: true, disabledAt: true },
    });
    if (!channel || channel.providerId !== 'sms' || channel.disabledAt) {
      this.logger.warn(`callback for unknown/disabled SMS channel ${channelId}`);
      return null;
    }
    let config: SmsGatewayConfig;
    try {
      config = parseGatewayConfig(channel.config);
    } catch (err) {
      this.logger.warn(`callback for channel ${channelId} with invalid config: ${String(err)}`);
      return null;
    }
    const expected = config.webhookSecret;
    if (!expected) {
      this.logger.warn(`callback rejected: channel ${channelId} has no webhookSecret configured`);
      return null;
    }
    if (!presented || !SmsWebhookController.secretsMatch(expected, presented)) {
      this.logger.warn(`callback rejected: bad secret for channel ${channelId}`);
      return null;
    }
    return { organizationId: channel.organizationId, config };
  }

  /** Constant-time compare that does not leak the secret's length via early exit. */
  private static secretsMatch(expected: string, presented: string): boolean {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(presented, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  private async handleStatus(
    channelId: string,
    secret: string | undefined,
    payload: Record<string, unknown>,
  ): Promise<{ ok: boolean }> {
    const auth = await this.authenticate(channelId, secret);
    if (!auth) return { ok: true };
    const dlr = auth.config.dlr;
    if (!dlr) return { ok: true };

    const providerMessageId = readPath(payload, dlr.messageIdPath);
    const rawStatus = readPath(payload, dlr.statusPath);
    if (!providerMessageId || rawStatus === undefined || rawStatus === null) return { ok: true };

    const mapped = dlr.statusMap[String(rawStatus)] ?? dlr.statusMap[String(rawStatus).toLowerCase()];
    if (!mapped) {
      // An unmapped token is normal (gateways emit intermediate states we do not
      // model). Ignoring it is correct; guessing would corrupt the status rank.
      return { ok: true };
    }

    const at = SmsWebhookController.parseTimestamp(readPath(payload, dlr.timestampPath ?? '')) ?? new Date();

    if (mapped === 'failed') {
      const errorCode = String(readPath(payload, dlr.errorCodePath ?? '') ?? 'gateway_failed');
      await this.failDelivery(String(providerMessageId), errorCode);
      return { ok: true };
    }

    await this.tenant.run({ organizationId: auth.organizationId }, () =>
      this.deliveryStatus.applyProviderStatus({
        providerId: 'sms',
        providerMessageId: String(providerMessageId),
        status: mapped,
        at,
      }),
    );
    return { ok: true };
  }

  /**
   * A terminal DLR failure. Written directly rather than through
   * DeliveryStatusService, which only models forward progress through
   * sent/delivered/read — a network-side rejection is a different axis and must
   * stop retries, not advance the rank.
   */
  private async failDelivery(providerMessageId: string, errorCode: string): Promise<void> {
    const rows = await this.prisma.raw.messageDelivery.findMany({
      where: {
        providerId: 'sms',
        OR: [{ externalMessageId: providerMessageId }, { providerRequestId: providerMessageId }],
        status: { notIn: ['failed', 'cancelled'] },
      },
      select: { id: true },
    });
    if (rows.length === 0) return;
    await this.prisma.raw.messageDelivery.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: {
        status: 'failed',
        failedAt: new Date(),
        errorCode,
        lastError: `Gateway reported delivery failure (${errorCode}).`,
        claimToken: null,
        claimedAt: null,
      },
    });
  }

  private async handleInbound(
    channelId: string,
    secret: string | undefined,
    payload: Record<string, unknown>,
  ): Promise<{ ok: boolean }> {
    const auth = await this.authenticate(channelId, secret);
    if (!auth) return { ok: true };
    const mapping = auth.config.inbound;
    if (!mapping) return { ok: true };

    const rawFrom = readPath(payload, mapping.fromPath);
    const text = readPath(payload, mapping.textPath);
    if (!rawFrom || typeof text !== 'string' || !text) return { ok: true };

    let from: string;
    try {
      from = normalizeE164(String(rawFrom), auth.config.defaultCountryCode);
    } catch {
      this.logger.warn(`inbound SMS from unparseable number '${String(rawFrom)}' on channel ${channelId}`);
      return { ok: true };
    }

    const externalMessageId = String(
      readPath(payload, mapping.messageIdPath ?? '') ??
        // No gateway id: synthesize a stable one so a redelivered callback is a
        // replay (deduped by ExternalMessage's unique) rather than a duplicate.
        `${from}:${Date.now()}`,
    );
    const occurredAt = SmsWebhookController.parseTimestamp(readPath(payload, mapping.timestampPath ?? '')) ?? new Date();

    await this.tenant.run({ organizationId: auth.organizationId }, async () => {
      // Consent first. A STOP must take effect even if conversation ingest were
      // to fail — the opt-out is the legally meaningful half of this request.
      const action = await this.consent.applyInboundKeyword(auth.organizationId, 'sms', from, text);
      if (action) {
        this.logger.log(`SMS ${action} recorded for ${from} on channel ${channelId}`);
      }
      await this.inbound.ingest({
        organizationId: auth.organizationId,
        channelId,
        providerId: 'sms',
        // For SMS the thread IS the phone number — there is no server-side thread id.
        externalConversationId: from,
        externalMessageId,
        externalSenderId: from,
        senderAddress: from,
        senderDisplayName: null,
        body: text,
        contentType: 'text',
        occurredAt,
        raw: payload,
      });
    });
    return { ok: true };
  }

  /** Accept epoch seconds, epoch millis, or anything Date can parse. */
  private static parseTimestamp(value: unknown): Date | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'number' || /^\d+$/.test(String(value))) {
      const n = Number(value);
      const ms = n > 1e12 ? n : n * 1000;
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? null : d;
  }
}
