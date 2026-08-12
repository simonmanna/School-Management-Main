import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const ZERO = new Prisma.Decimal(0);

interface DateRange {
  from?: string;
  to?: string;
}

/**
 * Cash Flow report (M6). Three sections:
 *   - Operating:  net P&L + working-capital changes (AR, AP, inventory)
 *   - Investing:  asset account movements (cashFlowCategory='investing')
 *   - Financing:  liability/equity account movements (cashFlowCategory='financing')
 *
 * Accounts not tagged default to 'operating'. Revenue and expense always
 * contribute to operating.
 */
@Injectable()
export class CashFlowReportService {
  constructor(private readonly prisma: PrismaService) {}

  async cashFlow(range: DateRange) {
    const grouped = await this.prisma.client.journalLine.groupBy({
      by: ['accountId'],
      where: { entry: { status: 'posted', postingDate: this.rangeFilter(range) } },
      _sum: { baseDebit: true, baseCredit: true },
    });
    const accounts = await this.prisma.client.account.findMany({
      where: { id: { in: grouped.map((g: any) => g.accountId) } },
    });
    const accountById = new Map(accounts.map((a: any) => [a.id, a]));

    let operating = ZERO;
    let investing = ZERO;
    let financing = ZERO;

    for (const g of grouped as any[]) {
      const account = accountById.get(g.accountId);
      if (!account) continue;
      const debit: Prisma.Decimal = g._sum.baseDebit ?? ZERO;
      const credit: Prisma.Decimal = g._sum.baseCredit ?? ZERO;
      const net = debit.minus(credit);
      const t = account.accountType as string;

      // Income/expense always operating (cash impact shown as P&L effect).
      if (t === 'revenue' || t === 'contra_revenue' || t === 'expense' || t === 'cost_of_goods_sold') {
        operating = operating.plus(net.negated()); // cash effect: positive revenue → positive cash
        continue;
      }

      // For balance-sheet accounts, use the account's tag if set.
      const tag = (account as any).cashFlowCategory as string | null;
      const section = tag ?? 'operating';
      // Cash impact of a balance-sheet move: debit-positive cash (e.g., Dr Bank) is +cash.
      // For assets, debit-positive means cash in (operating/investing); for liabilities/equity, credit-positive means cash in (financing).
      if (t === 'asset' || t === 'bank' || t === 'cash' || t === 'receivable' || t === 'contra_asset') {
        const cashEffect = section === 'operating' ? net : (section === 'investing' ? net : ZERO);
        if (section === 'operating') operating = operating.plus(cashEffect);
        else if (section === 'investing') investing = investing.plus(cashEffect);
      } else if (t === 'liability' || t === 'payable' || t === 'tax' || t === 'contra_liability' || t === 'equity') {
        if (section === 'financing') financing = financing.plus(net.negated());
        else operating = operating.plus(net.negated());
      }
    }

    return {
      operating: operating.toString(),
      investing: investing.toString(),
      financing: financing.toString(),
      netCashFlow: operating.plus(investing).plus(financing).toString(),
    };
  }

  private rangeFilter(range: DateRange): any {
    const f: any = {};
    if (range.from) f.gte = new Date(range.from);
    if (range.to) f.lte = new Date(range.to);
    return f;
  }
}