import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ZERO } from '../../../kernel/common/money';
import { PrismaService } from '../../../kernel/prisma/prisma.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface DateRange {
  from?: string;
  to?: string;
}

const OPEN = { documentType: 'sales_invoice' as const, status: { in: ['posted', 'paid'] as any }, amountResidual: { gt: 0 } };

@Injectable()
export class ArReportingService {
  constructor(private readonly prisma: PrismaService) {}

  /** AR aging by due date relative to `asOf`. */
  async aging(asOfStr?: string) {
    const asOf = asOfStr ? new Date(asOfStr) : new Date();
    const docs = await this.prisma.client.document.findMany({
      where: OPEN,
      include: { partner: true },
      orderBy: { dueDate: 'asc' },
    });

    const buckets: Record<string, Prisma.Decimal> = {
      current: ZERO,
      d1_30: ZERO,
      d31_60: ZERO,
      d61_90: ZERO,
      d90_plus: ZERO,
    };

    const rows = docs.map((d: any) => {
      const due = d.dueDate ?? d.issueDate;
      const days = Math.floor((asOf.getTime() - new Date(due).getTime()) / 86_400_000);
      const bucket =
        days <= 0 ? 'current' : days <= 30 ? 'd1_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90_plus';
      buckets[bucket] = buckets[bucket].plus(d.amountResidual);
      return {
        documentId: d.id,
        documentNumber: d.documentNumber,
        partnerName: d.partner.name,
        dueDate: due,
        daysOverdue: Math.max(0, days),
        residual: (d.amountResidual as Prisma.Decimal).toString(),
        bucket,
      };
    });

    const total = docs.reduce((s: Prisma.Decimal, d: any) => s.plus(d.amountResidual), ZERO);
    return {
      asOf,
      buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.toString()])),
      total: total.toString(),
      rows,
    };
  }

  async customerBalances() {
    const docs = await this.prisma.client.document.findMany({ where: OPEN, include: { partner: true } });
    const map = new Map<string, { partnerId: string; partnerName: string; outstanding: Prisma.Decimal }>();
    for (const d of docs as any[]) {
      const cur = map.get(d.partnerId) ?? { partnerId: d.partnerId, partnerName: d.partner.name, outstanding: ZERO };
      cur.outstanding = cur.outstanding.plus(d.amountResidual);
      map.set(d.partnerId, cur);
    }
    return [...map.values()]
      .map((v) => ({ partnerId: v.partnerId, partnerName: v.partnerName, outstanding: v.outstanding.toString() }))
      .sort((a, b) => a.partnerName.localeCompare(b.partnerName));
  }

  async outstandingInvoices() {
    const docs = await this.prisma.client.document.findMany({
      where: OPEN,
      include: { partner: true },
      orderBy: { dueDate: 'asc' },
    });
    return docs.map((d: any) => ({
      documentId: d.id,
      documentNumber: d.documentNumber,
      partnerName: d.partner.name,
      issueDate: d.issueDate,
      dueDate: d.dueDate,
      total: (d.totalAmount as Prisma.Decimal).toString(),
      residual: (d.amountResidual as Prisma.Decimal).toString(),
      paymentStatus: d.paymentStatus,
    }));
  }

  async revenueByCustomer(range: DateRange) {
    const docs = await this.postedInvoices(range);
    const map = new Map<string, { partnerId: string; partnerName: string; revenue: Prisma.Decimal }>();
    for (const d of docs as any[]) {
      const cur = map.get(d.partnerId) ?? { partnerId: d.partnerId, partnerName: d.partner.name, revenue: ZERO };
      cur.revenue = cur.revenue.plus(d.subtotal);
      map.set(d.partnerId, cur);
    }
    return [...map.values()]
      .map((v) => ({ partnerId: v.partnerId, partnerName: v.partnerName, revenue: v.revenue.toString() }))
      .sort((a, b) => a.partnerName.localeCompare(b.partnerName));
  }

  async revenueByPeriod(range: DateRange) {
    const docs = await this.postedInvoices(range);
    const map = new Map<string, Prisma.Decimal>();
    for (const d of docs as any[]) {
      const key = new Date(d.issueDate).toISOString().slice(0, 7);
      map.set(key, (map.get(key) ?? ZERO).plus(d.subtotal));
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([period, revenue]) => ({ period, revenue: revenue.toString() }));
  }

  private postedInvoices(range: DateRange) {
    const where: any = { documentType: 'sales_invoice', status: { in: ['posted', 'paid'] } };
    if (range.from || range.to) {
      where.issueDate = {};
      if (range.from) where.issueDate.gte = new Date(range.from);
      if (range.to) where.issueDate.lte = new Date(range.to);
    }
    return this.prisma.client.document.findMany({ where, include: { partner: true } });
  }
}
