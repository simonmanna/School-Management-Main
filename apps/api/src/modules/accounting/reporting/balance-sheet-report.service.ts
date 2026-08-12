import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ReportSection } from '@erp/shared';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { BALANCE_AFFECTING_STATUSES } from '../posting/posting.types';
import { AccountResolverService, type AccountMeta } from '../posting/account-resolver.service';
import {
  BALANCE_SHEET_SECTIONS,
  ZERO,
  balanceSheetSideOf,
  displayBalance,
  isProfitAndLoss,
} from './account-classification';

/** Snapshot rows written before the AccountCategory migration lack category data. */
const SNAPSHOT_SCHEMA_VERSION = 2;

interface SectionTotals {
  assets: Prisma.Decimal;
  liabilities: Prisma.Decimal;
  equity: Prisma.Decimal;
  earnings: Prisma.Decimal;
}

/**
 * Balance Sheet (D3). Reads from `ReportBalanceSheetSnapshot` when available;
 * falls back to live JournalLine aggregation otherwise. As-of semantics: the
 * snapshot's `asOf` must be ≤ the requested date and within 1 minute of now.
 *
 * Section membership and sign both come from the account's category — see
 * ./account-classification. This service used to carry three separate hardcoded
 * `accountType` arrays that had to be kept in sync by hand.
 */
@Injectable()
export class BalanceSheetReportService {
  private readonly logger = new Logger('BalanceSheetReportService');
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountResolverService,
  ) {}

  async balanceSheet(asOf: string) {
    const requested = new Date(asOf);
    const snap = await this.findSnapshot(requested);
    if (snap) {
      const rows = await this.prisma.client.reportBalanceSheetSnapshot.findMany({
        where: { organizationId: snap.organizationId, asOf: snap.asOf },
        orderBy: { accountCode: 'asc' },
      });
      const totals = this.emptyTotals();
      for (const r of rows as any[]) {
        // Snapshot balances are already sign-adjusted for display.
        this.accumulate(totals, r.reportSection as ReportSection | null, r.balance);
      }
      // The snapshot builder already closed revenue/expense into retained
      // earnings for the period, so no extra earnings term is added here.
      return this.summary(asOf, totals, 'snapshot');
    }
    return this.live(asOf);
  }

  private async live(asOf: string) {
    const { totals } = await this.aggregate(asOf);
    return this.summary(asOf, totals, 'live');
  }

  async balanceSheetDetailed(asOf: string) {
    const { totals, rowsBySection } = await this.aggregate(asOf, { withRows: true });

    const sections = BALANCE_SHEET_SECTIONS.map((def) => {
      const rows = rowsBySection.get(def.key) ?? [];
      let subtotal = ZERO;
      for (const r of rows) subtotal = subtotal.plus(new Prisma.Decimal(r.balance || 0));
      return {
        key: def.key,
        label: def.label,
        type: def.side,
        rows,
        subtotal: subtotal.toString(),
      };
    });

    return { ...this.summary(asOf, totals, 'live'), sections };
  }

  /**
   * One pass over the ledger. Groups by account, merges each account's category
   * behavior, then buckets by report section with a category-derived sign.
   */
  private async aggregate(
    asOf: string,
    opts: { withRows?: boolean } = {},
  ): Promise<{
    totals: SectionTotals;
    rowsBySection: Map<ReportSection, Array<{ accountId: string; code: string; name: string; balance: string }>>;
  }> {
    const grouped = await this.prisma.client.journalLine.groupBy({
      by: ['accountId'],
      where: {
        entry: {
          status: { in: [...BALANCE_AFFECTING_STATUSES] },
          postingDate: { lte: new Date(asOf) },
        },
      },
      _sum: { baseDebit: true, baseCredit: true },
    });

    const meta = await this.accounts.meta((grouped as any[]).map((g) => g.accountId));
    const totals = this.emptyTotals();
    const rowsBySection = new Map<
      ReportSection,
      Array<{ accountId: string; code: string; name: string; balance: string; sortOrder: number }>
    >();

    for (const g of grouped as any[]) {
      const account = meta.get(g.accountId);
      if (!account || !account.isActive) continue;

      const debit = new Prisma.Decimal(g._sum.baseDebit ?? 0);
      const credit = new Prisma.Decimal(g._sum.baseCredit ?? 0);
      const display = displayBalance(debit.minus(credit), account);

      this.accumulate(totals, account.reportSection, display);

      if (opts.withRows && balanceSheetSideOf(account.reportSection)) {
        const key = account.reportSection as ReportSection;
        const list = rowsBySection.get(key) ?? [];
        list.push({
          accountId: account.id,
          code: account.code,
          name: account.name,
          balance: display.toString(),
          sortOrder: account.sortOrder,
        });
        rowsBySection.set(key, list);
      }
    }

    for (const list of rowsBySection.values()) {
      list.sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
    }

    return { totals, rowsBySection: rowsBySection as any };
  }

  /**
   * Add a display balance to the right total. P&L sections roll into current-year
   * earnings; `off_balance` and uncategorized accounts are excluded from both
   * sides so they cannot silently unbalance the statement.
   */
  private accumulate(
    totals: SectionTotals,
    section: ReportSection | null,
    display: Prisma.Decimal | number | string,
  ): void {
    const value = new Prisma.Decimal(display ?? 0);
    const side = balanceSheetSideOf(section);
    if (side === 'asset') {
      totals.assets = totals.assets.plus(value);
      return;
    }
    if (side === 'liability') {
      totals.liabilities = totals.liabilities.plus(value);
      return;
    }
    if (side === 'equity') {
      totals.equity = totals.equity.plus(value);
      return;
    }
    // P&L: revenue and contra-revenue are already signed by normalBalance, so a
    // discount (debit-normal contra) correctly reduces earnings.
    switch (section) {
      case 'revenue':
      case 'other_income':
        totals.earnings = totals.earnings.plus(value);
        break;
      case 'contra_revenue':
      case 'cogs':
      case 'operating_expense':
      case 'other_expense':
        totals.earnings = totals.earnings.minus(value);
        break;
      default:
        break;
    }
  }

  private emptyTotals(): SectionTotals {
    return { assets: ZERO, liabilities: ZERO, equity: ZERO, earnings: ZERO };
  }

  private summary(asOf: string, t: SectionTotals, source: 'live' | 'snapshot') {
    const totalLiabilitiesAndEquity = t.liabilities.plus(t.equity).plus(t.earnings);
    return {
      asOf,
      totalAssets: t.assets.toString(),
      totalLiabilities: t.liabilities.toString(),
      totalEquity: t.equity.toString(),
      currentYearEarnings: t.earnings.toString(),
      totalLiabilitiesAndEquity: totalLiabilitiesAndEquity.toString(),
      balanced: t.assets.minus(totalLiabilitiesAndEquity).abs().lessThanOrEqualTo(0.01),
      source,
      totals: {
        assets: t.assets.toString(),
        liabilities: t.liabilities.toString(),
        equity: t.equity.toString(),
        liabilitiesAndEquity: totalLiabilitiesAndEquity.toString(),
      },
    };
  }

  /**
   * Latest snapshot ≤ asOf, served only if nothing balance-affecting posted
   * since. Pre-category (v1) rows are treated as stale: they carry no
   * reportSection, so serving them would silently drop every account from its
   * section.
   */
  private async findSnapshot(asOf: Date): Promise<{ organizationId: string; asOf: Date } | null> {
    const snap = await this.prisma.client.reportBalanceSheetSnapshot.findFirst({
      where: { asOf: { lte: asOf }, schemaVersion: { gte: SNAPSHOT_SCHEMA_VERSION } },
      orderBy: { asOf: 'desc' },
      select: { organizationId: true, asOf: true },
    });
    if (!snap) return null;
    const newer = await this.prisma.client.journalLine.count({
      where: {
        entry: {
          status: { in: [...BALANCE_AFFECTING_STATUSES] },
          postingDate: { gt: snap.asOf, lte: asOf },
        },
      },
    });
    if (newer > 0) return null;
    return snap;
  }
}

// `isProfitAndLoss` is re-exported for the snapshot builder, which needs the
// same revenue/expense predicate when it closes the period into retained earnings.
export { isProfitAndLoss };
