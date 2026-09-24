import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { RecurringService } from '../recurring/recurring.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * F.5 — Cron-driven background workers.
 *
 * Every worker is multi-tenant: it iterates the orgs that need work. Each
 * worker runs inside its own AsyncLocalStorage scope so the Prisma extension
 * sees the right tenant.
 *
 * Workers use Postgres advisory locks to guarantee at-most-one execution in a
 * multi-instance deploy. If a second instance loses the lock, it skips this
 * tick.
 */
@Injectable()
export class CronWorkersService {
  private readonly logger = new Logger('CronWorkers');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly webhooks: WebhooksService,
    private readonly recurring: RecurringService,
    private readonly notifications: NotificationsService,
  ) {}

  // No outbox cron here: OutboxWorker drives its own poll loop. A second tick
  // path (this used to run tick() every 30 s) doubled the claimers for no
  // benefit and, before claims set status, re-dispatched rows (Wave 3).

  @Cron(CronExpression.EVERY_MINUTE, { name: 'webhooks-retry' })
  async retryWebhooks() {
    try {
      // Tenant context not needed for webhooks; worker reads via raw.
      const result = await this.webhooks.tick();
      if (result.attempted > 0) {
        this.logger.log(`Webhooks: ${result.succeeded}/${result.attempted} succeeded, ${result.failed} failed`);
      }
    } catch (err) {
      this.logger.warn(`Webhook tick failed: ${String(err)}`);
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'recurring-tick' })
  async generateRecurring() {
    const orgs = await this.prisma.raw.organization.findMany({
      where: { status: 'active' },
      select: { id: true },
    });
    let totalProcessed = 0;
    let totalErrors = 0;
    for (const org of orgs) {
      await this.tenant.run({ organizationId: org.id }, async () => {
        try {
          const r = await this.recurring.tick();
          totalProcessed += r.processed;
          totalErrors += r.errors;
        } catch (err) {
          this.logger.warn(`Recurring tick for org ${org.id} failed: ${String(err)}`);
          totalErrors++;
        }
      });
    }
    if (totalProcessed + totalErrors > 0) {
      this.logger.log(`Recurring: ${totalProcessed} generated, ${totalErrors} errors`);
    }
  }

  @Cron(CronExpression.EVERY_HOUR, { name: 'cleanup-notifications' })
  async cleanupNotifications() {
    // Soft-prune in-app notifications older than 90 days (keep audit trail).
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const r = await this.prisma.raw.notification.deleteMany({
      where: { channel: 'in_app', createdAt: { lt: cutoff }, status: { in: ['read', 'failed'] } },
    });
    if (r.count > 0) this.logger.log(`Pruned ${r.count} old notifications`);
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: 'cleanup-tokens' })
  async cleanupTokens() {
    // Expired one-time tokens, idempotency records > 7d, revoked refresh tokens > 30d.
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const [tokens, idemp, refresh] = await Promise.all([
      this.prisma.raw.oneTimeToken.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.prisma.raw.idempotencyRecord.deleteMany({ where: { createdAt: { lt: sevenDaysAgo } } }),
      this.prisma.raw.refreshToken.deleteMany({ where: { revokedAt: { lt: thirtyDaysAgo } } }),
    ]);
    this.logger.log(
      `Daily cleanup: ${tokens.count} expired tokens, ${idemp.count} idempotency rows, ${refresh.count} refresh tokens`,
    );
  }
}
