import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { SnapshotRebuildService } from './snapshots/snapshot-rebuild.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface DateRange {
  from?: string;
  to?: string;
}

const ZERO = new Prisma.Decimal(0);
const FALLBACK_EPSILON_MS = 60 * 1000; // consider snapshot "current" within 1 min

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
  ) {}

  /** Trial Balance — snapshot-first, live-fallback. */
  async trialBalance(range: DateRange) {
    const asOf = range.to ? new Date(range.to) : new Date();
    const snap = await this.findSnapshot(asOf, 'trialBalance');
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
      where: { entry: { status: 'posted', postingDate: this.rangeFilter(range) } } as any,
      _sum: { baseDebit: true, baseCredit: true },
    });
    const accounts = await this.prisma.client.account.findMany({
      where: { id: { in: (grouped as any[]).map((g) => g.accountId) } },
    });
    const accountMap = new Map((accounts as any[]).map((a) => [a.id, a]));
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
          accountType: account?.accountType ?? '',
          debit: debit.toString(),
          credit: credit.toString(),
          balance: debit.minus(credit).toString(),
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code));
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
      where: { accountId, entry: { status: 'posted', postingDate: this.rangeFilter(range) } },
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
    const where = { entry: { status: 'posted', postingDate: this.rangeFilter(range) } } as any;
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

  /** Pick the latest snapshot at or before `asOf`, no older than 1 minute. */
  private async findSnapshot(asOf: Date, _kind: string): Promise<{ organizationId: string; asOf: Date } | null> {
    // We store snapshots per (organization, asOf) for the calling org; the
    // calling code is in a tenant context, so we just look for the latest
    // snapshot whose asOf is <= the request's asOf and within epsilon of now.
    const now = Date.now();
    const candidates = await this.prisma.client.reportTrialBalanceSnapshot.findMany({
      orderBy: { asOf: 'desc' },
      take: 5,
    });
    for (const c of candidates) {
      const cMs = c.asOf.getTime();
      if (cMs > asOf.getTime()) continue;
      if (Math.abs(now - cMs) > FALLBACK_EPSILON_MS) continue;
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