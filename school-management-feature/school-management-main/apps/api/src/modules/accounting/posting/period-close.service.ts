import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dec, sum, ZERO } from '../../../kernel/common/money';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { AuditService } from '../../../kernel/audit/audit.service';
import { PostingService } from './posting.service';
import { AccountDeterminationService } from './account-determination.service';

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
      const accounts = accountIds.length
        ? await tx.account.findMany({ where: { id: { in: accountIds } } })
        : [];
      const acctById = new Map((accounts as any[]).map((a) => [a.id, a]));

      // Compute net per account type. Credit-normal (revenue / contra_revenue)
      // => balance = credit - debit. Debit-normal (expense / cogs) => debit - credit.
      let totalRevenue = ZERO; // positive number
      let totalContraRevenue = ZERO; // positive number (contra side)
      let totalExpense = ZERO; // positive number (sum of debit-normal balances)
      let totalCogs = ZERO;
      const closingLines: { accountId: string; debit: Prisma.Decimal; credit: Prisma.Decimal }[] = [];
      let unbalancedDelta = ZERO; // catches rounding < epsilon; paid into retained earnings

      for (const g of grouped as any[]) {
        const acct = acctById.get(g.accountId);
        if (!acct) continue;
        const debit = dec(g._sum.baseDebit ?? 0);
        const credit = dec(g._sum.baseCredit ?? 0);
        const t = acct.accountType as string;
        switch (t) {
          case 'revenue': {
            const bal = credit.minus(debit);
            totalRevenue = totalRevenue.plus(bal);
            // To zero revenue: debit the revenue account by `bal`.
            if (!bal.isZero()) closingLines.push({ accountId: acct.id, debit: bal, credit: ZERO });
            break;
          }
          case 'contra_revenue': {
            const bal = credit.minus(debit);
            totalContraRevenue = totalContraRevenue.plus(bal);
            // Contra-revenue has credit-normal balance; zero it by debiting.
            if (!bal.isZero()) closingLines.push({ accountId: acct.id, debit: bal, credit: ZERO });
            break;
          }
          case 'expense': {
            const bal = debit.minus(credit);
            totalExpense = totalExpense.plus(bal);
            if (!bal.isZero()) closingLines.push({ accountId: acct.id, debit: ZERO, credit: bal });
            break;
          }
          case 'cost_of_goods_sold': {
            const bal = debit.minus(credit);
            totalCogs = totalCogs.plus(bal);
            if (!bal.isZero()) closingLines.push({ accountId: acct.id, debit: ZERO, credit: bal });
            break;
          }
          default:
            // Balance-sheet accounts are NOT closed.
            break;
        }
      }

      if (closingLines.length === 0) {
        throw new BadRequestException(
          `Nothing to close for '${period.name}': no posted revenue or expense in this period`,
        );
      }

      // Net income = (revenue − contra_revenue) − (expense + cogs).
      const netIncome = totalRevenue.minus(totalContraRevenue).minus(totalExpense).minus(totalCogs);

      // Resolve the Retained Earnings account from account mapping; fall back
      // to the first equity account if the mapping is unconfigured (so the
      // system remains usable in dev / fresh installs).
      let retainedEarningsId: string;
      try {
        retainedEarningsId = await this.determination.mapped('retained_earnings', tx);
      } catch {
        const fallback = await tx.account.findFirst({
          where: { organizationId, accountType: 'equity' },
          orderBy: { code: 'asc' },
        });
        if (!fallback) {
          throw new BadRequestException(
            `Cannot close '${period.name}': no Retained Earnings account configured (set AccountMapping key 'retained_earnings')`,
          );
        }
        retainedEarningsId = fallback.id;
      }

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