import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AdmissionsService } from './admissions.service';

/**
 * Phase 4 — offer-expiry sweep. `OfferLetter.expiresAt` is enforced at accept
 * time, but nothing was moving a lapsed offer to the `offer_expired` state, so
 * an unaccepted offer sat in `offer_issued` forever and the offer_expired state
 * was unreachable. This worker sweeps every tenant on an interval and lets
 * AdmissionsService.expireLapsedOffers transition them.
 *
 * Self-scheduled setInterval with an overlap guard, matching PenaltyCronWorker —
 * no kernel scheduling infra imported, so module isolation holds.
 */
@Injectable()
export class OfferExpiryWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OfferExpiryWorker.name);
  private readonly intervalHours = Number(process.env.OFFER_EXPIRY_INTERVAL_HOURS ?? '6');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly admissions: AdmissionsService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.OFFER_EXPIRY_CRON_ENABLED === 'false') {
      this.logger.log('Offer expiry cron disabled (OFFER_EXPIRY_CRON_ENABLED=false)');
      return;
    }
    const intervalMs = this.intervalHours * 60 * 60 * 1000;
    this.timer = setInterval(() => void this.runGuarded(), intervalMs);
    this.timer.unref();
    this.logger.log(`Offer expiry cron registered: every ${this.intervalHours}h`);
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
      this.logger.error(`offer expiry sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Walk every org and expire its lapsed offers within that org's tenant context. */
  async tick(): Promise<void> {
    const orgs = await this.prisma.raw.organization.findMany({ select: { id: true } });
    let total = 0;
    for (const org of orgs) {
      // One school's bad row must not stop every later school's offers expiring.
      try {
        const res = await this.tenant.run(
          { organizationId: org.id, userId: 'system:offer-expiry', permissions: [] },
          () => this.admissions.expireLapsedOffers(),
        );
        total += res.expired;
      } catch (err) {
        this.logger.error(`offer expiry failed for org ${org.id}: ${(err as Error).message}`);
      }
    }
    if (total > 0) this.logger.log(`Expired ${total} lapsed offer(s)`);
  }
}
