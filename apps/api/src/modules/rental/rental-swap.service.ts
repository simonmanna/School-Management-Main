import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { LifecycleService } from '../../kernel/lifecycle/lifecycle.service';
import { RentalPostingService } from './rental-posting.service';
import { RentalLocationConfigService } from './rental-location-config.service';

/**
 * RentalSwapService — mid-hire swap of the physical unit on a line.
 *
 * Old unit: RENT-OUT → RENT-CLEAN (it is now out of hire and must be
 * inspected). New unit: RENT-STOCK → RENT-OUT (transfer count 1 of the same
 * product). The booking re-points to the new unit. A rate delta (different
 * size/class) is billed at swap time.
 */
@Injectable()
export class RentalSwapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly lifecycle: LifecycleService,
    private readonly posting: RentalPostingService,
    private readonly locations: RentalLocationConfigService,
  ) {}

  async list(query: { agreementId?: string; page?: number; pageSize?: number }) {
    const orgId = this.tenant.organizationId;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where: any = {
      organizationId: orgId,
      ...(query.agreementId ? { agreementLine: { agreementId: query.agreementId } } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.client.rentalSwap.count({ where }),
      this.prisma.client.rentalSwap.findMany({
        where,
        include: {
          agreementLine: {
            include: {
              product: { select: { id: true, code: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, items };
  }

  /**
   * Swap the unit on a checked-out line. `toUnitId` must belong to the same
   * product and be currently available (not on another hire).
   */
  async swap(dto: {
    agreementId: string;
    lineId: string;
    toUnitId: string;
    reason?: string;
    priceDelta?: number;
    paymentMode?: 'cash' | 'card' | 'mobile_money' | 'mixed' | 'credit';
  }) {
    const orgId = this.tenant.organizationId;

    const line = await this.prisma.client.rentalAgreementLine.findFirst({
      where: { id: dto.lineId, organizationId: orgId },
      include: { agreement: { select: { id: true, partnerId: true, agreementNumber: true, branchId: true } } },
    });
    if (!line) throw new NotFoundException('Agreement line not found');
    if (line.agreementId !== dto.agreementId) {
      throw new BadRequestException('Line does not belong to the agreement');
    }
    if (!line.unitId) throw new BadRequestException('Line has no unit to swap');

    const toUnit = await this.prisma.client.rentalUnit.findFirst({
      where: { id: dto.toUnitId, organizationId: orgId, productId: line.productId },
    });
    if (!toUnit) {
      throw new BadRequestException('Target unit not found for this product');
    }
    if (toUnit.id === line.unitId) throw new BadRequestException('Target unit is the current unit');
    if (toUnit.status !== 'available') {
      throw new BadRequestException(`Target unit is '${toUnit.status}', not available`);
    }

    return this.prisma.client.$transaction(async (tx: any) => {
      const swap = await tx.rentalSwap.create({
        data: {
          organizationId: orgId,
          agreementLineId: line.id,
          fromUnitId: line.unitId,
          toUnitId: toUnit.id,
          reason: dto.reason ?? null,
          priceDelta: dto.priceDelta ?? 0,
          byUserId: this.tenant.userId ?? null,
        },
      });

      // Old unit: RENT-OUT → RENT-CLEAN (count 1). New unit: RENT-STOCK → RENT-OUT.
      await this.posting.returnTransfer(tx, orgId, dto.agreementId, line.productId, 1, 'returned');
      await this.posting.checkoutTransfer(tx, orgId, { ...line, unitId: toUnit.id });

      // Re-point the booking to the new unit.
      const booking = await tx.rentalBooking.findFirst({
        where: {
          organizationId: orgId,
          sourceType: 'agreement',
          sourceId: dto.agreementId,
          productId: line.productId,
          status: { in: ['confirmed', 'active'] },
        },
      });
      if (booking) {
        await tx.rentalBooking.update({ where: { id: booking.id }, data: { unitId: toUnit.id } });
      }

      // Unit statuses: old → cleaning (must be inspected), new → checked_out.
      await tx.rentalUnit.update({ where: { id: line.unitId as string }, data: { status: 'cleaning' } });
      await tx.rentalUnit.update({ where: { id: toUnit.id }, data: { status: 'checked_out', rentalCount: { increment: 1 } } });
      await tx.rentalAgreementLine.update({ where: { id: line.id }, data: { unitId: toUnit.id } });

      for (const [unitId, from, to] of [
        [line.unitId, 'checked_out', 'cleaning'],
        [toUnit.id, 'available', 'checked_out'],
      ] as const) {
        await this.lifecycle.transition({
          defKey: 'custody.rental_unit',
          entityType: 'rental_unit',
          entityId: unitId as string,
          from,
          to,
          action: 'swap',
          metadata: { swapId: swap.id, reason: dto.reason ?? null },
          refType: 'rental_swap',
          refId: swap.id,
          tx,
        });
      }

      // Rate delta billed at swap time.
      const delta = dto.priceDelta ?? 0;
      if (delta > 0) {
        const feeProduct = await tx.product.findFirst({
          where: { organizationId: orgId, code: 'RENT-EXTEND', isActive: true },
        });
        if (feeProduct) {
          await this.posting.createFeeInvoice(
            tx,
            orgId,
            {
              agreementId: dto.agreementId,
              partnerId: line.agreement.partnerId,
              branchId: line.agreement.branchId ?? undefined,
              feeType: 'rental',
              lines: [
                {
                  productId: feeProduct.id,
                  description: `Swap rate delta — ${line.agreement.agreementNumber}`,
                  quantity: 1,
                  unitPrice: delta,
                  rentalFeeType: 'rental',
                },
              ],
              paymentMode: dto.paymentMode ?? 'cash',
            },
          );
        }
      }

      return swap;
    });
  }
}
