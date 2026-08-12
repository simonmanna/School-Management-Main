import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { PosReservationsService } from '../../modules/pos/pos-reservations.service';

/**
 * POS Phase T1 — Reservation cron worker.
 *
 * Runs in the same CronWorkersService host as outbox + recurring. Iterates
 * every active org and:
 *
 *  - Once per minute: sweeps PENDING reservations whose startAt is older
 *    than the 30-minute grace → NO_SHOW; frees the table.
 *  - Once per 5 minutes: refreshes the RESERVED flag on tables whose
 *    next booking is within 60 minutes (so the table picker reflects them).
 *
 * Multi-instance safety: the @Cron decorator + NestJS schedule guarantees
 * one tick per process; combined with the tenant.run scope this is safe.
 */
@Injectable()
export class ReservationWorker {
  private readonly logger = new Logger('ReservationWorker');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly reservations: PosReservationsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'reservation-no-show' })
  async sweepNoShows() {
    const orgs = await this.prisma.raw.organization.findMany({
      where: { status: 'active' },
      select: { id: true },
    });
    let totalNoShow = 0;
    for (const org of orgs) {
      await this.tenant.run({ organizationId: org.id }, async () => {
        try {
          totalNoShow += await this.reservations.sweepNoShows();
        } catch (err) {
          this.logger.warn(`No-show sweep for org ${org.id} failed: ${String(err)}`);
        }
      });
    }
    if (totalNoShow > 0) {
      this.logger.log(`Reservations: ${totalNoShow} marked no-show`);
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'reservation-refresh' })
  async refreshReserved() {
    const orgs = await this.prisma.raw.organization.findMany({
      where: { status: 'active' },
      select: { id: true },
    });
    let totalFlipped = 0;
    for (const org of orgs) {
      await this.tenant.run({ organizationId: org.id }, async () => {
        try {
          totalFlipped += await this.reservations.refreshReservedFlags();
        } catch (err) {
          this.logger.warn(`Reservation refresh for org ${org.id} failed: ${String(err)}`);
        }
      });
    }
    if (totalFlipped > 0) {
      this.logger.log(`Reservations: ${totalFlipped} tables flipped to RESERVED`);
    }
  }
}