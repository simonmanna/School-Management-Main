import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { MessageDispatchService } from './message-dispatch.service';

/**
 * Drains the `MessageDelivery` work queue. A self-scheduling `setTimeout` loop
 * (not `@Cron`) because Telegram's 30 msg/s needs sub-second polling, below the
 * `@nestjs/schedule` 1s floor. Multi-instance safe: rows are claimed with
 * `FOR UPDATE SKIP LOCKED` + a stale-claim window, identical to `OutboxWorker`.
 *
 * Pacing is enforced in two places, both provider-agnostic here:
 *   • the claim query skips rows whose channel/conversation `nextSendAt` is in the
 *     future (coarse gate), and
 *   • a provider's own SendPolicy returns `SendDeferred` at send time (fine gate).
 * The worker never encodes per-provider limits.
 *
 * Fairness + the Baileys single-writer lease are handled WITHOUT special-casing:
 *   • A paced channel's rows carry a future `nextSendAt`, so the batch naturally
 *     fills with ready rows across other channels — a WhatsApp backlog (4s gap)
 *     cannot starve internal/Telegram, which have no gap.
 *   • A WhatsApp row claimed by a replica that does NOT hold the Baileys session
 *     is safely deferred: `BaileysProvider.isReady()` is false off the lease, so
 *     `processDelivery` reschedules it (+30s) without consuming an attempt.
 * A flat batch is therefore correct for internal + WhatsApp + Telegram together.
 */
@Injectable()
export class MessageDispatchWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('MessageDispatchWorker');
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs = Number(process.env.COMM_DISPATCH_POLL_MS ?? '250');
  private readonly batchSize = Number(process.env.COMM_DISPATCH_BATCH ?? '50');
  private readonly staleClaimMs = 60_000;
  private draining = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly dispatch: MessageDispatchService,
  ) {}

  onApplicationBootstrap(): void {
    this.scheduleNext();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<number> {
    const claimToken = randomUUID();
    const staleBefore = new Date(Date.now() - this.staleClaimMs);
    const claimed = await this.prisma.raw.$queryRaw<{ id: string; organization_id: string }[]>`
      UPDATE "MessageDelivery"
      SET "claimToken" = ${claimToken}, "claimedAt" = NOW(), "status" = 'sending'
      WHERE "id" IN (
        SELECT x."id"
        FROM "MessageDelivery" x
        LEFT JOIN "CommunicationChannel" ch ON ch."id" = x."channelId"
        LEFT JOIN "ConversationChannel" cc ON cc."id" = x."conversationChannelId"
        WHERE ((x."status" = 'queued' AND x."nextAttemptAt" <= NOW())
               OR (x."status" = 'sending' AND x."claimedAt" < ${staleBefore}))
          AND (ch."disabledAt" IS NULL)
          AND (ch."nextSendAt" IS NULL OR ch."nextSendAt" <= NOW())
          AND (cc."nextSendAt" IS NULL OR cc."nextSendAt" <= NOW())
        ORDER BY x."nextAttemptAt" ASC, x."createdAt" ASC
        LIMIT ${this.batchSize}
        FOR UPDATE OF x SKIP LOCKED
      )
      RETURNING "id", "organizationId" AS organization_id
    `;
    if (claimed.length === 0) return 0;

    for (const row of claimed) {
      await this.tenant.run({ organizationId: row.organization_id }, async () => {
        try {
          await this.dispatch.processDelivery(row.id);
        } catch (err) {
          this.logger.error(`delivery ${row.id} failed: ${String(err)}`);
        }
      });
    }
    return claimed.length;
  }

  private scheduleNext(): void {
    this.timer = setTimeout(async () => {
      if (!this.draining) {
        this.draining = true;
        try {
          // Keep draining while the queue yields full batches, so a burst is not
          // paced by the poll interval.
          let n = 0;
          do {
            n = await this.tick();
          } while (n >= this.batchSize);
        } catch (err) {
          this.logger.error(`dispatch tick failed: ${String(err)}`);
        } finally {
          this.draining = false;
        }
      }
      this.scheduleNext();
    }, this.intervalMs);
  }
}
