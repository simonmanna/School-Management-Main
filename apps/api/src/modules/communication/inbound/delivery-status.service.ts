import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { ConversationAccessService } from '../conversation-access.service';
import { CommunicationStreamService } from '../communication-stream.service';

/** Monotonic rank — a delivery status may only ever move forward. */
const RANK: Record<string, number> = {
  queued: 0,
  sending: 1,
  sent: 2,
  delivered: 3,
  read: 4,
};

export interface ProviderStatusUpdate {
  providerId: string;
  /** Provider's message id OR our providerRequestId (we match on either). */
  providerMessageId: string;
  status: 'sent' | 'delivered' | 'read';
  at: Date;
}

/**
 * Applies asynchronous delivery acks (Baileys receipts, Telegram — none) to
 * `MessageDelivery`. The update is CONDITIONAL on the current status ranking
 * below the incoming one, so out-of-order acks (a late DELIVERED after a READ)
 * are no-ops rather than walking the state backwards. Runs with `prisma.raw` —
 * ack handlers fire outside any request, in a `tenant.run` established by the
 * caller.
 */
@Injectable()
export class DeliveryStatusService {
  private readonly logger = new Logger('DeliveryStatus');

  constructor(
    private readonly prisma: PrismaService,
    private readonly stream: CommunicationStreamService,
  ) {}

  async applyProviderStatus(update: ProviderStatusUpdate): Promise<void> {
    const targetRank = RANK[update.status];
    const lowerStatuses = Object.keys(RANK).filter((s) => RANK[s] < targetRank);

    const timestampField =
      update.status === 'delivered' ? { deliveredAt: update.at } : update.status === 'read' ? { readAt: update.at } : { sentAt: update.at };

    const rows = await this.prisma.raw.messageDelivery.findMany({
      where: {
        providerId: update.providerId,
        OR: [{ externalMessageId: update.providerMessageId }, { providerRequestId: update.providerMessageId }],
        status: { in: lowerStatuses },
      },
      select: { id: true, messageId: true, organizationId: true },
    });
    if (rows.length === 0) return;

    await this.prisma.raw.messageDelivery.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { status: update.status, ...timestampField },
    });

    // Notify the conversation's audience so ticks update live.
    for (const row of rows) {
      await this.emitStatus(row.organizationId, row.messageId, update.status).catch((e) =>
        this.logger.warn(`delivery status emit failed: ${String(e)}`),
      );
    }
  }

  /** Mark a delivery sent + record the provider id, releasing the claim atomically. */
  async markSent(deliveryId: string, externalMessageId: string, sentAt: Date, deliveredAt?: Date): Promise<void> {
    await this.prisma.raw.messageDelivery.update({
      where: { id: deliveryId },
      data: {
        status: deliveredAt ? 'delivered' : 'sent',
        externalMessageId,
        sentAt,
        ...(deliveredAt ? { deliveredAt } : {}),
        claimToken: null,
        claimedAt: null,
        lastError: null,
      },
    });
  }

  private async emitStatus(organizationId: string, messageId: string, status: string): Promise<void> {
    const msg = await this.prisma.raw.message.findFirst({
      where: { id: messageId },
      select: { conversationId: true },
    });
    if (!msg) return;
    const conv = await this.prisma.raw.conversation.findFirst({
      where: { id: msg.conversationId },
      select: { visibility: true, visibleToPermissions: true },
    });
    if (!conv) return;
    const participants = await this.prisma.raw.conversationParticipant.findMany({
      where: { conversationId: msg.conversationId, participantType: 'user', leftAt: null, userId: { not: null } },
      select: { userId: true },
    });
    this.stream.emit(
      organizationId,
      { conversation: conv, participantUserIds: participants.map((p) => p.userId!).filter(Boolean) },
      { type: 'delivery.status', conversationId: msg.conversationId, messageId, status },
    );
  }
}
