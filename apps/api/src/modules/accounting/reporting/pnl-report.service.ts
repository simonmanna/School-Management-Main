import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { BALANCE_AFFECTING_STATUSES } from '../posting/posting.types';
import { AccountResolverService } from '../posting/account-resolver.service';
import { displayBalance } from './account-classification';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface DateRange {
  from?: string;
  to?: string;
}

const ZERO = new Prisma.Decimal(0);

/**
 * P&L report (D3). Reads from `ReportPnLSnapshot` when available; falls back
 * to live `JournalLine` aggregation. The report treats revenue as positive,
 * contra-revenue as positive (subtracted), COGS and expense as positive
 * (subtracted), yielding operating profit.
 */
@Injectable()
export class PnLReportService {
  private readonly logger = new Logger('PnLReportService');
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountResolverService,
  ) {}

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
          // The P&L snapshot carries four aggregate columns only, so other
          // income/expense are folded into revenue/expense there.
          otherIncome: '0',
          otherExpense: '0',
          operatingProfit: operatingProfit.toString(),
          netProfit: operatingProfit.toString(),
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
      where: { entry: { status: { in: [...BALANCE_AFFECTING_STATUSES] }, postingDate: this.rangeFilter(range) } },
      _sum: { baseDebit: true, baseCredit: true },
    });
    const meta = await this.accounts.meta((grouped as any[]).map((g) => g.accountId));

    // Every bucket is keyed on the account's report section, so `contra_revenue`
    // finally has real members: it used to be branched on here but was not a
    // member of the AccountType enum, so sales discounts silently netted into
    // revenue and the discount line always read zero.
    let revenue = ZERO,
      contraRevenue = ZERO,
      cogs = ZERO,
      expense = ZERO,
      otherIncome = ZERO,
      otherExpense = ZERO;

    for (const g of grouped as any[]) {
      const account = meta.get(g.accountId);
      if (!account) continue;
      const debit = new Prisma.Decimal(g._sum.baseDebit ?? 0);
      const credit = new Prisma.Decimal(g._sum.baseCredit ?? 0);
      // Positive in the direction the statement reads: revenue positive when
      // credited, expenses positive when debited, contra-revenue positive when
      // debited (its category is debit-normal).
      const value = displayBalance(debit.minus(credit), account);
      switch (account.reportSection) {
        case 'revenue': revenue = revenue.plus(value); break;
        case 'contra_revenue': contraRevenue = contraRevenue.plus(value); break;
        case 'cogs': cogs = cogs.plus(value); break;
        case 'operating_expense': expense = expense.plus(value); break;
        case 'other_income': otherIncome = otherIncome.plus(value); break;
        case 'other_expense': otherExpense = otherExpense.plus(value); break;
        default: break;
      }
    }

    const netRevenue = revenue.minus(contraRevenue);
    const grossProfit = netRevenue.minus(cogs);
    const operatingProfit = grossProfit.minus(expense);
    const netProfit = operatingProfit.plus(otherIncome).minus(otherExpense);
    return {
      revenue: revenue.toString(),
      contraRevenue: contraRevenue.toString(),
      netRevenue: netRevenue.toString(),
      cogs: cogs.toString(),
      grossProfit: grossProfit.toString(),
      expense: expense.toString(),
      otherIncome: otherIncome.toString(),
      otherExpense: otherExpense.toString(),
      operatingProfit: operatingProfit.toString(),
      netProfit: netProfit.toString(),
      source: 'live',
    };
  }

  /** Latest snapshot ≤ asOf, served only if nothing balance-affecting posted since. */
  private async findSnapshot(asOf: Date): Promise<{ organizationId: string; asOf: Date } | null> {
    const snap = await this.prisma.client.reportPnLSnapshot.findFirst({
      where: { asOf: { lte: asOf } },
      orderBy: { asOf: 'desc' },
      select: { organizationId: true, asOf: true },
    });
    if (!snap) return null;
    const newer = await this.prisma.client.journalLine.count({
      where: {
        entry: { status: { in: [...BALANCE_AFFECTING_STATUSES] }, postingDate: { gt: snap.asOf, lte: asOf } },
      },
    });
    if (newer > 0) return null;
    return snap;
  }

  private rangeFilter(range: DateRange): any {
    const f: any = {};
    if (range.from) f.gte = new Date(range.from);
    if (range.to) f.lte = new Date(range.to);
    return f;
  }
}