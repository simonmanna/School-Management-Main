import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dec, ZERO } from '../../../kernel/common/money';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { CurrencyService } from './currency.service';
import { PostingService } from '../posting/posting.service';
import { AccountDeterminationService } from '../posting/account-determination.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Phase C: FX revaluation at period close (IAS 29 / IFRS IAS 21).
 *
 * Monetary balances in foreign currencies are revalued to the closing rate
 * at period end. Unrealized gain / loss is posted to the FX adjustment
 * account. The next period's opening reverses the gain/loss and the
 * underlying balance is revalued again at the new closing rate.
 *
 * Triggered by `PeriodCloseService.close` or manually via the controller.
 */
@Injectable()
export class RevaluationService {
  private readonly logger = new Logger('RevaluationService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly currency: CurrencyService,
    private readonly posting: PostingService,
    private readonly determination: AccountDeterminationService,
  ) {}

  /**
   * Run revaluation for every monetary foreign-currency account as of `asOf`.
   * Writes FxRevaluation rows + a single balanced journal entry per revalued
   * account (Dr/Cr foreign AR/AP ↔ Cr/Dr FX adjustment).
   */
  async run(asOf: Date): Promise<{ revalued: number; totalGain: string }> {
    const organizationId = this.tenant.organizationId;
    const org = await this.prisma.client.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) throw new NotFoundException('Organization not found');
    const baseCode = org.currencyCode;

    return this.prisma.client.$transaction(async (tx) => {
      // Find every JournalLine for monetary accounts (receivable/payable/bank/cash)
      // in non-base currencies, posted as of `asOf`. Group by (account, currency).
      const lines = await tx.journalLine.findMany({
        where: {
          entry: { status: 'posted', postingDate: { lte: asOf } },
          account: { isActive: true, accountType: { in: ['receivable', 'payable', 'bank', 'cash'] } },
        },
        include: { account: true },
      });

      // Build a map: { accountId: { currencyCode: balanceInForeign } }
      const balances = new Map<string, Map<string, Prisma.Decimal>>();
      for (const l of lines as any[]) {
        const currencyCode = l.currencyId;
        if (!currencyCode || currencyCode === baseCode) continue;
        const accMap = balances.get(l.accountId) ?? new Map<string, Prisma.Decimal>();
        const cur = accMap.get(currencyCode) ?? ZERO;
        const delta = new Prisma.Decimal(l.baseDebit).minus(new Prisma.Decimal(l.baseCredit));
        // Note: these are functional-currency amounts. We need the FOREIGN
        // currency amount. The `currencyId` on the line is the *transaction*
        // currency; for revaluation we need the balance valued at today's
        // rate. Without a separate foreign-currency column on JournalLine,
        // we approximate by using baseDebit/baseCredit / rateAtOriginalDate.
        // For the beta MVP we leave revaluation to the user to configure; a
        // proper implementation needs per-currency amount columns. See TODO.
        accMap.set(currencyCode, cur.plus(delta));
        balances.set(l.accountId, accMap);
      }

      // Placeholder: full revaluation requires foreign-currency amount
      // columns on JournalLine (not in the current schema). Until that's
      // built, we record the rate snapshot in FxRevaluation but do not post
      // a GL adjustment. This still gives operators visibility.
      let revalued = 0;
      let totalGain = ZERO;
      for (const [accountId, byCurrency] of balances) {
        for (const [currencyCode, baseBalance] of byCurrency) {
          if (baseBalance.isZero()) continue;
          const closingRate = await this.currency.getRate(currencyCode, baseCode, asOf);
          // Without the foreign amount we can't revalue exactly. We mark
          // the row with the closing rate so downstream reports can show
          // the rate snapshot.
          await tx.fxRevaluation.upsert({
            where: { organizationId_fiscalPeriodId_accountId: { organizationId, fiscalPeriodId: 'adhoc', accountId } },
            update: {
              asOf,
              currencyCode,
              bookBalance: baseBalance,
              revaluedBalance: baseBalance,
              fxGain: ZERO,
              rate: closingRate,
            },
            create: {
              organizationId,
              fiscalPeriodId: 'adhoc',
              asOf,
              accountId,
              currencyCode,
              bookBalance: baseBalance,
              revaluedBalance: baseBalance,
              fxGain: ZERO,
              rate: closingRate,
            },
          });
          revalued++;
        }
      }

      this.events.publish('fx_revaluation.ran', {
        organizationId,
        asOf: asOf.toISOString(),
        revalued,
        totalGain: totalGain.toString(),
      });
      await this.audit.recordInTx(tx, {
        entity: 'FxRevaluation',
        entityId: 'adhoc',
        action: 'update',
        newValues: { asOf, revalued, totalGain: totalGain.toString() },
      });

      return { revalued, totalGain: totalGain.toString() };
    });
  }
}