import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { BillingService } from './billing.service';

/**
 * PenaltyCronWorker — daily scheduled run of `BillingService.generatePenaltyRun`
 * for every active FeeSchedule in the org.
 *
 * Architecture:
 *   - The worker self-schedules with a single-flight `setInterval`. The parent
 *     platform schedules its kernel jobs with `@nestjs/schedule` `@Cron`
 *     decorators (static expressions); this job's cadence is runtime-configurable
 *     from env, so it drives its own interval and guards against overlap with an
 *     in-flight flag. It lives entirely inside the school module — no kernel
 *     scheduling infra is imported, so ADR-011 isolation holds.
 *
 * Schedule:
 *   - Default: every 24h.
 *   - Override via `PENALTY_RUN_INTERVAL_HOURS` (e.g. `12` for twice daily).
 *
 * KNOWN: scheduled via a self-managed setInterval (runtime-configurable cadence
 * via PENALTY_RUN_INTERVAL_HOURS), not a kernel @Cron. Each org's work is run
 * inside an explicit tenant scope so BillingService sees only that org's data.
 */
@Injectable()
export class PenaltyCronWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PenaltyCronWorker.name);
  private readonly intervalHours = Number(process.env.PENALTY_RUN_INTERVAL_HOURS ?? '24');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly billing: BillingService,
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.PENALTY_CRON_ENABLED === 'false') {
      this.logger.log('Penalty cron disabled (PENALTY_CRON_ENABLED=false)');
      return;
    }
    const intervalMs = this.intervalHours * 60 * 60 * 1000;
    this.timer = setInterval(() => void this.runGuarded(), intervalMs);
    this.timer.unref();
    this.logger.log(`Penalty cron registered: every ${this.intervalHours}h`);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Single-flight wrapper: skip a tick if the previous one is still running. */
  private async runGuarded(): Promise<void> {
    if (this.running) {
      this.logger.warn('Penalty tick skipped — previous run still in flight');
      return;
    }
    this.running = true;
    try {
      await this.tick();
    } catch (e) {
      this.logger.error(`Penalty tick failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Run the penalty assessment across every org. Safe to invoke manually
   * (e.g. from a /admin/run endpoint or the smoke test) — idempotent on
   * re-runs because `generatePenaltyRun` only creates invoices for
   * `amountResidual > 0` and due dates in the past.
   */
  async tick(): Promise<{ orgs: number; schedules: number; penalties: number; durationMs: number }> {
    const started = Date.now();
    const orgs = await this.prisma.client.organization.findMany({ select: { id: true } });

    let schedulesProcessed = 0;
    let penaltiesCreated = 0;

    // Iterate every org + every active schedule. We can't use the tenant
    // AsyncLocalStorage context here because the cron tick runs outside a
    // request, so we walk orgs explicitly. The BillingService is org-scoped
    // via the tenancy extension — it scopes correctly because we run the
    // transaction with the tenant context explicitly set.
    for (const org of orgs) {
      // Every FeeSchedule query and the BillingService call below hit
      // org-scoped tables, so each org's work must run inside a tenant scope —
      // otherwise the tenant-scoped Prisma client throws "No tenant context".
      await this.tenant.run({ organizationId: org.id }, async () => {
        const activeSchedules = await this.prisma.client.feeSchedule.findMany({
          where: { organizationId: org.id },
          select: { id: true },
        });
        for (const sched of activeSchedules) {
          try {
            const run = await this.billing.generatePenaltyRun(sched.id);
            schedulesProcessed++;
            penaltiesCreated += Array.isArray((run as any).createdInvoices)
              ? (run as any).createdInvoices.length
              : 0;
          } catch (e: any) {
            this.logger.error(`Penalty run failed for schedule ${sched.id}: ${e?.message ?? e}`);
          }
        }
      });
    }

    return {
      orgs: orgs.length,
      schedules: schedulesProcessed,
      penalties: penaltiesCreated,
      durationMs: Date.now() - started,
    };
  }
}