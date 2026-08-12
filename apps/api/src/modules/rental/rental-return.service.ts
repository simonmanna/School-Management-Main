import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { LifecycleService } from '../../kernel/lifecycle/lifecycle.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';
import { RentalPostingService } from './rental-posting.service';
import { RentalDepositService } from './rental-deposit.service';
import { RentalScoreService } from './rental-score.service';

/**
 * RentalReturnService — return → inspect → dispose → settle.
 *
 * 1. `createReturn` — the counter logs what came back (checklist: per-package
 *    component lines). Missing items are flagged; late days + late fees are
 *    computed from the line dueAt.
 * 2. `inspect` — grade + damages per line. Damaged/missing lines keep the unit
 *    OUT of the pool (damaged/repair status), clean lines move
 *    RENT-CLEAN → RENT-STOCK.
 * 3. `settle` — builds the settlement invoice: remaining rental fee, late fees,
 *    damage charges; applies deposit liability; refunds the remainder;
 *    closes the agreement; recomputes the customer score.
 */
@Injectable()
export class RentalReturnService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly lifecycle: LifecycleService,
    private readonly seq: SequenceService,
    private readonly posting: RentalPostingService,
    private readonly deposit: RentalDepositService,
    private readonly score: RentalScoreService,
  ) {}

  async list(query: { agreementId?: string; status?: string; page?: number; pageSize?: number }) {
    const orgId = this.tenant.organizationId;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where: any = { organizationId: orgId, ...(query.agreementId ? { agreementId: query.agreementId } : {}) };
    const [total, items] = await Promise.all([
      this.prisma.client.rentalReturn.count({ where }),
      this.prisma.client.rentalReturn.findMany({
        where,
        include: {
          agreement: { select: { id: true, agreementNumber: true, partnerId: true } },
          lines: { include: { damages: true } },
        },
        orderBy: { receivedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, items };
  }

  /** The full return object for a return id (with lines + damages). */
  async get(returnId: string) {
    const orgId = this.tenant.organizationId;
    const ret = await this.prisma.client.rentalReturn.findFirst({
      where: { id: returnId, organizationId: orgId },
      include: {
        agreement: { select: { id: true, agreementNumber: true, partnerId: true } },
        lines: {
          include: {
            damages: true,
          },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!ret) throw new NotFoundException('Return not found');
    return ret;
  }

  /**
   * Counter return. `items` = [{agreementLineId, quantity, quantityMissing,
   * conditionGrade?, notes?}]. Late days are computed per line against dueAt.
   */
  async createReturn(dto: {
    agreementId: string;
    notes?: string;
    items: Array<{
      agreementLineId: string;
      quantity?: number;
      quantityMissing?: number;
      conditionGrade?: string;
      notes?: string;
    }>;
  }) {
    const orgId = this.tenant.organizationId;
    if (!dto.items.length) throw new BadRequestException('At least one returned item is required');

    const agreement = await this.prisma.client.rentalAgreement.findFirst({
      where: { id: dto.agreementId, organizationId: orgId },
      include: { lines: true },
    });
    if (!agreement) throw new NotFoundException('Agreement not found');
    if (!['checked_out', 'partially_returned'].includes(agreement.status)) {
      throw new BadRequestException(`Agreement status '${agreement.status}' cannot be returned`);
    }

    return this.prisma.client.$transaction(async (tx: any) => {
      const returnNumber = await this.seq.next('rental_return', { prefix: 'RET-', padding: 5 }, tx);
      const ret = await tx.rentalReturn.create({
        data: {
          organizationId: orgId,
          agreementId: dto.agreementId,
          returnNumber,
          receivedById: this.tenant.userId ?? null,
          notes: dto.notes ?? null,
        },
      });

      const now = new Date();
      for (const item of dto.items) {
        const line = agreement.lines.find((l: any) => l.id === item.agreementLineId);
        if (!line) throw new BadRequestException(`Unknown agreement line ${item.agreementLineId}`);

        const quantityMissing = Number(item.quantityMissing ?? 0);
        const quantity = Number(item.quantity ?? 1);
        const isMissing = quantityMissing >= quantity || quantityMissing === Number(line.quantity);
        const lateDays = Math.max(0, Math.ceil((now.getTime() - new Date(line.dueAt).getTime()) / 86_400_000));
        const lateFeePerDay = Number((agreement.termsSnapshot as any)?.lateFeePerDay ?? 0);
        const lateFeeAmount = lateDays > 0 ? lateDays * lateFeePerDay * quantity : 0;

        await tx.rentalReturnLine.create({
          data: {
            organizationId: orgId,
            returnId: ret.id,
            agreementLineId: line.id,
            unitId: line.unitId ?? null,
            quantity,
            quantityMissing,
            returnedAt: isMissing ? null : now,
            conditionGrade: (item.conditionGrade as any) ?? null,
            isMissing,
            lateDays,
            lateFeeAmount,
            notes: item.notes ?? null,
          },
        });
      }

      // If the whole agreement came back, mark it returned; else partial.
      const returnedLineIds = new Set(dto.items.map((i) => i.agreementLineId));
      const allBack = agreement.lines.every((l: any) => returnedLineIds.has(l.id));
      await tx.rentalAgreement.update({
        where: { id: dto.agreementId },
        data: { status: allBack ? 'returned' : 'partially_returned' },
      });

      await this.lifecycle.transition({
        defKey: 'custody.rental_agreement',
        entityType: 'rental_agreement',
        entityId: dto.agreementId,
        from: agreement.status,
        to: allBack ? 'returned' : 'partially_returned',
        action: allBack ? 'return' : 'partial_return',
        refType: 'rental_return',
        refId: ret.id,
        tx,
      });

      return ret;
    });
  }

  /**
   * Inspection — grade each returned line, record damages, move stock.
   * `damages` = [{returnLineId, damageType, description?, chargeAmount?}].
   * Clean lines transfer RENT-CLEAN → RENT-STOCK; damaged lines go to
   * RENT-DAMAGED and their units to `repair`/`damaged`.
   */
  async inspect(dto: {
    returnId: string;
    items: Array<{
      returnLineId: string;
      conditionGrade?: string;
      notes?: string;
      damages?: Array<{ damageType: string; description?: string; chargeAmount?: number }>;
    }>;
  }) {
    const orgId = this.tenant.organizationId;
    const ret = await this.prisma.client.rentalReturn.findFirst({
      where: { id: dto.returnId, organizationId: orgId },
      include: { lines: true },
    });
    if (!ret) throw new NotFoundException('Return not found');

    return this.prisma.client.$transaction(async (tx: any) => {
      let allClean = true;
      for (const item of dto.items) {
        const line = ret.lines.find((l: any) => l.id === item.returnLineId);
        if (!line) throw new BadRequestException(`Unknown return line ${item.returnLineId}`);

        const grade = (item.conditionGrade as any) ?? line.conditionGrade ?? 'good';
        const damaged = (item.damages ?? []).length > 0;

        await tx.rentalReturnLine.update({
          where: { id: line.id },
          data: {
            conditionGrade: grade,
            inspectedById: this.tenant.userId ?? null,
            inspectedAt: new Date(),
            notes: item.notes ?? line.notes,
          },
        });

        for (const dmg of item.damages ?? []) {
          await tx.rentalDamage.create({
            data: {
              organizationId: orgId,
              returnLineId: line.id,
              damageType: dmg.damageType,
              description: dmg.description ?? null,
              chargeAmount: dmg.chargeAmount ?? 0,
            },
          });
        }

        // Stock: clean → RENT-STOCK; damaged/missing → RENT-DAMAGED.
        if (!damaged && !line.isMissing) {
          await this.posting.cleaningCompleteTransfer(
            tx,
            orgId,
            ret.agreementId,
            await this.lineProduct(tx, orgId, line.agreementLineId),
            Number(line.quantity),
          );
        } else if (damaged) {
          await this.posting.returnTransfer(tx, orgId, ret.agreementId, await this.lineProduct(tx, orgId, line.agreementLineId), Number(line.quantity), 'damaged');
        }
        if (damaged) allClean = false;

        // Unit status follows disposition.
        if (line.unitId) {
          if (damaged) {
            await tx.rentalUnit.update({ where: { id: line.unitId }, data: { status: 'damaged' } });
          } else if (!line.isMissing) {
            await tx.rentalUnit.update({ where: { id: line.unitId }, data: { status: 'available', lastInspectedAt: new Date() } });
          }
        }

        // Lifecycle events per unit.
        if (line.unitId) {
          await this.lifecycle.transition({
            defKey: 'custody.rental_unit',
            entityType: 'rental_unit',
            entityId: line.unitId,
            from: 'checked_out',
            to: damaged ? 'damaged' : 'available',
            action: damaged ? 'dispose' : 'inspect',
            metadata: { returnLineId: line.id },
            refType: 'rental_return',
            refId: ret.id,
            tx,
          });
        }
      }

      // If everything was clean, the agreement is fully returnable.
      if (allClean) {
        // no-op marker; settlement happens in `settle`.
      }
      return this.get(ret.id);
    });
  }

  /**
   * Settlement — the final money event. Computes:
   *   balance = remaining rental fee (window − already billed) +
   *             late fees + damage charges − deposit applied
   * Applies/refunds the deposit, bills the residual through the invoice
   * spine, closes the agreement, recomputes the score.
   */
  async settle(dto: {
    returnId: string;
    depositApplied?: number;
    paymentMode?: 'cash' | 'card' | 'mobile_money' | 'mixed' | 'credit';
    tenders?: Array<{ method: string; amount: number; reference?: string }>;
    waiveDamageIds?: string[];
  }) {
    const orgId = this.tenant.organizationId;
    const ret = await this.prisma.client.rentalReturn.findFirst({
      where: { id: dto.returnId, organizationId: orgId },
      include: { lines: { include: { damages: true } } },
    });
    if (!ret) throw new NotFoundException('Return not found');

    const agreement = await this.prisma.client.rentalAgreement.findFirst({
      where: { id: ret.agreementId, organizationId: orgId },
      include: { lines: true },
    });
    if (!agreement) throw new NotFoundException('Agreement not found');
    if (!['returned', 'partially_returned'].includes(agreement.status)) {
      throw new BadRequestException(`Agreement status '${agreement.status}' cannot be settled`);
    }

    return this.prisma.client.$transaction(async (tx: any) => {
      // 1. Compute charges.
      let lateFeeTotal = 0;
      let damageTotal = 0;
      const waiveSet = new Set(dto.waiveDamageIds ?? []);
      for (const line of ret.lines) {
        lateFeeTotal += Number(line.lateFeeAmount ?? 0);
        for (const dmg of line.damages) {
          if (!waiveSet.has(dmg.id)) damageTotal += Number(dmg.chargeAmount ?? 0);
        }
      }
      // Remaining rental: line totals for lines still due (extended windows etc.)
      // — already billed at checkout; settle bills only late + damage here.
      const settlementTotal = lateFeeTotal + damageTotal;

      // 2. Apply deposit (liability → receivable) then refund the remainder.
      const depositAvailable = await this.depositAvailable(tx, orgId, ret.agreementId);
      const apply = Math.min(depositAvailable, settlementTotal, dto.depositApplied ?? depositAvailable);
      if (apply > 0) {
        await this.deposit.apply({ agreementId: ret.agreementId, amount: apply, note: `Settlement of ${ret.returnNumber}` }, tx);
      }

      // 3. Bill the residual (what the deposit didn't cover).
      if (settlementTotal - apply > 0) {
        await this.posting.createFeeInvoice(
          tx,
          orgId,
          {
            agreementId: ret.agreementId,
            partnerId: agreement.partnerId,
            branchId: agreement.branchId ?? undefined,
            feeType: settlementTotal === lateFeeTotal ? 'late' : 'damage',
            lines: [
              ...(lateFeeTotal > 0
                ? [{
                    productId: (await tx.product.findFirst({ where: { organizationId: orgId, code: 'RENT-LATE' } }))?.id ?? agreement.lines[0].productId,
                    description: `Late fees — ${ret.returnNumber}`,
                    quantity: 1,
                    unitPrice: lateFeeTotal,
                    rentalFeeType: 'late' as const,
                  }]
                : []),
              ...(damageTotal > 0
                ? [{
                    productId: (await tx.product.findFirst({ where: { organizationId: orgId, code: 'RENT-DAMAGE' } }))?.id ?? agreement.lines[0].productId,
                    description: `Damage charges — ${ret.returnNumber}`,
                    quantity: 1,
                    unitPrice: damageTotal,
                    rentalFeeType: 'damage' as const,
                  }]
                : []),
            ],
            paymentMode: dto.paymentMode ?? 'cash',
            tenders: dto.tenders,
          },
        );
      }

      // 4. Refund leftover deposit.
      const afterApply = await this.depositAvailable(tx, orgId, ret.agreementId);
      if (afterApply > 0) {
        await this.deposit.refund(
          { agreementId: ret.agreementId, method: 'cash', amount: afterApply, note: `Deposit refund after ${ret.returnNumber}` },
          tx,
        );
      }

      // 5. Close the agreement.
      await tx.rentalAgreement.update({
        where: { id: ret.agreementId },
        data: { status: 'closed', closedAt: new Date(), settlementTotal, lateFeeTotal, damageTotal, depositApplied: apply },
      });
      await this.lifecycle.transition({
        defKey: 'custody.rental_agreement',
        entityType: 'rental_agreement',
        entityId: ret.agreementId,
        from: agreement.status,
        to: 'closed',
        action: 'settle',
        refType: 'rental_return',
        refId: ret.id,
        tx,
      });
      // Release all remaining bookings.
      await tx.rentalBooking.updateMany({
        where: { organizationId: orgId, sourceType: 'agreement', sourceId: ret.agreementId, status: { in: ['held', 'confirmed', 'active'] } },
        data: { status: 'completed' },
      });

      // 6. Recompute the customer score.
      await this.score.recompute(agreement.partnerId, tx);

      return this.get(ret.id);
    });
  }

  /** Damage waive (requires rental:waive permission at the controller). */
  async waiveDamage(damageId: string, reason: string) {
    const orgId = this.tenant.organizationId;
    const dmg = await this.prisma.client.rentalDamage.findFirst({
      where: { id: damageId, organizationId: orgId },
    });
    if (!dmg) throw new NotFoundException('Damage record not found');
    return this.prisma.client.rentalDamage.update({
      where: { id: damageId },
      data: { waivedById: this.tenant.userId ?? null, waiveReason: reason ?? null },
    });
  }

  private async depositAvailable(tx: any, orgId: string, agreementId: string): Promise<number> {
    const deposit = await tx.rentalDeposit.findFirst({ where: { organizationId: orgId, agreementId } });
    if (!deposit) return 0;
    return Number(deposit.totalCollected) - Number(deposit.totalApplied) - Number(deposit.totalRefunded) - Number(deposit.totalForfeited);
  }

  private async lineProduct(tx: any, orgId: string, agreementLineId: string): Promise<string> {
    const line = await tx.rentalAgreementLine.findFirst({ where: { id: agreementLineId, organizationId: orgId } });
    if (!line) throw new BadRequestException(`Unknown agreement line ${agreementLineId}`);
    return line.productId;
  }
}
