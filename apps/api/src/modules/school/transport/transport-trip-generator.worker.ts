import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { TransportTripService } from './transport-trip.service';

/**
 * Nightly trip generation. Runs per-org using the kernel tenancy loop so every
 * organization's schedules are materialized into trips. Override the hour via
 * TRANSPORT_TRIP_GEN_CRON (default 02:00). Idempotent by (org, scheduleId, date,
 * direction) so re-runs are safe.
 */
@Injectable()
export class TransportTripGeneratorWorker {
  private readonly logger = new Logger('TransportTripGeneratorWorker');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly trips: TransportTripService,
  ) {}

  @Cron(process.env.TRANSPORT_TRIP_GEN_CRON ?? CronExpression.EVERY_DAY_AT_2AM, { name: 'transport-trip-generation' })
  async run() {
    const orgs = await this.prisma.raw.organization.findMany({ select: { id: true } });
    const horizon = Number(process.env.TRANSPORT_TRIP_GEN_HORIZON ?? 7);
    for (const org of orgs) {
      await this.tenant.run({ organizationId: org.id }, async () => {
        try {
          const res = await this.trips.generate(new Date(), horizon);
          this.logger.log(`[org ${org.id}] generated ${res.created} transport trips`);
        } catch (err: any) {
          this.logger.error(`[org ${org.id}] trip generation failed: ${String(err?.message ?? err)}`);
        }
      });
    }
  }
}
