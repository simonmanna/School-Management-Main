import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { DocumentBuilderService } from '../../invoicing/document/document-builder.service';
import { PostingService } from '../../accounting/posting/posting.service';
import { dec, round } from '../../../kernel/common/money';
import { EVENTS } from '@erp/shared';
import type { CreateFeePlanDto, CreateFeePlanRateDto, GenerateChargesDto } from './dto.types';

@Injectable()
export class TransportBillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly documentBuilder: DocumentBuilderService,
    private readonly posting: PostingService,
  ) {}

  private get orgId() {
    return this.tenant.organizationId;
  }

  // ── Fee plans ──
  async listFeePlans() {
    return this.prisma.client.transportFeePlan.findMany({
      where: { organizationId: this.orgId },
      include: { rates: true },
    });
  }
  async createFeePlan(dto: CreateFeePlanDto) {
    return this.prisma.client.transportFeePlan.create({
      data: {
        organizationId: this.orgId,
        name: dto.name,
        campusId: dto.campusId ?? null,
        academicYearId: dto.academicYearId ?? null,
        basis: dto.basis as any,
        period: dto.period as any,
        baseAmount: dec(dto.baseAmount),
        oneWayFactor: dec(dto.oneWayFactor ?? 0.6),
        ratePerKm: dto.ratePerKm != null ? dec(dto.ratePerKm) : null,
        feeProductId: dto.feeProductId ?? null,
        isActive: dto.isActive ?? true,
      },
    });
  }
  async addRate(planId: string, dto: CreateFeePlanRateDto) {
    return this.prisma.client.transportFeePlanRate.create({
      data: {
        organizationId: this.orgId,
        feePlanId: planId,
        zoneId: dto.zoneId ?? null,
        routeId: dto.routeId ?? null,
        stopId: dto.stopId ?? null,
        amount: dec(dto.amount),
      },
    });
  }

  /**
   * Generate transport charges for a term. For each active assignment, compute
   * the gross amount from the applicable fee plan (prorated for mid-period
   * start/end), raise a TransportCharge (pending), then build + post ONE AR
   * invoice (Document sourceType='school_transport') and mark the charge
   * invoiced — all inside one $transaction (atomic like meal-billing).
   * Idempotent by (org, assignmentId, periodStart, periodEnd).
   */
  async generateForPeriod(dto: GenerateChargesDto) {
    const orgId = this.orgId;
    const term = await this.prisma.client.term.findFirst({ where: { id: dto.termId, organizationId: orgId } });
    if (!term) throw new BadRequestException(`Term ${dto.termId} not found`);

    const periodStart = dto.periodStart ? new Date(dto.periodStart) : new Date(term.startDate);
    const periodEnd = dto.periodEnd ? new Date(dto.periodEnd) : new Date(term.endDate);

    const assignments = await this.prisma.client.studentTransportAssignment.findMany({
      where: { organizationId: orgId, termId: dto.termId, status: 'active' },
      include: { student: { include: { partner: true } }, route: true, pickupStop: true, dropoffStop: true },
    });

    const created: any[] = [];
    const skipped: any[] = [];

    for (const a of assignments) {
      const plan = await this.resolvePlan(a);
      if (!plan || !plan.feeProductId) {
        skipped.push({ assignmentId: a.id, reason: 'no_fee_plan' });
        continue;
      }
      const partnerId = a.student?.partnerId;
      if (!partnerId) {
        skipped.push({ assignmentId: a.id, reason: 'no_partner' });
        continue;
      }
      const gross = await this.computeAmount(plan, a, periodStart, periodEnd, term);

      const reference = `TRANSPORT-${a.termId}`;
      const sourceId = `charge:${a.id}`;

      try {
        const doc = await this.prisma.client.$transaction(async (tx: Prisma.TransactionClient) => {
          const existingCharge = await tx.transportCharge.findFirst({
            where: { organizationId: orgId, assignmentId: a.id, periodStart, periodEnd },
          });
          if (existingCharge) return { _skipped: true, id: existingCharge.id };

          const charge = await tx.transportCharge.create({
            data: {
              organizationId: orgId,
              assignmentId: a.id,
              periodStart,
              periodEnd,
              grossAmount: gross,
              discountAmount: dec(0),
              netAmount: gross,
              status: 'pending',
              prorated: gross.lt(await this.fullAmount(plan, a)),
            },
          });

          const createdDoc = await this.documentBuilder.createDocument(
            tx,
            'sales_invoice',
            {
              partnerId,
              issueDate: new Date().toISOString(),
              reference,
              notes: `Transport · ${a.route?.name ?? 'route'} · ${a.student ? a.student.id : ''}`,
              sourceType: 'school_transport',
            },
            [{ productId: plan.feeProductId!, description: `Transport · ${a.route?.name ?? ''}`, quantity: 1, unitPrice: Number(gross) }],
          );
          await tx.document.update({ where: { id: createdDoc.id }, data: { sourceId } });

          const full = await tx.document.findFirst({ where: { id: createdDoc.id }, include: { lines: true, partner: true } });
          const journalLines = await this.documentBuilder.salesPostingLines(tx, full!, {
            receivable: `Transport invoice ${full!.documentNumber}`,
            revenue: 'Transport revenue',
          });

          const entry = await this.posting.post(
            {
              journalCode: 'SALES',
              date: new Date(),
              description: `School transport · ${full!.documentNumber}`,
              sourceType: 'school_transport_invoice',
              sourceId: full!.id,
              postingKey: `school_transport:${full!.id}`,
              lines: journalLines,
            },
            tx,
          );

          await tx.document.update({
            where: { id: full!.id },
            data: {
              amountResidual: full!.totalAmount,
              amountPaid: 0,
              paymentStatus: 'not_paid',
              status: 'posted',
              journalEntryId: entry.id,
              postedAt: new Date(),
            },
          });
          await tx.transportCharge.update({ where: { id: charge.id }, data: { status: 'invoiced', documentId: full!.id } });
          return full!;
        });

        if ((doc as any)._skipped) {
          skipped.push({ assignmentId: a.id, reason: 'already_billed' });
          continue;
        }
        created.push(doc);
        this.events.publish('school.transport.charge.posted' as any, {
          organizationId: orgId,
          chargeId: (doc as any).id,
          documentId: (doc as any).id,
          studentProfileId: a.studentProfileId,
          amount: (doc as any).totalAmount?.toString() ?? gross.toString(),
        } as any);
      } catch (err: any) {
        if (err?.code === 'P2002') {
          skipped.push({ assignmentId: a.id, reason: 'already_billed' });
          continue;
        }
        throw err;
      }
    }
    return { count: created.length, documents: created, skipped };
  }

  private async resolvePlan(a: any) {
    const plan = await this.prisma.client.transportFeePlan.findFirst({
      where: { organizationId: this.orgId, isActive: true },
      orderBy: { baseAmount: 'asc' },
      include: { rates: true },
    });
    return plan;
  }

  private async fullAmount(plan: any, a: any): Promise<any> {
    if (plan.basis === 'flat') return dec(plan.baseAmount);
    if (plan.basis === 'zone' && a.pickupStop?.zoneId) {
      const rate = plan.rates.find((r: any) => r.zoneId === a.pickupStop.zoneId);
      if (rate) return dec(rate.amount);
    }
    if (plan.basis === 'route') {
      const rate = plan.rates.find((r: any) => r.routeId === a.routeId);
      if (rate) return dec(rate.amount);
    }
    if (plan.basis === 'stop') {
      const rate = plan.rates.find((r: any) => r.stopId === a.pickupStopId);
      if (rate) return dec(rate.amount);
    }
    if (plan.basis === 'distance' && plan.ratePerKm && a.route?.distanceKm) {
      return dec(Number(plan.ratePerKm) * Number(a.route.distanceKm));
    }
    return dec(plan.baseAmount);
  }

  private async computeAmount(plan: any, a: any, periodStart: Date, periodEnd: Date, term: any) {
    const full = await this.fullAmount(plan, a);
    // Proration: only the days the assignment is active within the period.
    const start = a.startDate > periodStart ? new Date(a.startDate) : periodStart;
    const end = a.endDate && new Date(a.endDate) < periodEnd ? new Date(a.endDate) : periodEnd;
    const termDays = Math.max(1, (new Date(term.endDate).getTime() - new Date(term.startDate).getTime()) / 86400000);
    const activeDays = Math.max(0, (end.getTime() - start.getTime()) / 86400000);
    if (activeDays >= termDays) return full;
    const factor = round((activeDays / termDays) as any, 6);
    return dec(Number(full) * Number(factor));
  }
}
