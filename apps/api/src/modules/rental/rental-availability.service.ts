import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';

/** Active booking statuses — everything that still holds a window. */
const ACTIVE_STATUSES = ['held', 'confirmed', 'active'] as const;

/** Statuses a unit may be in while physically present and rentable. */
const RENTABLE_UNIT_STATUSES = ['available', 'cleaning', 'repair'] as const;

/**
 * RentalAvailabilityService — the calendar engine.
 *
 * Availability = candidates − overlapping bookings. Bookings are unit-scoped
 * calendar holds (held/confirmed/active); they outlive the unit status, so a
 * unit checked out today is still bookable for next month. A unit whose status
 * is checked_out/lost/damaged/retired is excluded from candidates entirely
 * until it comes back.
 *
 * Two knobs bend the windows:
 *  - `endAt` is buffer-extended per product (rentalBufferDays) so a same-day
 *    turnaround is blocked;
 *  - units whose product requires cleaning (rentalRequiresCleaning) are held
 *    out of candidate pools while in `cleaning`.
 */
@Injectable()
export class RentalAvailabilityService {
  private readonly logger = new Logger('RentalAvailabilityService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /**
   * How many units of a product are available in [startAt, endAt).
   * `requested` (per-agreement needs) is optional — when given and the product
   * has no unit-level tracking (pooled), the pool size is the fallback cap.
   */
  async countAvailable(input: {
    productId: string;
    startAt: Date;
    endAt: Date;
    excludeSourceId?: string; // the booking source being edited (e.g. agreement id)
    locationId?: string;
  }): Promise<number> {
    const orgId = this.tenant.organizationId;
    const product = await this.prisma.client.product.findFirst({
      where: { id: input.productId, organizationId: orgId },
    });
    if (!product) return 0;

    const bufferMs = (product.rentalBufferDays ?? 0) * 86_400_000;
    const effEnd = new Date(input.endAt.getTime() + bufferMs);

    const [candidates, overlap] = await Promise.all([
      this.candidates(product.id, orgId, input.locationId ?? null),
      this.prisma.client.rentalBooking.count({
        where: {
          organizationId: orgId,
          productId: product.id,
          ...(input.excludeSourceId
            ? { NOT: { sourceId: input.excludeSourceId, sourceType: 'agreement' } }
            : {}),
          status: { in: [...ACTIVE_STATUSES] },
          startAt: { lt: effEnd },
          endAt: { gt: input.startAt },
        },
      }),
    ]);

    return Math.max(0, candidates - overlap);
  }

  /**
   * Candidate units for a window — unit-level (serialized) products only.
   * Pooled products have no units and are sized by `countAvailable`.
   */
  async candidateUnits(input: {
    productId: string;
    startAt: Date;
    endAt: Date;
    locationId?: string;
  }): Promise<string[]> {
    const orgId = this.tenant.organizationId;
    const product = await this.prisma.client.product.findFirst({
      where: { id: input.productId, organizationId: orgId },
    });
    if (!product || product.rentalIsPooled) return [];

    const bufferMs = (product.rentalBufferDays ?? 0) * 86_400_000;
    const effEnd = new Date(input.endAt.getTime() + bufferMs);

    const [unitIds, overlapping] = await Promise.all([
      this.prisma.client.rentalUnit.findMany({
        where: {
          organizationId: orgId,
          productId: product.id,
          status: { in: this.rentableStatusesFor(product) as any },
        },
        select: { id: true },
      }),
      this.prisma.client.rentalBooking.findMany({
        where: {
          organizationId: orgId,
          productId: product.id,
          status: { in: [...ACTIVE_STATUSES] },
          startAt: { lt: effEnd },
          endAt: { gt: input.startAt },
          unitId: { not: null },
        },
        select: { unitId: true },
      }),
    ]);

    const busy = new Set(overlapping.map((b) => b.unitId as string));
    return unitIds.map((u) => u.id).filter((id) => !busy.has(id));
  }

  /** Statuses that keep a unit in the candidate pool for a product. */
  private rentableStatusesFor(product: any): string[] {
    if (product.rentalIsPooled) return [];
    if (product.rentalRequiresCleaning) {
      // cleaning units are not rentable until inspected+cleaned
      return ['available', 'repair'];
    }
    return [...RENTABLE_UNIT_STATUSES];
  }

  /**
   * The unit-status side of candidates. `cleaning`/`repair` count only for
   * products that do NOT require cleaning (a rentalRequiresCleaning product's
   * units are not rentable while cleaning — the turnaround buffer already
   * models this at booking time, and physical truth at availability time).
   *
   * Physical location lives in the stock layer (StockItem), not on RentalUnit,
   * so location filtering is intentionally not applied here — availability is
   * a calendar concern. Cross-location transfer happens at checkout.
   */
  private async candidates(
    productId: string,
    orgId: string,
    locationId: string | null,
  ): Promise<number> {
    const product = await this.prisma.client.product.findFirst({
      where: { id: productId, organizationId: orgId },
      select: { rentalIsPooled: true, rentalRequiresCleaning: true },
    });
    if (product?.rentalIsPooled) return 0; // pooled: sized by booking qty, not units

    const statuses = [...RENTABLE_UNIT_STATUSES];
    if (product?.rentalRequiresCleaning) {
      // cleaning units are not rentable for this product until inspected+cleaned
      return this.prisma.client.rentalUnit.count({
        where: {
          organizationId: orgId,
          productId,
          status: { in: ['available', 'repair'] },
        },
      });
    }
    return this.prisma.client.rentalUnit.count({
      where: {
        organizationId: orgId,
        productId,
        status: { in: statuses as unknown as any[] },
      },
    });
  }
}
