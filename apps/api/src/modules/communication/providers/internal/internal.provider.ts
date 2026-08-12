import { Injectable } from '@nestjs/common';
import type {
  ChannelHealth,
  MessagingProvider,
  OutboundMessage,
  ProviderCapabilities,
  SendOutcome,
} from '../messaging-provider.interface';

/**
 * The internal (staff-to-staff) provider. There is no external system: a
 * "delivery" is the message already being durably in the recipient's
 * conversation, so `send` succeeds instantly and reports `deliveredAt = now`.
 *
 * Treating internal as a real provider (rather than special-casing it in the
 * dispatcher) is deliberate — the dispatcher's claim/pace/retry loop is
 * identical for internal, WhatsApp and Telegram.
 */
@Injectable()
export class InternalProvider implements MessagingProvider {
  readonly id = 'internal' as const;

  readonly capabilities: ProviderCapabilities = {
    outbound: true,
    inbound: true,
    attachments: true,
    deliveryReceipts: true,
    clientSuppliedMessageId: true,
    requiresPairing: false,
    typingIndicator: false,
  };

  async isReady(): Promise<boolean> {
    return true;
  }

  async health(): Promise<ChannelHealth> {
    return { status: 'connected', lastConnectedAt: new Date(), lastError: null, ownedByThisProcess: true };
  }

  async send(msg: OutboundMessage): Promise<SendOutcome> {
    const now = new Date();
    // The message row already exists; the "external id" is the message id itself.
    return { kind: 'sent', externalMessageId: msg.messageId, sentAt: now, deliveredAt: now };
  }

  async markRead(): Promise<void> {
    // Read state for internal is tracked via ConversationParticipant.lastReadMessageId.
  }

  async connect(): Promise<void> {
    // Always connected.
  }

  async disconnect(): Promise<void> {
    // Cannot disconnect the internal transport.
  }

  normalizeAddress(raw: string): string {
    // Internal addresses are user ids — passed through unchanged.
    return raw;
  }
}
