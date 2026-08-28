import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { BroadcastMaterializerService } from './broadcast-materializer.service';

/**
 * Drives scheduled broadcasts: claim → materialize → fan out → reconcile.
 *
 * Deliberately a SEPARATE worker from MessageDispatchWorker, despite the similar
 * shape. Their cadences have nothing to do with each other: the dispatcher polls
 * every 250ms because Telegram allows 30 messages a second, while a broadcast
 * needs checking about once a second and its work is measured in whole rosters.
 * Sharing a loop would either starve the dispatcher during a 4,000-parent
 * materialization or poll the broadcast table 240 times a minute for nothing.
 *
 * Multi-instance safe via the same `FOR UPDATE SKIP LOCKED` claim the outbox
 * worker uses, with a stale-claim window so a replica that dies mid-broadcast
 * releases its work instead of stranding it.
 */
@Injectable()
export class BroadcastWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('BroadcastWorker');
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs = Number(process.env.COMM_BROADCAST_POLL_MS ?? '1000');
  private readonly staleClaimMs = 5 * 60_000;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly materializer: BroadcastMaterializerService,
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

    // One broadcast per tick per replica. Materialization is heavy, and taking a
    // batch would mean holding several rosters in memory at once for no gain —
    // the dispatcher, not this loop, is what determines send throughput.
    const claimed = await this.prisma.raw.$queryRaw<{ id: string; organization_id: string; status: string }[]>`
      UPDATE "MessageBroadcast"
      SET "claimToken" = ${claimToken}, "claimedAt" = NOW()
      WHERE "id" IN (
        SELECT b."id"
        FROM "MessageBroadcast" b
        WHERE (
                (b."status" = 'scheduled' AND b."scheduledAt" <= NOW())
             OR (b."status" = 'sending')
             OR (b."status" = 'materializing' AND b."claimedAt" < ${staleBefore})
              )
          AND (b."claimToken" IS NULL OR b."claimedAt" < ${staleBefore})
        ORDER BY b."scheduledAt" ASC NULLS LAST, b."createdAt" ASC
        LIMIT 1
        FOR UPDATE OF b SKIP LOCKED
      )
      RETURNING "id", "organizationId" AS organization_id, "status"
    `;
    if (claimed.length === 0) return 0;

    const row = claimed[0];
    await this.tenant.run({ organizationId: row.organization_id }, async () => {
      try {
        await this.process(row.organization_id, row.id, row.status);
      } catch (err) {
        this.logger.error(`broadcast ${row.id} failed: ${String(err)}`);
        await this.prisma.raw.messageBroadcast.update({
          where: { id: row.id },
          data: {
            // `failed` only when nothing has gone out yet. Once messages are on
            // the wire the broadcast is genuinely in flight, and flipping it to
            // failed would hide the ones that DID arrive.
            status: row.status === 'scheduled' ? 'failed' : 'sending',
            lastError: String(err).slice(0, 500),
            claimToken: null,
            claimedAt: null,
          },
        });
      }
    });
    return 1;
  }

  private async process(organizationId: string, broadcastId: string, status: string): Promise<void> {
    if (status === 'scheduled' || status === 'materializing') {
      await this.prisma.raw.messageBroadcast.update({
        where: { id: broadcastId },
        data: { status: 'materializing' },
      });
      await this.materializer.materialize(organizationId, broadcastId);
    }

    // Fan out until nothing is left pending. Each batch re-reads the broadcast,
    // so a cancel landing mid-drain stops this loop on the next iteration rather
    // than after the whole roster.
    let processed = 0;
    do {
      processed = await this.materializer.fanoutBatch(organizationId, broadcastId);
    } while (processed > 0);

    const { done } = await this.materializer.reconcile(organizationId, broadcastId);
    await this.prisma.raw.messageBroadcast.updateMany({
      where: { id: broadcastId, status: { notIn: ['completed', 'cancelled', 'failed'] } },
      data: { claimToken: null, claimedAt: null },
    });
    if (done) this.logger.log(`broadcast ${broadcastId} completed`);
  }

  private scheduleNext(): void {
    this.timer = setTimeout(async () => {
      if (!this.running) {
        this.running = true;
        try {
          await this.tick();
        } catch (err) {
          this.logger.error(`broadcast tick failed: ${String(err)}`);
        } finally {
          this.running = false;
        }
      }
      this.scheduleNext();
    }, this.intervalMs);
  }
}
