import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { HrLeaveAccrualService } from './hr-leave-accrual.service';
import { HrAlertsSubscriber } from './hr-alerts.subscriber';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Long enough for a sweep across every tenant; the lock is only as long-lived as this. */
const JOB_TX_TIMEOUT_MS = 30 * 60_000;

/**
 * HR scheduled jobs. Every job here was an endpoint nobody called on a
 * schedule, so leave never accrued and expiry alerts never fired unless an
 * administrator remembered to press a button.
 *
 *  - 01:15 daily      leave accrual (idempotent per period key — safe to repeat)
 *  - 01:30 on 1 Jan   leave year-end rollover (carry-forward + forfeiture)
 *  - 01:45 daily      carry-forward expiry
 *  - 06:00 daily      contract / certification / probation alerts
 *
 * Each job runs per organisation in its own tenant context, under a Postgres
 * advisory lock so a multi-instance deploy runs it once. Disabled when
 * HR_SCHEDULER_ENABLED=false and under NODE_ENV=test.
 */
@Injectable()
export class HrSchedulerService {
  private readonly logger = new Logger('HrScheduler');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly accrual: HrLeaveAccrualService,
    private readonly alerts: HrAlertsSubscriber,
  ) {}

  private get enabled(): boolean {
    return process.env.HR_SCHEDULER_ENABLED !== 'false' && process.env.NODE_ENV !== 'test';
  }

  /** Run `work` once across the fleet: a second instance fails the try-lock and skips. */
  private async exclusively(job: string, work: () => Promise<void>): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.prisma.raw.$transaction(
        async (tx: any) => {
          const rows = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext(${`hr_job:${job}`})) AS locked`;
          if (!rows?.[0]?.locked) return;
          await work();
        },
        { timeout: JOB_TX_TIMEOUT_MS, maxWait: 10_000 },
      );
    } catch (err) {
      this.logger.error(`${job} failed: ${String(err)}`);
    }
  }

  private async forEachOrg(job: string, fn: () => Promise<unknown>): Promise<void> {
    const orgs = await this.prisma.raw.organization.findMany({
      where: { status: 'active' },
      select: { id: true },
    });
    let failed = 0;
    for (const org of orgs) {
      await this.tenant.run({ organizationId: org.id, userId: 'system:hr-scheduler' }, async () => {
        try {
          await fn();
        } catch (err) {
          failed++;
          this.logger.warn(`${job} for org ${org.id} failed: ${String(err)}`);
        }
      });
    }
    this.logger.log(`${job}: ${orgs.length} organisation(s), ${failed} failure(s)`);
  }

  @Cron('15 1 * * *', { name: 'hr-leave-accrual' })
  async leaveAccrual() {
    await this.exclusively('leave-accrual', () => this.forEachOrg('leave-accrual', () => this.accrual.runAccrual({})));
  }

  @Cron('30 1 1 1 *', { name: 'hr-leave-year-end' })
  async leaveYearEnd() {
    await this.exclusively('leave-year-end', () =>
      this.forEachOrg('leave-year-end', () => this.accrual.runYearEndRollover({})),
    );
  }

  @Cron('45 1 * * *', { name: 'hr-leave-carry-forward-expiry' })
  async carryForwardExpiry() {
    await this.exclusively('leave-cf-expiry', () =>
      this.forEachOrg('leave-cf-expiry', () => this.accrual.expireCarryForward({})),
    );
  }

  @Cron('0 6 * * *', { name: 'hr-alerts' })
  async hrAlerts() {
    await this.exclusively('alerts', async () => {
      const r = await this.alerts.runAlerts();
      this.logger.log(`HR alerts: ${r.fired} fired across ${r.organizations} organisation(s)`);
    });
  }
}
