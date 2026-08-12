import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';

/**
 * RentalReportsService — utilization, revenue and fleet KPI queries.
 *
 * Utilization is `(sum of active line windows) / (fleet × window)`, i.e. the
 * fraction of rentable unit-days actually on hire. Revenue splits rental /
 * late / damage / extension income from the settlement columns on the
 * agreement (invoice-level splits stay in the GL).
 */
@Injectable()
export class RentalReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  async utilization(query: { from?: string; to?: string }) {
    const orgId = this.tenant.organizationId;
    const from = query.from ? new Date(query.from) : new Date(Date.now() - 30 * 86_400_000);
    const to = query.to ? new Date(query.to) : new Date();

    const fleet = await this.prisma.client.rentalUnit.count({
      where: { organizationId: orgId, deletedAt: null },
    });
    const lines = await this.prisma.client.rentalAgreementLine.findMany({
      where: {
        organizationId: orgId,
        dueAt: { gt: from },
        agreement: {
          status: { in: ['checked_out', 'returned', 'closed'] },
          startAt: { lt: to },
        },
      },
      select: { dueAt: true, quantity: true, agreement: { select: { startAt: true } } },
    });

    let hiredDays = 0;
    for (const l of lines) {
      const s = l.agreement.startAt.getTime() > from.getTime() ? l.agreement.startAt.getTime() : from.getTime();
      const e = l.dueAt.getTime() < to.getTime() ? l.dueAt.getTime() : to.getTime();
      const days = (e - s) / 86_400_000;
      if (days > 0) hiredDays += days * Number(l.quantity);
    }
    const denominator = fleet > 0 ? (to.getTime() - from.getTime()) / 86_400_000 * fleet : 0;

    return {
      from,
      to,
      fleet,
      totalUnitDays: denominator,
      hiredUnitDays: hiredDays,
      utilization: denominator > 0 ? Math.round((hiredDays / denominator) * 1000) / 10 : 0,
    };
  }

  async revenue(query: { from?: string; to?: string }) {
    const orgId = this.tenant.organizationId;
    const from = query.from ? new Date(query.from) : new Date(Date.now() - 30 * 86_400_000);
    const to = query.to ? new Date(query.to) : new Date();

    const agreements = await this.prisma.client.rentalAgreement.findMany({
      where: {
        organizationId: orgId,
        status: 'closed',
        closedAt: { gte: from, lte: to },
      },
      select: {
        settlementTotal: true,
        lateFeeTotal: true,
        damageTotal: true,
      },
    });

    let rental = 0;
    let late = 0;
    let damage = 0;
    for (const a of agreements) {
      rental += Number(a.settlementTotal);
      late += Number(a.lateFeeTotal);
      damage += Number(a.damageTotal);
    }

    return {
      from,
      to,
      closedAgreements: agreements.length,
      rentalIncome: rental,
      lateFeeIncome: late,
      damageRecovery: damage,
      total: rental + late + damage,
    };
  }

  async fleet(query: { status?: string }) {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId, deletedAt: null, ...(query.status ? { status: query.status } : {}) };
    const groups = await this.prisma.client.rentalUnit.groupBy({
      by: ['status'],
      where: { organizationId: orgId, deletedAt: null },
      _count: { id: true },
    });
    const items = await this.prisma.client.rentalUnit.findMany({
      where,
      include: {
        product: { select: { id: true, code: true, name: true } },
        agreementLines: { where: { agreement: { status: 'checked_out' } }, select: { id: true, dueAt: true } },
      },
      orderBy: { unitCode: 'asc' },
      take: 500,
    });
    return {
      byStatus: Object.fromEntries(groups.map((g: any) => [g.status, g._count.id])),
      items,
    };
  }
}
