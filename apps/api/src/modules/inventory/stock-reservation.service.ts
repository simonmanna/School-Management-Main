import { Injectable } from '@nestjs/common';
import { dec, ZERO } from '../../kernel/common/money';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { SettingResolverService } from '../../kernel/settings/setting-resolver.service';

export interface ReserveDto {
  productId: string;
  variantId?: string | null;
  locationId: string;
  quantity: number;
  sourceType: string; // 'order' | 'invoice' | 'pos_tab' | 'manual'
  sourceId: string;
  reason?: string;
}

/**
 * Soft stock reservations → available-to-promise (ATP).
 *
 * A reservation holds quantity for a source document without touching the
 * inventory ledger; ATP = on-hand − sum(active reservations). Reserve is
 * declarative and idempotent per (sourceType, sourceId, product, variant,
 * location): re-reserving a line sets its quantity rather than stacking. The
 * StockReservation model is org-scoped by the tenancy extension.
 */
@Injectable()
export class StockReservationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly settings: SettingResolverService,
  ) {}

  /** Whether reservations are enabled at all (org setting). */
  async mode(): Promise<'none' | 'order' | 'invoice'> {
    return this.settings.resolveEnum<'none' | 'order' | 'invoice'>('inventory.reservationMode');
  }

  async reserve(dto: ReserveDto) {
    const organizationId = this.tenant.organizationId;
    const variantKey = dto.variantId ?? '';
    const quantity = dec(dto.quantity);

    // F11 fix: serialise concurrent reserves against the StockItem row so two
    // callers can't both pass an ATP check and over-reserve the same
    // (product, variant, location). The previous read-then-write was a TOCTOU
    // — the read saw on-hand before the competing decrement committed.
    return this.prisma.client.$transaction(async (tx: any) => {
      // Lock the StockItem row for the duration of this TX. Concurrent
      // reserves / issues / transfers / adjusts of the same line block here
      // until we commit, so the ATP computation is consistent with the
      // decrement we are about to publish.
      await tx.$queryRawUnsafe(
        `SELECT id FROM "StockItem"
         WHERE "organizationId" = $1 AND "productId" = $2 AND "variantKey" = $3 AND "locationId" = $4
         FOR UPDATE`,
        organizationId,
        dto.productId,
        variantKey,
        dto.locationId,
      );

      const existing = await tx.stockReservation.findFirst({
        where: {
          productId: dto.productId,
          variantKey,
          locationId: dto.locationId,
          sourceType: dto.sourceType,
          sourceId: dto.sourceId,
          status: 'active',
        },
      });
      if (existing) {
        return tx.stockReservation.update({
          where: { id: existing.id },
          data: { quantity, reason: dto.reason ?? existing.reason },
        });
      }
      return tx.stockReservation.create({
        data: {
          organizationId,
          productId: dto.productId,
          variantId: dto.variantId ?? null,
          variantKey,
          locationId: dto.locationId,
          quantity,
          sourceType: dto.sourceType,
          sourceId: dto.sourceId,
          reason: dto.reason ?? null,
          createdById: this.tenant.userId ?? null,
        },
      });
    });
  }

  /** Release all active reservations for a source (e.g. order cancel / invoice void). */
  async release(sourceType: string, sourceId: string) {
    const res = await this.prisma.client.stockReservation.updateMany({
      where: { sourceType, sourceId, status: 'active' },
      data: { status: 'released', releasedAt: new Date() },
    });
    return { released: res.count };
  }

  /** Mark a source's reservations consumed (the stock actually shipped). */
  async consume(sourceType: string, sourceId: string) {
    const res = await this.prisma.client.stockReservation.updateMany({
      where: { sourceType, sourceId, status: 'active' },
      data: { status: 'consumed', consumedAt: new Date() },
    });
    return { consumed: res.count };
  }

  /** Sum of active reservations for a stock line. */
  async reservedQty(productId: string, locationId: string, variantId?: string | null) {
    const agg = await this.prisma.client.stockReservation.aggregate({
      where: { productId, variantKey: variantId ?? '', locationId, status: 'active' },
      _sum: { quantity: true },
    });
    return dec(agg._sum.quantity ?? 0);
  }

  /** on-hand − active reservations. */
  async availableToPromise(productId: string, locationId: string, variantId?: string | null) {
    const item = await this.prisma.client.stockItem.findFirst({
      where: { productId, variantKey: variantId ?? '', locationId },
      select: { quantity: true },
    });
    const onHand = item ? dec(item.quantity) : ZERO;
    const reserved = await this.reservedQty(productId, locationId, variantId);
    const available = onHand.minus(reserved);
    return {
      onHand: onHand.toString(),
      reserved: reserved.toString(),
      available: available.toString(),
    };
  }

  listForSource(sourceType: string, sourceId: string) {
    return this.prisma.client.stockReservation.findMany({
      where: { sourceType, sourceId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
