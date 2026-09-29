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
  private stopped = false;
  /** The tick currently talking to the database, if any. Shutdown waits for it. */
  private inflight: Promise<unknown> | null = null;
  private readonly intervalMs = Number(process.env.OUTBOX_POLL_MS ?? '1000');
  private readonly batchSize = Number(process.env.OUTBOX_BATCH ?? '50');
  private readonly staleClaimMs = 30_000;
  /** After this many failed attempts a row is parked as 'dead' for a human. */
  static readonly MAX_ATTEMPTS = Number(process.env.OUTBOX_MAX_ATTEMPTS ?? '8');

  constructor(
    private readonly outbox: EventOutboxService,
    private readonly prisma: PrismaService,
  ) {}

  onApplicationBootstrap(): void {
    this.stopped = false;
    this.scheduleNext();
  }

  async onModuleDestroy(): Promise<void> {
    // Set the guard before clearing: a tick may already be awaiting I/O and its
    // finally block must not schedule a fresh timer after shutdown.
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Audit 2026-09-29 A08: let a claimed batch finish before Prisma
    // disconnects. Cutting it off mid-flight logged "client disconnected"
    // errors and left rows 'claimed' until the stale-claim window reclaimed them.
    await this.inflight?.catch(() => undefined);
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
    // The claim flips status to 'claimed'. It used to set only claimToken and
    // leave status 'pending', so the next tick — or the second tick path the
    // cron service ran every 30 s — claimed and dispatched the same rows again.
    const claimed = await this.prisma.raw.$queryRaw<
      { id: string; event_name: string; payload: any; attempts: number; completed: number[] }[]
    >`
      UPDATE "EventOutbox"
      SET "claimToken" = ${claimToken}, "claimedAt" = NOW(), "status" = 'claimed'
      WHERE "id" IN (
        SELECT "id" FROM "EventOutbox"
        WHERE ("status" = 'pending' AND "availableAt" <= NOW())
           OR ("status" = 'claimed' AND "claimedAt" < ${staleBefore})
        ORDER BY "createdAt" ASC
        LIMIT ${this.batchSize}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "eventName" AS event_name, "payload", "attempts", "completedHandlers" AS completed
    `;
    if (claimed.length === 0) return 0;
    let shipped = 0;
    for (const row of claimed) {
      const attempts = Number(row.attempts ?? 0);
      try {
        await this.outbox.dispatch(
          { id: row.id, eventName: row.event_name, payload: row.payload },
          {
            completed: row.completed ?? [],
            onHandlerDone: async (index) => {
              await this.prisma.raw.$executeRaw`
                UPDATE "EventOutbox" SET "completedHandlers" = array_append("completedHandlers", ${index})
                WHERE "id" = ${row.id} AND "claimToken" = ${claimToken}`;
            },
          },
        );
        await this.prisma.raw.eventOutbox.updateMany({
          where: { id: row.id, claimToken },
          data: { status: 'shipped', shippedAt: new Date(), claimToken: null, claimedAt: null },
        });
        shipped++;
      } catch (err) {
        const msg = String(err).slice(0, 500);
        const next = attempts + 1;
        const dead = next >= OutboxWorker.MAX_ATTEMPTS;
        // Exponential backoff: 5 s, 10 s, 20 s … capped at one hour.
        const backoffMs = Math.min(60 * 60_000, 5_000 * 2 ** attempts);
        this.logger.warn(`Outbox row ${row.id} failed (attempt ${next}${dead ? ', now dead' : ''}): ${msg}`);
        // updateMany: the row may be gone (tenant cleanup); do not throw.
        await this.prisma.raw.eventOutbox.updateMany({
          where: { id: row.id, claimToken },
          data: {
            attempts: next,
            lastError: msg,
            status: dead ? 'dead' : 'pending',
            availableAt: new Date(Date.now() + backoffMs),
            claimToken: null,
            claimedAt: null,
          },
        });
      }
    }
    return shipped;
  }

  private scheduleNext(): void {
    if (this.stopped) return;
    this.timer = setTimeout(async () => {
      try {
        this.inflight = this.tick();
        await this.inflight;
      } catch (err) {
        if (!this.stopped) this.logger.error(`Outbox worker tick failed: ${String(err)}`);
      } finally {
        this.inflight = null;
        if (!this.stopped) this.scheduleNext();
      }
    }, this.intervalMs);
    this.timer.unref();
  }
}
