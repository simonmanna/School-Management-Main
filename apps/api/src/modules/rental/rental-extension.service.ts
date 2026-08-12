import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { LifecycleService } from '../../kernel/lifecycle/lifecycle.service';
import { RentalAvailabilityService } from './rental-availability.service';
import { RentalPostingService } from './rental-posting.service';

/**
 * RentalExtensionService — extend a line's due date (per line, not the
 * agreement). The new window must be availability-clear against every OTHER
 * booking; the line's own booking is excluded via excludeSourceId. Extension
 * fees (RENT-EXTEND) are billed at extend time through the invoice spine.
 */
@Injectable()
export class RentalExtensionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly lifecycle: LifecycleService,
    private readonly availability: RentalAvailabilityService,
    private readonly posting: RentalPostingService,
  ) {}

  async list(query: { agreementId?: string; page?: number; pageSize?: number }) {
    const orgId = this.tenant.organizationId;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where: any = {
      organizationId: orgId,
      ...(query.agreementId
        ? { agreementLine: { agreementId: query.agreementId } }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.client.rentalExtension.count({ where }),
      this.prisma.client.rentalExtension.findMany({
        where,
        include: {
          agreementLine: {
            include: {
              product: { select: { id: true, code: true, name: true } },
              unit: { select: { id: true, unitCode: true } },
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
   * Extend a checked-out line. `newDueAt` is the absolute new due date; the
   * extension spans (previousDueAt, newDueAt] and bills at the line's rate.
   */
  async extend(dto: {
    agreementId: string;
    lineId: string;
    newDueAt: string | Date;
    note?: string;
    paymentMode?: 'cash' | 'card' | 'mobile_money' | 'mixed' | 'credit';
  }) {
    const orgId = this.tenant.organizationId;
    const newDueAt = new Date(dto.newDueAt);

    const line = await this.prisma.client.rentalAgreementLine.findFirst({
      where: { id: dto.lineId, organizationId: orgId },
      include: {
        agreement: { select: { id: true, partnerId: true, agreementNumber: true, branchId: true } },
      },
    });
    if (!line) throw new NotFoundException('Agreement line not found');
    if (line.agreementId !== dto.agreementId) {
      throw new BadRequestException('Line does not belong to the agreement');
    }
    if (newDueAt <= line.dueAt) {
      throw new BadRequestException('newDueAt must be after the current due date');
    }

    // Availability gate: the extension window must be free of OTHER bookings.
    const available = await this.availability.countAvailable({
      productId: line.productId,
      startAt: line.dueAt,
      endAt: newDueAt,
      excludeSourceId: dto.agreementId,
    });
    if (available < Number(line.quantity)) {
      throw new BadRequestException('Requested extension overlaps an existing booking');
    }

    return this.prisma.client.$transaction(async (tx: any) => {
      const extensionUnits = this.calcUnits(line.dueAt, newDueAt, line.ratePeriod);
      const extensionAmount = Number(line.unitRate) * extensionUnits * Number(line.quantity);

      const ext = await tx.rentalExtension.create({
        data: {
          organizationId: orgId,
          agreementLineId: line.id,
          previousDueAt: line.dueAt,
          newDueAt,
          additionalUnits: extensionUnits,
          additionalCharge: extensionAmount,
          approvedById: this.tenant.userId ?? null,
        },
      });

      // Shift the line's booking window.
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
        await tx.rentalBooking.update({ where: { id: booking.id }, data: { endAt: newDueAt } });
      }
      await tx.rentalAgreementLine.update({ where: { id: line.id }, data: { dueAt: newDueAt } });

      // Bill the extension fee through the invoice spine (fee type extension).
      const feeProduct = await tx.product.findFirst({
        where: { organizationId: orgId, code: 'RENT-EXTEND', isActive: true },
      });
      if (feeProduct && extensionAmount > 0) {
        await this.posting.createFeeInvoice(
          tx,
          orgId,
          {
            agreementId: dto.agreementId,
            partnerId: line.agreement.partnerId,
            branchId: line.agreement.branchId ?? undefined,
            feeType: 'extension',
            lines: [
              {
                productId: feeProduct.id,
                description: `Extension (${extensionUnits} ${line.ratePeriod}) — ${line.agreement.agreementNumber}`,
                quantity: 1,
                unitPrice: extensionAmount,
                rentalFeeType: 'extension',
              },
            ],
            paymentMode: dto.paymentMode ?? 'cash',
          },
        );
      }

      await this.lifecycle.transition({
        defKey: 'custody.rental_unit',
        entityType: 'rental_unit',
        entityId: line.unitId ?? line.id,
        from: 'checked_out',
        to: 'checked_out',
        action: 'extend',
        metadata: { extensionId: ext.id, previousDueAt: line.dueAt, newDueAt },
        refType: 'rental_extension',
        refId: ext.id,
        tx,
      });

      return ext;
    });
  }

  /** Convert a duration into rate-period units (ceil for fractional spans). */
  private calcUnits(from: Date, to: Date, period: string): number {
    const ms = to.getTime() - from.getTime();
    const day = 86_400_000;
    const hour = 3_600_000;
    if (period === 'hour') return Math.max(1, Math.ceil(ms / hour));
    if (period === 'week') return Math.max(1, Math.ceil(ms / (7 * day)));
    if (period === 'month') return Math.max(1, Math.ceil(ms / (30 * day)));
    return Math.max(1, Math.ceil(ms / day));
  }
}
