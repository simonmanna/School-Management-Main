import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';
import { NotificationsService } from '../../kernel/notifications/notifications.service';

/**
 * RepairCronWorker — housekeeping for the RMMS vertical:
 *
 * 1. Preventive maintenance: every active schedule with nextDueAt ≤ now
 *    auto-generates a preventive RepairOrder (orderType `preventive`) and
 *    rolls the schedule forward.
 * 2. Warranty expiry: active warranties past coverageEnd are marked `expired`.
 */
@Injectable()
export class RepairCronWorker {
  private readonly logger = new Logger('RepairCronWorker');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly seq: SequenceService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'repair-housekeeping' })
  async housekeeping(): Promise<void> {
    const orgs = await this.prisma.client.organization.findMany({
      select: { id: true },
      where: { deletedAt: null },
    });
    for (const org of orgs) {
      await this.runForOrg(org.id).catch((err) =>
        this.logger.error(`repair housekeeping failed for org ${org.id}: ${String(err)}`),
      );
    }
  }

  private async runForOrg(orgId: string): Promise<void> {
    const now = new Date();

    // 1. Preventive maintenance — generate work orders for due schedules.
    const due = await this.prisma.client.repairSchedule.findMany({
      where: { organizationId: orgId, status: 'active', nextDueAt: { lte: now }, deletedAt: null },
    });
    for (const schedule of due) {
      const repairNumber = await this.seq.next('repair_order', { prefix: 'RPR-', padding: 6 });
      const order = await this.prisma.client.repairOrder.create({
        data: {
          organizationId: orgId,
          repairNumber,
          status: 'received',
          orderType: 'preventive',
          itemType: schedule.assetRef ?? schedule.title,
          problemDescription: schedule.taskTemplate ?? `Preventive maintenance: ${schedule.title}`,
          notes: `Auto-generated from schedule ${schedule.id}`,
        },
      });
      await this.prisma.client.repairStatusHistory.create({
        data: {
          organizationId: orgId,
          repairOrderId: order.id,
          toStatus: 'received',
          action: 'preventive',
          note: `Auto-generated preventive order from schedule ${schedule.id}`,
        },
      });
      const next = new Date(now);
      next.setDate(next.getDate() + schedule.intervalDays);
      await this.prisma.client.repairSchedule.update({
        where: { id: schedule.id },
        data: { lastRunAt: now, nextDueAt: next },
      });
      await this.notifications.send({
        organizationId: orgId,
        channel: 'in_app',
        category: 'repair',
        title: `Preventive order ${repairNumber}`,
        body: schedule.title,
        payload: { repairOrderId: order.id, repairNumber, scheduleId: schedule.id },
      });
    }

    // 2. Warranty expiry.
    const expired = await this.prisma.client.repairWarranty.updateMany({
      where: { organizationId: orgId, status: 'active', coverageEnd: { lte: now } },
      data: { status: 'expired' },
    });
    if (expired.count > 0) {
      this.logger.log(`org ${orgId}: expired ${expired.count} warranties`);
    }
  }
}
