/**
 * POS KDS — kitchen performance reporting + live ops.
 *
 * Reads KitchenTicket timestamps (createdAt/startedAt/readyAt/servedAt) and the
 * denormalised `items` JSON to compute prep-time percentiles, per-station load,
 * per-chef throughput, delays, cancellations, recall causes, peak hours and the
 * most-prepared dishes. `live()` returns a real-time operational snapshot.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';

const DELAY_THRESHOLD_MIN = 10;

function mins(a: Date, b: Date): number { return (a.getTime() - b.getTime()) / 60000; }
function percentile(sortedAsc: number[], p: number): number {
  if (!sortedAsc.length) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1));
  return Math.round(sortedAsc[idx] * 10) / 10;
}
function avg(xs: number[]): number { return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0; }

@Injectable()
export class PosKdsReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /** Historical performance over a date range (defaults to the last 7 days). */
  async summary(fromISO?: string, toISO?: string) {
    const orgId = this.tenant.organizationId;
    const to = toISO ? new Date(toISO) : new Date();
    const from = fromISO ? new Date(fromISO) : new Date(to.getTime() - 7 * 24 * 3600 * 1000);

    const tickets = await this.prisma.client.kitchenTicket.findMany({
      where: { organizationId: orgId, createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: 'asc' },
    });

    const prepTimes: number[] = [];
    const waitTimes: number[] = [];
    const perStation = new Map<string, { count: number; prep: number[] }>();
    const perChef = new Map<string, { count: number; prep: number[] }>();
    const recallReasons = new Map<string, number>();
    const hours = new Array(24).fill(0);
    const dishes = new Map<string, number>();
    let delayed = 0, cancelled = 0, recalls = 0;

    for (const t of tickets as any[]) {
      const created = t.createdAt as Date;
      hours[created.getUTCHours()]++;
      if (t.status === 'cancelled') cancelled++;
      if ((t.recallCount ?? 0) > 0) { recalls++; recallReasons.set(t.recallReason ?? 'unspecified', (recallReasons.get(t.recallReason ?? 'unspecified') ?? 0) + 1); }

      const st = perStation.get(t.station) ?? { count: 0, prep: [] };
      st.count++;

      let prep: number | null = null;
      if (t.startedAt && t.readyAt) {
        prep = mins(t.readyAt, t.startedAt);
        if (prep >= 0) { prepTimes.push(prep); st.prep.push(prep); if (prep > DELAY_THRESHOLD_MIN) delayed++; }
      }
      perStation.set(t.station, st);

      if (t.servedAt) { const w = mins(t.servedAt, created); if (w >= 0) waitTimes.push(w); }

      const chef = t.readyBy ?? t.startedBy;
      if (chef && prep !== null) {
        const c = perChef.get(chef) ?? { count: 0, prep: [] };
        c.count++; c.prep.push(prep); perChef.set(chef, c);
      }

      for (const it of (Array.isArray(t.items) ? t.items : [])) {
        const name = it.productName ?? 'Unknown';
        dishes.set(name, (dishes.get(name) ?? 0) + (Number(it.quantity) || 1));
      }
    }

    const prepSorted = [...prepTimes].sort((a, b) => a - b);
    const waitSorted = [...waitTimes].sort((a, b) => a - b);

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      totals: { tickets: tickets.length, cancelled, recalls, delayed },
      prepTime: { avg: avg(prepTimes), p50: percentile(prepSorted, 50), p90: percentile(prepSorted, 90), samples: prepTimes.length },
      waitTime: { avg: avg(waitTimes), p50: percentile(waitSorted, 50), p90: percentile(waitSorted, 90), samples: waitTimes.length },
      perStation: [...perStation.entries()].map(([station, v]) => ({ station, tickets: v.count, avgPrep: avg(v.prep) })).sort((a, b) => b.tickets - a.tickets),
      perChef: [...perChef.entries()].map(([chefUserId, v]) => ({ chefUserId, tickets: v.count, avgPrep: avg(v.prep) })).sort((a, b) => b.tickets - a.tickets),
      recallCauses: [...recallReasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
      peakHours: hours.map((count, hour) => ({ hour, count })),
      topDishes: [...dishes.entries()].map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty).slice(0, 15),
    };
  }

  /** Real-time operational snapshot for the live dashboard. */
  async live() {
    const orgId = this.tenant.organizationId;
    const active = await this.prisma.client.kitchenTicket.findMany({
      where: { organizationId: orgId, status: { in: ['new', 'preparing', 'ready'] } },
      orderBy: { createdAt: 'asc' },
    });
    const now = Date.now();
    const byStatus = { new: 0, preparing: 0, ready: 0 };
    const perStation = new Map<string, number>();
    let longestWaitMin = 0;
    const ages: number[] = [];
    for (const t of active as any[]) {
      (byStatus as any)[t.status]++;
      perStation.set(t.station, (perStation.get(t.station) ?? 0) + 1);
      const ageMin = (now - new Date(t.createdAt).getTime()) / 60000;
      ages.push(ageMin);
      if ((t.status === 'new' || t.status === 'preparing') && ageMin > longestWaitMin) longestWaitMin = ageMin;
    }
    return {
      counts: byStatus,
      totalActive: active.length,
      avgAgeMin: avg(ages),
      longestWaitMin: Math.round(longestWaitMin * 10) / 10,
      perStation: [...perStation.entries()].map(([station, count]) => ({ station, count })).sort((a, b) => b.count - a.count),
    };
  }
}
