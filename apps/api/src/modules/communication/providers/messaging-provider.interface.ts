/**
 * The provider boundary. NOTHING provider-specific — no Express `Response`, no
 * Prisma types, no Baileys/Telegram SDK types — may cross this interface. That
 * is what lets a `WhatsAppCloudProvider` drop in for the `BaileysProvider` with
 * zero change to conversations, messages, or the dispatcher.
 *
 * The dispatcher understands only provider-agnostic concepts: `SendResult`,
 * `SendDeferred` (the provider's own pacing said "not yet"), and
 * `ProviderSendError{ retryable, ambiguous, retryAfterMs }`. It never learns the
 * words "warm-up" or "daily cap" — those live inside a provider's SendPolicy.
 */

export type ProviderId = 'internal' | 'whatsapp' | 'telegram';

export interface ProviderCapabilities {
  readonly outbound: boolean;
  readonly inbound: boolean;
  readonly attachments: boolean;
  /** Provider pushes delivered/read receipts. WhatsApp true; Telegram false. */
  readonly deliveryReceipts: boolean;
  /** Caller may supply the message id ⇒ true provider-side send dedupe. */
  readonly clientSuppliedMessageId: boolean;
  /** Needs an interactive pairing step (QR). Baileys true; cloud/telegram false. */
  readonly requiresPairing: boolean;
  readonly typingIndicator: boolean;
}

export interface OutboundMessage {
  readonly organizationId: string;
  readonly channelId: string;
  readonly conversationId: string;
  /** The transport binding this send goes over — the per-conversation pacing key. */
  readonly conversationChannelId?: string | null;
  readonly messageId: string;
  /** Deterministic, stable across retries. Passed to the provider verbatim. */
  readonly providerRequestId: string;
  /** Provider-native destination: jid | chat_id | userId. */
  readonly toAddress: string;
  readonly body: string;
  readonly contentType: 'text';
}

/** A message left our side for the provider. */
export interface SendResult {
  readonly kind: 'sent';
  readonly externalMessageId: string;
  readonly sentAt: Date;
  /**
   * Instant-delivery providers (internal) set this so the dispatcher can move
   * straight to `delivered`. Async providers leave it undefined — `delivered`
   * arrives later via an ack/webhook.
   */
  readonly deliveredAt?: Date;
  /** Provider already had this id ⇒ no second copy was created. */
  readonly deduped?: boolean;
}

/** The provider's pacing decided this send may not go yet. Not an error. */
export interface SendDeferred {
  readonly kind: 'deferred';
  readonly deferUntil: Date;
  readonly reason?: string;
}

export type SendOutcome = SendResult | SendDeferred;

export class ProviderSendError extends Error {
  constructor(
    message: string,
    /** e.g. 'not_on_whatsapp' | 'rate_limited' | 'chat_not_found' | 'blocked'. */
    readonly code: string,
    readonly retryable: boolean,
    /** True when we cannot tell whether the message was actually delivered. */
    readonly ambiguous: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ProviderSendError';
  }
}

export interface ChannelHealth {
  readonly status:
    | 'disconnected'
    | 'connecting'
    | 'pairing'
    | 'connected'
    | 'logged_out'
    | 'error';
  readonly lastConnectedAt: Date | null;
  readonly lastError: string | null;
  /** True when THIS process holds the live session (Baileys lease). */
  readonly ownedByThisProcess: boolean;
}

export interface MessagingProvider {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;

  /** Ready to accept a send right now on this channel (socket open / lease held). */
  isReady(channelId: string): Promise<boolean>;
  health(channelId: string): Promise<ChannelHealth>;

  send(msg: OutboundMessage): Promise<SendOutcome>;

  /** No-op where unsupported. */
  markRead(channelId: string, externalConversationId: string, externalMessageId: string): Promise<void>;

  /** Pairing lifecycle. No-ops for providers with requiresPairing=false. */
  connect(channelId: string): Promise<void>;
  disconnect(channelId: string, opts?: { logout?: boolean }): Promise<void>;

  /** Normalize a raw address (E.164 → jid, @handle → chat_id). Throws if invalid. */
  normalizeAddress(raw: string): string;
}
