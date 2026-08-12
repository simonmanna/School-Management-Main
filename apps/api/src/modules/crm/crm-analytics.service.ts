import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { DealStage } from '@prisma/client';

/**
 * CRM pipeline analytics (Phase A.3). All queries are org-scoped and soft-delete
 * aware via the tenancy extension (`prisma.client`). Amounts are Decimal columns
 * in the DB and are converted to plain numbers at the edge for JSON responses.
 */

/** Probability weight per open stage, used for the weighted pipeline forecast. */
const STAGE_WEIGHTS: Record<string, number> = {
  lead: 0.1,
  qualified: 0.25,
  proposal: 0.5,
  negotiation: 0.8,
};

const OPEN_STAGES: DealStage[] = ['lead', 'qualified', 'proposal', 'negotiation'];

@Injectable()
export class CrmAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /** Per-stage counts + totals for open stages, plus open and weighted pipeline value. */
  async getPipeline() {
    const rows = await this.prisma.client.deal.groupBy({
      by: ['stage'],
      where: { stage: { in: OPEN_STAGES } },
      _count: true,
      _sum: { amount: true },
    });

    const stages = OPEN_STAGES.map((stage) => {
      const row = rows.find((r) => r.stage === stage);
      return {
        stage,
        count: row?._count ?? 0,
        totalAmount: Number(row?._sum?.amount ?? 0),
        weight: STAGE_WEIGHTS[stage] ?? 0,
      };
    });

    const openPipelineValue = stages.reduce((sum, s) => sum + s.totalAmount, 0);
    const weightedValue = stages.reduce((sum, s) => sum + s.totalAmount * s.weight, 0);

    return { stages, openPipelineValue, weightedValue };
  }

  /** Won/lost counts and win rate within an optional date window (on updatedAt). */
  async getWinRate(from?: string, to?: string) {
    const where: Record<string, unknown> = { stage: { in: ['won', 'lost'] } };
    const updatedAt: Record<string, Date> = {};
    if (from) updatedAt.gte = new Date(from);
    if (to) updatedAt.lte = new Date(to);
    if (Object.keys(updatedAt).length > 0) where.updatedAt = updatedAt;

    const rows = await this.prisma.client.deal.groupBy({
      by: ['stage'],
      where,
      _count: true,
    });

    const won = rows.find((r) => r.stage === 'won')?._count ?? 0;
    const lost = rows.find((r) => r.stage === 'lost')?._count ?? 0;
    const total = won + lost;

    return { won, lost, total, rate: total > 0 ? won / total : 0 };
  }

  /** Expected-close amount bucketed by calendar month for open deals. */
  async getForecast(months = 3) {
    const limit = Math.min(12, Math.max(1, months));
    const now = new Date();
    const horizon = new Date(now.getFullYear(), now.getMonth() + limit, 1);

    const deals = await this.prisma.client.deal.findMany({
      where: {
        stage: { in: OPEN_STAGES },
        expectedClose: { not: null },
      },
      select: { amount: true, expectedClose: true },
    });

    const buckets = new Map<string, number>();
    for (let i = 0; i < limit; i++) {
      const key = `${now.getFullYear()}-${String(now.getMonth() + i + 1).padStart(2, '0')}`;
      buckets.set(key, 0);
    }

    for (const d of deals) {
      const close = d.expectedClose as Date;
      if (close < now || close >= horizon) continue;
      const key = `${close.getFullYear()}-${String(close.getMonth() + 1).padStart(2, '0')}`;
      buckets.set(key, (buckets.get(key) ?? 0) + Number(d.amount));
    }

    return [...buckets.entries()].map(([month, expectedAmount]) => ({ month, expectedAmount }));
  }

  /** Top partners by total open-deal value, with partner name/code resolved. */
  async getTopCustomers(limit = 10) {
    const take = Math.min(50, Math.max(1, limit));
    const rows = await this.prisma.client.deal.groupBy({
      by: ['partnerId'],
      where: { stage: { in: OPEN_STAGES } },
      _count: true,
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take,
    });

    const partnerIds = rows.map((r) => r.partnerId);
    const partners = partnerIds.length
      ? await this.prisma.client.partner.findMany({
          where: { id: { in: partnerIds } },
          select: { id: true, name: true, code: true },
        })
      : [];
    const byId = new Map(partners.map((p) => [p.id, p]));

    return rows.map((r) => ({
      partnerId: r.partnerId,
      name: byId.get(r.partnerId)?.name ?? 'Unknown partner',
      code: byId.get(r.partnerId)?.code ?? null,
      dealCount: r._count ?? 0,
      dealValue: Number(r._sum?.amount ?? 0),
    }));
  }

  /**
   * C1 — Partner 360: revenue context from POS documents so the CRM tab shows
   * real spend. Counts only completed (posted/paid) sales + proforma invoices;
   * the open receivable is the residual on posted, unpaid documents.
   * Org-scoped via the tenancy extension (request context, not outbox).
   */
  async getPartner360(partnerId: string) {
    const orgId = this.tenant.organizationId;
    const completed = await this.prisma.client.document.aggregate({
      where: {
        organizationId: orgId,
        partnerId,
        status: { in: ['posted', 'paid'] },
        documentType: { in: ['sales_invoice', 'proforma_invoice'] },
      },
      _count: true,
      _sum: { totalAmount: true },
      _max: { issueDate: true },
    });

    const receivable = await this.prisma.client.document.aggregate({
      where: {
        organizationId: orgId,
        partnerId,
        status: 'posted',
        paymentStatus: { in: ['not_paid', 'partial'] },
      },
      _sum: { amountResidual: true },
    });

    return {
      totalSpent: Number(completed._sum?.totalAmount ?? 0),
      orderCount: completed._count ?? 0,
      lastOrderAt: completed._max?.issueDate ?? null,
      openReceivable: Number(receivable._sum?.amountResidual ?? 0),
    };
  }
}
