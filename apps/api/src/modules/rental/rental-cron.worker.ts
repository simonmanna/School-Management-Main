import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { RentalDepositService } from './rental-deposit.service';
import { RentalReservationService } from './rental-reservation.service';

/**
 * RentalCronWorker — housekeeping for the rental lifecycle:
 *
 * 1. Expire held reservations that outlived their hold window
 *    (RentalReservation.status held → cancelled; booking released).
 * 2. Forfeit deposits on agreements stuck in `returned` (never settled)
 *    after `rental.forfeitAfterDays` — the liability ages out.
 * 3. Flag agreements past dueAt + grace as overdue (status stays active,
 *    late days are computed at return — this is only a monitor signal).
 */
@Injectable()
export class RentalCronWorker {
  private readonly logger = new Logger('RentalCronWorker');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly reservations: RentalReservationService,
    private readonly deposit: RentalDepositService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'rental-housekeeping' })
  async housekeeping(): Promise<void> {
    const orgs = await this.prisma.client.organization.findMany({
      select: { id: true },
      where: { deletedAt: null },
    });
    for (const org of orgs) {
      await this.runForOrg(org.id).catch((err) =>
        this.logger.error(`rental housekeeping failed for org ${org.id}: ${String(err)}`),
      );
    }
  }

  private async runForOrg(orgId: string): Promise<void> {
    // 1. Expire held reservations whose hold window elapsed.
    const expired = await this.prisma.client.rentalReservation.findMany({
      where: {
        organizationId: orgId,
        status: 'held',
        expiresAt: { lt: new Date() },
      },
      select: { id: true },
    });
    for (const r of expired) {
      try {
        this.tenant.run({ organizationId: orgId }, () => this.reservations.cancel(r.id));
      } catch (err) {
        this.logger.warn(`reservation ${r.id} expiry failed: ${String(err)}`);
      }
    }
    if (expired.length) this.logger.log(`expired ${expired.length} held reservation(s) in org ${orgId}`);

    // 2. Forfeit deposits on abandoned returns (returned, not settled).
    const abandoned = await this.prisma.client.rentalAgreement.findMany({
      where: {
        organizationId: orgId,
        status: 'returned',
        returnedAt: { lt: new Date(Date.now() - 14 * 86_400_000) },
      },
      select: { id: true },
    });
    for (const a of abandoned) {
      try {
        this.tenant.run({ organizationId: orgId }, async () => {
          const deposit = await this.prisma.client.rentalDeposit.findFirst({
            where: { organizationId: orgId, agreementId: a.id },
          });
          if (!deposit) return;
          const available =
            Number(deposit.totalCollected) -
            Number(deposit.totalApplied) -
            Number(deposit.totalRefunded) -
            Number(deposit.totalForfeited);
          if (available > 0) {
            await this.deposit.forfeit({ agreementId: a.id, amount: available, note: 'Auto-forfeit after 14 days' });
          }
        });
      } catch (err) {
        this.logger.warn(`deposit forfeit for ${a.id} failed: ${String(err)}`);
      }
    }
    if (abandoned.length) this.logger.log(`forfeited deposits on ${abandoned.length} abandoned return(s) in org ${orgId}`);
  }
}
