import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dec, ZERO } from '../../../kernel/common/money';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { AuditService } from '../../../kernel/audit/audit.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface OpenSessionDto {
  cashRegisterId: string;
  openingFloat?: number | string;
  notes?: string;
}

export interface CloseSessionDto {
  closingCounted: number | string;
  notes?: string;
}

export interface RecordMovementDto {
  movementType: 'pay_in' | 'pay_out' | 'adjustment';
  amount: number | string;
  reason?: string;
}

/**
 * CashSessionService — opens / closes a cashier shift and records every
 * in/out during the shift. M5 foundation for POS and School canteen.
 *
 * Each open session knows its cash register, its opening float, the user
 * (cashier) running it. Cash movements link to Payment rows for sales /
 * refunds so the session reconciles with the ledger at close.
 */
@Injectable()
export class CashSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
  ) {}

  /** Open a new session. Fails if there is already an open session for this register. */
  async open(dto: OpenSessionDto) {
    const organizationId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    if (!userId) throw new BadRequestException('No user in tenant context');

    return this.prisma.client.$transaction(async (tx: any) => {
      const register = await tx.cashRegister.findFirst({ where: { id: dto.cashRegisterId, organizationId } });
      if (!register) throw new NotFoundException('Cash register not found');

      const existing = await tx.cashSession.findFirst({
        where: { organizationId, cashRegisterId: dto.cashRegisterId, status: 'open' },
      });
      if (existing) {
        throw new BadRequestException(`A session is already open on register ${register.code}`);
      }

      const session = await tx.cashSession.create({
        data: {
          organizationId,
          cashRegisterId: dto.cashRegisterId,
          userId,
          status: 'open',
          openingFloat: dec(dto.openingFloat ?? 0),
          notes: dto.notes ?? null,
        },
      });

      await this.audit.recordInTx(tx, {
        entity: 'CashSession',
        entityId: session.id,
        action: 'create',
        newValues: { cashRegisterId: session.cashRegisterId, openingFloat: session.openingFloat.toString() },
      });

      this.events.publish('cash.session.opened', {
        organizationId,
        sessionId: session.id,
        cashRegisterId: dto.cashRegisterId,
      });

      return session;
    });
  }

  /** Close the current open session. Computes expected vs counted. */
  async close(dto: CloseSessionDto) {
    const organizationId = this.tenant.organizationId;
    const counted = dec(dto.closingCounted);

    return this.prisma.client.$transaction(async (tx: any) => {
      const session = await this.requireOpenSession(tx);
      const expected = await this.computeExpected(tx, session);

      const closingDifference = counted.minus(expected);

      const updated = await tx.cashSession.updateMany({
        where: { id: session.id },
        data: {
          status: 'closed',
          closedAt: new Date(),
          closingCounted: counted,
          closingExpected: expected,
          closingDifference,
          notes: dto.notes ?? session.notes,
        },
      });
      if (updated.count === 0) throw new Error('Failed to close session');

      await this.audit.recordInTx(tx, {
        entity: 'CashSession',
        entityId: session.id,
        action: 'update',
        oldValues: { status: 'open' },
        newValues: { status: 'closed', closingDifference: closingDifference.toString() },
      });

      this.events.publish('cash.session.closed', {
        organizationId,
        sessionId: session.id,
        expected: expected.toString(),
        counted: counted.toString(),
        variance: closingDifference.toString(),
      });

      return tx.cashSession.findFirst({ where: { id: session.id } });
    });
  }

  /** Record a manual movement (pay-in, pay-out, adjustment). */
  async recordMovement(sessionId: string | undefined, dto: RecordMovementDto) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const session = sessionId
        ? await tx.cashSession.findFirst({ where: { id: sessionId, organizationId } })
        : await tx.cashSession.findFirst({ where: { organizationId, status: 'open' } });
      if (!session) throw new NotFoundException('No open cash session');
      if (session.status !== 'open') throw new BadRequestException('Session is not open');

      const movement = await tx.cashMovement.create({
        data: {
          organizationId,
          cashSessionId: session.id,
          movementType: dto.movementType,
          amount: dec(dto.amount),
          reason: dto.reason ?? null,
          performedBy: this.tenant.userId ?? null,
        },
      });

      await this.audit.recordInTx(tx, {
        entity: 'CashMovement',
        entityId: movement.id,
        action: 'create',
        newValues: { cashSessionId: session.id, movementType: dto.movementType, amount: dec(dto.amount).toString() },
      });

      this.events.publish('cash.movement.recorded', {
        organizationId,
        sessionId: session.id,
        movementId: movement.id,
        movementType: dto.movementType,
        amount: dec(dto.amount).toString(),
      });

      return movement;
    });
  }

  /** Record a sale or refund against an open session (called from PaymentService). */
  async recordSaleOrRefund(
    tx: any,
    sessionId: string,
    paymentId: string,
    movementType: 'sale' | 'refund',
    amount: Prisma.Decimal,
  ) {
    return tx.cashMovement.create({
      data: {
        organizationId: this.tenant.organizationId,
        cashSessionId: sessionId,
        movementType,
        amount,
        paymentId,
        performedBy: this.tenant.userId ?? null,
      },
    });
  }

  /** Get the open session for the current user/cash register (or null). */
  async findOpen(cashRegisterId?: string) {
    const where: any = { organizationId: this.tenant.organizationId, status: 'open' };
    if (cashRegisterId) where.cashRegisterId = cashRegisterId;
    return this.prisma.client.cashSession.findFirst({
      where,
      include: { cashRegister: true, movements: { orderBy: { createdAt: 'asc' } } },
    });
  }

  /** Read-only expected cash = opening + sales + pay-ins − pay-outs − refunds. */
  async expectedCash(sessionId: string): Promise<Prisma.Decimal> {
    return this.prisma.client.$transaction(async (tx: any) => {
      const session = await tx.cashSession.findFirst({ where: { id: sessionId } });
      if (!session) throw new NotFoundException('Cash session not found');
      return this.computeExpected(tx, session);
    });
  }

  // ─── helpers ────────────────────────────────────────────────────────────
  private async requireOpenSession(tx: any) {
    const session = await tx.cashSession.findFirst({
      where: { organizationId: this.tenant.organizationId, status: 'open' },
    });
    if (!session) throw new NotFoundException('No open cash session');
    return session;
  }

  /**
   * expected = opening + Σ(sales) + Σ(pay_in) − Σ(pay_out) − Σ(refunds)
   * For sales, sign follows direction: sales are +amount, refunds are −amount.
   */
  private async computeExpected(tx: any, session: any): Promise<Prisma.Decimal> {
    const movements = await tx.cashMovement.findMany({ where: { cashSessionId: session.id } });
    let total = dec(session.openingFloat);
    for (const m of movements) {
      const amt = dec(m.amount);
      switch (m.movementType) {
        case 'sale':
        case 'pay_in':
          total = total.plus(amt);
          break;
        case 'refund':
        case 'pay_out':
          total = total.minus(amt);
          break;
        case 'adjustment':
          // Adjustments are signed: positive = adds cash, negative = removes.
          total = total.plus(amt);
          break;
      }
    }
    return total;
  }
}