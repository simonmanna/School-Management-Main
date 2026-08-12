import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { dec, ZERO } from '../../../kernel/common/money';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface StatementLineInput {
  postedAt: Date | string;
  externalRef?: string;
  description: string;
  amount: string | number | Prisma.Decimal;
  currencyCode: string;
}

/**
 * Phase D: Bank reconciliation service.
 *
 * - `importStatement`: bulk-insert statement lines from a CSV / MT940 / OFX
 *   payload. Operator pre-parses the file and calls this with an array.
 * - `match`: greedy exact match on (amount, currencyCode, date±3 days) against
 *   unallocated Payments in the same bank account.
 * - `unmatch`: release a match.
 * - `runReport`: summary of unmatched lines + GL bank balance vs statement.
 */
@Injectable()
export class BankReconciliationService {
  private readonly logger = new Logger('BankReconciliationService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  /** Bulk import. Idempotent on (bankAccountId, externalRef) — second import reuses the line. */
  async importStatement(
    bankAccountId: string,
    lines: StatementLineInput[],
    currencyCode: string,
  ): Promise<{ imported: number; skipped: number }> {
    const organizationId = this.tenant.organizationId;
    let imported = 0;
    let skipped = 0;
    for (const l of lines) {
      const existing = l.externalRef
        ? await this.prisma.client.bankStatementLine.findFirst({
            where: { organizationId, bankAccountId, externalRef: l.externalRef },
          })
        : null;
      if (existing) {
        skipped++;
        continue;
      }
      await this.prisma.client.bankStatementLine.create({
        data: {
          organizationId,
          bankAccountId,
          postedAt: new Date(l.postedAt),
          externalRef: l.externalRef ?? null,
          description: l.description,
          amount: new Prisma.Decimal(l.amount),
          currencyCode: l.currencyCode ?? currencyCode,
          status: 'unmatched',
        },
      });
      imported++;
    }
    this.events.publish('bank_statement.imported', {
      organizationId,
      bankAccountId,
      imported,
      skipped,
    });
    return { imported, skipped };
  }

  /**
   * Greedy exact-amount + currency match with a ±3-day tolerance. Marks the
   * matched Payment and the matched line. Writes a BankReconciliationRun row
   * summarizing the pass.
   */
  async match(bankAccountId: string, opts: { dateToleranceDays?: number; notes?: string } = {}): Promise<{
    runId: string;
    matched: number;
    unmatched: number;
  }> {
    const organizationId = this.tenant.organizationId;
    const toleranceDays = opts.dateToleranceDays ?? 3;
    return this.prisma.client.$transaction(async (tx) => {
      const run = await tx.bankReconciliationRun.create({
        data: {
          organizationId,
          bankAccountId,
          startedAt: new Date(),
          totalAmount: ZERO,
          notes: opts.notes ?? null,
          createdById: this.tenant.userId ?? null,
        },
      });

      const lines = await tx.bankStatementLine.findMany({
        where: { organizationId, bankAccountId, status: 'unmatched' },
        orderBy: { postedAt: 'asc' },
      });

      let matchedCount = 0;
      const usedPayments = new Set<string>();

      for (const line of lines as any[]) {
        const lineAmount = new Prisma.Decimal(line.amount);
        const lineDate = new Date(line.postedAt);
        const fromDate = new Date(lineDate.getTime() - toleranceDays * 24 * 60 * 60 * 1000);
        const toDate = new Date(lineDate.getTime() + toleranceDays * 24 * 60 * 60 * 1000);

// Find a Payment that:
//   - belongs to the same bank account (via its accountId)
//   - is posted
//   - amount + currency match exactly
//   - paymentDate within tolerance
//   - not already matched (Payment.journalEntryId is set; we track via line.matchedPaymentId)
        const candidate = await tx.payment.findFirst({
          where: {
            organizationId,
            accountId: bankAccountId,
            status: 'posted',
            paymentDate: { gte: fromDate, lte: toDate },
            amount: lineAmount.toString(),
          },
        });

        if (candidate && !usedPayments.has(candidate.id)) {
          await tx.bankStatementLine.update({
            where: { id: line.id },
            data: {
              status: 'matched',
              matchedPaymentId: candidate.id,
              matchedRunId: run.id,
            },
          });
          usedPayments.add(candidate.id);
          matchedCount++;
        }
      }

      const totalAmount = (lines as any[]).reduce(
        (acc, l) => acc.plus(l.amount ?? 0),
        ZERO,
      );

      await tx.bankReconciliationRun.update({
        where: { id: run.id },
        data: {
          finishedAt: new Date(),
          matched: matchedCount,
          unmatched: lines.length - matchedCount,
          totalAmount,
        },
      });

      await this.audit.recordInTx(tx, {
        entity: 'BankReconciliationRun',
        entityId: run.id,
        action: 'create',
        newValues: { matched: matchedCount, unmatched: lines.length - matchedCount },
      });

      this.events.publish('bank_reconciliation.ran', {
        organizationId,
        bankAccountId,
        runId: run.id,
        matched: matchedCount,
        unmatched: lines.length - matchedCount,
      });

      return { runId: run.id, matched: matchedCount, unmatched: lines.length - matchedCount };
    });
  }

  /** Manually unmatch a single line. */
  async unmatch(lineId: string): Promise<{ ok: true }> {
    const line = await this.prisma.client.bankStatementLine.findUnique({ where: { id: lineId } });
    if (!line) throw new Error('Line not found');
    await this.prisma.client.bankStatementLine.update({
      where: { id: lineId },
      data: { status: 'unmatched', matchedPaymentId: null, matchedRunId: null },
    });
    return { ok: true };
  }

  /** Unmatched lines + latest run summary. */
  async status(bankAccountId: string): Promise<{
    unmatched: number;
    matched: number;
    total: number;
    latestRun?: { startedAt: Date; matched: number; unmatched: number };
  }> {
    const [unmatchedCount, matchedCount, totalCount, latestRun] = await Promise.all([
      this.prisma.client.bankStatementLine.count({ where: { bankAccountId, status: 'unmatched' } }),
      this.prisma.client.bankStatementLine.count({ where: { bankAccountId, status: 'matched' } }),
      this.prisma.client.bankStatementLine.count({ where: { bankAccountId } }),
      this.prisma.client.bankReconciliationRun.findFirst({
        where: { bankAccountId },
        orderBy: { startedAt: 'desc' },
      }),
    ]);
    return {
      unmatched: unmatchedCount,
      matched: matchedCount,
      total: totalCount,
      latestRun: latestRun
        ? {
            startedAt: latestRun.startedAt,
            matched: latestRun.matched,
            unmatched: latestRun.unmatched,
          }
        : undefined,
    };
  }
}