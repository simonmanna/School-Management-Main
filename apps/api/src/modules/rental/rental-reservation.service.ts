import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';
import { RentalAvailabilityService } from './rental-availability.service';
import { SettingResolverService } from '../../kernel/settings/setting-resolver.service';

/**
 * RentalReservationService — pre-booking before a contract.
 *
 * A reservation is a hold: it creates unit-scoped RentalBooking rows
 * (status `held`, expiry = now + holdMinutes) so the calendar is blocked while
 * the customer decides. Confirmation converts the reservation to an agreement
 * (the agreement takes over the bookings — status → `confirmed`); a hold that
 * expires is cancelled by the cron worker and its bookings released.
 */
@Injectable()
export class RentalReservationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly seq: SequenceService,
    private readonly availability: RentalAvailabilityService,
    private readonly settings: SettingResolverService,
  ) {}

  async list(query: { status?: string; partnerId?: string; page?: number; pageSize?: number }) {
    const orgId = this.tenant.organizationId;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where: any = {
      organizationId: orgId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.partnerId ? { partnerId: query.partnerId } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.client.rentalReservation.count({ where }),
      this.prisma.client.rentalReservation.findMany({
        where,
        include: {
          lines: {
            include: { product: { select: { id: true, code: true, name: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, items };
  }

  async get(id: string) {
    const orgId = this.tenant.organizationId;
    const res = await this.prisma.client.rentalReservation.findFirst({
      where: { id, organizationId: orgId },
      include: { lines: { include: { product: { select: { id: true, code: true, name: true } } } } },
    });
    if (!res) throw new NotFoundException('Reservation not found');
    return res;
  }

  /**
   * Create a hold. Each line is availability-checked; the whole reservation is
   * rejected if any line cannot be covered.
   */
  async create(dto: {
    partnerId: string;
    startAt: string | Date;
    endAt: string | Date;
    holdMinutes?: number;
    notes?: string;
    branchId?: string;
    lines: Array<{ productId: string; quantity?: number }>;
  }) {
    const orgId = this.tenant.organizationId;
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (!(endAt > startAt)) throw new BadRequestException('endAt must be after startAt');
    if (!dto.lines.length) throw new BadRequestException('At least one line is required');

    const holdMinutes =
      dto.holdMinutes ?? (await this.settings.resolveNumber('rental.autoHoldMinutes'));
    const expiresAt = new Date(Date.now() + holdMinutes * 60_000);

    return this.prisma.client.$transaction(async (tx: any) => {
      // Availability check — count available for each line against the window.
      for (const line of dto.lines) {
        const available = await this.availability.countAvailable({
          productId: line.productId,
          startAt,
          endAt,
        });
        const requested = line.quantity ?? 1;
        if (available < requested) {
          const product = await tx.product.findFirst({ where: { id: line.productId } });
          throw new BadRequestException(
            `Insufficient availability for '${product?.name ?? line.productId}': requested ${requested}, available ${available}`,
          );
        }
      }

      const reservationNumber = await this.seq.next('rental_reservation', { prefix: 'RSV-', padding: 5 }, tx);
      const reservation = await tx.rentalReservation.create({
        data: {
          organizationId: orgId,
          reservationNumber,
          partnerId: dto.partnerId,
          status: 'held',
          startAt,
          endAt,
          expiresAt,
          holdMinutes,
          notes: dto.notes ?? null,
          branchId: dto.branchId ?? null,
          createdBy: this.tenant.userId ?? null,
          lines: {
            create: dto.lines.map((l) => ({
              organizationId: orgId,
              productId: l.productId,
              quantity: l.quantity ?? 1,
            })),
          },
        },
        include: { lines: true },
      });

      // Block the calendar: one held booking per unit per line. For unit-level
      // products the availability engine assigned no specific units — we lock
      // the count generically (booking rows without unitId hold quantity).
      for (const line of dto.lines) {
        await tx.rentalBooking.create({
          data: {
            organizationId: orgId,
            productId: line.productId,
            quantity: line.quantity ?? 1,
            startAt,
            endAt,
            status: 'held',
            sourceType: 'reservation',
            sourceId: reservation.id,
            expiresAt,
          },
        });
      }
      return reservation;
    });
  }

  /** Cancel a held reservation: releases its bookings. */
  async cancel(id: string) {
    const orgId = this.tenant.organizationId;
    const res = await this.prisma.client.rentalReservation.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!res) throw new NotFoundException('Reservation not found');
    if (!['held', 'draft'].includes(res.status)) {
      throw new BadRequestException(`Cannot cancel a reservation in status '${res.status}'`);
    }

    return this.prisma.client.$transaction(async (tx: any) => {
      await tx.rentalBooking.updateMany({
        where: { organizationId: orgId, sourceType: 'reservation', sourceId: id },
        data: { status: 'cancelled' },
      });
      return tx.rentalReservation.update({
        where: { id },
        data: { status: 'cancelled' },
      });
    });
  }

  /**
   * Called by the cron worker: expire held reservations past expiresAt.
   * Returns the number expired.
   */
  async expireDue(): Promise<number> {
    const orgId = this.tenant.organizationId;
    const due = await this.prisma.client.rentalReservation.findMany({
      where: { organizationId: orgId, status: 'held', expiresAt: { lt: new Date() } },
      select: { id: true },
    });
    if (!due.length) return 0;

    return this.prisma.client.$transaction(async (tx: any) => {
      for (const r of due) {
        await tx.rentalBooking.updateMany({
          where: { organizationId: orgId, sourceType: 'reservation', sourceId: r.id, status: 'held' },
          data: { status: 'expired' },
        });
        await tx.rentalReservation.update({
          where: { id: r.id },
          data: { status: 'expired' },
        });
      }
      return due.length;
    });
  }

  /**
   * Convert a held reservation into an agreement: the caller (AgreementService)
   * passes the agreement id; bookings are re-pointed to the agreement and
   * promoted to `confirmed`, and the reservation is marked `converted`.
   */
  async convertToAgreement(reservationId: string, agreementId: string, tx: any) {
    const orgId = this.tenant.organizationId;
    const res = await tx.rentalReservation.findFirst({
      where: { id: reservationId, organizationId: orgId },
    });
    if (!res) throw new NotFoundException('Reservation not found');
    if (res.status !== 'held') {
      throw new BadRequestException(`Cannot convert a reservation in status '${res.status}'`);
    }

    await tx.rentalBooking.updateMany({
      where: { organizationId: orgId, sourceType: 'reservation', sourceId: reservationId },
      data: {
        status: 'confirmed',
        sourceType: 'agreement',
        sourceId: agreementId,
        expiresAt: null,
      },
    });
    return tx.rentalReservation.update({
      where: { id: reservationId },
      data: { status: 'converted' },
    });
  }
}
