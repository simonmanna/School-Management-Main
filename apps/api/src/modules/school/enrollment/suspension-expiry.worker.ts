import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { StudentEnrollmentService } from './student-enrollment.service';

/**
 * Reinstates learners whose suspension has run its course
 * (`StudentEnrollment.suspendedUntil <= now`). Each reinstatement goes through
 * the ordinary status transition — FSM, compare-and-set, audit, event — inside
 * its organization's tenant context.
 *
 * Self-scheduled setInterval with an overlap guard, matching OfferExpiryWorker.
 */
@Injectable()
export class SuspensionExpiryWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SuspensionExpiryWorker.name);
  private readonly intervalHours = Number(process.env.SUSPENSION_EXPIRY_INTERVAL_HOURS ?? '1');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly enrollments: StudentEnrollmentService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.SUSPENSION_EXPIRY_CRON_ENABLED === 'false') {
      this.logger.log('Suspension expiry cron disabled (SUSPENSION_EXPIRY_CRON_ENABLED=false)');
      return;
    }
    this.timer = setInterval(() => void this.runGuarded(), this.intervalHours * 60 * 60 * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async runGuarded(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.tick();
    } catch (err) {
      this.logger.error(`suspension expiry sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async tick(now: Date = new Date()): Promise<number> {
    // Fan out only to organizations that actually have a lapsed suspension.
    const due = await this.prisma.raw.studentEnrollment.findMany({
      where: { status: 'SUSPENDED', suspendedUntil: { lte: now } },
      distinct: ['organizationId'],
      select: { organizationId: true },
    });
    let total = 0;
    for (const { organizationId } of due) {
      // Isolated per school: one failure must not leave every later school's
      // pupils suspended past their return date.
      try {
        total += await this.tenant.run(
          { organizationId, userId: 'system:suspension-expiry', permissions: [] },
          () => this.enrollments.liftExpiredSuspensions(now),
        );
      } catch (err) {
        this.logger.error(`suspension expiry failed for org ${organizationId}: ${(err as Error).message}`);
      }
    }
    if (total > 0) this.logger.log(`Reinstated ${total} learner(s) at the end of their suspension`);
    return total;
  }
}
