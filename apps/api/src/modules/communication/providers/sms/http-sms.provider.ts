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
import { CommSecretService } from '../whatsapp/comm-secret.service';
import {
  isSuccessResponse,
  normalizeE164,
  parseGatewayConfig,
  readPath,
  renderTemplate,
  type SmsGatewayConfig,
  type SmsRenderContext,
} from './sms-gateway.config';
import { countSegments, transliterateToGsm7 } from './sms-segments';

/**
 * SMS provider driven entirely by per-channel configuration.
 *
 * One class, any gateway. `CommunicationChannel.config` describes the HTTP call
 * (endpoint, encoding, parameter templates, response paths) and this adapter
 * executes it. See sms-gateway.config.ts for why the vendor lives in data.
 *
 * Contract obligations that matter to the dispatcher:
 *   - `ProviderSendError.retryable` must be FALSE for anything a retry cannot
 *     fix (bad number, insufficient credit, rejected sender id). Retrying those
 *     six times just burns the school's balance and delays the failure report.
 *   - `ambiguous` must be TRUE whenever we cannot tell whether the gateway
 *     accepted the message — a timeout, a 5xx after the body was sent, a 200
 *     with an unparseable payload. The dispatcher surfaces that in the UI rather
 *     than silently double-sending a fee reminder.
 *   - `normalizeAddress` must be deterministic, because its output is the
 *     consent key AND part of the delivery idempotency key.
 */
@Injectable()
export class HttpSmsProvider implements MessagingProvider {
  readonly id = 'sms' as const;
  private readonly logger = new Logger('SmsProvider');

  readonly capabilities: ProviderCapabilities = {
    outbound: true,
    // Inbound (MO) and receipts (DLR) are real, but only when the gateway is
    // configured with the mappings — capabilities here describe the transport's
    // ceiling, and the webhook no-ops when a mapping is absent.
    inbound: true,
    attachments: false,
    deliveryReceipts: true,
    // Gateways assign their own id; ours goes along as a correlation field only.
    clientSuppliedMessageId: false,
    requiresPairing: false,
    typingIndicator: false,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: CommSecretService,
  ) {}

  /**
   * Load + validate a channel's gateway config. Validating on every send (rather
   * than trusting the write-time check) costs nothing measurable and means a row
   * edited directly in the database cannot produce a malformed outbound request.
   */
  private async config(channelId: string): Promise<SmsGatewayConfig | null> {
    const row = await this.prisma.raw.communicationChannel.findUnique({
      where: { id: channelId },
      select: { config: true },
    });
    if (!row) return null;
    try {
      return parseGatewayConfig(row.config);
    } catch {
      return null;
    }
  }

  /** Decrypt the channel's secret bag. Missing/rotated key => no secrets, not a crash. */
  private decryptSecrets(cfg: SmsGatewayConfig, channelId: string): Record<string, string> {
    if (!cfg.secretsEnc) return {};
    try {
      const parsed = JSON.parse(this.secrets.decrypt(cfg.secretsEnc)) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) out[k] = String(v);
      return out;
    } catch (err) {
      this.logger.error(`channel ${channelId}: could not decrypt gateway secrets — ${String(err)}`);
      return {};
    }
  }

  async isReady(channelId: string): Promise<boolean> {
    const row = await this.prisma.raw.communicationChannel.findUnique({
      where: { id: channelId },
      select: { config: true, disabledAt: true, desiredState: true },
    });
    if (!row || row.disabledAt) return false;
    if (row.desiredState === 'disconnected') return false;
    try {
      parseGatewayConfig(row.config);
      return true;
    } catch {
      return false;
    }
  }

  async health(channelId: string): Promise<ChannelHealth> {
    const row = await this.prisma.raw.communicationChannel.findUnique({
      where: { id: channelId },
      select: { config: true, lastConnectedAt: true, lastError: true, desiredState: true },
    });
    if (!row) {
      return { status: 'error', lastConnectedAt: null, lastError: 'channel not found', ownedByThisProcess: true };
    }
    let configError: string | null = null;
    try {
      parseGatewayConfig(row.config);
    } catch (err) {
      configError = err instanceof Error ? err.message : String(err);
    }
    const status = configError ? 'error' : row.desiredState === 'disconnected' ? 'disconnected' : 'connected';
    return {
      status,
      lastConnectedAt: row.lastConnectedAt,
      lastError: configError ?? row.lastError,
      // Stateless HTTP — every replica can send; there is no lease to hold.
      ownedByThisProcess: true,
    };
  }

  async send(msg: OutboundMessage): Promise<SendOutcome> {
    const cfg = await this.config(msg.channelId);
    if (!cfg) {
      throw new ProviderSendError('SMS channel is not configured', 'not_configured', false, false);
    }

    const to = normalizeE164(msg.toAddress, cfg.defaultCountryCode);
    const text = cfg.transliterate ? transliterateToGsm7(msg.body) : msg.body;
    const seg = countSegments(text);

    // A body over the cap is a permanent condition — retrying cannot shorten it.
    if (cfg.maxSegments && seg.segments > cfg.maxSegments) {
      throw new ProviderSendError(
        `Message is ${seg.segments} SMS segments (${seg.encoding}); this channel allows ${cfg.maxSegments}.`,
        'too_long',
        false,
        false,
      );
    }

    const ctx: SmsRenderContext = {
      to,
      from: cfg.senderId ?? '',
      text,
      requestId: msg.providerRequestId,
      secrets: this.decryptSecrets(cfg, msg.channelId),
    };

    const params: Record<string, string> = {};
    for (const [k, template] of Object.entries(cfg.params)) params[k] = renderTemplate(template, ctx);
    const headers: Record<string, string> = {};
    for (const [k, template] of Object.entries(cfg.headers ?? {})) headers[k] = renderTemplate(template, ctx);

    let url = cfg.endpoint;
    let body: string | undefined;
    if (cfg.bodyEncoding === 'query') {
      const qs = new URLSearchParams(params).toString();
      url += (url.includes('?') ? '&' : '?') + qs;
    } else if (cfg.bodyEncoding === 'form') {
      body = new URLSearchParams(params).toString();
      headers['Content-Type'] ??= 'application/x-www-form-urlencoded';
    } else {
      body = JSON.stringify(params);
      headers['Content-Type'] ??= 'application/json';
    }
    headers['Accept'] ??= 'application/json';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.requestTimeoutMs ?? 20_000);

    let res: Response;
    try {
      res = await fetch(url, { method: cfg.method, headers, body, signal: controller.signal });
    } catch (err) {
      // Network fault or timeout. The gateway may or may not have queued it —
      // ambiguous, so the dispatcher flags a possible duplicate on retry.
      const aborted = (err as { name?: string }).name === 'AbortError';
      throw new ProviderSendError(
        aborted ? `SMS gateway timed out after ${cfg.requestTimeoutMs ?? 20_000}ms` : String(err),
        aborted ? 'timeout' : 'network',
        true,
        true,
      );
    } finally {
      clearTimeout(timer);
    }

    const raw = await res.text().catch(() => '');
    let parsed: unknown = raw;
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      // Non-JSON gateways exist (plain "OK 12345"). Path mappings will miss and
      // we fall back to the requestId; the HTTP status still decides success.
      parsed = { raw };
    }

    if (!res.ok) {
      const retryable =
        res.status === 429 || res.status >= 500 || (cfg.retryableStatusCodes ?? []).includes(res.status);
      const retryAfterHeader = Number(res.headers.get('retry-after'));
      throw new ProviderSendError(
        `SMS gateway ${res.status}: ${raw.slice(0, 300)}`,
        res.status === 429 ? 'rate_limited' : `http_${res.status}`,
        retryable,
        // A 5xx may still have queued the message; a 4xx definitively did not.
        res.status >= 500,
        Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader * 1000 : undefined,
      );
    }

    // HTTP 200 with an in-body failure — the most common gateway shape.
    if (!isSuccessResponse(parsed, cfg.response)) {
      const code = String(readPath(parsed, cfg.response.errorCodePath ?? '') ?? 'gateway_rejected');
      const message = String(
        readPath(parsed, cfg.response.errorMessagePath ?? '') ?? raw.slice(0, 300) ?? 'gateway rejected the message',
      );
      const retryable = (cfg.response.retryableErrorCodes ?? []).includes(code);
      throw new ProviderSendError(`SMS gateway rejected: ${message}`, code, retryable, false);
    }

    const externalMessageId =
      (cfg.response.messageIdPath ? readPath(parsed, cfg.response.messageIdPath) : undefined) ?? msg.providerRequestId;

    await this.recordCost(msg, seg.segments, cfg.costPerSegmentMicros);

    return { kind: 'sent', externalMessageId: String(externalMessageId), sentAt: new Date() };
  }

  /**
   * Stamp what this send actually cost. Written here rather than in the
   * dispatcher because segment count depends on the provider's own encoding
   * decision (transliteration), which the dispatcher deliberately knows nothing
   * about. Best-effort: a failure to record cost must never fail a delivered SMS.
   */
  private async recordCost(msg: OutboundMessage, segments: number, perSegmentMicros?: number): Promise<void> {
    try {
      await this.prisma.raw.messageDelivery.updateMany({
        where: { providerId: 'sms', providerRequestId: msg.providerRequestId },
        data: {
          segments,
          costMicros: perSegmentMicros ? BigInt(Math.round(perSegmentMicros * segments)) : null,
        },
      });
    } catch (err) {
      this.logger.warn(`could not record SMS cost for ${msg.providerRequestId}: ${String(err)}`);
    }
  }

  /** SMS has no read receipt. */
  async markRead(): Promise<void> {
    // No-op: the GSM network reports delivery, never read.
  }

  async connect(channelId: string): Promise<void> {
    // Stateless — "connecting" only records operator intent so the dispatcher's
    // isReady() gate opens. Real readiness is config validity.
    await this.prisma.raw.communicationChannel.update({
      where: { id: channelId },
      data: { desiredState: 'connected', status: 'connected', lastConnectedAt: new Date(), lastError: null },
    });
  }

  async disconnect(channelId: string): Promise<void> {
    await this.prisma.raw.communicationChannel.update({
      where: { id: channelId },
      data: { desiredState: 'disconnected', status: 'disconnected' },
    });
  }

  /**
   * Normalize without a channel-specific default country code — the interface is
   * channel-agnostic. Send() re-normalizes WITH the channel's code, so a bare
   * local number typed in the composer still resolves; this path only guarantees
   * a stable shape for already-international input.
   */
  normalizeAddress(raw: string): string {
    return normalizeE164(raw, process.env.SMS_DEFAULT_COUNTRY_CODE);
  }
}
