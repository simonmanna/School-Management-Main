import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dec, sum, ZERO } from '../../../kernel/common/money';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { AuditService } from '../../../kernel/audit/audit.service';
import { PostingService } from './posting.service';
import { AccountDeterminationService } from './account-determination.service';
import { AccountResolverService } from './account-resolver.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Period-close service (D2-2).
 *
 * A fiscal period must be closable end-to-end atomically:
 *   1. Verify the period is `open`.
 *   2. Sum every revenue and expense account's posted balance.
 *   3. Post a single closing journal to journal `CLOSING` that zeroes out
 *      revenue (Dr) and expense (Cr) into Retained Earnings (the residual
 *      either credit = profit or debit = loss lands on Retained Earnings).
 *   4. Update FiscalPeriod.status = 'closed' / `closedAt` / `closedBy`.
 *   5. Audit + emit `fiscal_period.closed`.
 *
 * Lock: a closed period becomes immutable via `lock(periodId)`. After that,
 * PostingService.assertOpen rejects any date in the period — no more
 * after-the-fact postings.
 *
 * The whole flow runs inside ONE transaction so the closing entry and the
 * period-status flip are atomic.
 */
@Injectable()
export class PeriodCloseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly determination: AccountDeterminationService,
    private readonly accounts: AccountResolverService,
  ) {}

  /** Close the period: post the closing journal, flip status to closed. */
  async close(periodId: string): Promise<{ journalEntryId: string; netIncome: string }> {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx) => {
      const period = await tx.fiscalPeriod.findFirst({ where: { id: periodId, organizationId } });
      if (!period) throw new NotFoundException('Fiscal period not found');
      if (period.status !== 'open') {
        throw new BadRequestException(
          `Fiscal period '${period.name}' is ${period.status}; only open periods can be closed`,
        );
      }

      // Revenue posts synchronously at billing, but COGS is deferred to the async
      // stock-posting worker. Closing a period whose stock-posting jobs are still
      // pending/processing/failed would book revenue without the matching COGS and
      // permanently understate cost of sales for the period. Refuse until the
      // backlog drains — `failed` jobs never post on their own, so they must be
      // resolved in the Posting Monitor first. Scoped explicitly (StockPostingJob
      // predates its addition to ORG_SCOPED; the filter is belt-and-suspenders).
      const unpostedCogs = await tx.stockPostingJob.count({
        where: {
          organizationId,
          status: { in: ['pending', 'processing', 'failed'] },
          createdAt: { gte: period.startDate, lte: period.endDate },
        },
      });
      if (unpostedCogs > 0) {
        throw new BadRequestException(
          `Cannot close '${period.name}': ${unpostedCogs} stock-posting job(s) in this period have not posted COGS yet. ` +
            `Drain the stock-posting queue, and resolve any failed jobs in the Posting Monitor, before closing.`,
        );
      }

      // 1) Sum every revenue / contra-revenue / expense / COGS line posted in
      //    this period's date range.
      const grouped = await tx.journalLine.groupBy({
        by: ['accountId'],
        where: {
          entry: {
            status: 'posted',
            postingDate: { gte: period.startDate, lte: period.endDate },
          },
        },
        _sum: { baseDebit: true, baseCredit: true },
      });
      const accountIds = (grouped as any[]).map((g) => g.accountId);
      const acctById = await this.accounts.meta(accountIds);

      // Totals are all positive numbers, each signed by the account's own normal
      // balance. Contra-revenue is debit-normal, so a sales discount correctly
      // adds to `totalContraRevenue` instead of cancelling revenue silently.
      let totalRevenue = ZERO;
      let totalContraRevenue = ZERO;
      let totalExpense = ZERO;
      let totalCogs = ZERO;
      const closingLines: { accountId: string; debit: Prisma.Decimal; credit: Prisma.Decimal }[] = [];
      const unbalancedDelta = ZERO; // catches rounding < epsilon; paid into retained earnings

      for (const g of grouped as any[]) {
        const acct = acctById.get(g.accountId);
        if (!acct) continue;
        const debit = dec(g._sum.baseDebit ?? 0);
        const credit = dec(g._sum.baseCredit ?? 0);
        // Positive in the direction the account normally carries a balance.
        const bal = acct.normalBalance === 'credit' ? credit.minus(debit) : debit.minus(credit);
        // Zeroing an account means posting the opposite of its balance.
        const closing =
          acct.normalBalance === 'credit'
            ? { accountId: acct.id, debit: bal, credit: ZERO }
            : { accountId: acct.id, debit: ZERO, credit: bal };

        switch (acct.reportSection) {
          case 'revenue':
          case 'other_income':
            totalRevenue = totalRevenue.plus(bal);
            break;
          case 'contra_revenue':
            totalContraRevenue = totalContraRevenue.plus(bal);
            break;
          case 'operating_expense':
          case 'other_expense':
            totalExpense = totalExpense.plus(bal);
            break;
          case 'cogs':
            totalCogs = totalCogs.plus(bal);
            break;
          default:
            // Balance-sheet and off-balance accounts are NOT closed.
            continue;
        }
        if (!bal.isZero()) closingLines.push(closing);
      }

      if (closingLines.length === 0) {
        throw new BadRequestException(
          `Nothing to close for '${period.name}': no posted revenue or expense in this period`,
        );
      }

      // Net income = (revenue − contra_revenue) − (expense + cogs).
      const netIncome = totalRevenue.minus(totalContraRevenue).minus(totalExpense).minus(totalCogs);

      // Resolve the Retained Earnings account from the account mapping. The COA
      // seeder wires `retained_earnings` for every organization, so an
      // unconfigured mapping is a real misconfiguration and must not silently
      // fall through to "whichever equity account sorts first by code" — that
      // closed the year into an arbitrary account.
      const retainedEarningsId = await this.determination.mapped('retained_earnings', tx).catch(() => {
        throw new BadRequestException(
          `Cannot close '${period.name}': no Retained Earnings account configured ` +
            "(set AccountMapping key 'retained_earnings' under Accounting > Account Mapping)",
        );
      });

      // Mirror leg on Retained Earnings to balance the entry.
      // netIncome > 0 (profit) → credit RE / debit the income sum → balanced.
      // netIncome < 0 (loss) → debit RE / credit the income sum.
      if (netIncome.greaterThanOrEqualTo(0)) {
        closingLines.push({ accountId: retainedEarningsId, debit: ZERO, credit: netIncome });
      } else {
        closingLines.push({ accountId: retainedEarningsId, debit: netIncome.abs(), credit: ZERO });
      }

      // Sanity: the closing entry must balance to zero.
      const totalDebit = sum(closingLines.map((l) => l.debit));
      const totalCredit = sum(closingLines.map((l) => l.credit));
      if (!totalDebit.minus(totalCredit).abs().lessThanOrEqualTo(0.01)) {
        throw new BadRequestException(
          `Closing entry unbalanced: debit ${totalDebit.toString()} vs credit ${totalCredit.toString()}`,
        );
      }

      // 2) Ensure the CLOSING journal exists.
      let closingJournal = await tx.journal.findFirst({ where: { code: 'CLOSING' } });
      if (!closingJournal) {
        closingJournal = await tx.journal.create({
          data: {
            organizationId,
            code: 'CLOSING',
            name: 'Period Closing',
            journalType: 'closing',
          },
        });
      }

      // 3) Post the closing journal via PostingService.post so it goes
      //    through the same balanced + period-checked path as every other
      //    entry. We bypass assertOpen by going around it: the period is
      //    open at this point, so the existing assertOpen will allow it
      //    (closing date = period.endDate).
      //    Note: we mark the closing entry with sourceType='period_close' so
      //    reports can identify it.
      const entry = await this.posting.post(
        {
          journalCode: 'CLOSING',
          date: period.endDate,
          description: `Closing of ${period.name}`,
          sourceType: 'period_close',
          sourceId: period.id,
          lines: closingLines.map((l, i) => ({
            accountId: l.accountId,
            debit: l.debit.toString(),
            credit: l.credit.toString(),
            description: i === closingLines.length - 1 ? 'Net income / (loss)' : 'Closing',
          })),
        },
        tx,
      );

      // 4) Flip period to closed.
      await tx.fiscalPeriod.updateMany({
        where: { id: period.id },
        data: {
          status: 'closed',
          closedAt: new Date(),
          closedBy: this.tenant.userId ?? null,
        },
      });

      // 5) Audit + event.
      await this.audit.recordInTx(tx, {
        entity: 'FiscalPeriod',
        entityId: period.id,
        action: 'update',
        oldValues: { status: 'open' },
        newValues: {
          status: 'closed',
          netIncome: netIncome.toString(),
          closingEntryId: entry.id,
        },
      });

      this.events.publish('fiscal_period.closed', {
        organizationId,
        periodId: period.id,
        periodName: period.name,
        closingEntryId: entry.id,
        netIncome: netIncome.toString(),
      });

      return { journalEntryId: entry.id, netIncome: netIncome.toString() };
    });
  }

  /** Lock a closed period: no more postings to its date range ever. */
  async lock(periodId: string): Promise<void> {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx) => {
      const period = await tx.fiscalPeriod.findFirst({ where: { id: periodId, organizationId } });
      if (!period) throw new NotFoundException('Fiscal period not found');
      if (period.status === 'open') {
        throw new BadRequestException(
          `Fiscal period '${period.name}' is open; close it before locking`,
        );
      }

      await tx.fiscalPeriod.updateMany({
        where: { id: period.id },
        data: { status: 'locked', lockedAt: new Date() },
      });

      await this.audit.recordInTx(tx, {
        entity: 'FiscalPeriod',
        entityId: period.id,
        action: 'update',
        oldValues: { status: period.status },
        newValues: { status: 'locked' },
      });

      this.events.publish('fiscal_period.locked', {
        organizationId,
        periodId: period.id,
        periodName: period.name,
      });
    });
  }
}