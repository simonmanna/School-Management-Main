import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { dec, ZERO } from '../../../kernel/common/money';
import { BALANCE_AFFECTING_STATUSES } from '../posting/posting.types';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface StatementLineInput {
  postedAt: Date | string;
  externalRef?: string;
  description: string;
  amount: string | number | Prisma.Decimal;
  currencyCode?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TOLERANCE_DAYS = 7;

/** A ledger line on the bank's GL account, as the matcher sees it. */
interface LedgerCandidate {
  id: string;
  postingDate: Date;
  signed: Prisma.Decimal;
}

/**
 * Bank reconciliation against the general ledger (wave 18, ADR-033).
 *
 * A statement line is reconciled to a JournalLine on the bank's ledger account
 * (`BankAccount.accountId`). Every movement that hits the bank in the books —
 * fee receipts, expense and supplier payments, mobile-money payouts, refunds,
 * transfers and manual journals — is a line there, so one matcher covers them
 * all. Amounts are signed the bank's way: money in is positive, and a ledger
 * line's signed amount is `baseDebit − baseCredit`.
 *
 * - `importStatement` — dedupe on a content key per line (bank reference, else
 *   date|amount|description|occurrence), in one transaction, audited.
 * - `match` — exact signed amount + currency within a date window, closest date
 *   wins, ties left for a person; a ledger line is matched at most once across
 *   all runs (partial unique index).
 * - `matchLine` / `unmatch` / `exclude` — manual, audited, conditional.
 * - `report` — adjusted bank vs adjusted book balance; difference must be 0.
 */
@Injectable()
export class BankReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  // ─── Import ───────────────────────────────────────────────────────────────

  async importStatement(
    bankAccountId: string,
    lines: StatementLineInput[],
    currencyCode?: string,
  ): Promise<{ imported: number; skipped: number }> {
    const organizationId = this.tenant.organizationId;
    if (!Array.isArray(lines) || lines.length === 0) throw new BadRequestException('No statement lines to import');
    if (lines.length > 5000) throw new BadRequestException('Import at most 5000 lines at a time');

    return this.prisma.client.$transaction(async (tx: any) => {
      const bank = await this.requireBank(tx, bankAccountId);
      const bankCurrency = await this.bankCurrency(tx, bank);
      const occurrences = new Map<string, number>();
      const rows = lines.map((l, i) => {
        const postedAt = new Date(l.postedAt);
        if (Number.isNaN(postedAt.getTime())) throw new BadRequestException(`Line ${i + 1}: invalid date`);
        let amount: Prisma.Decimal;
        try {
          amount = dec(l.amount as any);
        } catch {
          throw new BadRequestException(`Line ${i + 1}: invalid amount`);
        }
        if (amount.isZero()) throw new BadRequestException(`Line ${i + 1}: amount cannot be zero`);
        const description = String(l.description ?? '').trim();
        if (!description) throw new BadRequestException(`Line ${i + 1}: description is required`);
        const ref = l.externalRef?.trim() || null;
        let contentKey: string;
        if (ref) {
          contentKey = `ref:${ref}`;
        } else {
          const base = `row:${postedAt.toISOString().slice(0, 10)}|${amount.toFixed(2)}|${description.toLowerCase().replace(/\s+/g, ' ')}`;
          const n = (occurrences.get(base) ?? 0) + 1;
          occurrences.set(base, n);
          contentKey = `${base}|${n}`;
        }
        return {
          organizationId,
          bankAccountId: bank.id,
          postedAt,
          externalRef: ref,
          contentKey,
          description,
          amount,
          currencyCode: (l.currencyCode ?? currencyCode ?? bankCurrency).toUpperCase(),
          importedById: this.tenant.userId ?? null,
        };
      });

      const res = await tx.bankStatementLine.createMany({ data: rows, skipDuplicates: true });
      const imported = res.count;
      const skipped = rows.length - imported;
      await this.audit.recordInTx(tx, {
        entity: 'BankStatementLine',
        entityId: bank.id,
        action: 'create',
        newValues: { op: 'import', imported, skipped },
      });
      await this.events.publishInTx(tx, 'bank_statement.imported', {
        organizationId,
        bankAccountId: bank.id,
        imported,
        skipped,
      });
      return { imported, skipped };
    });
  }

  // ─── Auto-match ───────────────────────────────────────────────────────────

  async match(
    bankAccountId: string,
    opts: { dateToleranceDays?: number; notes?: string } = {},
  ): Promise<{ runId: string; matched: number; unmatched: number; ambiguous: number }> {
    const organizationId = this.tenant.organizationId;
    const tolerance = Math.min(Math.max(Math.floor(opts.dateToleranceDays ?? 3), 0), MAX_TOLERANCE_DAYS);

    return this.prisma.client.$transaction(async (tx: any) => {
      const bank = await this.requireBank(tx, bankAccountId);
      const bankCurrency = await this.bankCurrency(tx, bank);
      // One matcher per bank account at a time.
      await tx.$queryRawUnsafe(
        `SELECT id FROM "BankStatementLine"
          WHERE "organizationId" = $1 AND "bankAccountId" = $2 AND status = 'unmatched'
          ORDER BY id FOR UPDATE`,
        organizationId,
        bank.id,
      );
      const lines = await tx.bankStatementLine.findMany({
        where: { bankAccountId: bank.id, status: 'unmatched' },
        orderBy: [{ postedAt: 'asc' }, { id: 'asc' }],
      });

      const run = await tx.bankReconciliationRun.create({
        data: {
          organizationId,
          bankAccountId: bank.id,
          startedAt: new Date(),
          totalAmount: ZERO,
          notes: opts.notes ?? null,
          createdById: this.tenant.userId ?? null,
        },
      });

      const used = new Set<string>();
      let matched = 0;
      let ambiguous = 0;
      for (const line of lines as any[]) {
        if (String(line.currencyCode).toUpperCase() !== bankCurrency) continue;
        const postedAt = new Date(line.postedAt);
        const candidates = (
          await this.candidates(tx, bank.accountId, dec(line.amount), postedAt, tolerance)
        ).filter((c) => !used.has(c.id));
        if (candidates.length === 0) continue;
        const distance = (c: LedgerCandidate) => Math.abs(c.postingDate.getTime() - postedAt.getTime());
        candidates.sort((a, b) => distance(a) - distance(b));
        if (candidates.length > 1 && distance(candidates[0]) === distance(candidates[1])) {
          ambiguous++;
          continue; // two equally good ledger lines — a person decides
        }
        const pick = candidates[0];
        await tx.bankReconciliationMatch.create({
          data: {
            organizationId,
            statementLineId: line.id,
            journalLineId: pick.id,
            runId: run.id,
            method: 'auto',
            matchedById: this.tenant.userId ?? null,
          },
        });
        await tx.bankStatementLine.updateMany({ where: { id: line.id, status: 'unmatched' }, data: { status: 'matched' } });
        used.add(pick.id);
        matched++;
      }

      const totalAmount = (lines as any[]).reduce((acc, l) => acc.plus(dec(l.amount)), ZERO);
      await tx.bankReconciliationRun.update({
        where: { id: run.id },
        data: { finishedAt: new Date(), matched, unmatched: lines.length - matched, totalAmount },
      });
      await this.audit.recordInTx(tx, {
        entity: 'BankReconciliationRun',
        entityId: run.id,
        action: 'reconcile',
        newValues: { matched, unmatched: lines.length - matched, ambiguous, toleranceDays: tolerance },
      });
      await this.events.publishInTx(tx, 'bank_reconciliation.ran', {
        organizationId,
        bankAccountId: bank.id,
        runId: run.id,
        matched,
        unmatched: lines.length - matched,
      });
      return { runId: run.id, matched, unmatched: lines.length - matched, ambiguous };
    });
  }

  // ─── Manual actions ───────────────────────────────────────────────────────

  async matchLine(statementLineId: string, journalLineId: string) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const line = await this.lockLine(tx, statementLineId);
      if (line.status !== 'unmatched') throw new ConflictException(`Statement line is ${line.status}`);
      const bank = await this.requireBank(tx, line.bankAccountId);
      const jl = await tx.journalLine.findFirst({
        where: { id: journalLineId, accountId: bank.accountId, entry: { status: { in: [...BALANCE_AFFECTING_STATUSES] } } },
        include: { entry: { select: { entryNumber: true } } },
      });
      if (!jl) throw new NotFoundException("Ledger line not found on this bank account's ledger account");
      const signed = dec(jl.baseDebit).minus(dec(jl.baseCredit));
      if (!signed.equals(dec(line.amount))) {
        throw new BadRequestException(
          `Amounts differ: statement ${dec(line.amount).toString()}, ledger ${signed.toString()} (${jl.entry.entryNumber})`,
        );
      }
      try {
        await tx.bankReconciliationMatch.create({
          data: {
            organizationId,
            statementLineId: line.id,
            journalLineId: jl.id,
            method: 'manual',
            matchedById: this.tenant.userId ?? null,
          },
        });
      } catch (e: any) {
        if (e?.code === 'P2002') throw new ConflictException('That ledger line is already reconciled to another statement line');
        throw e;
      }
      await tx.bankStatementLine.updateMany({ where: { id: line.id, status: 'unmatched' }, data: { status: 'matched' } });
      await this.audit.recordInTx(tx, {
        entity: 'BankStatementLine',
        entityId: line.id,
        action: 'reconcile',
        newValues: { journalLineId: jl.id, entryNumber: jl.entry.entryNumber, method: 'manual' },
      });
      return { statementLineId: line.id, journalLineId: jl.id, status: 'matched' };
    });
  }

  /** Release a matched line (or bring back an excluded one). */
  async unmatch(statementLineId: string, reason?: string) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const line = await this.lockLine(tx, statementLineId);
      if (line.status === 'unmatched') throw new ConflictException('Statement line is not matched');
      if (line.status === 'matched') {
        const r = await tx.bankReconciliationMatch.updateMany({
          where: { statementLineId: line.id, unmatchedAt: null },
          data: { unmatchedAt: new Date(), unmatchedById: this.tenant.userId ?? null, unmatchReason: reason?.trim() || null },
        });
        if (r.count === 0) throw new ConflictException('No live match on this line');
      }
      await tx.bankStatementLine.updateMany({
        where: { id: line.id, status: line.status },
        data: { status: 'unmatched', excludedReason: null },
      });
      await this.audit.recordInTx(tx, {
        entity: 'BankStatementLine',
        entityId: line.id,
        action: 'update',
        oldValues: { status: line.status },
        newValues: { status: 'unmatched', op: 'unmatch', reason: reason ?? null },
      });
      return { statementLineId: line.id, status: 'unmatched' };
    });
  }

  /** Take a line out of reconciliation (bank charge booked elsewhere, duplicate …). */
  async exclude(statementLineId: string, reason: string) {
    const why = (reason ?? '').trim();
    if (why.length < 3) throw new BadRequestException('Give a reason for excluding this line');
    return this.prisma.client.$transaction(async (tx: any) => {
      const line = await this.lockLine(tx, statementLineId);
      if (line.status !== 'unmatched') throw new ConflictException(`Statement line is ${line.status}`);
      await tx.bankStatementLine.updateMany({
        where: { id: line.id, status: 'unmatched' },
        data: { status: 'excluded', excludedReason: why },
      });
      await this.audit.recordInTx(tx, {
        entity: 'BankStatementLine',
        entityId: line.id,
        action: 'update',
        oldValues: { status: 'unmatched' },
        newValues: { status: 'excluded', op: 'exclude', reason: why },
      });
      return { statementLineId: line.id, status: 'excluded' };
    });
  }

  // ─── Reads ────────────────────────────────────────────────────────────────

  async status(bankAccountId: string) {
    const bank = await this.requireBank(this.prisma.client, bankAccountId);
    const [unmatched, matched, excluded, latestRun] = await Promise.all([
      this.prisma.client.bankStatementLine.count({ where: { bankAccountId: bank.id, status: 'unmatched' } }),
      this.prisma.client.bankStatementLine.count({ where: { bankAccountId: bank.id, status: 'matched' } }),
      this.prisma.client.bankStatementLine.count({ where: { bankAccountId: bank.id, status: 'excluded' } }),
      this.prisma.client.bankReconciliationRun.findFirst({
        where: { bankAccountId: bank.id },
        orderBy: { startedAt: 'desc' },
      }),
    ]);
    return {
      unmatched,
      matched,
      excluded,
      total: unmatched + matched + excluded,
      latestRun: latestRun
        ? { startedAt: latestRun.startedAt, matched: latestRun.matched, unmatched: latestRun.unmatched }
        : undefined,
    };
  }

  /** Statement lines with their live match (ledger entry number and date). */
  async statementLines(bankAccountId: string, status?: string) {
    const bank = await this.requireBank(this.prisma.client, bankAccountId);
    const where: any = { bankAccountId: bank.id };
    if (status && ['unmatched', 'matched', 'excluded'].includes(status)) where.status = status;
    const rows = await this.prisma.client.bankStatementLine.findMany({
      where,
      orderBy: [{ postedAt: 'desc' }, { id: 'asc' }],
      take: 1000,
      include: {
        matches: {
          where: { unmatchedAt: null },
          include: { journalLine: { include: { entry: { select: { entryNumber: true, postingDate: true, description: true } } } } },
        },
      },
    });
    return rows.map((r: any) => {
      const m = r.matches[0];
      return {
        id: r.id,
        postedAt: r.postedAt,
        externalRef: r.externalRef,
        description: r.description,
        amount: r.amount.toString(),
        currencyCode: r.currencyCode,
        status: r.status,
        excludedReason: r.excludedReason,
        match: m
          ? {
              journalLineId: m.journalLineId,
              method: m.method,
              entryNumber: m.journalLine.entry.entryNumber,
              postingDate: m.journalLine.entry.postingDate,
              description: m.journalLine.entry.description ?? m.journalLine.description,
            }
          : null,
      };
    });
  }

  /** Ledger lines on the bank's GL account that no statement line explains yet. */
  async openLedgerLines(bankAccountId: string, asOf?: string) {
    const bank = await this.requireBank(this.prisma.client, bankAccountId);
    const until = asOf ? this.endOfDay(asOf) : undefined;
    const rows = await this.prisma.client.journalLine.findMany({
      where: {
        accountId: bank.accountId,
        entry: {
          status: { in: [...BALANCE_AFFECTING_STATUSES] },
          ...(until ? { postingDate: { lte: until } } : {}),
        },
        bankMatches: { none: { unmatchedAt: null } },
      },
      include: { entry: { select: { entryNumber: true, postingDate: true, description: true, status: true, reversalOfId: true } } },
      orderBy: { entry: { postingDate: 'desc' } },
      take: 1000,
    });
    return rows.map((l: any) => ({
      id: l.id,
      entryNumber: l.entry.entryNumber,
      postingDate: l.entry.postingDate,
      description: l.entry.description ?? l.description,
      amount: dec(l.baseDebit).minus(dec(l.baseCredit)).toString(),
      reversal: l.entry.status === 'reversed' || !!l.entry.reversalOfId,
    }));
  }

  /**
   * Bank reconciliation statement as of a date:
   *   adjusted bank = statement closing balance + ledger items not on the statement
   *   adjusted book = ledger balance + statement items not in the ledger (unmatched + excluded)
   * They agree (difference 0) when the account is reconciled.
   */
  async report(bankAccountId: string, asOf: string, statementClosingBalance?: string | number) {
    const bank = await this.requireBank(this.prisma.client, bankAccountId);
    const until = this.endOfDay(asOf);
    const client = this.prisma.client;

    const statementLines = await client.bankStatementLine.findMany({
      where: { bankAccountId: bank.id, postedAt: { lte: until } },
      select: { amount: true, status: true },
    });
    const statementSum = statementLines.reduce((t: Prisma.Decimal, l: any) => t.plus(dec(l.amount)), ZERO);
    const statementOnly = statementLines
      .filter((l: any) => l.status !== 'matched')
      .reduce((t: Prisma.Decimal, l: any) => t.plus(dec(l.amount)), ZERO);
    const closing =
      statementClosingBalance !== undefined && statementClosingBalance !== null && `${statementClosingBalance}` !== ''
        ? dec(statementClosingBalance as any)
        : statementSum;

    const gl = await client.journalLine.aggregate({
      where: {
        accountId: bank.accountId,
        entry: { status: { in: [...BALANCE_AFFECTING_STATUSES] }, postingDate: { lte: until } },
      },
      _sum: { baseDebit: true, baseCredit: true },
    });
    const glBalance = dec(gl._sum.baseDebit ?? 0).minus(dec(gl._sum.baseCredit ?? 0));
    const glOnlyAgg = await client.journalLine.aggregate({
      where: {
        accountId: bank.accountId,
        entry: { status: { in: [...BALANCE_AFFECTING_STATUSES] }, postingDate: { lte: until } },
        bankMatches: { none: { unmatchedAt: null } },
      },
      _sum: { baseDebit: true, baseCredit: true },
    });
    const ledgerOnly = dec(glOnlyAgg._sum.baseDebit ?? 0).minus(dec(glOnlyAgg._sum.baseCredit ?? 0));

    const adjustedBank = closing.plus(ledgerOnly);
    const adjustedBook = glBalance.plus(statementOnly);
    const difference = adjustedBank.minus(adjustedBook);
    return {
      bankAccountId: bank.id,
      ledgerAccountId: bank.accountId,
      asOf: until,
      statementClosingBalance: closing.toString(),
      statementClosingSource: closing === statementSum ? 'sum_of_imported_lines' : 'entered',
      ledgerBalance: glBalance.toString(),
      ledgerItemsNotOnStatement: ledgerOnly.toString(),
      statementItemsNotInLedger: statementOnly.toString(),
      adjustedBankBalance: adjustedBank.toString(),
      adjustedBookBalance: adjustedBook.toString(),
      difference: difference.toString(),
      reconciled: difference.isZero(),
    };
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private async requireBank(client: any, bankAccountId: string) {
    if (!bankAccountId) throw new BadRequestException('bankAccountId is required');
    const bank = await client.bankAccount.findFirst({ where: { id: bankAccountId } });
    if (!bank) throw new NotFoundException('Bank account not found');
    return bank;
  }

  private async bankCurrency(client: any, bank: any): Promise<string> {
    if (bank.currencyId) {
      const byId = await client.currency
        .findFirst({ where: { OR: [{ id: bank.currencyId }, { code: bank.currencyId }] }, select: { code: true } })
        .catch(() => null);
      if (byId?.code) return String(byId.code).toUpperCase();
    }
    const org = await client.organization.findUnique({
      where: { id: this.tenant.organizationId },
      select: { currencyCode: true },
    });
    return String(org?.currencyCode ?? 'UGX').toUpperCase();
  }

  private async lockLine(tx: any, id: string) {
    await tx.$queryRawUnsafe(
      `SELECT id FROM "BankStatementLine" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE`,
      id,
      this.tenant.organizationId,
    );
    const line = await tx.bankStatementLine.findFirst({ where: { id } });
    if (!line) throw new NotFoundException('Statement line not found');
    return line;
  }

  /**
   * Ledger lines on `ledgerAccountId` with exactly `amount` (signed), dated
   * within the window, not in a live match, and not part of a reversed pair
   * (an original and its reversal net to nothing on the bank side).
   */
  private async candidates(
    tx: any,
    ledgerAccountId: string,
    amount: Prisma.Decimal,
    postedAt: Date,
    toleranceDays: number,
  ): Promise<LedgerCandidate[]> {
    const from = new Date(postedAt.getTime() - (toleranceDays + 1) * DAY_MS);
    const to = new Date(postedAt.getTime() + (toleranceDays + 1) * DAY_MS);
    const rows: any[] = await tx.$queryRawUnsafe(
      `SELECT jl.id, je."postingDate"
         FROM "JournalLine" jl
         JOIN "JournalEntry" je ON je.id = jl."journalEntryId"
        WHERE jl."organizationId" = $1
          AND jl."accountId" = $2
          AND je.status = 'posted'
          AND je."reversalOfId" IS NULL
          AND je."postingDate" BETWEEN $3 AND $4
          AND (jl."baseDebit" - jl."baseCredit") = $5::numeric
          AND NOT EXISTS (
                SELECT 1 FROM "BankReconciliationMatch" m
                 WHERE m."journalLineId" = jl.id AND m."unmatchedAt" IS NULL)`,
      this.tenant.organizationId,
      ledgerAccountId,
      from,
      to,
      amount.toString(),
    );
    const windowMs = toleranceDays * DAY_MS + DAY_MS / 2;
    return rows
      .map((r) => ({ id: r.id, postingDate: new Date(r.postingDate), signed: amount }))
      .filter((c) => Math.abs(c.postingDate.getTime() - postedAt.getTime()) <= windowMs);
  }

  private endOfDay(day: string): Date {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999));
    const d = new Date(day);
    if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid date');
    return d;
  }
}
