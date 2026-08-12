import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { BALANCE_AFFECTING_STATUSES } from '../posting/posting.types';
import { AccountResolverService, type AccountMeta } from '../posting/account-resolver.service';
import { cashFlowSectionOf } from './account-classification';

/* eslint-disable @typescript-eslint/no-explicit-any */

const ZERO = new Prisma.Decimal(0);

type Section = 'operating' | 'investing' | 'financing';

interface DateRange {
  from?: string;
  to?: string;
}

/**
 * Cash Flow statement (direct method).
 *
 * The statement measures the *movement of cash* and cash-equivalents (cash,
 * bank, mobile-money, petty-cash accounts). For every journal entry that
 * touches a cash account, the cash moved equals the negated sum of that entry's
 * NON-cash (counter) lines — so we attribute the movement to a section by the
 * nature of each counter account:
 *   - Operating: revenue / expense / COGS / working-capital (AR, AP, inventory, tax)
 *   - Investing: accounts tagged cashFlowCategory='investing'
 *   - Financing: accounts tagged cashFlowCategory='financing'
 *
 * Cash-to-cash transfers (e.g. bank deposit: Dr Bank / Cr Cash) have no non-cash
 * counter line and therefore contribute zero — correct, since total cash is
 * unchanged.
 *
 * By construction `openingCash + netCashFlow === closingCash`, and closingCash
 * equals the cash balance on the balance sheet as of `to`. `reconciled` asserts
 * this independently as a guard against logic drift.
 */
@Injectable()
export class CashFlowReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountResolverService,
  ) {}

  async cashFlow(range: DateRange) {
    const from = this.parseDate(range.from, 'from');
    // A date-only `to` (YYYY-MM-DD) is inclusive through the END of that day, so
    // a "July" report (to=2026-07-31) captures postings made on the 31st.
    const to = this.parseDate(range.to, 'to', /* endOfDay */ true);
    if (from && to && from > to) {
      throw new BadRequestException('`from` must be on or before `to`');
    }

    const cashAccountIds = await this.cashAccountIds();
    if (cashAccountIds.size === 0) {
      return this.emptyResult(range, from, to);
    }
    const cashIds = [...cashAccountIds];

    // Opening cash: net movement of cash accounts strictly before `from`.
    const openingCash = from
      ? await this.sumCashMovement(cashIds, { lt: from })
      : ZERO;

    // Distinct entries in the period that touch at least one cash account.
    const cashLines = await this.prisma.client.journalLine.findMany({
      where: {
        accountId: { in: cashIds },
        entry: { status: { in: [...BALANCE_AFFECTING_STATUSES] }, postingDate: this.periodFilter(from, to) },
      },
      select: { journalEntryId: true },
      distinct: ['journalEntryId'],
    });
    const entryIds = cashLines.map((l: any) => l.journalEntryId);

    let operating = ZERO;
    let investing = ZERO;
    let financing = ZERO;

    if (entryIds.length > 0) {
      // All lines of those entries + the account meta needed to classify them.
      const lines = await this.prisma.client.journalLine.findMany({
        where: { journalEntryId: { in: entryIds } },
        select: { accountId: true, baseDebit: true, baseCredit: true },
      });
      const accMeta = await this.accountMeta(lines.map((l: any) => l.accountId));

      for (const l of lines as any[]) {
        if (cashAccountIds.has(l.accountId)) continue; // skip the cash legs themselves
        // Cash-in attributable to this counter line = (credit - debit).
        const contribution = new Prisma.Decimal(l.baseCredit ?? 0).minus(l.baseDebit ?? 0);
        if (contribution.isZero()) continue;
        const section = this.sectionFor(accMeta.get(l.accountId));
        if (section === 'operating') operating = operating.plus(contribution);
        else if (section === 'investing') investing = investing.plus(contribution);
        else financing = financing.plus(contribution);
      }
    }

    const netCashFlow = operating.plus(investing).plus(financing);
    const closingCash = openingCash.plus(netCashFlow);

    // Independent tie-out: the actual cash balance as of `to` must equal closing.
    const actualClosingCash = await this.sumCashMovement(cashIds, to ? { lte: to } : {});
    const reconciled = closingCash.minus(actualClosingCash).abs().lessThanOrEqualTo(new Prisma.Decimal('0.01'));

    return {
      from: range.from ?? null,
      to: range.to ?? null,
      openingCash: openingCash.toString(),
      operating: operating.toString(),
      investing: investing.toString(),
      financing: financing.toString(),
      netCashFlow: netCashFlow.toString(),
      closingCash: closingCash.toString(),
      actualClosingCash: actualClosingCash.toString(),
      reconciled,
    };
  }

  // ---- helpers ----------------------------------------------------------

  /**
   * Cash and cash-equivalents, from the categories flagged `isCashEquivalent`
   * rather than a hardcoded account-type list. The old list was duplicated
   * verbatim in TreasuryCashFlowService and had to be edited in both places.
   */
  private async cashAccountIds(): Promise<Set<string>> {
    return new Set(await this.accounts.cashEquivalentIds());
  }

  private async accountMeta(ids: string[]): Promise<Map<string, AccountMeta>> {
    return this.accounts.meta([...new Set(ids)]);
  }

  /** Net (debit − credit) of the cash accounts over a posting-date window. */
  private async sumCashMovement(cashIds: string[], dateFilter: { lt?: Date; lte?: Date }): Promise<Prisma.Decimal> {
    const postingDate: any = {};
    if (dateFilter.lt) postingDate.lt = dateFilter.lt;
    if (dateFilter.lte) postingDate.lte = dateFilter.lte;
    const agg = await this.prisma.client.journalLine.aggregate({
      where: {
        accountId: { in: cashIds },
        entry: {
          status: { in: [...BALANCE_AFFECTING_STATUSES] },
          ...(Object.keys(postingDate).length ? { postingDate } : {}),
        },
      },
      _sum: { baseDebit: true, baseCredit: true },
    });
    return new Prisma.Decimal(agg._sum.baseDebit ?? 0).minus(agg._sum.baseCredit ?? 0);
  }

  private sectionFor(account: AccountMeta | undefined): Section {
    if (!account) return 'operating';
    return cashFlowSectionOf(account);
  }

  private parseDate(value: string | undefined, label: string, endOfDay = false): Date | undefined {
    if (!value) return undefined;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new BadRequestException(`Invalid \`${label}\` date: ${value}`);
    // Extend a date-only value (no time component) to the end of the day so the
    // upper bound is inclusive of postings made during that day.
    if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
      d.setUTCHours(23, 59, 59, 999);
    }
    return d;
  }

  private periodFilter(from?: Date, to?: Date): any {
    const f: any = {};
    if (from) f.gte = from;
    if (to) f.lte = to;
    return Object.keys(f).length ? f : undefined;
  }

  private emptyResult(range: DateRange, _from?: Date, _to?: Date) {
    return {
      from: range.from ?? null,
      to: range.to ?? null,
      openingCash: '0',
      operating: '0',
      investing: '0',
      financing: '0',
      netCashFlow: '0',
      closingCash: '0',
      actualClosingCash: '0',
      reconciled: true,
    };
  }
}
