import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';

/**
 * RepairReportsService — dashboard KPIs and operational reports for the RMMS
 * vertical. All queries are org-scoped; date filters default to all-time but
 * accept from/to for the reports page.
 */
@Injectable()
export class RepairReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  private dateRange(from?: string, to?: string): { gte?: Date; lte?: Date } {
    const range: { gte?: Date; lte?: Date } = {};
    if (from) range.gte = new Date(from);
    if (to) {
      const d = new Date(to);
      d.setHours(23, 59, 59, 999);
      range.lte = d;
    }
    return range;
  }

  async dashboard() {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId, status: { not: 'cancelled' } };
    const [openOrders, inWorkshop, readyPickup, awaitingApproval, completed30, revenue30, labourTypes, technicians] =
      await Promise.all([
        this.prisma.client.repairOrder.count({ where: { ...where, status: { in: ['received', 'diagnosis', 'waiting_approval', 'approved'] } } }),
        this.prisma.client.repairOrder.count({ where: { ...where, status: { in: ['repairing', 'testing'] } } }),
        this.prisma.client.repairOrder.count({ where: { ...where, status: 'ready_pickup' } }),
        this.prisma.client.repairOrder.count({ where: { ...where, status: 'waiting_approval' } }),
        this.prisma.client.repairOrder.count({
          where: { ...where, status: 'closed', closedAt: { gte: new Date(Date.now() - 30 * 864e5) } },
        }),
        this.prisma.client.repairOrder.aggregate({
          where: { ...where, status: 'closed', closedAt: { gte: new Date(Date.now() - 30 * 864e5) } },
          _sum: { totalAmount: true },
        }),
        this.prisma.client.repairLabourType.count({ where: { organizationId: orgId, deletedAt: null } }),
        this.prisma.client.repairTechnician.count({ where: { organizationId: orgId, deletedAt: null } }),
      ]);
    const byStatus = await this.prisma.client.repairOrder.groupBy({
      by: ['status'],
      where: { organizationId: orgId },
      _count: { _all: true },
    });
    return {
      openOrders,
      inWorkshop,
      readyPickup,
      awaitingApproval,
      completed30,
      revenue30: Number(revenue30._sum.totalAmount ?? 0),
      labourTypes,
      technicians,
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
    };
  }

  /** Revenue by month (closed orders). */
  async revenueByMonth(from?: string, to?: string) {
    const orgId = this.tenant.organizationId;
    const rows = await this.prisma.client.repairOrder.findMany({
      where: { organizationId: orgId, status: 'closed', closedAt: this.dateRange(from, to) },
      select: { totalAmount: true, closedAt: true },
    });
    const buckets = new Map<string, number>();
    for (const r of rows) {
      const key = r.closedAt ? r.closedAt.toISOString().slice(0, 7) : 'unknown';
      buckets.set(key, (buckets.get(key) ?? 0) + Number(r.totalAmount ?? 0));
    }
    return Array.from(buckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, revenue]) => ({ month, revenue }));
  }

  /** Open jobs by technician — the workshop load board. */
  async technicianLoad() {
    const orgId = this.tenant.organizationId;
    const jobs = await this.prisma.client.repairJob.findMany({
      where: { organizationId: orgId, status: { in: ['pending', 'in_progress', 'testing'] } },
      select: { technicianId: true, status: true, priority: true },
    });
    const technicians = await this.prisma.client.repairTechnician.findMany({
      where: { organizationId: orgId, deletedAt: null },
      select: { id: true, name: true, availability: true },
    });
    const byTech = new Map<string, any>();
    for (const t of technicians) byTech.set(t.id, { id: t.id, name: t.name, availability: t.availability, pending: 0, in_progress: 0, testing: 0 });
    for (const j of jobs) {
      const row = byTech.get(j.technicianId ?? '');
      if (!row) continue;
      row[j.status] += 1;
    }
    return Array.from(byTech.values());
  }

  /** Warranty health: active vs expired vs claimed. */
  async warrantyHealth() {
    const orgId = this.tenant.organizationId;
    const rows = await this.prisma.client.repairWarranty.groupBy({
      by: ['status'],
      where: { organizationId: orgId },
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  }

  /** Contract portfolio: active contracts and upcoming preventive runs. */
  async contractsOverview() {
    const orgId = this.tenant.organizationId;
    const [active, upcoming, expiring] = await Promise.all([
      this.prisma.client.repairServiceContract.count({ where: { organizationId: orgId, status: 'active', deletedAt: null } }),
      this.prisma.client.repairSchedule.count({
        where: { organizationId: orgId, status: 'active', nextDueAt: { lte: new Date(Date.now() + 30 * 864e5) }, deletedAt: null },
      }),
      this.prisma.client.repairServiceContract.count({
        where: { organizationId: orgId, status: 'active', endDate: { lte: new Date(Date.now() + 30 * 864e5) }, deletedAt: null },
      }),
    ]);
    return { active, upcomingRuns: upcoming, expiringSoon: expiring };
  }

  /** Full operational report: counts + revenue + labour + parts + warranty. */
  async operationalReport(from?: string, to?: string) {
    const orgId = this.tenant.organizationId;
    const range = this.dateRange(from, to);
    const [orders, byType, labourTotal, partsTotal, jobs, partsUsed] = await Promise.all([
      this.prisma.client.repairOrder.findMany({
        where: { organizationId: orgId, createdAt: range },
        select: { status: true, orderType: true, totalAmount: true, labourTotal: true, partsTotal: true, createdAt: true },
      }),
      this.prisma.client.repairOrder.groupBy({
        by: ['orderType'],
        where: { organizationId: orgId, createdAt: range },
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      this.prisma.client.repairOrder.aggregate({
        where: { organizationId: orgId, createdAt: range },
        _sum: { labourTotal: true },
      }),
      this.prisma.client.repairOrder.aggregate({
        where: { organizationId: orgId, createdAt: range },
        _sum: { partsTotal: true },
      }),
      this.prisma.client.repairJob.count({ where: { organizationId: orgId, createdAt: range } }),
      this.prisma.client.repairPart.aggregate({
        where: { organizationId: orgId, status: 'issued', issuedAt: range },
        _sum: { quantity: true, totalCost: true },
      }),
    ]);
    return {
      totalOrders: orders.length,
      closedOrders: orders.filter((o) => o.status === 'closed').length,
      cancelledOrders: orders.filter((o) => o.status === 'cancelled').length,
      revenue: orders.filter((o) => o.status === 'closed').reduce((s, o) => s + Number(o.totalAmount ?? 0), 0),
      labourTotal: Number(labourTotal._sum.labourTotal ?? 0),
      partsTotal: Number(partsTotal._sum.partsTotal ?? 0),
      jobs,
      partsUsedQty: Number(partsUsed._sum.quantity ?? 0),
      partsCost: Number(partsUsed._sum.totalCost ?? 0),
      byType: byType.map((r) => ({ type: r.orderType, count: r._count._all, revenue: Number(r._sum.totalAmount ?? 0) })),
    };
  }
}
