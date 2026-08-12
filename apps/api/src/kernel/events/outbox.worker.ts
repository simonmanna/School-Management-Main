import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EventOutboxService } from './event-outbox.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * D4-3 + F.5: OutboxWorker.
 *
 * Polls `EventOutbox` for `pending` rows, claims each with a unique token
 * (advisory lock pattern), dispatches via the registered handlers, and marks
 * the row shipped on success or increments `attempts` on failure.
 *
 * Multi-replica safe: each pending row is claimed via
 *   UPDATE EventOutbox SET claimToken = ?, claimedAt = NOW()
 *   WHERE id = ? AND (claimToken IS NULL OR claimedAt < NOW() - 30s)
 * If two workers race, exactly one UPDATE affects 1 row; the loser's UPDATE
 * returns 0 and it skips the row.
 */
@Injectable()
export class OutboxWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('OutboxWorker');
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs = Number(process.env.OUTBOX_POLL_MS ?? '1000');
  private readonly batchSize = Number(process.env.OUTBOX_BATCH ?? '50');
  private readonly staleClaimMs = 30_000;

  constructor(
    private readonly outbox: EventOutboxService,
    private readonly prisma: PrismaService,
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

  /** Drain a batch of pending outbox rows. Returns the number shipped. */
  async tick(): Promise<number> {
    const claimToken = randomUUID();
    const now = new Date();
    const staleBefore = new Date(now.getTime() - this.staleClaimMs);
    // Atomically claim up to batchSize rows that are pending or whose previous
    // claim expired. UPDATE ... RETURNING gives us the claimed IDs.
    // NOTE: alias "eventName" AS event_name. Prisma $queryRaw returns the raw
    // Postgres column label, and a quoted identifier preserves camelCase — so
    // without the alias `row.event_name` is undefined and every event dispatches
    // to zero handlers (a latent bug that silently no-op'd all outbox handlers).
    const claimed = await this.prisma.raw.$queryRaw<{ id: string; event_name: string; payload: any }[]>`
      UPDATE "EventOutbox"
      SET "claimToken" = ${claimToken}, "claimedAt" = NOW()
      WHERE "id" IN (
        SELECT "id" FROM "EventOutbox"
        WHERE ("status" = 'pending' OR ("status" = 'claimed' AND "claimedAt" < ${staleBefore}))
        ORDER BY "createdAt" ASC
        LIMIT ${this.batchSize}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "eventName" AS event_name, "payload"
    `;
    if (claimed.length === 0) return 0;
    let shipped = 0;
    for (const row of claimed) {
      const existing = await this.prisma.raw.eventOutbox.findUnique({ where: { id: row.id } });
      const attempts = existing?.attempts ?? 0;
      try {
        await this.outbox.dispatch({ id: row.id, eventName: row.event_name, payload: row.payload });
        await this.prisma.raw.eventOutbox.update({
          where: { id: row.id },
          data: { status: 'shipped', shippedAt: new Date(), claimToken: null, claimedAt: null },
        });
        shipped++;
      } catch (err) {
        const msg = String(err).slice(0, 500);
        this.logger.warn(`Outbox row ${row.id} failed (attempt ${attempts + 1}): ${msg}`);
        await this.prisma.raw.eventOutbox.update({
          where: { id: row.id },
          data: {
            attempts: { increment: 1 },
            lastError: msg,
            claimToken: null,
            claimedAt: null,
          },
        });
      }
    }
    return shipped;
  }

  private scheduleNext(): void {
    this.timer = setTimeout(async () => {
      try {
        await this.tick();
      } catch (err) {
        this.logger.error(`Outbox worker tick failed: ${String(err)}`);
      } finally {
        this.scheduleNext();
      }
    }, this.intervalMs);
  }
}
