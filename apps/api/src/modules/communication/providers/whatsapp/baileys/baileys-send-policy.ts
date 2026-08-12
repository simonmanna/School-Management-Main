import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';

export interface PacingDecision {
  ok: boolean;
  deferUntil?: Date;
  reason?: string;
}

/**
 * All WhatsApp anti-ban pacing lives HERE, inside the provider — never in the
 * generic dispatcher, which understands only `SendDeferred`. Gates:
 *   • min gap between sends on a channel (WA_MIN_GAP_MS ±40% jitter)
 *   • per-conversation gap (a burst to one chat looks like a bot)
 *   • daily cap per channel (WA_DAILY_CAP), reset on date rollover
 *   • warm-up ramp: min(cap, 20 × days since pairing) — a freshly paired number
 *     that immediately blasts 200 messages is the classic ban signal
 *
 * State is DB-persisted (CommunicationChannel/ConversationChannel.nextSendAt +
 * dailySentCount) so pacing survives a restart and coordinates across replicas —
 * a `sleep` would do neither.
 */
@Injectable()
export class BaileysSendPolicy {
  constructor(private readonly prisma: PrismaService) {}

  private get minGapMs(): number {
    return Number(process.env.WA_MIN_GAP_MS ?? '4000');
  }
  private get dailyCap(): number {
    return Number(process.env.WA_DAILY_CAP ?? '200');
  }

  /** Decide whether a send may proceed now. Read-only — call `recordSend` after. */
  async check(channelId: string, conversationChannelId: string | null): Promise<PacingDecision> {
    const now = Date.now();
    const channel = await this.prisma.raw.communicationChannel.findUnique({
      where: { id: channelId },
      select: { nextSendAt: true, dailySentCount: true, dailyCountDate: true, pairedAt: true },
    });
    if (!channel) return { ok: false, reason: 'channel_missing' };

    // Channel min-gap gate.
    if (channel.nextSendAt && channel.nextSendAt.getTime() > now) {
      return { ok: false, deferUntil: channel.nextSendAt, reason: 'channel_gap' };
    }

    // Daily cap + warm-up ramp.
    const today = new Date().toISOString().slice(0, 10);
    const countToday = channel.dailyCountDate?.toISOString().slice(0, 10) === today ? channel.dailySentCount : 0;
    const effectiveCap = this.effectiveCap(channel.pairedAt);
    if (countToday >= effectiveCap) {
      // Defer to the start of tomorrow (UTC) rather than failing.
      const tomorrow = new Date();
      tomorrow.setUTCHours(24, 0, 0, 0);
      return { ok: false, deferUntil: tomorrow, reason: 'daily_cap' };
    }

    // Per-conversation gate.
    if (conversationChannelId) {
      const cc = await this.prisma.raw.conversationChannel.findUnique({
        where: { id: conversationChannelId },
        select: { nextSendAt: true },
      });
      if (cc?.nextSendAt && cc.nextSendAt.getTime() > now) {
        return { ok: false, deferUntil: cc.nextSendAt, reason: 'conversation_gap' };
      }
    }
    return { ok: true };
  }

  /** Push the pacing gates forward after a successful send. */
  async recordSend(channelId: string, conversationChannelId: string | null): Promise<void> {
    const gap = this.minGapMs * (1 + (Math.random() * 0.8 - 0.4)); // ±40%
    const nextSendAt = new Date(Date.now() + gap);
    const today = new Date();

    const channel = await this.prisma.raw.communicationChannel.findUnique({
      where: { id: channelId },
      select: { dailyCountDate: true, dailySentCount: true },
    });
    const sameDay = channel?.dailyCountDate?.toISOString().slice(0, 10) === today.toISOString().slice(0, 10);
    await this.prisma.raw.communicationChannel.update({
      where: { id: channelId },
      data: {
        nextSendAt,
        dailyCountDate: today,
        dailySentCount: sameDay ? { increment: 1 } : 1,
      },
    });
    if (conversationChannelId) {
      await this.prisma.raw.conversationChannel.update({
        where: { id: conversationChannelId },
        data: { nextSendAt },
      });
    }
  }

  private effectiveCap(pairedAt: Date | null): number {
    if (!pairedAt) return Math.min(this.dailyCap, 20); // never paired → treat as day 1
    const days = Math.max(1, Math.ceil((Date.now() - pairedAt.getTime()) / 86_400_000));
    return Math.min(this.dailyCap, 20 * days);
  }
}
