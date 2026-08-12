import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface DateRange {
  from?: string;
  to?: string;
}

const ZERO = new Prisma.Decimal(0);
const FALLBACK_EPSILON_MS = 60 * 1000;

/**
 * P&L report (D3). Reads from `ReportPnLSnapshot` when available; falls back
 * to live `JournalLine` aggregation. The report treats revenue as positive,
 * contra-revenue as positive (subtracted), COGS and expense as positive
 * (subtracted), yielding operating profit.
 */
@Injectable()
export class PnLReportService {
  private readonly logger = new Logger('PnLReportService');
  constructor(private readonly prisma: PrismaService) {}

  async pnl(range: DateRange) {
    const asOf = range.to ? new Date(range.to) : new Date();
    const snap = await this.findSnapshot(asOf);
    if (snap) {
      const pnl = await this.prisma.client.reportPnLSnapshot.findFirst({
        where: { organizationId: snap.organizationId, asOf: snap.asOf },
      });
      if (pnl) {
        const grossProfit = pnl.revenue.minus(pnl.contraRevenue).minus(pnl.cogs);
        const operatingProfit = grossProfit.minus(pnl.expense);
        return {
          revenue: pnl.revenue.toString(),
          contraRevenue: pnl.contraRevenue.toString(),
          netRevenue: pnl.revenue.minus(pnl.contraRevenue).toString(),
          cogs: pnl.cogs.toString(),
          grossProfit: grossProfit.toString(),
          expense: pnl.expense.toString(),
          otherIncome: '0',
          operatingProfit: operatingProfit.toString(),
          source: 'snapshot',
          asOf: pnl.asOf,
        };
      }
    }
    return this.livePnl(range);
  }

  private async livePnl(range: DateRange) {
    const grouped = await this.prisma.client.journalLine.groupBy({
      by: ['accountId'],
      where: { entry: { status: 'posted', postingDate: this.rangeFilter(range) } },
      _sum: { baseDebit: true, baseCredit: true },
    });
    const accounts = await this.prisma.client.account.findMany({
      where: { id: { in: (grouped as any[]).map((g) => g.accountId) } },
    });
    const acctById = new Map((accounts as any[]).map((a) => [a.id, a]));
    let revenue = ZERO,
      contraRevenue = ZERO,
      cogs = ZERO,
      expense = ZERO;
    for (const g of grouped as any[]) {
      const acct = acctById.get(g.accountId);
      if (!acct) continue;
      const debit = new Prisma.Decimal(g._sum.baseDebit ?? 0);
      const credit = new Prisma.Decimal(g._sum.baseCredit ?? 0);
      const t = acct.accountType as string;
      const bal = credit.minus(debit);
      switch (t) {
        case 'revenue': revenue = revenue.plus(bal); break;
        case 'contra_revenue': contraRevenue = contraRevenue.plus(bal); break;
        case 'cost_of_goods_sold': cogs = cogs.plus(debit.minus(credit)); break;
        case 'expense': expense = expense.plus(debit.minus(credit)); break;
      }
    }
    const grossProfit = revenue.minus(contraRevenue).minus(cogs);
    const operatingProfit = grossProfit.minus(expense);
    return {
      revenue: revenue.toString(),
      contraRevenue: contraRevenue.toString(),
      netRevenue: revenue.minus(contraRevenue).toString(),
      cogs: cogs.toString(),
      grossProfit: grossProfit.toString(),
      expense: expense.toString(),
      otherIncome: '0',
      operatingProfit: operatingProfit.toString(),
      source: 'live',
    };
  }

  private async findSnapshot(asOf: Date): Promise<{ organizationId: string; asOf: Date } | null> {
    const now = Date.now();
    const candidates = await this.prisma.client.reportPnLSnapshot.findMany({
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

  private rangeFilter(range: DateRange): any {
    const f: any = {};
    if (range.from) f.gte = new Date(range.from);
    if (range.to) f.lte = new Date(range.to);
    return f;
  }
}