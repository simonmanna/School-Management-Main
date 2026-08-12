import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';

const ZERO = new Prisma.Decimal(0);
const FALLBACK_EPSILON_MS = 60 * 1000;

/**
 * AP Aging (D3). Snapshot-first, live-fallback. Bucket logic is identical
 * between the snapshot rebuild and the live path.
 */
@Injectable()
export class ApAgingService {
  private readonly logger = new Logger('ApAgingService');
  constructor(private readonly prisma: PrismaService) {}

  async apAging(asOf: string = new Date().toISOString()) {
    const requested = new Date(asOf);
    const snap = await this.findSnapshot(requested);
    if (snap) {
      const rows = await this.prisma.client.reportApAgingSnapshot.findMany({
        where: { organizationId: snap.organizationId, asOf: snap.asOf },
        orderBy: { partnerName: 'asc' },
      });
      const buckets = this.aggregateBuckets(rows.map((r) => ({
        partnerId: r.partnerId,
        partnerName: r.partnerName,
        total: r.total,
        current: r.current,
        b1_30: r.b1_30,
        b31_60: r.b31_60,
        b61_90: r.b61_90,
        b90p: r.b90p,
      })));
      return {
        asOf: snap.asOf,
        buckets: this.bucketsToString(buckets.totals),
        total: buckets.grand.toString(),
        partners: buckets.perPartner,
        source: 'snapshot',
      };
    }
    return this.live(asOf);
  }

  private async live(asOf: string) {
    const bills = await this.prisma.client.document.findMany({
      where: {
        documentType: 'vendor_bill',
        status: { in: ['posted', 'paid'] },
        amountResidual: { gt: 0 },
      },
      include: { partner: true },
    });
    const asOfDate = new Date(asOf);
    const buckets = new Map<string, {
      partnerId: string; partnerName: string;
      total: Prisma.Decimal; current: Prisma.Decimal; b1_30: Prisma.Decimal;
      b31_60: Prisma.Decimal; b61_90: Prisma.Decimal; b90p: Prisma.Decimal;
    }>();
    for (const bill of bills as any[]) {
      const due = bill.dueDate ? new Date(bill.dueDate) : new Date(bill.issueDate);
      const days = Math.max(0, Math.floor((asOfDate.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)));
      const residual = new Prisma.Decimal(bill.amountResidual);
      const bucket =
        days <= 0 ? 'current' :
        days <= 30 ? 'b1_30' :
        days <= 60 ? 'b31_60' :
        days <= 90 ? 'b61_90' : 'b90p';
      const existing = buckets.get(bill.partnerId) ?? {
        partnerId: bill.partnerId,
        partnerName: bill.partner?.name ?? '',
        total: new Prisma.Decimal(0),
        current: new Prisma.Decimal(0),
        b1_30: new Prisma.Decimal(0),
        b31_60: new Prisma.Decimal(0),
        b61_90: new Prisma.Decimal(0),
        b90p: new Prisma.Decimal(0),
      };
      existing[bucket] = existing[bucket].plus(residual);
      existing.total = existing.total.plus(residual);
      existing.partnerName = bill.partner?.name ?? existing.partnerName;
      buckets.set(bill.partnerId, existing);
    }
    const bucketsArr = [...buckets.values()];
    const agg = this.aggregateBuckets(bucketsArr);
    return {
      asOf,
      buckets: this.bucketsToString(agg.totals),
      total: agg.grand.toString(),
      partners: agg.perPartner,
      source: 'live',
    };
  }

  private aggregateBuckets(rows: {
    partnerId: string; partnerName: string;
    total: Prisma.Decimal; current: Prisma.Decimal; b1_30: Prisma.Decimal;
    b31_60: Prisma.Decimal; b61_90: Prisma.Decimal; b90p: Prisma.Decimal;
  }[]) {
    const totals = {
      current: ZERO, b1_30: ZERO, b31_60: ZERO, b61_90: ZERO, b90p: ZERO,
    };
    let grand = ZERO;
    const perPartner = rows.map((p) => {
      totals.current = totals.current.plus(p.current);
      totals.b1_30 = totals.b1_30.plus(p.b1_30);
      totals.b31_60 = totals.b31_60.plus(p.b31_60);
      totals.b61_90 = totals.b61_90.plus(p.b61_90);
      totals.b90p = totals.b90p.plus(p.b90p);
      grand = grand.plus(p.total);
      return {
        partnerId: p.partnerId,
        partnerName: p.partnerName,
        total: p.total.toString(),
        buckets: {
          current: p.current.toString(),
          b1_30: p.b1_30.toString(),
          b31_60: p.b31_60.toString(),
          b61_90: p.b61_90.toString(),
          b90p: p.b90p.toString(),
        },
      };
    });
    return { totals, grand, perPartner };
  }

  private bucketsToString(t: { current: Prisma.Decimal; b1_30: Prisma.Decimal; b31_60: Prisma.Decimal; b61_90: Prisma.Decimal; b90p: Prisma.Decimal }) {
    return {
      current: { label: 'Current', amount: t.current.toString() },
      b1_30: { label: '1-30 days', amount: t.b1_30.toString() },
      b31_60: { label: '31-60 days', amount: t.b31_60.toString() },
      b61_90: { label: '61-90 days', amount: t.b61_90.toString() },
      b90p: { label: '90+ days', amount: t.b90p.toString() },
    };
  }

  private async findSnapshot(asOf: Date): Promise<{ organizationId: string; asOf: Date } | null> {
    const now = Date.now();
    const candidates = await this.prisma.client.reportApAgingSnapshot.findMany({
      orderBy: { asOf: 'desc' },
      take: 5,
    });
    for (const c of candidates) {
      if (c.asOf.getTime() > asOf.getTime()) continue;
      if (Math.abs(now - c.asOf.getTime()) > FALLBACK_EPSILON_MS) continue;
      return { organizationId: c.organizationId, asOf: c.asOf };
    }
    return null;
  }
}