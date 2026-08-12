/**
 * POS Phase T1 — Table / Reservation reports (ADR-012).
 *
 *   /pos/reports/tables/utilization  — occupancy % by hour/day
 *   /pos/reports/tables/revenue      — revenue per table / per zone / top performers
 *   /pos/reports/reservations        — daily counts + no-show rate
 *
 * All queries go through `Document.tableId` (the denormalised cache) so they
 * stay cheap at scale. PosTableOrder is used only for open-dining-time
 * metrics (average dining time).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';

@Injectable()
export class PosTableReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /**
   * Utilization by hour for a given date. Returns occupancy % for each of
   * the 24 hours by counting tables whose status was OCCUPIED or RESERVED
   * during that hour.
   */
  async utilization(dateStr: string) {
    const organizationId = this.tenant.organizationId;
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('Invalid date');
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    // Total active tables (denominator).
    const totalActive = await this.prisma.client.posTable.count({
      where: { organizationId, active: true },
    });

    // For each PosTableOrder that was open during the day, count the
    // distinct hours it was open. Sum across tables → "table-hours occupied".
    const orders = await this.prisma.client.posTableOrder.findMany({
      where: {
        organizationId,
        openedAt: { lt: end },
        OR: [{ closedAt: null }, { closedAt: { gt: start } }],
      },
      select: { openedAt: true, closedAt: true },
    });

    const hourBuckets = new Array(24).fill(0).map((_, hour) => ({
      hour,
      occupiedHours: 0,
      occupancyPct: 0,
    }));
    for (const o of orders) {
      const opened = new Date(o.openedAt);
      const closed = o.closedAt ? new Date(o.closedAt) : end;
      const opStart = opened < start ? start : opened;
      const opEnd = closed > end ? end : closed;
      if (opEnd <= opStart) continue;
      const firstHour = opStart.getHours();
      const lastHour = opEnd.getHours() + (opEnd.getMinutes() > 0 || opEnd.getSeconds() > 0 ? 1 : 0);
      for (let h = firstHour; h < Math.min(24, lastHour); h++) {
        hourBuckets[h].occupiedHours += 1;
      }
    }
    for (const b of hourBuckets) {
      b.occupancyPct = totalActive > 0
        ? Math.round((b.occupiedHours / totalActive) * 100)
        : 0;
    }

    // Peak hours = top 3.
    const peak = [...hourBuckets]
      .sort((a, b) => b.occupiedHours - a.occupiedHours)
      .slice(0, 3)
      .map((b) => b.hour);

    return {
      date: start.toISOString().slice(0, 10),
      totalActiveTables: totalActive,
      hours: hourBuckets,
      peakHours: peak,
    };
  }

  /** Revenue per table + per zone + top performers in a date range. */
  async revenue(fromDate: string, toDate: string) {
    const organizationId = this.tenant.organizationId;
    const start = new Date(fromDate);
    const end = new Date(toDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid fromDate/toDate');
    }
    end.setHours(23, 59, 59, 999);

    // POS sales now live on the `Invoice` table (with its own `tableId`); legacy
    // POS sales are `Document` rows tagged sourceType='pos'. Union both so the
    // report doesn't silently read zero after the Order→Invoice split.
    const [invoices, docs] = await Promise.all([
      this.prisma.client.invoice.findMany({
        where: {
          organizationId,
          tableId: { not: null },
          status: { in: ['posted', 'paid'] },
          createdAt: { gte: start, lte: end },
        },
        select: { tableId: true, totalAmount: true },
      }),
      this.prisma.client.document.findMany({
        where: {
          organizationId,
          tableId: { not: null },
          documentType: 'sales_invoice',
          sourceType: 'pos',
          status: { in: ['posted', 'paid'] },
          createdAt: { gte: start, lte: end },
        },
        select: { tableId: true, totalAmount: true },
      }),
    ]);

    const perTable = new Map<string, { tableId: string; orders: number; revenue: number }>();
    let totalRevenue = 0;
    let totalOrders = 0;
    for (const d of [...invoices, ...docs] as any[]) {
      if (!d.tableId) continue;
      const cur = perTable.get(d.tableId) ?? { tableId: d.tableId, orders: 0, revenue: 0 };
      cur.orders += 1;
      cur.revenue += Number(d.totalAmount);
      perTable.set(d.tableId, cur);
      totalRevenue += Number(d.totalAmount);
      totalOrders += 1;
    }

    const tableIds = Array.from(perTable.keys());
    const tables = tableIds.length
      ? await this.prisma.client.posTable.findMany({
          where: { id: { in: tableIds } },
          select: { id: true, number: true, name: true, zone: true },
        })
      : [];
    const tableMap = new Map(tables.map((t: any) => [t.id, t]));

    // Zone catalog metadata (name + color) for table + zone enrichment.
    const zones = await this.prisma.client.posTableZone.findMany({
      where: { organizationId, deletedAt: null },
      select: { key: true, name: true, color: true },
    });
    const zoneMeta = new Map(zones.map((z) => [z.key, z]));

    const enriched = Array.from(perTable.values()).map((row) => {
      const t = tableMap.get(row.tableId);
      const meta = zoneMeta.get(t?.zone ?? '');
      return {
        tableId: row.tableId,
        number: t?.number ?? null,
        name: t?.name ?? 'Unknown',
        zone: t?.zone ?? 'indoor',
        zoneName: meta?.name ?? t?.zone ?? 'indoor',
        zoneColor: meta?.color ?? null,
        orders: row.orders,
        revenue: row.revenue.toFixed(2),
      };
    });

    // Revenue per zone — grouped by the zone key (no more custom: hack).
    const perZone = new Map<string, { zone: string; zoneName: string; zoneColor: string | null; orders: number; revenue: number }>();
    for (const row of enriched) {
      const key = row.zone;
      const meta = zoneMeta.get(key);
      const cur = perZone.get(key) ?? {
        zone: key,
        zoneName: meta?.name ?? key,
        zoneColor: meta?.color ?? null,
        orders: 0,
        revenue: 0,
      };
      cur.orders += row.orders;
      cur.revenue += Number(row.revenue);
      perZone.set(key, cur);
    }

    // Average dining time (closed PosTableOrder rows in window).
    const orders = await this.prisma.client.posTableOrder.findMany({
      where: {
        organizationId,
        openedAt: { gte: start, lte: end },
        closedAt: { not: null },
      },
      select: { openedAt: true, closedAt: true },
    });
    let totalMinutes = 0;
    for (const o of orders) {
      const ms = (o.closedAt as Date).getTime() - new Date(o.openedAt).getTime();
      if (ms > 0) totalMinutes += ms / 60000;
    }
    const averageDiningMinutes = orders.length ? Math.round(totalMinutes / orders.length) : 0;

    // Turnover rate = (orders served / total tables). Approximation.
    const totalTables = await this.prisma.client.posTable.count({
      where: { organizationId, active: true },
    });
    const turnoverRate = totalTables > 0 ? Math.round((totalOrders / totalTables) * 100) / 100 : 0;

    return {
      fromDate: start.toISOString().slice(0, 10),
      toDate: end.toISOString().slice(0, 10),
      totals: {
        orders: totalOrders,
        revenue: totalRevenue.toFixed(2),
        averageDiningMinutes,
        turnoverRate,
      },
      perTable: enriched.sort((a, b) => Number(b.revenue) - Number(a.revenue)),
      perZone: Array.from(perZone.values()).map((z) => ({
        ...z,
        revenue: z.revenue.toFixed(2),
      })),
      topPerformers: enriched.sort((a, b) => Number(b.revenue) - Number(a.revenue)).slice(0, 10),
    };
  }

  /** Reservation counts by day + no-show rate. */
  async reservations(fromDate: string, toDate: string) {
    const organizationId = this.tenant.organizationId;
    const start = new Date(fromDate);
    const end = new Date(toDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid fromDate/toDate');
    }
    end.setHours(23, 59, 59, 999);

    const reservations = await this.prisma.client.posTableReservation.findMany({
      where: {
        organizationId,
        startAt: { gte: start, lte: end },
      },
      select: { status: true, startAt: true },
    });

    const byDay = new Map<string, { pending: number; seated: number; completed: number; cancelled: number; noShow: number; total: number }>();
    for (const r of reservations) {
      const day = r.startAt.toISOString().slice(0, 10);
      const cur = byDay.get(day) ?? { pending: 0, seated: 0, completed: 0, cancelled: 0, noShow: 0, total: 0 };
      cur.total += 1;
      if (r.status === 'pending') cur.pending += 1;
      else if (r.status === 'seated') cur.seated += 1;
      else if (r.status === 'completed') cur.completed += 1;
      else if (r.status === 'cancelled') cur.cancelled += 1;
      else if (r.status === 'no_show') cur.noShow += 1;
      byDay.set(day, cur);
    }

    const totals = { pending: 0, seated: 0, completed: 0, cancelled: 0, noShow: 0, total: 0 };
    for (const r of reservations) {
      totals.total += 1;
      if (r.status === 'pending') totals.pending += 1;
      else if (r.status === 'seated') totals.seated += 1;
      else if (r.status === 'completed') totals.completed += 1;
      else if (r.status === 'cancelled') totals.cancelled += 1;
      else if (r.status === 'no_show') totals.noShow += 1;
    }
    const noShowRate = totals.total ? Math.round((totals.noShow / totals.total) * 100) : 0;
    const completionRate = totals.total ? Math.round((totals.completed / totals.total) * 100) : 0;

    return {
      fromDate: start.toISOString().slice(0, 10),
      toDate: end.toISOString().slice(0, 10),
      totals: { ...totals, noShowRate, completionRate },
      byDay: Array.from(byDay.entries())
        .map(([day, v]) => ({ day, ...v }))
        .sort((a, b) => a.day.localeCompare(b.day)),
    };
  }
}