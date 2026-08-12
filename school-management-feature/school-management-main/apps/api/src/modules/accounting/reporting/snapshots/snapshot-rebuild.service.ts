import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../kernel/prisma/prisma.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Reporting snapshot rebuild (D3).
 *
 * Reads posted entries directly from `JournalLine` / `Document` and materializes
 * the four reporting tables (Trial Balance, P&L, Balance Sheet, AP Aging).
 * Reports then read from these tables so a 1M-row tenant returns in <500ms.
 *
 * Snapshot key is (organizationId, asOf). The nightly cron worker calls
 * `rebuildAll()` with `asOf = now` so reports for "today" hit the snapshot.
 * For historical queries older than the latest snapshot, reports fall back
 * to the live query path.
 */
@Injectable()
export class SnapshotRebuildService {
  private readonly logger = new Logger('SnapshotRebuildService');

  constructor(private readonly prisma: PrismaService) {}

  /** Rebuild snapshots for every organization, keyed on `asOf`. */
  async rebuildAll(asOf: Date = new Date()): Promise<{ orgs: number; durationMs: number }> {
    const started = Date.now();
    const orgs = await this.prisma.raw.organization.findMany({ select: { id: true } });
    for (const org of orgs) {
      try {
        await this.rebuildForOrg(org.id, asOf);
      } catch (err) {
        this.logger.error(`Snapshot rebuild failed for org ${org.id}: ${String(err)}`);
      }
    }
    return { orgs: orgs.length, durationMs: Date.now() - started };
  }

  /** Rebuild snapshots for a single organization. Idempotent. */
  async rebuildForOrg(organizationId: string, asOf: Date = new Date()): Promise<void> {
    await Promise.all([
      this.rebuildTrialBalance(organizationId, asOf),
      this.rebuildPnL(organizationId, asOf),
      this.rebuildBalanceSheet(organizationId, asOf),
      this.rebuildApAging(organizationId, asOf),
    ]);
  }

  // ─── Trial Balance ──────────────────────────────────────────────────────
  private async rebuildTrialBalance(organizationId: string, asOf: Date): Promise<void> {
    // Wipe any prior snapshot at this asOf.
    await this.prisma.client.reportTrialBalanceSnapshot.deleteMany({
      where: { organizationId, asOf },
    });

    const grouped = await this.prisma.client.journalLine.groupBy({
      by: ['accountId'],
      where: { entry: { status: 'posted', postingDate: { lte: asOf } } },
      _sum: { baseDebit: true, baseCredit: true },
    });
    if (grouped.length === 0) return;

    const accountIds = (grouped as any[]).map((g) => g.accountId);
    const accounts = await this.prisma.client.account.findMany({
      where: { id: { in: accountIds } },
    });
    const acctById = new Map((accounts as any[]).map((a) => [a.id, a]));

    const rows: Prisma.ReportTrialBalanceSnapshotCreateManyInput[] = [];
    for (const g of grouped as any[]) {
      const acct = acctById.get(g.accountId);
      if (!acct) continue;
      const debit = new Prisma.Decimal(g._sum.baseDebit ?? 0);
      const credit = new Prisma.Decimal(g._sum.baseCredit ?? 0);
      const balance = debit.minus(credit);
      rows.push({
        organizationId,
        asOf,
        accountId: acct.id,
        accountCode: acct.code,
        accountName: acct.name,
        accountType: acct.accountType,
        debit,
        credit,
        balance,
      });
    }
    if (rows.length > 0) {
      await this.prisma.client.reportTrialBalanceSnapshot.createMany({ data: rows });
    }
  }

  // ─── P&L ────────────────────────────────────────────────────────────────
  private async rebuildPnL(organizationId: string, asOf: Date): Promise<void> {
    await this.prisma.client.reportPnLSnapshot.deleteMany({ where: { organizationId, asOf } });

    const grouped = await this.prisma.client.journalLine.groupBy({
      by: ['accountId'],
      where: { entry: { status: 'posted', postingDate: { lte: asOf } } },
      _sum: { baseDebit: true, baseCredit: true },
    });
    const accountIds = (grouped as any[]).map((g) => g.accountId);
    const accounts = accountIds.length
      ? await this.prisma.client.account.findMany({ where: { id: { in: accountIds } } })
      : [];
    const acctById = new Map((accounts as any[]).map((a) => [a.id, a]));

    let revenue = new Prisma.Decimal(0);
    let contraRevenue = new Prisma.Decimal(0);
    let cogs = new Prisma.Decimal(0);
    let expense = new Prisma.Decimal(0);
    for (const g of grouped as any[]) {
      const acct = acctById.get(g.accountId);
      if (!acct) continue;
      const debit = new Prisma.Decimal(g._sum.baseDebit ?? 0);
      const credit = new Prisma.Decimal(g._sum.baseCredit ?? 0);
      const t = acct.accountType as string;
      const bal = credit.minus(debit); // credit-normal positive
      switch (t) {
        case 'revenue':
          revenue = revenue.plus(bal);
          break;
        case 'contra_revenue':
          contraRevenue = contraRevenue.plus(bal);
          break;
        case 'cost_of_goods_sold':
          cogs = cogs.plus(debit.minus(credit));
          break;
        case 'expense':
          expense = expense.plus(debit.minus(credit));
          break;
        default:
          break;
      }
    }
    const netIncome = revenue.minus(contraRevenue).minus(cogs).minus(expense);

    await this.prisma.client.reportPnLSnapshot.create({
      data: {
        organizationId,
        asOf,
        revenue,
        contraRevenue,
        cogs,
        expense,
        netIncome,
      },
    });
  }

  // ─── Balance Sheet ─────────────────────────────────────────────────────
  private async rebuildBalanceSheet(organizationId: string, asOf: Date): Promise<void> {
    await this.prisma.client.reportBalanceSheetSnapshot.deleteMany({
      where: { organizationId, asOf },
    });

    const grouped = await this.prisma.client.journalLine.groupBy({
      by: ['accountId'],
      where: { entry: { status: 'posted', postingDate: { lte: asOf } } },
      _sum: { baseDebit: true, baseCredit: true },
    });
    const accountIds = (grouped as any[]).map((g) => g.accountId);
    if (accountIds.length === 0) return;
    const accounts = await this.prisma.client.account.findMany({
      where: { id: { in: accountIds } },
    });
    const acctById = new Map((accounts as any[]).map((a) => [a.id, a]));

    const rows: Prisma.ReportBalanceSheetSnapshotCreateManyInput[] = [];
    for (const g of grouped as any[]) {
      const acct = acctById.get(g.accountId);
      if (!acct) continue;
      // Balance sheet accounts only — skip income/expense (those are P&L).
      const t = acct.accountType as string;
      if (
        t === 'revenue' ||
        t === 'contra_revenue' ||
        t === 'expense' ||
        t === 'cost_of_goods_sold'
      ) {
        continue;
      }
      const debit = new Prisma.Decimal(g._sum.baseDebit ?? 0);
      const credit = new Prisma.Decimal(g._sum.baseCredit ?? 0);
      const balance = debit.minus(credit);
      rows.push({
        organizationId,
        asOf,
        accountId: acct.id,
        accountCode: acct.code,
        accountName: acct.name,
        accountType: t,
        balance,
      });
    }
    if (rows.length > 0) {
      await this.prisma.client.reportBalanceSheetSnapshot.createMany({ data: rows });
    }
  }

  // ─── AP Aging ───────────────────────────────────────────────────────────
  private async rebuildApAging(organizationId: string, asOf: Date): Promise<void> {
    await this.prisma.client.reportApAgingSnapshot.deleteMany({
      where: { organizationId, asOf },
    });

    const bills = await this.prisma.client.document.findMany({
      where: {
        documentType: 'vendor_bill',
        status: { in: ['posted', 'paid'] },
        amountResidual: { gt: 0 },
      },
      include: { partner: true },
    });

    const asOfDate = asOf;
    const buckets = new Map<string, { total: Prisma.Decimal; current: Prisma.Decimal; b1_30: Prisma.Decimal; b31_60: Prisma.Decimal; b61_90: Prisma.Decimal; b90p: Prisma.Decimal; partnerName: string }>();

    for (const bill of bills as any[]) {
      const due = bill.dueDate ? new Date(bill.dueDate) : new Date(bill.issueDate);
      const days = Math.max(
        0,
        Math.floor((asOfDate.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)),
      );
      const residual = new Prisma.Decimal(bill.amountResidual);
      const bucket =
        days <= 0
          ? 'current'
          : days <= 30
          ? 'b1_30'
          : days <= 60
          ? 'b31_60'
          : days <= 90
          ? 'b61_90'
          : 'b90p';

      const existing = buckets.get(bill.partnerId) ?? {
        total: new Prisma.Decimal(0),
        current: new Prisma.Decimal(0),
        b1_30: new Prisma.Decimal(0),
        b31_60: new Prisma.Decimal(0),
        b61_90: new Prisma.Decimal(0),
        b90p: new Prisma.Decimal(0),
        partnerName: bill.partner?.name ?? '',
      };
      existing[bucket] = existing[bucket].plus(residual);
      existing.total = existing.total.plus(residual);
      existing.partnerName = bill.partner?.name ?? existing.partnerName;
      buckets.set(bill.partnerId, existing);
    }

    if (buckets.size === 0) return;
    const rows: Prisma.ReportApAgingSnapshotCreateManyInput[] = [];
    for (const [partnerId, b] of buckets) {
      rows.push({
        organizationId,
        asOf,
        partnerId,
        partnerName: b.partnerName,
        total: b.total,
        current: b.current,
        b1_30: b.b1_30,
        b31_60: b.b31_60,
        b61_90: b.b61_90,
        b90p: b.b90p,
      });
    }
    await this.prisma.client.reportApAgingSnapshot.createMany({ data: rows });
  }
}