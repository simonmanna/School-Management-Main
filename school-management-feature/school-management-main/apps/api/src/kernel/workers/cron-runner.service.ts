import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';

/**
 * Generic cron runner for the kernel.
 *
 * Verticals (school, POS, etc.) register their handlers via `register()` and
 * the kernel schedules them on a uniform cadence. The kernel does NOT know
 * about vertical-specific services — vertical isolation (ADR-011) is
 * preserved because the registered callback is a closure over whatever
 * services the registering module has access to.
 *
 * Cadence is a simple interval (milliseconds). For more complex schedules
 * (cron expressions, multiple slots per day), swap the scheduler below for
 * `cron-parser` + a more capable implementation.
 *
 * @example
 *   // In FeesModule.onApplicationBootstrap:
 *   this.cron.register('school.penalty-run', 24 * 60 * 60 * 1000, () =>
 *     this.billing.generatePenaltyRun(scheduleId),
 *   );
 */
@Injectable()
export class CronRunnerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CronRunnerService.name);
  private jobs: Array<{
    name: string;
    intervalMs: number;
    fn: () => Promise<void>;
    lastRunAt: Date | null;
    lastError: string | null;
  }> = [];
  private timers = new Map<string, NodeJS.Timeout>();

  /**
   * Register a periodic job. The job fires every `intervalMs` after the
   * previous run completes. If the previous run is still in progress when
   * the next tick fires, the new tick is skipped (single-flight).
   */
  register(name: string, intervalMs: number, fn: () => Promise<void>): void {
    if (this.jobs.some((j) => j.name === name)) {
      this.logger.warn(`Cron job '${name}' already registered — overwriting`);
      this.unregister(name);
    }
    this.jobs.push({ name, intervalMs, fn, lastRunAt: null, lastError: null });
    this.logger.log(`Registered cron job '${name}' every ${this.formatInterval(intervalMs)}`);
  }

  unregister(name: string): void {
    const timer = this.timers.get(name);
    if (timer) clearTimeout(timer);
    this.timers.delete(name);
    this.jobs = this.jobs.filter((j) => j.name !== name);
  }

  /** Synchronous registry state — useful for /health endpoints. */
  status(): Array<{ name: string; intervalMs: string; lastRunAt: string | null; lastError: string | null }> {
    return this.jobs.map((j) => ({
      name: j.name,
      intervalMs: this.formatInterval(j.intervalMs),
      lastRunAt: j.lastRunAt?.toISOString() ?? null,
      lastError: j.lastError,
    }));
  }

  onApplicationBootstrap(): void {
    for (const job of this.jobs) this.scheduleNext(job);
  }

  onModuleDestroy(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  private scheduleNext(job: { name: string; intervalMs: number; fn: () => Promise<void>; lastRunAt: Date | null; lastError: string | null }): void {
    // Single-flight: skip if still running.
    if (job.lastRunAt && Date.now() - job.lastRunAt.getTime() < job.intervalMs && this.timers.has(job.name)) {
      // already running a tick — let the in-flight one schedule the next
      return;
    }
    const timer = setTimeout(async () => {
      try {
        this.logger.debug?.(`Cron '${job.name}' starting`);
        job.lastRunAt = new Date();
        await job.fn();
        job.lastError = null;
        this.logger.log(`Cron '${job.name}' completed`);
      } catch (e: any) {
        job.lastError = e?.message ?? String(e);
        this.logger.error(`Cron '${job.name}' failed: ${job.lastError}`);
      } finally {
        this.scheduleNext(job);
      }
    }, job.intervalMs);
    if (this.timers.has(job.name)) clearTimeout(this.timers.get(job.name)!);
    this.timers.set(job.name, timer);
  }

  private formatInterval(ms: number): string {
    if (ms < 60_000) return `${ms}ms`;
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
    if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
    return `${Math.round(ms / 86_400_000)}d`;
  }
}