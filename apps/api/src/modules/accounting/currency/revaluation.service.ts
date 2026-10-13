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
 * account. Adjustments are cumulative: each run compares the closing-rate
 * value with the carrying value INCLUDING earlier revaluation entries (tagged
 * `dimensions.fxCurrency`), so a re-run at the same rate posts nothing.
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
      // Find every JournalLine for monetary accounts in non-base currencies,
      // posted as of `asOf`. Group by (account, currency).
      //
      // "Monetary" is now the category's `allowReconciliation` flag rather than a
      // hardcoded type list, so an org that adds e.g. a second receivable-style
      // category gets revalued without a code change.
      // Posted AND reversed: a reversed line and its reversal net to zero only
      // when both are summed.
      const lines = await tx.journalLine.findMany({
        where: {
          entry: { status: { in: ['posted', 'reversed'] }, postingDate: { lte: asOf } },
          account: { isActive: true, category: { allowReconciliation: true } },
        },
        include: { account: true, entry: { select: { sourceType: true, dimensions: true } } },
      });

      // Lines carry the Currency row id (documents) or a code; resolve to codes.
      // Comparing the raw id with the base code treated every base-currency line
      // as foreign and the run failed on the rate lookup (wave 19).
      const currencies = await tx.currency.findMany({ select: { id: true, code: true } });
      const codeOf = new Map<string, string>();
      for (const c of currencies as any[]) {
        codeOf.set(c.id, c.code);
        codeOf.set(c.code, c.code);
      }

      // Aggregate per (account, currency): the foreign-currency balance (from the
      // transaction debit/credit columns) and the current base carrying value
      // (baseDebit/baseCredit). Both are needed to revalue at the closing rate.
      const balances = new Map<string, Map<string, { foreign: Prisma.Decimal; base: Prisma.Decimal }>>();
      for (const l of lines as any[]) {
        const baseDelta = new Prisma.Decimal(l.baseDebit).minus(new Prisma.Decimal(l.baseCredit));
        // An earlier revaluation moved base value only; it belongs to the
        // currency it revalued, or the next run would book it a second time.
        const fxCurrency = l.entry?.sourceType === 'fx_revaluation' ? (l.entry?.dimensions as any)?.fxCurrency : null;
        if (fxCurrency) {
          const accMap = balances.get(l.accountId) ?? new Map<string, { foreign: Prisma.Decimal; base: Prisma.Decimal }>();
          const cur = accMap.get(fxCurrency) ?? { foreign: ZERO, base: ZERO };
          accMap.set(fxCurrency, { foreign: cur.foreign, base: cur.base.plus(baseDelta) });
          balances.set(l.accountId, accMap);
          continue;
        }
        const currencyCode = l.currencyId ? (codeOf.get(l.currencyId) ?? l.currencyId) : null;
        if (!currencyCode || currencyCode === baseCode) continue;
        const accMap = balances.get(l.accountId) ?? new Map<string, { foreign: Prisma.Decimal; base: Prisma.Decimal }>();
        const cur = accMap.get(currencyCode) ?? { foreign: ZERO, base: ZERO };
        const foreignDelta = new Prisma.Decimal(l.debit).minus(new Prisma.Decimal(l.credit));
        accMap.set(currencyCode, { foreign: cur.foreign.plus(foreignDelta), base: cur.base.plus(baseDelta) });
        balances.set(l.accountId, accMap);
      }

      // Revalue each foreign balance to the closing rate and post the unrealized
      // gain/loss: adjustment = foreignBalance × closingRate − currentBaseBalance.
      //   adjustment > 0 → Dr <account> / Cr FX gain   (carrying value increases)
      //   adjustment < 0 → Dr FX loss  / Cr <account>  (carrying value decreases)
      // The sign rule holds for both asset (debit-balance) and liability
      // (credit-balance) monetary accounts because base/foreign carry their sign.
      const fxGainAcct = await this.determination.mapped('fx_gain', tx);
      const fxLossAcct = await this.determination.mapped('fx_loss', tx);
      let revalued = 0;
      let totalGain = ZERO;
      for (const [accountId, byCurrency] of balances) {
        for (const [currencyCode, bal] of byCurrency) {
          if (bal.foreign.isZero() && bal.base.isZero()) continue;
          const closingRate = await this.currency.getRate(currencyCode, baseCode, asOf);
          const revaluedBase = bal.foreign.times(closingRate);
          const adjustment = revaluedBase.minus(bal.base);
          await tx.fxRevaluation.upsert({
            where: { organizationId_fiscalPeriodId_accountId: { organizationId, fiscalPeriodId: 'adhoc', accountId } },
            update: { asOf, currencyCode, bookBalance: bal.base, revaluedBalance: revaluedBase, fxGain: adjustment, rate: closingRate },
            create: {
              organizationId,
              fiscalPeriodId: 'adhoc',
              asOf,
              accountId,
              currencyCode,
              bookBalance: bal.base,
              revaluedBalance: revaluedBase,
              fxGain: adjustment,
              rate: closingRate,
            },
          });
          if (!adjustment.isZero()) {
            const amt = adjustment.abs().toString();
            const postLines = adjustment.gt(ZERO)
              ? [
                  { accountId, debit: amt, credit: 0, description: `FX reval ${currencyCode}` },
                  { accountId: fxGainAcct, debit: 0, credit: amt, description: 'Unrealized FX gain' },
                ]
              : [
                  { accountId: fxLossAcct, debit: amt, credit: 0, description: 'Unrealized FX loss' },
                  { accountId, debit: 0, credit: amt, description: `FX reval ${currencyCode}` },
                ];
            await this.posting.post(
              {
                journalCode: 'GEN',
                date: asOf,
                description: `FX revaluation ${currencyCode} @ ${closingRate}`,
                sourceType: 'fx_revaluation',
                sourceId: accountId,
                dimensions: { fxCurrency: currencyCode },
                lines: postLines,
              },
              tx,
            );
            totalGain = totalGain.plus(adjustment);
          }
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