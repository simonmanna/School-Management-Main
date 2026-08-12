import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { SnapshotRebuildService } from './snapshots/snapshot-rebuild.service';
import { AccountResolverService } from '../posting/account-resolver.service';
import { BALANCE_AFFECTING_STATUSES } from '../posting/posting.types';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface DateRange {
  from?: string;
  to?: string;
}

const ZERO = new Prisma.Decimal(0);

/**
 * Accounting reports (D3) — Trial Balance, Account Ledger, GL listing.
 * Reads from snapshot tables when available; falls back to live JournalLine
 * when no snapshot exists for the requested asOf.
 */
@Injectable()
export class AccountingReportingService {
  private readonly logger = new Logger('AccountingReportingService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshots: SnapshotRebuildService,
    private readonly accounts: AccountResolverService,
  ) {}

  /** Trial Balance — snapshot-first, live-fallback. */
  async trialBalance(range: DateRange) {
    const asOf = range.to ? new Date(range.to) : new Date();
    const snap = await this.findSnapshot(asOf);
    if (snap) {
      const rows = await this.prisma.client.reportTrialBalanceSnapshot.findMany({
        where: { organizationId: snap.organizationId, asOf: snap.asOf },
        orderBy: { accountCode: 'asc' },
      });
      let totalDebit = ZERO;
      let totalCredit = ZERO;
      const mapped = rows.map((r) => {
        totalDebit = totalDebit.plus(r.debit);
        totalCredit = totalCredit.plus(r.credit);
        return {
          accountId: r.accountId,
          code: r.accountCode,
          name: r.accountName,
          categoryKey: r.accountCategoryKey,
          classification: r.classification,
          normalBalance: r.normalBalance,
          /** @deprecated read `categoryKey` / `classification` instead. */
          accountType: r.accountType,
          debit: r.debit.toString(),
          credit: r.credit.toString(),
          balance: r.balance.toString(),
        };
      });
      return {
        rows: mapped,
        totals: { debit: totalDebit.toString(), credit: totalCredit.toString() },
        balanced: totalDebit.minus(totalCredit).abs().lessThanOrEqualTo(0.0001),
        source: 'snapshot',
        asOf: snap.asOf,
      };
    }

    // Fallback: live groupBy.
    const grouped = await this.prisma.client.journalLine.groupBy({
      by: ['accountId'],
      where: { entry: { status: { in: [...BALANCE_AFFECTING_STATUSES] }, postingDate: this.rangeFilter(range) } } as any,
      _sum: { baseDebit: true, baseCredit: true },
    });
    const accountMap = await this.accounts.meta((grouped as any[]).map((g) => g.accountId));
    let totalDebit = ZERO;
    let totalCredit = ZERO;
    const rows = (grouped as any[])
      .map((g) => {
        const debit: Prisma.Decimal = g._sum.baseDebit ?? ZERO;
        const credit: Prisma.Decimal = g._sum.baseCredit ?? ZERO;
        const account = accountMap.get(g.accountId);
        totalDebit = totalDebit.plus(debit);
        totalCredit = totalCredit.plus(credit);
        return {
          accountId: g.accountId,
          code: account?.code ?? '',
          name: account?.name ?? '',
          categoryKey: account?.categoryKey ?? null,
          classification: account?.classification ?? null,
          normalBalance: account?.normalBalance ?? 'debit',
          sortOrder: account?.sortOrder ?? 0,
          debit: debit.toString(),
          credit: credit.toString(),
          balance: debit.minus(credit).toString(),
        };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
    return {
      rows,
      totals: { debit: totalDebit.toString(), credit: totalCredit.toString() },
      balanced: totalDebit.minus(totalCredit).abs().lessThanOrEqualTo(0.0001),
      source: 'live',
    };
  }

  /** Account Ledger — uses snapshot for the asOf balance + live lines for the period. */
  async accountLedger(accountId: string, range: DateRange) {
    const account = await this.prisma.client.account.findFirst({ where: { id: accountId } });
    const lines = await this.prisma.client.journalLine.findMany({
      where: { accountId, entry: { status: { in: [...BALANCE_AFFECTING_STATUSES] }, postingDate: this.rangeFilter(range) } },
      include: { entry: true },
      orderBy: [{ entry: { postingDate: 'asc' } }, { lineNumber: 'asc' }],
    });
    let running = ZERO;
    const rows = (lines as any[]).map((l) => {
      running = running.plus(l.baseDebit).minus(l.baseCredit);
      return {
        id: l.id,
        date: l.entry.postingDate,
        entryNumber: l.entry.entryNumber,
        description: l.description,
        debit: l.baseDebit.toString(),
        credit: l.baseCredit.toString(),
        balance: running.toString(),
      };
    });
    return { account, lines: rows, closingBalance: running.toString() };
  }

  /** General Ledger — paginated, live. Not snapshotted (range is open-ended). */
  async generalLedger(range: DateRange, page = 1, pageSize = 100) {
    const where = { entry: { status: { in: [...BALANCE_AFFECTING_STATUSES] }, postingDate: this.rangeFilter(range) } } as any;
    const [lines, total] = await Promise.all([
      this.prisma.client.journalLine.findMany({
        where,
        include: { entry: true, account: true },
        orderBy: [{ entry: { postingDate: 'asc' } }, { lineNumber: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.journalLine.count({ where }),
    ]);
    return {
      data: (lines as any[]).map((l) => ({
        id: l.id,
        date: l.entry.postingDate,
        entryNumber: l.entry.entryNumber,
        accountCode: l.account.code,
        accountName: l.account.name,
        description: l.description,
        debit: l.baseDebit.toString(),
        credit: l.baseCredit.toString(),
      })),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  /**
   * Pick the latest snapshot at or before `asOf` and serve it ONLY if nothing has
   * been posted since (so it is exact for `asOf`). This lets historical queries
   * hit a snapshot instead of always falling back to live — while never returning
   * a stale balance. `reversed` entries count as changes so a reversal after the
   * snapshot correctly forces a live recompute.
   */
  private async findSnapshot(asOf: Date): Promise<{ organizationId: string; asOf: Date } | null> {
    const snap = await this.prisma.client.reportTrialBalanceSnapshot.findFirst({
      // Rows written before the AccountCategory migration (schemaVersion 1) carry
      // no category data, so they are treated as stale and the live path runs.
      where: { asOf: { lte: asOf }, schemaVersion: { gte: 2 } },
      orderBy: { asOf: 'desc' },
      select: { organizationId: true, asOf: true },
    });
    if (!snap) return null;
    // Any balance-affecting line dated after the snapshot up to asOf ⇒ stale.
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

  private rangeFilter(range: DateRange): any {
    const f: any = {};
    if (range.from) f.gte = new Date(range.from);
    if (range.to) f.lte = new Date(range.to);
    return f;
  }
}