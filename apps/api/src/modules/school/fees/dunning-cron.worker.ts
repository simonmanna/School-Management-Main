import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { FeeNotificationsSubscriber } from './fee-notifications.subscriber';

/**
 * Automated dunning — the reminder schedule that runs without anyone clicking.
 *
 * Reminders existed but had to be triggered by hand, which means in practice
 * they were sent in the first week of term and never again. An unattended
 * schedule collects more than any report, because the message arrives while the
 * parent still has the money.
 *
 * The ladder, deliberately gentle before it is firm:
 *
 *   7 days before due   "fees of X are due on the 14th"
 *   on the due date     "fees of X are due today"
 *   7 days overdue      "X is now overdue"
 *   every 14 days after "X remains outstanding"
 *
 * Three properties matter more than the schedule itself:
 *
 *  - **A pupil who owes nothing is never contacted.** The sweep re-reads the
 *    canonical balance per pupil, so a family whose fees were waived, paid, or
 *    cleared by a credit drops out immediately. Chasing a bursary family for a
 *    balance the school forgave is the fastest way to lose their trust.
 *  - **One message per pupil per day, at most.** The notification layer's
 *    dedupeKey is per (kind, pupil, day), so overlapping runs, a retry, or a
 *    bursar also pressing "Remind" by hand collapse into one SMS.
 *  - **Never inside a closed term.** A closed term is reconciled and done;
 *    dunning it would chase a balance the school has already written off or
 *    carried forward deliberately.
 *
 * Cadence is env-configurable and the whole worker is off by default: a school
 * must opt in, because SMS costs money and an unwanted reminder is worse than
 * no reminder.
 *
 *   DUNNING_CRON_ENABLED=true        turn it on
 *   DUNNING_INTERVAL_HOURS=24        how often the sweep runs
 *   DUNNING_DUE_SOON_DAYS=7          how far ahead to warn
 *   DUNNING_MIN_BALANCE=1000         ignore trivial balances (UGX)
 */
@Injectable()
export class DunningCronWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DunningCronWorker.name);
  private readonly intervalHours = Number(process.env.DUNNING_INTERVAL_HOURS ?? '24');
  private readonly dueSoonDays = Number(process.env.DUNNING_DUE_SOON_DAYS ?? '7');
  private readonly minBalance = Number(process.env.DUNNING_MIN_BALANCE ?? '1000');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly notifications: FeeNotificationsSubscriber,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.DUNNING_CRON_ENABLED !== 'true') {
      this.logger.log('Fee dunning disabled (set DUNNING_CRON_ENABLED=true to enable)');
      return;
    }
    const intervalMs = Math.max(1, this.intervalHours) * 60 * 60 * 1000;
    this.timer = setInterval(() => void this.runGuarded(), intervalMs);
    this.timer.unref();
    this.logger.log(`Fee dunning registered: every ${this.intervalHours}h, warning ${this.dueSoonDays}d ahead`);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Single-flight: a slow sweep must not overlap the next tick. */
  private async runGuarded(): Promise<void> {
    if (this.running) {
      this.logger.warn('Dunning tick skipped — previous sweep still in flight');
      return;
    }
    this.running = true;
    try {
      await this.sweepAllOrganizations();
    } catch (err) {
      this.logger.error(`Dunning sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Walk every organization. Each is swept inside its own tenant context so a
   * query can never read across schools — the reminder for one school's parent
   * must be built only from that school's data.
   */
  async sweepAllOrganizations(): Promise<{ organizations: number; sent: number }> {
    const orgs = await this.prisma.raw.organization.findMany({ select: { id: true, name: true } });
    let sent = 0;
    let swept = 0;

    for (const org of orgs) {
      try {
        // AsyncLocalStorage context: the sweep runs outside any request, so
        // the tenant must be established explicitly or the tenancy extension
        // has nothing to scope by.
        const result = await this.tenant.run({ organizationId: org.id }, () =>
          this.sweepOrganization(org.id),
        );
        sent += result.sent;
        swept++;
        if (result.sent > 0) {
          this.logger.log(`${org.name}: ${result.sent} reminder(s) sent`);
        }
      } catch (err) {
        // One school's bad configuration must not stop the rest.
        this.logger.error(`${org.name}: dunning failed — ${(err as Error).message}`);
      }
    }
    return { organizations: swept, sent };
  }

  /** One organization's ladder. */
  async sweepOrganization(organizationId: string): Promise<{ sent: number }> {
    let sent = 0;

    // Due soon — the gentle rung. Runs daily; the per-pupil dedupeKey means a
    // parent gets one warning that day, not one per invoice falling due.
    const dueSoon = await this.notifications.remind({
      organizationId,
      daysAhead: this.dueSoonDays,
      minBalance: this.minBalance,
    });
    sent += dueSoon.sent;

    // Overdue — the firm rung.
    const overdue = await this.notifications.remind({
      organizationId,
      overdue: true,
      minBalance: this.minBalance,
    });
    sent += overdue.sent;

    return { sent };
  }
}
