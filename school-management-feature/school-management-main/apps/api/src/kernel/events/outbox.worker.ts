import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { EventOutboxService } from './event-outbox.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * D4-3: OutboxWorker. Polls `EventOutbox` for `pending` rows every second,
 * dispatches each via the EventOutboxService handlers, and marks rows
 * `shipped` on success or increments `attempts` + records `lastError` on
 * failure.
 *
 * Single-replica beta: no distributed lock needed. For multi-replica, wrap
 * the poll in `pg_try_advisory_xact_lock` to elect a leader.
 */
@Injectable()
export class OutboxWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('OutboxWorker');
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs = Number(process.env.OUTBOX_POLL_MS ?? '1000');
  private readonly batchSize = Number(process.env.OUTBOX_BATCH ?? '50');

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
  async drainOnce(): Promise<number> {
    const rows = await this.prisma.client.eventOutbox.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: this.batchSize,
    });
    if (rows.length === 0) return 0;
    let shipped = 0;
    for (const row of rows) {
      try {
        await this.outbox.dispatch({ id: row.id, eventName: row.eventName, payload: row.payload });
        await this.prisma.client.eventOutbox.update({
          where: { id: row.id },
          data: { status: 'shipped', shippedAt: new Date() },
        });
        shipped++;
      } catch (err) {
        const msg = String(err).slice(0, 500);
        this.logger.warn(`Outbox row ${row.id} failed (attempt ${row.attempts + 1}): ${msg}`);
        await this.prisma.client.eventOutbox.update({
          where: { id: row.id },
          data: { attempts: row.attempts + 1, lastError: msg },
        });
      }
    }
    return shipped;
  }

  private scheduleNext(): void {
    this.timer = setTimeout(async () => {
      try {
        await this.drainOnce();
      } catch (err) {
        this.logger.error(`Outbox worker tick failed: ${String(err)}`);
      } finally {
        this.scheduleNext();
      }
    }, this.intervalMs);
  }
}