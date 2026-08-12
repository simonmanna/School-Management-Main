import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { SnapshotRebuildService } from './snapshots/snapshot-rebuild.service';
import { TieOutService } from './tieout.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Nightly snapshot + tie-out worker (D3).
 *
 * Lives in the accounting module because it depends on SnapshotRebuildService
 * and TieOutService (both module-private). Schedules itself to run daily at
 * the configured hour (default 02:00 UTC). Operators can trigger an immediate
 * rebuild via `POST /api/reports/accounting/rebuild-snapshots`.
 */
@Injectable()
export class SnapshotCronWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('SnapshotCronWorker');
  private timer: NodeJS.Timeout | null = null;
  private readonly runHourUtc = Number(process.env.SNAPSHOT_RUN_HOUR_UTC ?? '2');

  constructor(
    private readonly snapshots: SnapshotRebuildService,
    private readonly tieOut: TieOutService,
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

  /** Trigger an immediate rebuild. Wired to a controller endpoint. */
  async runNow(): Promise<{ orgs: number; tieOutOrgs: number; durationMs: number }> {
    const started = Date.now();
    const snap = await this.snapshots.rebuildAll();
    const tie = await this.tieOut.runAll();
    return { orgs: snap.orgs, tieOutOrgs: tie.orgs, durationMs: Date.now() - started };
  }

  private scheduleNext(): void {
    if (this.timer) clearTimeout(this.timer);
    const now = new Date();
    const next = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), this.runHourUtc, 0, 0),
    );
    if (next.getTime() <= now.getTime()) {
      next.setUTCDate(next.getUTCDate() + 1);
    }
    const ms = next.getTime() - now.getTime();
    this.logger.log(`Next snapshot rebuild at ${next.toISOString()} (in ${Math.round(ms / 1000)}s)`);
    this.timer = setTimeout(() => {
      this.runNow()
        .then((r) => this.logger.log(`Nightly rebuild done: ${r.orgs} orgs in ${r.durationMs}ms`))
        .catch((err) => this.logger.error(`Nightly rebuild failed: ${String(err)}`))
        .finally(() => this.scheduleNext());
    }, ms);
  }
}