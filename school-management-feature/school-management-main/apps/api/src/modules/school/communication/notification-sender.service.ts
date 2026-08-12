import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import type { NotificationProvider } from './notification-provider.interface';

/**
 * NotificationSender — polls the Notification queue and dispatches to the
 * configured NotificationProvider. Lives in the kernel so every vertical
 * (school, POS, etc.) can publish events that translate into outbound
 * SMS/email/push without coupling to a specific transport.
 *
 * In production this would be scheduled (cron / kernel worker). In dev we
 * call `drainOnce()` from the API startup hook to flush any leftover
 * notifications from the previous boot.
 */
@Injectable()
export class NotificationSender {
  private readonly logger = new Logger(NotificationSender.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly provider: NotificationProvider,
  ) {}

  /**
   * Process up to `limit` queued notifications. Returns the number of rows
   * actually sent. Called from the polling worker on a 5s tick.
   */
  async drainOnce(limit = 50): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const queued = await this.prisma.client.notification.findMany({
        where: { status: 'queued' },
        orderBy: { createdAt: 'asc' },
        take: limit,
      });
      if (queued.length === 0) return 0;

      let sent = 0;
      for (const n of queued) {
        try {
          const res = await this.provider.send({
            organizationId: n.organizationId,
            channel: n.channel as any,
            recipientType: n.recipientType as any,
            recipientId: n.recipientId,
            subject: (n.payload as any)?.subject,
            body: (n.payload as any)?.body ?? '',
            payload: (n.payload as any) ?? {},
          });
          await this.prisma.client.notification.updateMany({
            where: { id: n.id },
            data: { status: 'sent', sentAt: new Date(), providerMessageId: res.id },
          });
          sent++;
        } catch (e: any) {
          this.logger.error(`Notification ${n.id} failed: ${e?.message ?? e}`);
          await this.prisma.client.notification.updateMany({
            where: { id: n.id },
            data: {
              status: 'failed',
              error: e?.message ?? 'unknown',
              attempts: { increment: 1 },
            },
          });
        }
      }
      return sent;
    } finally {
      this.running = false;
    }
  }

  /** Start a 5s polling loop. Call from a kernel worker on boot. */
  start(intervalMs = 5_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.drainOnce().catch((e) => this.logger.error(`drain failed: ${e?.message ?? e}`));
    }, intervalMs);
    this.logger.log(`NotificationSender polling every ${intervalMs}ms`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}