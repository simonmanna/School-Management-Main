import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';

const ZERO = new Prisma.Decimal(0);
const FALLBACK_EPSILON_MS = 60 * 1000;

/**
 * Balance Sheet (D3). Reads from `ReportBalanceSheetSnapshot` when available;
 * falls back to live JournalLine aggregation otherwise. As-of semantics: the
 * snapshot's `asOf` must be ≤ the requested date and within 1 minute of now.
 */
@Injectable()
export class BalanceSheetReportService {
  private readonly logger = new Logger('BalanceSheetReportService');
  constructor(private readonly prisma: PrismaService) {}

  async balanceSheet(asOf: string) {
    const requested = new Date(asOf);
    const snap = await this.findSnapshot(requested);
    if (snap) {
      const rows = await this.prisma.client.reportBalanceSheetSnapshot.findMany({
        where: { organizationId: snap.organizationId, asOf: snap.asOf },
        orderBy: { accountCode: 'asc' },
      });
      let totalAssets = ZERO;
      let totalLiabilities = ZERO;
      let totalEquity = ZERO;
      let totalEarnings = ZERO;
      for (const r of rows) {
        const bal = r.balance;
        switch (r.accountType as string) {
          case 'asset':
          case 'bank':
          case 'cash':
          case 'receivable':
          case 'contra_asset':
            totalAssets = totalAssets.plus(bal);
            break;
          case 'liability':
          case 'payable':
          case 'tax':
          case 'contra_liability':
            totalLiabilities = totalLiabilities.plus(bal.negated());
            break;
          case 'equity':
            totalEquity = totalEquity.plus(bal.negated());
            break;
          default:
            break;
        }
      }
      // P&L rolls into equity via retained earnings in the snapshot.
      // The snapshot builder already closed revenue/expense into RE for the
      // relevant period. We do not add another earnings term here.
      const totalLiabilitiesAndEquity = totalLiabilities.plus(totalEquity).plus(totalEarnings);
      return {
        asOf: snap.asOf,
        totalAssets: totalAssets.toString(),
        totalLiabilities: totalLiabilities.toString(),
        totalEquity: totalEquity.toString(),
        currentYearEarnings: totalEarnings.toString(),
        totalLiabilitiesAndEquity: totalLiabilitiesAndEquity.toString(),
        balanced: totalAssets.minus(totalLiabilitiesAndEquity).abs().lessThanOrEqualTo(0.01),
        source: 'snapshot',
      };
    }
    return this.live(asOf);
  }

  private async live(asOf: string) {
    const grouped = await this.prisma.client.journalLine.groupBy({
      by: ['accountId'],
      where: { entry: { status: 'posted', postingDate: { lte: new Date(asOf) } } },
      _sum: { baseDebit: true, baseCredit: true },
    });
    const accounts = await this.prisma.client.account.findMany({
      where: { id: { in: (grouped as any[]).map((g) => g.accountId) } },
    });
    const acctById = new Map((accounts as any[]).map((a) => [a.id, a]));
    let totalAssets = ZERO,
      totalLiabilities = ZERO,
      totalEquity = ZERO,
      totalEarnings = ZERO;
    for (const g of grouped as any[]) {
      const acct = acctById.get(g.accountId);
      if (!acct) continue;
      const debit = new Prisma.Decimal(g._sum.baseDebit ?? 0);
      const credit = new Prisma.Decimal(g._sum.baseCredit ?? 0);
      const net = debit.minus(credit);
      switch (acct.accountType as string) {
        case 'asset':
        case 'bank':
        case 'cash':
        case 'receivable':
        case 'contra_asset':
          totalAssets = totalAssets.plus(net);
          break;
        case 'liability':
        case 'payable':
        case 'tax':
        case 'contra_liability':
          totalLiabilities = totalLiabilities.plus(net.negated());
          break;
        case 'equity':
          totalEquity = totalEquity.plus(net.negated());
          break;
        case 'revenue':
        case 'contra_revenue':
          totalEarnings = totalEarnings.plus(net.negated());
          break;
        case 'cost_of_goods_sold':
        case 'expense':
          totalEarnings = totalEarnings.minus(net);
          break;
      }
    }
    const totalLiabilitiesAndEquity = totalLiabilities.plus(totalEquity).plus(totalEarnings);
    return {
      asOf,
      totalAssets: totalAssets.toString(),
      totalLiabilities: totalLiabilities.toString(),
      totalEquity: totalEquity.toString(),
      currentYearEarnings: totalEarnings.toString(),
      totalLiabilitiesAndEquity: totalLiabilitiesAndEquity.toString(),
      balanced: totalAssets.minus(totalLiabilitiesAndEquity).abs().lessThanOrEqualTo(0.01),
      source: 'live',
    };
  }

  private async findSnapshot(asOf: Date): Promise<{ organizationId: string; asOf: Date } | null> {
    const now = Date.now();
    const candidates = await this.prisma.client.reportBalanceSheetSnapshot.findMany({
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