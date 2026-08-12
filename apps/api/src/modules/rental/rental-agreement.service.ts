import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { LifecycleService } from '../../kernel/lifecycle/lifecycle.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';
import { SettingResolverService } from '../../kernel/settings/setting-resolver.service';
import { ApprovalsService } from '../../kernel/approvals/approvals.service';
import { RentalCatalogService } from './rental-catalog.service';
import { RentalAvailabilityService } from './rental-availability.service';
import { RentalReservationService } from './rental-reservation.service';
import { RentalScoreService } from './rental-score.service';
import { RentalPostingService } from './rental-posting.service';
import { RentalDepositService } from './rental-deposit.service';
import { RentalRatePeriod, RentalAgreementStatus } from '@prisma/client';

/** Agreement statuses that still hold the calendar / stock. */
const OPEN_STATUSES: RentalAgreementStatus[] = ['draft', 'pending_approval', 'confirmed', 'checked_out', 'partially_returned'];

/**
 * RentalAgreementService — the contract.
 *
 * Lifecycle (guarded by the `custody.rental_agreement` definition, registered
 * in this module's onModuleInit):
 *
 *   draft → confirmed (confirm) · draft → cancelled (cancel)
 *   confirmed → checked_out (checkout) · confirmed → pending_approval → confirmed
 *   checked_out → partially_returned (partial return) → returned (return)
 *   returned → closed (settle) · checked_out → returned (full return)
 *
 * Checkout = stock transfer (RENT-STOCK → RENT-OUT) + fee invoice + deposit
 * collection, all in one transaction.
 */
@Injectable()
export class RentalAgreementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly lifecycle: LifecycleService,
    private readonly seq: SequenceService,
    private readonly settings: SettingResolverService,
    private readonly approvals: ApprovalsService,
    private readonly catalog: RentalCatalogService,
    private readonly availability: RentalAvailabilityService,
    private readonly reservations: RentalReservationService,
    private readonly score: RentalScoreService,
    private readonly posting: RentalPostingService,
    private readonly deposit: RentalDepositService,
  ) {}

  async list(query: { status?: string; partnerId?: string; search?: string; page?: number; pageSize?: number }) {
    const orgId = this.tenant.organizationId;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where: any = {
      organizationId: orgId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.partnerId ? { partnerId: query.partnerId } : {}),
      ...(query.search
        ? { agreementNumber: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.client.rentalAgreement.count({ where }),
      this.prisma.client.rentalAgreement.findMany({
        where,
        include: {
          partner: { select: { id: true, name: true, code: true } },
          lines: {
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

  async get(id: string) {
    const orgId = this.tenant.organizationId;
    const agreement = await this.prisma.client.rentalAgreement.findFirst({
      where: { id, organizationId: orgId },
      include: {
        partner: { select: { id: true, name: true, code: true, phone: true } },
        lines: {
          include: {
            product: { select: { id: true, code: true, name: true } },
            unit: { select: { id: true, unitCode: true, conditionGrade: true } },
          },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!agreement) throw new NotFoundException('Agreement not found');
    return agreement;
  }

  /** Find the open agreement for a partner (e.g. terminal scan by phone). */
  async findOpenByPartner(partnerId: string) {
    const orgId = this.tenant.organizationId;
    return this.prisma.client.rentalAgreement.findFirst({
      where: { organizationId: orgId, partnerId, status: { in: ['confirmed', 'checked_out', 'partially_returned'] } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Create a draft agreement. Lines resolve rates through the catalog; the
   * window is availability-checked per line. A `reservationId` converts an
   * existing hold (bookings re-pointed to the agreement).
   */
  async create(dto: {
    partnerId: string;
    startAt: string | Date;
    dueAt: string | Date;
    reservationId?: string;
    packageId?: string;
    branchId?: string;
    notes?: string;
    lines: Array<{
      productId: string;
      unitId?: string;
      quantity?: number;
      ratePeriod?: RentalRatePeriod;
      rateUnits?: number;
      unitRate?: number;
    }>;
  }) {
    const orgId = this.tenant.organizationId;
    const startAt = new Date(dto.startAt);
    const dueAt = new Date(dto.dueAt);
    if (!(dueAt > startAt)) throw new BadRequestException('dueAt must be after startAt');
    if (!dto.lines.length) throw new BadRequestException('At least one line is required');

    const partner = await this.prisma.client.partner.findFirst({
      where: { id: dto.partnerId, organizationId: orgId },
    });
    if (!partner) throw new NotFoundException('Partner not found');

    // Availability gate — draft or not, the window must be bookable.
    for (const line of dto.lines) {
      const available = await this.availability.countAvailable({
        productId: line.productId,
        startAt,
        endAt: dueAt,
      });
      const requested = line.quantity ?? 1;
      if (available < requested) {
        const product = await this.prisma.client.product.findFirst({ where: { id: line.productId } });
        throw new BadRequestException(
          `Insufficient availability for '${product?.name ?? line.productId}': requested ${requested}, available ${available}`,
        );
      }
    }

    return this.prisma.client.$transaction(async (tx: any) => {
      const agreementNumber = await this.seq.next('rental_agreement', { prefix: 'RAG-', padding: 5 }, tx);

      // Terms snapshot — frozen at signature time.
      const [lateFeePerDay, holdMinutes, depositPolicy] = await Promise.all([
        this.settings.resolveNumber('rental.lateFeePerDay'),
        this.settings.resolveNumber('rental.autoHoldMinutes'),
        this.settings.resolve('rental.depositPolicy'),
      ]);
      const termsSnapshot = { lateFeePerDay, holdMinutes, depositPolicy };

      const agreement = await tx.rentalAgreement.create({
        data: {
          organizationId: orgId,
          agreementNumber,
          partnerId: dto.partnerId,
          status: 'draft',
          startAt,
          dueAt,
          packageId: dto.packageId ?? null,
          branchId: dto.branchId ?? null,
          notes: dto.notes ?? null,
          termsSnapshot: termsSnapshot as any,
          createdBy: this.tenant.userId ?? null,
        },
      });

      // Resolve each line's rate + totals.
      for (const line of dto.lines) {
        const period = line.ratePeriod ?? 'day';
        const rateUnits = line.rateUnits ?? 1;
        let unitRate = line.unitRate ?? 0;
        if (!(unitRate > 0)) {
          const resolved = await this.catalog.resolveRate(line.productId, period, rateUnits);
          unitRate = resolved?.unitRate ?? 0;
        }
        if (!(unitRate > 0)) {
          // Fall back to the product's default sale price as a last resort.
          const product = await tx.product.findFirst({ where: { id: line.productId } });
          unitRate = Number(product?.salePrice ?? 0);
        }
        const quantity = line.quantity ?? 1;
        const lineTotal = unitRate * rateUnits * quantity;

        await tx.rentalAgreementLine.create({
          data: {
            organizationId: orgId,
            agreementId: agreement.id,
            productId: line.productId,
            unitId: line.unitId ?? null,
            quantity,
            ratePeriod: period,
            rateUnits,
            unitRate,
            lineTotal,
            dueAt,
          },
        });
      }

      // Block the calendar for the whole window (one booking per line).
      const lines = await tx.rentalAgreementLine.findMany({ where: { agreementId: agreement.id } });
      for (const l of lines) {
        await tx.rentalBooking.create({
          data: {
            organizationId: orgId,
            productId: l.productId,
            unitId: l.unitId ?? null,
            quantity: l.quantity,
            startAt,
            endAt: dueAt,
            status: 'held',
            sourceType: 'agreement',
            sourceId: agreement.id,
          },
        });
      }

      // Convert a source reservation if given (bookings re-pointed).
      if (dto.reservationId) {
        await this.reservations.convertToAgreement(dto.reservationId, agreement.id, tx);
      }

      return this.reload(tx, agreement.id);
    });
  }

  /** Confirm a draft (approval-gated). */
  async confirm(id: string) {
    const orgId = this.tenant.organizationId;
    const agreement = await this.prisma.client.rentalAgreement.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!agreement) throw new NotFoundException('Agreement not found');
    if (agreement.status !== 'draft') {
      throw new BadRequestException(`Cannot confirm an agreement in status '${agreement.status}'`);
    }

    const approval = await this.approvals.checkOrRequestApproval({
      entityType: 'rental_agreement',
      entityId: agreement.id,
      snapshot: {
        agreementNumber: agreement.agreementNumber,
        partnerId: agreement.partnerId,
        status: agreement.status,
      },
    });
    if (approval?.needsApproval) {
      return this.prisma.client.rentalAgreement.update({
        where: { id },
        data: { status: 'pending_approval' },
      });
    }

    return this.prisma.client.$transaction(async (tx: any) => {
      await this.lifecycle.transition({
        defKey: 'custody.rental_agreement',
        entityType: 'rental_agreement',
        entityId: agreement.id,
        from: 'draft',
        to: 'confirmed',
        action: 'confirm',
        refType: 'rental_agreement',
        refId: agreement.id,
        tx,
      });
      // Promote held bookings → confirmed now that the contract is real.
      await tx.rentalBooking.updateMany({
        where: { organizationId: orgId, sourceType: 'agreement', sourceId: id, status: 'held' },
        data: { status: 'confirmed' },
      });
      return tx.rentalAgreement.update({
        where: { id },
        data: { status: 'confirmed', confirmedAt: new Date(), confirmedBy: this.tenant.userId ?? null },
      });
    });
  }

  /** Cancel a draft/pending agreement — releases bookings. */
  async cancel(id: string, reason?: string) {
    const orgId = this.tenant.organizationId;
    const agreement = await this.prisma.client.rentalAgreement.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!agreement) throw new NotFoundException('Agreement not found');
    if (!['draft', 'pending_approval'].includes(agreement.status)) {
      throw new BadRequestException(`Cannot cancel an agreement in status '${agreement.status}'`);
    }

    return this.prisma.client.$transaction(async (tx: any) => {
      await this.lifecycle.transition({
        defKey: 'custody.rental_agreement',
        entityType: 'rental_agreement',
        entityId: agreement.id,
        from: agreement.status,
        to: 'cancelled',
        action: 'cancel',
        metadata: { reason: reason ?? null },
        refType: 'rental_agreement',
        refId: agreement.id,
        tx,
      });
      await tx.rentalBooking.updateMany({
        where: { organizationId: orgId, sourceType: 'agreement', sourceId: id, status: { in: ['held', 'confirmed'] } },
        data: { status: 'cancelled' },
      });
      return tx.rentalAgreement.update({
        where: { id },
        data: { status: 'cancelled', notes: reason ? `${agreement.notes ?? ''}\n${reason}`.trim() : agreement.notes },
      });
    });
  }

  /**
   * Checkout — the money path. In ONE transaction:
   *   1. score gate (blocked partners are rejected),
   *   2. stock transfer RENT-STOCK → RENT-OUT per line (no COGS),
   *   3. deposit collection (liability),
   *   4. fee invoice (rental income) via the POS invoice spine,
   *   5. units → checked_out, bookings → active, agreement → checked_out.
   */
  async checkout(id: string, dto: { depositAmount?: number; depositMethod?: string; overrideById?: string }) {
    const orgId = this.tenant.organizationId;
    const agreement = await this.get(id);
    if (agreement.status !== 'confirmed') {
      throw new BadRequestException(`Checkout requires a confirmed agreement (status: '${agreement.status}')`);
    }

    const gate = await this.score.canCheckout(agreement.partnerId);
    if (!gate.allowed) {
      if (dto.overrideById) {
        await this.approvals.recordSynchronousOverride({
          entityType: 'rental_score_hold',
          entityId: agreement.id,
          approverId: dto.overrideById,
          snapshot: { partnerId: agreement.partnerId, reason: gate.reason, score: gate.score },
        });
      } else {
        throw new BadRequestException(
          `Partner blocked from checkout (${gate.reason}, score ${gate.score}) — requires a manager override`,
        );
      }
    }

    // Compute deposit requirement from the policy.
    const depositPolicy = await this.settings.resolve<{ mode?: string; percent?: number; fixedAmount?: number }>(
      'rental.depositPolicy',
    );
    const depositAmount =
      dto.depositAmount ??
      this.computeDeposit(agreement, depositPolicy ?? { mode: 'percent', percent: 10 });

    return this.prisma.client.$transaction(async (tx: any) => {
      const fresh = await tx.rentalAgreement.findFirst({
        where: { id, organizationId: orgId },
        include: { lines: true },
      });

      // 1. Stock transfer per line (RENT-STOCK → RENT-OUT).
      for (const line of fresh.lines) {
        await this.posting.checkoutTransfer(tx, orgId, line);
      }

      // 2. Deposit ledger.
      await this.deposit.createForAgreement(id, agreement.partnerId, tx);
      if (depositAmount > 0) {
        await this.deposit.collect(
          {
            agreementId: id,
            method: dto.depositMethod ?? 'cash',
            amount: depositAmount,
            note: 'Deposit collected at checkout',
          },
          tx,
        );
      }

      // 3. Fee invoice (rental income) — one order + one invoice for the whole
      //    agreement window.
      const { orderId, invoiceId } = await this.posting.checkoutInvoice(tx, orgId, fresh);

      // 4. Status transitions.
      for (const line of fresh.lines) {
        await tx.rentalUnit.updateMany({
          where: { organizationId: orgId, id: line.unitId ?? undefined },
          data: { status: 'checked_out', rentalCount: { increment: 1 } },
        });
        await tx.rentalAgreementLine.update({
          where: { id: line.id },
          data: { checkedOutAt: new Date() },
        });
        await this.lifecycle.transition({
          defKey: 'custody.rental_unit',
          entityType: 'rental_unit',
          entityId: line.unitId ?? line.id,
          from: 'available',
          to: 'checked_out',
          action: 'checkout',
          refType: 'rental_agreement',
          refId: agreement.id,
          tx,
        });
      }
      await tx.rentalBooking.updateMany({
        where: { organizationId: orgId, sourceType: 'agreement', sourceId: id, status: 'confirmed' },
        data: { status: 'active' },
      });
      await this.lifecycle.transition({
        defKey: 'custody.rental_agreement',
        entityType: 'rental_agreement',
        entityId: agreement.id,
        from: 'confirmed',
        to: 'checked_out',
        action: 'checkout',
        refType: 'rental_agreement',
        refId: agreement.id,
        tx,
      });
      return tx.rentalAgreement.update({
        where: { id },
        data: {
          status: 'checked_out',
          orderId,
          invoiceId,
          depositId: (await tx.rentalDeposit.findFirst({ where: { agreementId: id } }))?.id ?? null,
          checkedOutAt: new Date(),
        },
      });
    });
  }

  /** Deposit required by policy. */
  private computeDeposit(agreement: any, policy: { mode?: string; percent?: number; fixedAmount?: number }): number {
    const mode = policy.mode ?? 'percent';
    if (mode === 'fixed' && policy.fixedAmount) return policy.fixedAmount;
    // percent of replacement cost (fallback 10%).
    const pct = (policy.percent ?? 10) / 100;
    const replacement = agreement.lines.reduce((s: number, l: any) => {
      // per-line product replacement cost resolved lazily below is not
      // available here; use lineTotal as the base when replacement unknown.
      return s + Number(l.lineTotal);
    }, 0);
    return Math.ceil(replacement * pct);
  }

  private async reload(tx: any, id: string) {
    return tx.rentalAgreement.findFirst({
      where: { id },
      include: {
        partner: { select: { id: true, name: true, code: true } },
        lines: { include: { product: { select: { id: true, code: true, name: true } } } },
      },
    });
  }
}
