import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { REPORT_SECTION_BY_KEY, type ReportSection } from '@erp/shared';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { orgTimeZone, reportEnd, reportStart } from '../../../kernel/common/report-range';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { BALANCE_AFFECTING_STATUSES } from '../posting/posting.types';
import { AccountResolverService, type AccountMeta } from '../posting/account-resolver.service';
import {
  BALANCE_SHEET_SECTIONS,
  PNL_SECTIONS,
  ZERO,
  balanceSheetSideOf,
  balanceSheetValue,
  displayBalance,
  earningsValue,
  isProfitAndLoss,
} from './account-classification';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface PeriodRange {
  from?: string;
  to?: string;
}

/** Sum of `baseDebit` / `baseCredit` for one account over one window. */
interface Movement {
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
}

const EMPTY_MOVEMENT: Movement = { debit: ZERO, credit: ZERO };

const D = (v: unknown): Prisma.Decimal => new Prisma.Decimal((v ?? 0) as any);

/**
 * Document statuses that represent a real, issued document.
 *
 * `posted` alone is not enough: an invoice that has been settled moves to
 * `paid`, and one issued outside the posting flow sits at `issued` — both are
 * taxable supplies that belong on the return. Filtering to `posted` silently
 * dropped every fully-paid invoice from the tax report.
 */
const LIVE_DOCUMENT_STATUSES = ['posted', 'paid', 'issued', 'closed'] as const;

/**
 * Detailed accounting reports — the statutory statement set plus the
 * transaction-level listings an accountant actually reconciles against.
 *
 * Every figure here is derived from `JournalLine` at read time. Nothing is
 * cached or snapshotted: these reports are the audit view, so they must agree
 * with the ledger at the instant they are run, and a stale snapshot is worse
 * than a slower query. The dashboard-speed variants of the same statements live
 * in AccountingReportingService / PnLReportService / BalanceSheetReportService /
 * CashFlowReportService, which read snapshots first.
 *
 * Section membership and sign always come from the account's category — see
 * ./account-classification. No report in this file branches on account code,
 * account name, or the legacy `accountType` mirror.
 */
@Injectable()
export class FinancialReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountResolverService,
    private readonly tenant: TenantContextService,
  ) {}

  // ─────────────────────────────── helpers ────────────────────────────────

  private date(value: string | null | undefined, fallback: Date): Date {
    if (!value) return fallback;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? fallback : d;
  }

  private async tz(): Promise<string> {
    return orgTimeZone(this.prisma.client, this.tenant.optionalOrganizationId);
  }

  /** A calendar-day `to`/`asOf` ends at the last millisecond of that local day. */
  private async endDate(value: string | null | undefined, fallback: Date): Promise<Date> {
    if (!value) return fallback;
    try {
      return reportEnd(value, await this.tz()) ?? fallback;
    } catch {
      return fallback;
    }
  }

  /** Resolve a period, defaulting to year-to-date (local midnight, 1 January). */
  private async resolvePeriod(range: PeriodRange): Promise<{ from: Date; to: Date }> {
    const tz = await this.tz();
    const safe = (fn: () => Date | undefined, fallback: Date) => {
      try {
        return fn() ?? fallback;
      } catch {
        return fallback;
      }
    };
    const to = safe(() => reportEnd(range.to, tz), new Date());
    const year = Number(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric' }).format(new Date()));
    const from = safe(() => reportStart(range.from, tz), reportStart(`${year}-01-01`, tz)!);
    return { from, to };
  }

  /**
   * The period immediately preceding `from..to`, of identical length. Used for
   * the comparative column on every statement that offers one, so "prior
   * period" is never ambiguous.
   */
  private priorPeriod(from: Date, to: Date): { from: Date; to: Date } {
    const span = to.getTime() - from.getTime();
    const priorTo = new Date(from.getTime() - 86_400_000);
    return { from: new Date(priorTo.getTime() - span), to: priorTo };
  }

  /** Posted-and-reversed movement per account for a posting-date window. */
  private async movements(where: {
    from?: Date;
    to?: Date;
    accountIds?: string[];
    branchId?: string;
    costCenterId?: string;
  }): Promise<Map<string, Movement>> {
    const postingDate: any = {};
    if (where.from) postingDate.gte = where.from;
    if (where.to) postingDate.lte = where.to;

    const grouped = await this.prisma.client.journalLine.groupBy({
      by: ['accountId'],
      where: {
        ...(where.accountIds ? { accountId: { in: where.accountIds } } : {}),
        ...(where.branchId ? { branchId: where.branchId } : {}),
        ...(where.costCenterId ? { costCenterId: where.costCenterId } : {}),
        entry: {
          status: { in: [...BALANCE_AFFECTING_STATUSES] },
          ...(Object.keys(postingDate).length ? { postingDate } : {}),
        },
      } as any,
      _sum: { baseDebit: true, baseCredit: true },
    });

    const out = new Map<string, Movement>();
    for (const g of grouped as any[]) {
      out.set(g.accountId, { debit: D(g._sum.baseDebit), credit: D(g._sum.baseCredit) });
    }
    return out;
  }

  private get(map: Map<string, Movement>, id: string): Movement {
    return map.get(id) ?? EMPTY_MOVEMENT;
  }

  /** Raw ledger net for a window: debit − credit, unsigned by any convention. */
  private net(m: Movement): Prisma.Decimal {
    return m.debit.minus(m.credit);
  }

  /** Statement-oriented balance (debit-normal positive when debited, etc.). */
  private display(m: Movement, meta: AccountMeta): Prisma.Decimal {
    return displayBalance(this.net(m), meta);
  }

  private sorted(metas: AccountMeta[]): AccountMeta[] {
    return [...metas].sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.code.localeCompare(b.code),
    );
  }

  private sectionLabel(key: ReportSection | null): string {
    return key ? (REPORT_SECTION_BY_KEY[key]?.label ?? key) : 'Unclassified';
  }

  private pct(part: Prisma.Decimal, whole: Prisma.Decimal): string {
    if (whole.isZero()) return '0';
    return part.dividedBy(whole).times(100).toDecimalPlaces(2).toString();
  }

  private variance(current: Prisma.Decimal, prior: Prisma.Decimal) {
    const delta = current.minus(prior);
    return {
      variance: delta.toString(),
      variancePercent: prior.isZero()
        ? null
        : delta.dividedBy(prior.abs()).times(100).toDecimalPlaces(2).toString(),
    };
  }

  // ───────────────────────── 1. extended trial balance ─────────────────────

  /**
   * Extended (working) trial balance: opening balance, period movement and
   * closing balance per account, in the six-column layout auditors expect.
   *
   * The plain trial balance answers "what are the balances"; this answers
   * "how did they get there", which is what a period review actually needs.
   */
  async extendedTrialBalance(range: PeriodRange, opts: { includeZero?: boolean } = {}) {
    const { from, to } = await this.resolvePeriod(range);
    const openingCutoff = new Date(from.getTime() - 1);

    const [opening, period, metaById] = await Promise.all([
      this.movements({ to: openingCutoff }),
      this.movements({ from, to }),
      this.accounts.allMeta(),
    ]);

    const totals = {
      openingDebit: ZERO,
      openingCredit: ZERO,
      periodDebit: ZERO,
      periodCredit: ZERO,
      closingDebit: ZERO,
      closingCredit: ZERO,
    };

    const rows: any[] = [];
    for (const meta of this.sorted([...metaById.values()])) {
      const open = this.get(opening, meta.id);
      const move = this.get(period, meta.id);
      const openingNet = open.debit.minus(open.credit);
      const periodNet = move.debit.minus(move.credit);
      const closingNet = openingNet.plus(periodNet);

      const isEmpty =
        openingNet.isZero() && periodNet.isZero() && move.debit.isZero() && move.credit.isZero();
      if (isEmpty && !opts.includeZero) continue;

      // A net is shown in the column its sign puts it in — never as a negative
      // number in the opposite column, which is what makes a TB foot.
      const openingDebit = openingNet.greaterThan(0) ? openingNet : ZERO;
      const openingCredit = openingNet.lessThan(0) ? openingNet.negated() : ZERO;
      const closingDebit = closingNet.greaterThan(0) ? closingNet : ZERO;
      const closingCredit = closingNet.lessThan(0) ? closingNet.negated() : ZERO;

      totals.openingDebit = totals.openingDebit.plus(openingDebit);
      totals.openingCredit = totals.openingCredit.plus(openingCredit);
      totals.periodDebit = totals.periodDebit.plus(move.debit);
      totals.periodCredit = totals.periodCredit.plus(move.credit);
      totals.closingDebit = totals.closingDebit.plus(closingDebit);
      totals.closingCredit = totals.closingCredit.plus(closingCredit);

      rows.push({
        accountId: meta.id,
        code: meta.code,
        name: meta.name,
        classification: meta.classification,
        reportSection: meta.reportSection,
        sectionLabel: this.sectionLabel(meta.reportSection),
        normalBalance: meta.normalBalance,
        openingDebit: openingDebit.toString(),
        openingCredit: openingCredit.toString(),
        periodDebit: move.debit.toString(),
        periodCredit: move.credit.toString(),
        closingDebit: closingDebit.toString(),
        closingCredit: closingCredit.toString(),
        closingBalance: displayBalance(closingNet, meta).toString(),
      });
    }

    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      rows,
      totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v.toString()])),
      balanced: totals.closingDebit.minus(totals.closingCredit).abs().lessThanOrEqualTo(0.0001),
      generatedAt: new Date().toISOString(),
    };
  }

  // ───────────────────────── 2. income statement ───────────────────────────

  /**
   * Income statement, account by account, grouped into statement sections with
   * a comparative prior period and each line's share of net revenue.
   */
  async incomeStatement(range: PeriodRange, opts: { compare?: boolean } = {}) {
    const { from, to } = await this.resolvePeriod(range);
    const prior = this.priorPeriod(from, to);

    const [current, comparative, metaById] = await Promise.all([
      this.movements({ from, to }),
      opts.compare === false ? Promise.resolve(new Map<string, Movement>()) : this.movements(prior),
      this.accounts.allMeta(),
    ]);

    const bySection = new Map<ReportSection, any[]>();
    const sectionTotals = new Map<
      ReportSection,
      { current: Prisma.Decimal; prior: Prisma.Decimal }
    >();

    for (const meta of this.sorted([...metaById.values()])) {
      if (!isProfitAndLoss(meta.classification) || !meta.reportSection) continue;
      const cur = this.display(this.get(current, meta.id), meta);
      const pri = this.display(this.get(comparative, meta.id), meta);
      if (cur.isZero() && pri.isZero()) continue;

      const section = meta.reportSection;
      if (!bySection.has(section)) bySection.set(section, []);
      if (!sectionTotals.has(section)) sectionTotals.set(section, { current: ZERO, prior: ZERO });
      const agg = sectionTotals.get(section)!;
      agg.current = agg.current.plus(cur);
      agg.prior = agg.prior.plus(pri);

      bySection.get(section)!.push({
        accountId: meta.id,
        code: meta.code,
        name: meta.name,
        amount: cur.toString(),
        priorAmount: pri.toString(),
        ...this.variance(cur, pri),
      });
    }

    const total = (key: ReportSection): { current: Prisma.Decimal; prior: Prisma.Decimal } =>
      sectionTotals.get(key) ?? { current: ZERO, prior: ZERO };

    const revenue = total('revenue');
    const contra = total('contra_revenue');
    const cogs = total('cogs');
    const opex = total('operating_expense');
    const otherIncome = total('other_income');
    const otherExpense = total('other_expense');

    const netRevenue = {
      current: revenue.current.minus(contra.current),
      prior: revenue.prior.minus(contra.prior),
    };
    const grossProfit = {
      current: netRevenue.current.minus(cogs.current),
      prior: netRevenue.prior.minus(cogs.prior),
    };
    const operatingProfit = {
      current: grossProfit.current.minus(opex.current),
      prior: grossProfit.prior.minus(opex.prior),
    };
    const netProfit = {
      current: operatingProfit.current.plus(otherIncome.current).minus(otherExpense.current),
      prior: operatingProfit.prior.plus(otherIncome.prior).minus(otherExpense.prior),
    };

    const sections = PNL_SECTIONS.map((def) => {
      const agg = total(def.key);
      const rows = (bySection.get(def.key) ?? []).map((r) => ({
        ...r,
        percentOfRevenue: this.pct(D(r.amount), netRevenue.current),
      }));
      return {
        key: def.key,
        label: def.label,
        rows,
        subtotal: agg.current.toString(),
        priorSubtotal: agg.prior.toString(),
        ...this.variance(agg.current, agg.prior),
        percentOfRevenue: this.pct(agg.current, netRevenue.current),
      };
    }).filter((s) => s.rows.length > 0 || !D(s.subtotal).isZero());

    const line = (
      label: string,
      key: string,
      v: { current: Prisma.Decimal; prior: Prisma.Decimal },
    ) => ({
      key,
      label,
      amount: v.current.toString(),
      priorAmount: v.prior.toString(),
      ...this.variance(v.current, v.prior),
      percentOfRevenue: this.pct(v.current, netRevenue.current),
    });

    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      comparativePeriod: { from: prior.from.toISOString(), to: prior.to.toISOString() },
      sections,
      subtotals: [
        line('Net Revenue', 'net_revenue', netRevenue),
        line('Gross Profit', 'gross_profit', grossProfit),
        line('Operating Profit', 'operating_profit', operatingProfit),
        line('Net Profit', 'net_profit', netProfit),
      ],
      margins: {
        grossMargin: this.pct(grossProfit.current, netRevenue.current),
        operatingMargin: this.pct(operatingProfit.current, netRevenue.current),
        netMargin: this.pct(netProfit.current, netRevenue.current),
      },
      generatedAt: new Date().toISOString(),
    };
  }

  // ───────────────────────── 3. comparative balance sheet ──────────────────

  /**
   * Balance sheet with a comparative column, laid out by section and account.
   *
   * Revenue and expense balances are folded into equity as "Current Period
   * Earnings" rather than being dropped, so the statement balances even when
   * the period has not been closed into retained earnings yet.
   */
  async comparativeBalanceSheet(asOfInput?: string, compareAsOfInput?: string) {
    const asOf = await this.endDate(asOfInput, new Date());
    const compareAsOf = compareAsOfInput
      ? await this.endDate(compareAsOfInput, new Date())
      : new Date(Date.UTC(asOf.getUTCFullYear() - 1, asOf.getUTCMonth(), asOf.getUTCDate()));

    const [current, prior, metaById] = await Promise.all([
      this.movements({ to: asOf }),
      this.movements({ to: compareAsOf }),
      this.accounts.allMeta(),
    ]);

    const bySection = new Map<ReportSection, any[]>();
    const sectionTotals = new Map<
      ReportSection,
      { current: Prisma.Decimal; prior: Prisma.Decimal }
    >();
    let earningsCurrent = ZERO;
    let earningsPrior = ZERO;

    for (const meta of this.sorted([...metaById.values()])) {
      const curNet = this.net(this.get(current, meta.id));
      const priNet = this.net(this.get(prior, meta.id));
      if (curNet.isZero() && priNet.isZero()) continue;

      if (isProfitAndLoss(meta.classification)) {
        earningsCurrent = earningsCurrent.plus(earningsValue(curNet));
        earningsPrior = earningsPrior.plus(earningsValue(priNet));
        continue;
      }
      if (!meta.reportSection || !balanceSheetSideOf(meta.reportSection)) continue;

      // Signed by the section's side, so a contra account (accumulated
      // depreciation, owner drawings) deducts rather than adds.
      const cur = balanceSheetValue(curNet, meta.reportSection);
      const pri = balanceSheetValue(priNet, meta.reportSection);

      const section = meta.reportSection;
      if (!bySection.has(section)) bySection.set(section, []);
      if (!sectionTotals.has(section)) sectionTotals.set(section, { current: ZERO, prior: ZERO });
      const agg = sectionTotals.get(section)!;
      agg.current = agg.current.plus(cur);
      agg.prior = agg.prior.plus(pri);

      bySection.get(section)!.push({
        accountId: meta.id,
        code: meta.code,
        name: meta.name,
        amount: cur.toString(),
        priorAmount: pri.toString(),
        ...this.variance(cur, pri),
      });
    }

    const sections = BALANCE_SHEET_SECTIONS.map((def) => {
      const agg = sectionTotals.get(def.key) ?? { current: ZERO, prior: ZERO };
      let subtotal = agg.current;
      let priorSubtotal = agg.prior;
      const rows = [...(bySection.get(def.key) ?? [])];
      if (def.key === 'equity' && (!earningsCurrent.isZero() || !earningsPrior.isZero())) {
        rows.push({
          accountId: null,
          code: '',
          name: 'Current Period Earnings',
          amount: earningsCurrent.toString(),
          priorAmount: earningsPrior.toString(),
          ...this.variance(earningsCurrent, earningsPrior),
          derived: true,
        });
        subtotal = subtotal.plus(earningsCurrent);
        priorSubtotal = priorSubtotal.plus(earningsPrior);
      }
      return {
        key: def.key,
        label: def.label,
        side: def.side,
        rows,
        subtotal: subtotal.toString(),
        priorSubtotal: priorSubtotal.toString(),
        ...this.variance(subtotal, priorSubtotal),
      };
    }).filter((s) => s.rows.length > 0);

    const sideTotal = (side: 'asset' | 'liability' | 'equity', key: 'subtotal' | 'priorSubtotal') =>
      sections.filter((s) => s.side === side).reduce((acc, s) => acc.plus(D((s as any)[key])), ZERO);

    const assets = sideTotal('asset', 'subtotal');
    const liabilities = sideTotal('liability', 'subtotal');
    const equity = sideTotal('equity', 'subtotal');
    const priorAssets = sideTotal('asset', 'priorSubtotal');
    const priorLiabilities = sideTotal('liability', 'priorSubtotal');
    const priorEquity = sideTotal('equity', 'priorSubtotal');
    const difference = assets.minus(liabilities.plus(equity));

    return {
      asOf: asOf.toISOString(),
      compareAsOf: compareAsOf.toISOString(),
      sections,
      totals: {
        assets: assets.toString(),
        liabilities: liabilities.toString(),
        equity: equity.toString(),
        liabilitiesAndEquity: liabilities.plus(equity).toString(),
        priorAssets: priorAssets.toString(),
        priorLiabilities: priorLiabilities.toString(),
        priorEquity: priorEquity.toString(),
        priorLiabilitiesAndEquity: priorLiabilities.plus(priorEquity).toString(),
      },
      difference: difference.toString(),
      balanced: difference.abs().lessThanOrEqualTo(0.0001),
      generatedAt: new Date().toISOString(),
    };
  }

  // ───────────────────────── 4. detailed general ledger ────────────────────

  /**
   * General ledger grouped by account, each with its opening balance and a
   * running balance down the transaction listing. This is the report an auditor
   * ties a control account back to.
   *
   * Paged by ACCOUNT (not by line) so a full-year request on a large chart
   * cannot stream an unbounded response.
   */
  async detailedGeneralLedger(
    range: PeriodRange,
    opts: { accountIds?: string[]; page?: number; pageSize?: number } = {},
  ) {
    const { from, to } = await this.resolvePeriod(range);
    const openingCutoff = new Date(from.getTime() - 1);
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, opts.pageSize ?? 25));
    const filterIds = opts.accountIds?.length ? opts.accountIds : undefined;

    const metaById = await this.accounts.allMeta();
    const [opening, period] = await Promise.all([
      this.movements({ to: openingCutoff, accountIds: filterIds }),
      this.movements({ from, to, accountIds: filterIds }),
    ]);

    // Only accounts with an opening balance or period activity are shown; a
    // ledger of empty accounts is noise, not evidence.
    const candidates = this.sorted(
      [...metaById.values()].filter((m) => {
        if (filterIds && !filterIds.includes(m.id)) return false;
        const open = this.get(opening, m.id);
        const move = this.get(period, m.id);
        return (
          !open.debit.minus(open.credit).isZero() || !move.debit.isZero() || !move.credit.isZero()
        );
      }),
    );

    const pageAccounts = candidates.slice((page - 1) * pageSize, page * pageSize);
    const pageIds = pageAccounts.map((m) => m.id);

    const lines = pageIds.length
      ? await this.prisma.client.journalLine.findMany({
          where: {
            accountId: { in: pageIds },
            entry: {
              status: { in: [...BALANCE_AFFECTING_STATUSES] },
              postingDate: { gte: from, lte: to },
            },
          },
          include: {
            entry: {
              select: {
                id: true,
                entryNumber: true,
                postingDate: true,
                description: true,
                status: true,
                sourceType: true,
              },
            },
          },
          orderBy: [{ entry: { postingDate: 'asc' } }, { lineNumber: 'asc' }],
        })
      : [];

    const partnerIds = [
      ...new Set((lines as any[]).map((l) => l.partnerId).filter(Boolean)),
    ] as string[];
    const partners = partnerIds.length
      ? await this.prisma.client.partner.findMany({
          where: { id: { in: partnerIds } },
          select: { id: true, name: true },
        })
      : [];
    const partnerName = new Map((partners as any[]).map((p) => [p.id, p.name]));

    const linesByAccount = new Map<string, any[]>();
    for (const l of lines as any[]) {
      if (!linesByAccount.has(l.accountId)) linesByAccount.set(l.accountId, []);
      linesByAccount.get(l.accountId)!.push(l);
    }

    const accounts = pageAccounts.map((meta) => {
      const open = this.get(opening, meta.id);
      const openingBalance = open.debit.minus(open.credit);
      let running = openingBalance;
      let periodDebit = ZERO;
      let periodCredit = ZERO;

      const rows = (linesByAccount.get(meta.id) ?? []).map((l) => {
        const debit = D(l.baseDebit);
        const credit = D(l.baseCredit);
        periodDebit = periodDebit.plus(debit);
        periodCredit = periodCredit.plus(credit);
        running = running.plus(debit).minus(credit);
        return {
          id: l.id,
          date: l.entry.postingDate,
          entryId: l.entry.id,
          entryNumber: l.entry.entryNumber,
          entryStatus: l.entry.status,
          sourceType: l.entry.sourceType,
          description: l.description ?? l.entry.description ?? '',
          partner: l.partnerId ? (partnerName.get(l.partnerId) ?? null) : null,
          debit: debit.toString(),
          credit: credit.toString(),
          balance: running.toString(),
        };
      });

      return {
        accountId: meta.id,
        code: meta.code,
        name: meta.name,
        classification: meta.classification,
        normalBalance: meta.normalBalance,
        sectionLabel: this.sectionLabel(meta.reportSection),
        openingBalance: openingBalance.toString(),
        periodDebit: periodDebit.toString(),
        periodCredit: periodCredit.toString(),
        closingBalance: running.toString(),
        lines: rows,
      };
    });

    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      accounts,
      meta: {
        page,
        pageSize,
        total: candidates.length,
        totalPages: Math.max(1, Math.ceil(candidates.length / pageSize)),
      },
      generatedAt: new Date().toISOString(),
    };
  }

  // ───────────────────────── 5. journal report (day book) ──────────────────

  /** Chronological listing of journal entries with their lines. */
  async journalReport(
    range: PeriodRange,
    opts: { journalId?: string; status?: string; page?: number; pageSize?: number } = {},
  ) {
    const { from, to } = await this.resolvePeriod(range);
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50));

    const statuses = opts.status ? [opts.status] : [...BALANCE_AFFECTING_STATUSES];
    const where: any = {
      status: { in: statuses },
      postingDate: { gte: from, lte: to },
      ...(opts.journalId ? { journalId: opts.journalId } : {}),
    };

    const [entries, total] = await Promise.all([
      this.prisma.client.journalEntry.findMany({
        where,
        include: {
          journal: { select: { id: true, code: true, name: true, journalType: true } },
          lines: {
            include: { account: { select: { id: true, code: true, name: true } } },
            orderBy: { lineNumber: 'asc' },
          },
        },
        orderBy: [{ postingDate: 'asc' }, { entryNumber: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.journalEntry.count({ where }),
    ]);

    let totalDebit = ZERO;
    let totalCredit = ZERO;
    const data = (entries as any[]).map((e) => {
      let debit = ZERO;
      let credit = ZERO;
      const lines = e.lines.map((l: any) => {
        debit = debit.plus(D(l.baseDebit));
        credit = credit.plus(D(l.baseCredit));
        return {
          id: l.id,
          accountId: l.accountId,
          accountCode: l.account.code,
          accountName: l.account.name,
          description: l.description ?? '',
          debit: D(l.baseDebit).toString(),
          credit: D(l.baseCredit).toString(),
        };
      });
      totalDebit = totalDebit.plus(debit);
      totalCredit = totalCredit.plus(credit);
      return {
        id: e.id,
        entryNumber: e.entryNumber,
        postingDate: e.postingDate,
        description: e.description ?? '',
        status: e.status,
        sourceType: e.sourceType,
        journal: e.journal,
        lines,
        debit: debit.toString(),
        credit: credit.toString(),
        balanced: debit.minus(credit).abs().lessThanOrEqualTo(0.0001),
      };
    });

    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      data,
      totals: { debit: totalDebit.toString(), credit: totalCredit.toString() },
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      generatedAt: new Date().toISOString(),
    };
  }

  // ───────────────────────── 6. partner ledger ─────────────────────────────

  /**
   * Receivable / payable ledger by partner, straight off the control accounts.
   *
   * Membership comes from `Account.controlAccountType`, not from an account
   * code range, so a tenant that renumbers its chart still gets the right
   * accounts here.
   */
  async partnerLedger(
    range: PeriodRange,
    opts: { type?: 'receivable' | 'payable'; partnerId?: string; detail?: boolean } = {},
  ) {
    const { from, to } = await this.resolvePeriod(range);
    const openingCutoff = new Date(from.getTime() - 1);
    const type = opts.type === 'payable' ? 'payable' : 'receivable';
    const controlType = type === 'receivable' ? 'ar' : 'ap';

    const metaById = await this.accounts.allMeta();
    let accountIds = [...metaById.values()]
      .filter((m) => m.controlAccountType === controlType)
      .map((m) => m.id);

    // Fallback: plenty of live charts never had `controlAccountType` set — it
    // is a newer column, and nothing in posting requires it. Rather than
    // returning an empty statement for those tenants, fall back to the
    // account's category, which every account does carry.
    let basis: 'control_account' | 'category' = 'control_account';
    if (accountIds.length === 0) {
      const categoryKey = type === 'receivable' ? 'receivable' : 'payable';
      accountIds = [...metaById.values()]
        .filter((m) => m.categoryKey === categoryKey)
        .map((m) => m.id);
      basis = 'category';
    }

    if (accountIds.length === 0) {
      return {
        period: { from: from.toISOString(), to: to.toISOString() },
        type,
        partners: [],
        totals: { opening: '0', debit: '0', credit: '0', closing: '0', outstanding: '0' },
        note:
          `No ${controlType.toUpperCase()} account was found. Flag the control account on the ` +
          `chart of accounts, or give it the "${type === 'receivable' ? 'receivable' : 'payable'}" category.`,
        generatedAt: new Date().toISOString(),
      };
    }

    const baseWhere = (postingDate: any): any => ({
      accountId: { in: accountIds },
      partnerId: opts.partnerId ? opts.partnerId : { not: null },
      entry: { status: { in: [...BALANCE_AFFECTING_STATUSES] }, postingDate },
    });

    const [openingRows, periodRows] = await Promise.all([
      this.prisma.client.journalLine.groupBy({
        by: ['partnerId'],
        where: baseWhere({ lte: openingCutoff }),
        _sum: { baseDebit: true, baseCredit: true },
      }),
      this.prisma.client.journalLine.groupBy({
        by: ['partnerId'],
        where: baseWhere({ gte: from, lte: to }),
        _sum: { baseDebit: true, baseCredit: true },
      }),
    ]);

    const openingByPartner = new Map<string, Prisma.Decimal>();
    for (const r of openingRows as any[]) {
      openingByPartner.set(r.partnerId, D(r._sum.baseDebit).minus(D(r._sum.baseCredit)));
    }
    const periodByPartner = new Map<string, Movement>();
    for (const r of periodRows as any[]) {
      periodByPartner.set(r.partnerId, {
        debit: D(r._sum.baseDebit),
        credit: D(r._sum.baseCredit),
      });
    }

    const partnerIds = [...new Set([...openingByPartner.keys(), ...periodByPartner.keys()])];
    const partnerRows = partnerIds.length
      ? await this.prisma.client.partner.findMany({
          where: { id: { in: partnerIds } },
          select: { id: true, name: true, email: true, phone: true },
        })
      : [];
    const partnerById = new Map((partnerRows as any[]).map((p) => [p.id, p]));

    // Transaction detail is optional — a 500-customer run does not want every
    // line, but a single-partner statement is useless without them.
    const detailByPartner = new Map<string, any[]>();
    if (opts.detail) {
      const lines = await this.prisma.client.journalLine.findMany({
        where: baseWhere({ gte: from, lte: to }),
        include: {
          entry: {
            select: { entryNumber: true, postingDate: true, description: true, sourceType: true },
          },
        },
        orderBy: [{ entry: { postingDate: 'asc' } }, { lineNumber: 'asc' }],
        take: 5000,
      });
      for (const l of lines as any[]) {
        if (!detailByPartner.has(l.partnerId)) detailByPartner.set(l.partnerId, []);
        detailByPartner.get(l.partnerId)!.push(l);
      }
    }

    let tOpening = ZERO;
    let tDebit = ZERO;
    let tCredit = ZERO;
    let tClosing = ZERO;

    const partners = partnerIds
      .map((id) => {
        const opening = openingByPartner.get(id) ?? ZERO;
        const move = periodByPartner.get(id) ?? EMPTY_MOVEMENT;
        const closing = opening.plus(move.debit).minus(move.credit);
        tOpening = tOpening.plus(opening);
        tDebit = tDebit.plus(move.debit);
        tCredit = tCredit.plus(move.credit);
        tClosing = tClosing.plus(closing);

        let running = opening;
        const lines = (detailByPartner.get(id) ?? []).map((l: any) => {
          running = running.plus(D(l.baseDebit)).minus(D(l.baseCredit));
          return {
            date: l.entry.postingDate,
            entryNumber: l.entry.entryNumber,
            description: l.description ?? l.entry.description ?? '',
            sourceType: l.entry.sourceType,
            debit: D(l.baseDebit).toString(),
            credit: D(l.baseCredit).toString(),
            balance: running.toString(),
          };
        });

        const p = partnerById.get(id);
        return {
          partnerId: id,
          name: p?.name ?? 'Unknown partner',
          email: p?.email ?? null,
          phone: p?.phone ?? null,
          opening: opening.toString(),
          debit: move.debit.toString(),
          credit: move.credit.toString(),
          closing: closing.toString(),
          // Payables are credit-normal, so their "owed" figure is the credit
          // side. Flipping it here lets both reports read as "amount owed".
          outstanding: (type === 'payable' ? closing.negated() : closing).toString(),
          lines,
        };
      })
      .filter((p) => !(D(p.opening).isZero() && D(p.debit).isZero() && D(p.credit).isZero()))
      .sort((a, b) => D(b.outstanding).comparedTo(D(a.outstanding)));

    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      type,
      partners,
      totals: {
        opening: tOpening.toString(),
        debit: tDebit.toString(),
        credit: tCredit.toString(),
        closing: tClosing.toString(),
        outstanding: (type === 'payable' ? tClosing.negated() : tClosing).toString(),
      },
      basis,
      generatedAt: new Date().toISOString(),
    };
  }

  // ───────────────────────── 7. cash book ──────────────────────────────────

  /**
   * Cash & bank book: per cash-equivalent account, the opening balance,
   * receipts, payments and closing balance, plus a day-by-day movement series.
   */
  async cashBook(range: PeriodRange) {
    const { from, to } = await this.resolvePeriod(range);
    const openingCutoff = new Date(from.getTime() - 1);

    const metaById = await this.accounts.allMeta();
    const cashAccounts = this.sorted([...metaById.values()].filter((m) => m.isCashEquivalent));
    const ids = cashAccounts.map((m) => m.id);

    if (ids.length === 0) {
      return {
        period: { from: from.toISOString(), to: to.toISOString() },
        accounts: [],
        daily: [],
        totals: { opening: '0', receipts: '0', payments: '0', closing: '0' },
        note: 'No account category is flagged as a cash equivalent.',
        generatedAt: new Date().toISOString(),
      };
    }

    const [opening, period, lines] = await Promise.all([
      this.movements({ to: openingCutoff, accountIds: ids }),
      this.movements({ from, to, accountIds: ids }),
      this.prisma.client.journalLine.findMany({
        where: {
          accountId: { in: ids },
          entry: {
            status: { in: [...BALANCE_AFFECTING_STATUSES] },
            postingDate: { gte: from, lte: to },
          },
        },
        select: { baseDebit: true, baseCredit: true, entry: { select: { postingDate: true } } },
        orderBy: { entry: { postingDate: 'asc' } },
      }),
    ]);

    let tOpening = ZERO;
    let tReceipts = ZERO;
    let tPayments = ZERO;

    const accounts = cashAccounts.map((meta) => {
      const open = this.get(opening, meta.id);
      const move = this.get(period, meta.id);
      const openingBalance = open.debit.minus(open.credit);
      const closing = openingBalance.plus(move.debit).minus(move.credit);
      tOpening = tOpening.plus(openingBalance);
      tReceipts = tReceipts.plus(move.debit);
      tPayments = tPayments.plus(move.credit);
      return {
        accountId: meta.id,
        code: meta.code,
        name: meta.name,
        categoryName: meta.categoryName,
        openingBalance: openingBalance.toString(),
        receipts: move.debit.toString(),
        payments: move.credit.toString(),
        netMovement: move.debit.minus(move.credit).toString(),
        closingBalance: closing.toString(),
      };
    });

    // Day-by-day net movement, for the trend on the report.
    const byDay = new Map<string, { receipts: Prisma.Decimal; payments: Prisma.Decimal }>();
    for (const l of lines as any[]) {
      const day = new Date(l.entry.postingDate).toISOString().slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, { receipts: ZERO, payments: ZERO });
      const bucket = byDay.get(day)!;
      bucket.receipts = bucket.receipts.plus(D(l.baseDebit));
      bucket.payments = bucket.payments.plus(D(l.baseCredit));
    }
    let runningDay = tOpening;
    const daily = [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, v]) => {
        runningDay = runningDay.plus(v.receipts).minus(v.payments);
        return {
          date,
          receipts: v.receipts.toString(),
          payments: v.payments.toString(),
          net: v.receipts.minus(v.payments).toString(),
          balance: runningDay.toString(),
        };
      });

    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      accounts,
      daily,
      totals: {
        opening: tOpening.toString(),
        receipts: tReceipts.toString(),
        payments: tPayments.toString(),
        closing: tOpening.plus(tReceipts).minus(tPayments).toString(),
      },
      generatedAt: new Date().toISOString(),
    };
  }

  // ───────────────────────── 8. tax summary ────────────────────────────────

  /**
   * VAT / tax report: output tax on sales documents against input tax on
   * purchase documents, by tax code, with the net position for the period.
   *
   * Built from `DocumentLine` (where the tax code lives) rather than from the
   * GL tax control account, because a return has to be filed per rate.
   */
  async taxSummary(range: PeriodRange) {
    const { from, to } = await this.resolvePeriod(range);
    const organizationId = this.tenant.organizationId;

    const rows = await this.prisma.raw.$queryRaw<
      Array<{ taxId: string | null; documentType: string; net: string; tax: string; docs: bigint }>
    >`
      SELECT dl."taxId"                              AS "taxId",
             d."documentType"::text                  AS "documentType",
             COALESCE(SUM(dl.subtotal), 0)::text     AS net,
             COALESCE(SUM(dl."taxAmount"), 0)::text  AS tax,
             COUNT(DISTINCT d.id)                    AS docs
      FROM "DocumentLine" dl
      JOIN "Document" d ON d.id = dl."documentId"
      WHERE dl."organizationId" = ${organizationId}
        AND d.status::text = ANY(${[...LIVE_DOCUMENT_STATUSES]})
        AND d."issueDate" >= ${from}
        AND d."issueDate" <= ${to}
      GROUP BY dl."taxId", d."documentType"
    `;

    const taxIds = [...new Set(rows.map((r) => r.taxId).filter(Boolean))] as string[];
    const taxes = taxIds.length
      ? await this.prisma.client.tax.findMany({
          where: { id: { in: taxIds } },
          select: { id: true, name: true, code: true, rate: true, type: true, vatCategory: true },
        })
      : [];
    const taxById = new Map((taxes as any[]).map((t) => [t.id, t]));

    const SALES = new Set(['sales_invoice', 'credit_note']);
    const PURCHASE = new Set(['vendor_bill', 'debit_note']);

    interface Bucket {
      taxId: string | null;
      name: string;
      code: string | null;
      rate: string;
      vatCategory: string;
      netSales: Prisma.Decimal;
      outputTax: Prisma.Decimal;
      netPurchases: Prisma.Decimal;
      inputTax: Prisma.Decimal;
      documents: number;
    }
    const buckets = new Map<string, Bucket>();

    for (const r of rows) {
      const key = r.taxId ?? 'none';
      if (!buckets.has(key)) {
        const t = r.taxId ? taxById.get(r.taxId) : null;
        buckets.set(key, {
          taxId: r.taxId,
          name: t?.name ?? 'No tax / out of scope',
          code: t?.code ?? null,
          // `Tax.rate` is stored as a percentage (18 = 18%), the same way
          // TaxCalculationService consumes it — not as a 0–1 fraction.
          rate: t ? D(t.rate).toString() : '0',
          vatCategory: t?.vatCategory ?? 'out_of_scope',
          netSales: ZERO,
          outputTax: ZERO,
          netPurchases: ZERO,
          inputTax: ZERO,
          documents: 0,
        });
      }
      const b = buckets.get(key)!;
      // A credit note reverses a sale and a debit note reverses a purchase, so
      // their amounts are subtracted rather than added.
      const sign = r.documentType === 'credit_note' || r.documentType === 'debit_note' ? -1 : 1;
      if (SALES.has(r.documentType)) {
        b.netSales = b.netSales.plus(D(r.net).times(sign));
        b.outputTax = b.outputTax.plus(D(r.tax).times(sign));
        b.documents += Number(r.docs);
      } else if (PURCHASE.has(r.documentType)) {
        b.netPurchases = b.netPurchases.plus(D(r.net).times(sign));
        b.inputTax = b.inputTax.plus(D(r.tax).times(sign));
        b.documents += Number(r.docs);
      }
    }

    let totalOutput = ZERO;
    let totalInput = ZERO;
    let totalNetSales = ZERO;
    let totalNetPurchases = ZERO;
    const data = [...buckets.values()]
      .map((b) => {
        totalOutput = totalOutput.plus(b.outputTax);
        totalInput = totalInput.plus(b.inputTax);
        totalNetSales = totalNetSales.plus(b.netSales);
        totalNetPurchases = totalNetPurchases.plus(b.netPurchases);
        return {
          taxId: b.taxId,
          name: b.name,
          code: b.code,
          rate: b.rate,
          vatCategory: b.vatCategory,
          netSales: b.netSales.toString(),
          outputTax: b.outputTax.toString(),
          netPurchases: b.netPurchases.toString(),
          inputTax: b.inputTax.toString(),
          netTax: b.outputTax.minus(b.inputTax).toString(),
          documents: b.documents,
        };
      })
      .sort((a, b) => Number(b.rate) - Number(a.rate) || a.name.localeCompare(b.name));

    const netPayable = totalOutput.minus(totalInput);
    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      rows: data,
      totals: {
        netSales: totalNetSales.toString(),
        outputTax: totalOutput.toString(),
        netPurchases: totalNetPurchases.toString(),
        inputTax: totalInput.toString(),
        netTax: netPayable.toString(),
      },
      position: netPayable.greaterThanOrEqualTo(0) ? 'payable' : 'refundable',
      generatedAt: new Date().toISOString(),
    };
  }

  // ───────────────────────── 9/10. revenue & expense analysis ──────────────

  /** Shared engine for the revenue and expense breakdowns. */
  private async sectionAnalysis(range: PeriodRange, sections: ReportSection[], label: string) {
    const { from, to } = await this.resolvePeriod(range);
    const prior = this.priorPeriod(from, to);

    const [current, comparative, metaById] = await Promise.all([
      this.movements({ from, to }),
      this.movements(prior),
      this.accounts.allMeta(),
    ]);

    const wanted = new Set(sections);
    let total = ZERO;
    let priorTotal = ZERO;
    const rows: Array<{
      accountId: string;
      code: string;
      name: string;
      categoryName: string | null;
      section: ReportSection;
      sectionLabel: string;
      amount: Prisma.Decimal;
      priorAmount: Prisma.Decimal;
    }> = [];

    for (const meta of this.sorted([...metaById.values()])) {
      if (!meta.reportSection || !wanted.has(meta.reportSection)) continue;
      const cur = this.display(this.get(current, meta.id), meta);
      const pri = this.display(this.get(comparative, meta.id), meta);
      if (cur.isZero() && pri.isZero()) continue;
      total = total.plus(cur);
      priorTotal = priorTotal.plus(pri);
      rows.push({
        accountId: meta.id,
        code: meta.code,
        name: meta.name,
        categoryName: meta.categoryName,
        section: meta.reportSection,
        sectionLabel: this.sectionLabel(meta.reportSection),
        amount: cur,
        priorAmount: pri,
      });
    }

    const data = [...rows]
      .sort((a, b) => b.amount.comparedTo(a.amount))
      .map((r) => ({
        accountId: r.accountId,
        code: r.code,
        name: r.name,
        categoryName: r.categoryName,
        section: r.section,
        sectionLabel: r.sectionLabel,
        amount: r.amount.toString(),
        priorAmount: r.priorAmount.toString(),
        percentOfTotal: this.pct(r.amount, total),
        ...this.variance(r.amount, r.priorAmount),
      }));

    // Roll the same rows up by category so the report reads at two altitudes.
    const byCategory = new Map<string, { amount: Prisma.Decimal; prior: Prisma.Decimal }>();
    for (const r of rows) {
      const key = r.categoryName ?? r.sectionLabel;
      if (!byCategory.has(key)) byCategory.set(key, { amount: ZERO, prior: ZERO });
      const b = byCategory.get(key)!;
      b.amount = b.amount.plus(r.amount);
      b.prior = b.prior.plus(r.priorAmount);
    }

    return {
      label,
      period: { from: from.toISOString(), to: to.toISOString() },
      comparativePeriod: { from: prior.from.toISOString(), to: prior.to.toISOString() },
      rows: data,
      categories: [...byCategory.entries()]
        .map(([name, v]) => ({
          name,
          amount: v.amount.toString(),
          priorAmount: v.prior.toString(),
          percentOfTotal: this.pct(v.amount, total),
          ...this.variance(v.amount, v.prior),
        }))
        .sort((a, b) => D(b.amount).comparedTo(D(a.amount))),
      totals: {
        amount: total.toString(),
        priorAmount: priorTotal.toString(),
        ...this.variance(total, priorTotal),
      },
      generatedAt: new Date().toISOString(),
    };
  }

  revenueAnalysis(range: PeriodRange) {
    return this.sectionAnalysis(range, ['revenue', 'other_income'], 'Revenue');
  }

  expenseAnalysis(range: PeriodRange) {
    return this.sectionAnalysis(range, ['cogs', 'operating_expense', 'other_expense'], 'Expenses');
  }

  // ───────────────────────── 11. statement of changes in equity ────────────

  /**
   * Statement of changes in equity: opening equity per account, movements in
   * the period, the period's profit, and closing equity.
   */
  async equityStatement(range: PeriodRange) {
    const { from, to } = await this.resolvePeriod(range);
    const openingCutoff = new Date(from.getTime() - 1);

    const [opening, period, metaById] = await Promise.all([
      this.movements({ to: openingCutoff }),
      this.movements({ from, to }),
      this.accounts.allMeta(),
    ]);

    let openingTotal = ZERO;
    let movementTotal = ZERO;
    const rows: any[] = [];

    for (const meta of this.sorted([...metaById.values()])) {
      if (meta.classification !== 'equity') continue;
      const open = this.display(this.get(opening, meta.id), meta);
      const move = this.display(this.get(period, meta.id), meta);
      if (open.isZero() && move.isZero()) continue;
      openingTotal = openingTotal.plus(open);
      movementTotal = movementTotal.plus(move);
      rows.push({
        accountId: meta.id,
        code: meta.code,
        name: meta.name,
        opening: open.toString(),
        movement: move.toString(),
        closing: open.plus(move).toString(),
      });
    }

    // Profit for the period is the equity movement the ledger has not closed
    // out yet — shown as its own line so the statement reconciles.
    let profit = ZERO;
    for (const meta of metaById.values()) {
      if (!isProfitAndLoss(meta.classification)) continue;
      profit = profit.plus(earningsValue(this.net(this.get(period, meta.id))));
    }

    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      rows,
      profitForPeriod: profit.toString(),
      totals: {
        opening: openingTotal.toString(),
        movement: movementTotal.toString(),
        profitForPeriod: profit.toString(),
        closing: openingTotal.plus(movementTotal).plus(profit).toString(),
      },
      generatedAt: new Date().toISOString(),
    };
  }

  // ───────────────────────── 12. financial ratios ──────────────────────────

  /**
   * The standard liquidity / profitability / leverage / efficiency ratio set,
   * each returned with the raw inputs that produced it so a reviewer can check
   * the arithmetic without re-running three other reports.
   */
  async financialRatios(range: PeriodRange) {
    const { from, to } = await this.resolvePeriod(range);

    const [asOfMoves, periodMoves, metaById] = await Promise.all([
      this.movements({ to }),
      this.movements({ from, to }),
      this.accounts.allMeta(),
    ]);

    /** Balance-sheet section total, signed by side so contra accounts deduct. */
    const bsSection = (sections: ReportSection[]): Prisma.Decimal => {
      const wanted = new Set(sections);
      let sum = ZERO;
      for (const meta of metaById.values()) {
        if (!meta.reportSection || !wanted.has(meta.reportSection)) continue;
        sum = sum.plus(balanceSheetValue(this.net(this.get(asOfMoves, meta.id)), meta.reportSection));
      }
      return sum;
    };

    /** P&L section total for the period, positive in the direction it reads. */
    const plSection = (sections: ReportSection[]): Prisma.Decimal => {
      const wanted = new Set(sections);
      let sum = ZERO;
      for (const meta of metaById.values()) {
        if (!meta.reportSection || !wanted.has(meta.reportSection)) continue;
        sum = sum.plus(this.display(this.get(periodMoves, meta.id), meta));
      }
      return sum;
    };

    const currentAssets = bsSection(['current_assets']);
    const nonCurrentAssets = bsSection(['non_current_assets']);
    const currentLiabilities = bsSection(['current_liabilities']);
    const longTermLiabilities = bsSection(['long_term_liabilities']);
    const bookedEquity = bsSection(['equity']);

    let cash = ZERO;
    let inventory = ZERO;
    let receivables = ZERO;
    let payables = ZERO;
    for (const meta of metaById.values()) {
      const value = this.display(this.get(asOfMoves, meta.id), meta);
      if (meta.isCashEquivalent) cash = cash.plus(value);
      if (meta.controlAccountType === 'inventory') inventory = inventory.plus(value);
      if (meta.controlAccountType === 'ar') receivables = receivables.plus(value);
      if (meta.controlAccountType === 'ap') payables = payables.plus(value);
    }

    const revenue = plSection(['revenue']).minus(plSection(['contra_revenue']));
    const cogs = plSection(['cogs']);
    const opex = plSection(['operating_expense']);
    const otherIncome = plSection(['other_income']);
    const otherExpense = plSection(['other_expense']);
    const grossProfit = revenue.minus(cogs);
    const netProfit = grossProfit.minus(opex).plus(otherIncome).minus(otherExpense);

    // Retained earnings are not closed until year end, so equity for the ratios
    // is taken as assets − liabilities. Using the booked equity accounts alone
    // would understate the denominator on every leverage and return ratio.
    const totalAssets = currentAssets.plus(nonCurrentAssets);
    const totalLiabilities = currentLiabilities.plus(longTermLiabilities);
    const equity = totalAssets.minus(totalLiabilities);
    const periodDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1);

    const ratio = (
      key: string,
      label: string,
      group: string,
      numerator: Prisma.Decimal,
      denominator: Prisma.Decimal,
      format: 'ratio' | 'percent' | 'amount' | 'days',
      basis: string,
    ) => {
      let value: string | null = null;
      if (format === 'amount') {
        value = numerator.toString();
      } else if (!denominator.isZero()) {
        const raw = numerator.dividedBy(denominator);
        value =
          format === 'percent'
            ? raw.times(100).toDecimalPlaces(2).toString()
            : format === 'days'
              ? raw.times(periodDays).toDecimalPlaces(1).toString()
              : raw.toDecimalPlaces(3).toString();
      }
      return {
        key,
        label,
        group,
        format,
        value,
        numerator: numerator.toString(),
        denominator: denominator.toString(),
        basis,
      };
    };

    return {
      period: { from: from.toISOString(), to: to.toISOString(), days: periodDays },
      inputs: {
        currentAssets: currentAssets.toString(),
        nonCurrentAssets: nonCurrentAssets.toString(),
        totalAssets: totalAssets.toString(),
        currentLiabilities: currentLiabilities.toString(),
        longTermLiabilities: longTermLiabilities.toString(),
        totalLiabilities: totalLiabilities.toString(),
        equity: equity.toString(),
        bookedEquity: bookedEquity.toString(),
        cash: cash.toString(),
        inventory: inventory.toString(),
        receivables: receivables.toString(),
        payables: payables.toString(),
        revenue: revenue.toString(),
        cogs: cogs.toString(),
        grossProfit: grossProfit.toString(),
        operatingExpenses: opex.toString(),
        netProfit: netProfit.toString(),
      },
      ratios: [
        ratio('current_ratio', 'Current Ratio', 'Liquidity', currentAssets, currentLiabilities, 'ratio', 'Current assets ÷ current liabilities'),
        ratio('quick_ratio', 'Quick Ratio', 'Liquidity', currentAssets.minus(inventory), currentLiabilities, 'ratio', '(Current assets − inventory) ÷ current liabilities'),
        ratio('cash_ratio', 'Cash Ratio', 'Liquidity', cash, currentLiabilities, 'ratio', 'Cash & equivalents ÷ current liabilities'),
        ratio('working_capital', 'Working Capital', 'Liquidity', currentAssets.minus(currentLiabilities), ZERO, 'amount', 'Current assets − current liabilities'),
        ratio('gross_margin', 'Gross Margin', 'Profitability', grossProfit, revenue, 'percent', 'Gross profit ÷ net revenue'),
        ratio('net_margin', 'Net Margin', 'Profitability', netProfit, revenue, 'percent', 'Net profit ÷ net revenue'),
        ratio('return_on_assets', 'Return on Assets', 'Profitability', netProfit, totalAssets, 'percent', 'Net profit ÷ total assets'),
        ratio('return_on_equity', 'Return on Equity', 'Profitability', netProfit, equity, 'percent', 'Net profit ÷ equity'),
        ratio('debt_to_equity', 'Debt to Equity', 'Leverage', totalLiabilities, equity, 'ratio', 'Total liabilities ÷ equity'),
        ratio('debt_ratio', 'Debt Ratio', 'Leverage', totalLiabilities, totalAssets, 'percent', 'Total liabilities ÷ total assets'),
        ratio('equity_ratio', 'Equity Ratio', 'Leverage', equity, totalAssets, 'percent', 'Equity ÷ total assets'),
        ratio('expense_ratio', 'Operating Expense Ratio', 'Efficiency', opex, revenue, 'percent', 'Operating expenses ÷ net revenue'),
        ratio('receivable_days', 'Debtor Days', 'Efficiency', receivables, revenue, 'days', 'Receivables ÷ revenue × period days'),
        ratio('payable_days', 'Creditor Days', 'Efficiency', payables, cogs, 'days', 'Payables ÷ cost of sales × period days'),
        ratio('inventory_days', 'Inventory Days', 'Efficiency', inventory, cogs, 'days', 'Inventory ÷ cost of sales × period days'),
      ],
      generatedAt: new Date().toISOString(),
    };
  }

  // ───────────────────────── 13. chart of accounts with balances ───────────

  /** The chart of accounts as a report: every account with its as-of balance. */
  async accountBalances(asOfInput?: string, opts: { includeZero?: boolean } = {}) {
    const asOf = await this.endDate(asOfInput, new Date());
    const [moves, metaById] = await Promise.all([
      this.movements({ to: asOf }),
      this.accounts.allMeta(),
    ]);

    const rows: any[] = [];
    const totals = new Map<string, Prisma.Decimal>();
    for (const meta of this.sorted([...metaById.values()])) {
      const m = this.get(moves, meta.id);
      const balance = this.display(m, meta);
      if (balance.isZero() && m.debit.isZero() && !opts.includeZero) continue;
      const cls = meta.classification ?? 'unclassified';
      totals.set(cls, (totals.get(cls) ?? ZERO).plus(balance));
      rows.push({
        accountId: meta.id,
        code: meta.code,
        name: meta.name,
        classification: meta.classification,
        categoryKey: meta.categoryKey,
        categoryName: meta.categoryName,
        reportSection: meta.reportSection,
        sectionLabel: this.sectionLabel(meta.reportSection),
        normalBalance: meta.normalBalance,
        controlAccountType: meta.controlAccountType,
        isPostable: meta.isPostable,
        isActive: meta.isActive,
        debit: m.debit.toString(),
        credit: m.credit.toString(),
        balance: balance.toString(),
      });
    }

    return {
      asOf: asOf.toISOString(),
      rows,
      totalsByClassification: Object.fromEntries(
        [...totals.entries()].map(([k, v]) => [k, v.toString()]),
      ),
      generatedAt: new Date().toISOString(),
    };
  }
}
