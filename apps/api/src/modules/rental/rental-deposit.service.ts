import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { LifecycleService } from '../../kernel/lifecycle/lifecycle.service';
import { RentalDepositMoveType, RentalDepositStatus } from '@prisma/client';

/**
 * RentalDepositService — the deposit is a LIABILITY, not revenue.
 *
 * Money path: collection credits `customer_deposit` (a current liability),
 * refund debits it. Applying to damages/late fees transfers from the liability
 * to the fee invoice's receivable — never books revenue at collection.
 *
 * Movements are append-only; a refund can target a specific collection when
 * tenders differ (the customer paid part cash, part card — refund each).
 */
@Injectable()
export class RentalDepositService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly lifecycle: LifecycleService,
  ) {}

  async getByAgreement(agreementId: string) {
    const orgId = this.tenant.organizationId;
    const deposit = await this.prisma.client.rentalDeposit.findFirst({
      where: { agreementId, organizationId: orgId },
      include: { movements: { orderBy: { createdAt: 'asc' } } },
    });
    if (!deposit) throw new NotFoundException('No deposit for this agreement');
    return deposit;
  }

  /** Create the deposit ledger for an agreement (called at checkout). */
  async createForAgreement(agreementId: string, partnerId: string, tx: any) {
    const orgId = this.tenant.organizationId;
    return tx.rentalDeposit.create({
      data: { organizationId: orgId, agreementId, partnerId, status: 'held' },
    });
  }

  /**
   * Record a collection. `method` mirrors the payment method (cash/card/qr…).
   * A `paymentId` link is optional (the POS payment path records the tender;
   * this service is also usable standalone). Pass `tx` when called inside a
   * larger transaction (checkout) — the deposit row is FOR UPDATE locked.
   */
  async collect(dto: { agreementId: string; method: string; amount: number; paymentId?: string; note?: string }, tx?: any) {
    const orgId = this.tenant.organizationId;
    const amount = Number(dto.amount);
    if (!(amount > 0)) throw new BadRequestException('Deposit amount must be positive');

    const run = async (db: any) => {
      const deposit = await this.lockDeposit(db, orgId, dto.agreementId);
      await db.rentalDepositMovement.create({
        data: {
          organizationId: orgId,
          depositId: deposit.id,
          type: 'collected',
          method: dto.method,
          amount,
          paymentId: dto.paymentId ?? null,
          note: dto.note ?? null,
        },
      });
      return db.rentalDeposit.update({
        where: { id: deposit.id },
        data: {
          totalCollected: deposit.totalCollected.plus(amount),
          status: this.deriveStatus(deposit, amount, 0, 0, 0),
        },
      });
    };
    return tx ? run(tx) : this.prisma.client.$transaction((t: any) => run(t));
  }

  /** Apply deposit money to an invoice (settlement): liability → receivable. */
  async apply(dto: { agreementId: string; amount: number; invoiceId?: string; note?: string }, tx?: any) {
    const orgId = this.tenant.organizationId;
    const amount = Number(dto.amount);
    if (!(amount > 0)) throw new BadRequestException('Amount must be positive');

    const run = async (db: any) => {
      const deposit = await this.lockDeposit(db, orgId, dto.agreementId);
      const available = Number(deposit.totalCollected) - Number(deposit.totalApplied) - Number(deposit.totalRefunded) - Number(deposit.totalForfeited);
      if (amount > available) {
        throw new BadRequestException(
          `Cannot apply ${amount}: only ${available} deposit is still available`,
        );
      }
      await db.rentalDepositMovement.create({
        data: {
          organizationId: orgId,
          depositId: deposit.id,
          type: 'applied',
          method: 'applied',
          amount,
          paymentId: null,
          note: dto.note ?? null,
        },
      });
      return db.rentalDeposit.update({
        where: { id: deposit.id },
        data: {
          totalApplied: deposit.totalApplied.plus(amount),
          status: this.deriveStatus(deposit, 0, amount, 0, 0),
        },
      });
    };
    return tx ? run(tx) : this.prisma.client.$transaction((t: any) => run(t));
  }

  /** Refund deposit money back to the customer. */
  async refund(dto: { agreementId: string; method: string; amount: number; paymentId?: string; note?: string }, tx?: any) {
    const orgId = this.tenant.organizationId;
    const amount = Number(dto.amount);
    if (!(amount > 0)) throw new BadRequestException('Amount must be positive');

    const run = async (db: any) => {
      const deposit = await this.lockDeposit(db, orgId, dto.agreementId);
      const available = Number(deposit.totalCollected) - Number(deposit.totalApplied) - Number(deposit.totalRefunded) - Number(deposit.totalForfeited);
      if (amount > available) {
        throw new BadRequestException(`Cannot refund ${amount}: only ${available} deposit is available`);
      }
      await db.rentalDepositMovement.create({
        data: {
          organizationId: orgId,
          depositId: deposit.id,
          type: 'refunded',
          method: dto.method,
          amount,
          paymentId: dto.paymentId ?? null,
          note: dto.note ?? null,
        },
      });
      return db.rentalDeposit.update({
        where: { id: deposit.id },
        data: {
          totalRefunded: deposit.totalRefunded.plus(amount),
          status: this.deriveStatus(deposit, 0, 0, amount, 0),
        },
      });
    };
    return tx ? run(tx) : this.prisma.client.$transaction((t: any) => run(t));
  }

  /** Forfeit deposit money (unreturned damage over deposit, no-show, etc.). */
  async forfeit(dto: { agreementId: string; amount: number; note?: string }, tx?: any) {
    const orgId = this.tenant.organizationId;
    const amount = Number(dto.amount);
    if (!(amount > 0)) throw new BadRequestException('Amount must be positive');

    const run = async (db: any) => {
      const deposit = await this.lockDeposit(db, orgId, dto.agreementId);
      const available = Number(deposit.totalCollected) - Number(deposit.totalApplied) - Number(deposit.totalRefunded) - Number(deposit.totalForfeited);
      if (amount > available) {
        throw new BadRequestException(`Cannot forfeit ${amount}: only ${available} deposit is available`);
      }
      await db.rentalDepositMovement.create({
        data: {
          organizationId: orgId,
          depositId: deposit.id,
          type: 'forfeited',
          method: 'forfeited',
          amount,
          note: dto.note ?? null,
        },
      });
      return db.rentalDeposit.update({
        where: { id: deposit.id },
        data: {
          totalForfeited: deposit.totalForfeited.plus(amount),
          status: this.deriveStatus(deposit, 0, 0, 0, amount),
        },
      });
    };
    return tx ? run(tx) : this.prisma.client.$transaction((t: any) => run(t));
  }

  /** Lock the deposit row for the agreement (concurrent settlement guard). */
  private async lockDeposit(tx: any, orgId: string, agreementId: string) {
    const rows = (await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "RentalDeposit"
      WHERE "organizationId" = ${orgId} AND "agreementId" = ${agreementId}
      FOR UPDATE
    `) as Array<{ id: string }>;
    const id = rows[0]?.id;
    if (!id) throw new NotFoundException('No deposit for this agreement');
    return tx.rentalDeposit.findUnique({ where: { id } });
  }

  private deriveStatus(deposit: any, addCollected: number, addApplied: number, addRefunded: number, addForfeited: number): RentalDepositStatus {
    const collected = Number(deposit.totalCollected) + addCollected;
    const applied = Number(deposit.totalApplied) + addApplied;
    const refunded = Number(deposit.totalRefunded) + addRefunded;
    const forfeited = Number(deposit.totalForfeited) + addForfeited;
    if (collected === 0) return 'held';
    const consumed = applied + refunded + forfeited;
    if (consumed >= collected) {
      if (refunded > 0 && applied === 0 && forfeited === 0) return 'refunded';
      if (forfeited > 0 && applied === 0 && refunded === 0) return 'forfeited';
      return 'applied';
    }
    return 'partially_applied';
  }
}
