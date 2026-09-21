import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { AccountResolverService } from './account-resolver.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Account determination (ADR-009). Resolution order, most specific first:
 *   line override -> partner override -> product category -> tax -> org mapping.
 * Business modules call these helpers; they never hardcode account ids.
 *
 * This is now a thin façade over {@link AccountResolverService}, which owns the
 * actual lookup, the category-aware validation and the metadata cache. Keeping
 * the façade means the ~15 modules that already call `mapped(...)` need no
 * change.
 */
/**
 * Where money received by a given method sits until it is banked. Digital money
 * held by a provider is NOT cash in hand: it lands in a clearing account and is
 * swept to the bank when the provider settles (net of charges).
 */
export const SETTLEMENT_CLEARING_ACCOUNTS = {
  mobile_money: { code: 'MOMO-CLR', name: 'Mobile Money Clearing', categoryKey: 'mobile_money', mappingKey: 'mobile_money_clearing' },
  card: { code: 'CARD-CLR', name: 'Card Processor Clearing', categoryKey: 'current_asset', mappingKey: 'card_clearing' },
} as const;

export const GATEWAY_CHARGES_ACCOUNT = {
  code: 'PAY-CHG',
  name: 'Payment Gateway Charges',
  categoryKey: 'operating_expense',
  mappingKey: 'payment_gateway_charges',
} as const;

@Injectable()
export class AccountDeterminationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: AccountResolverService,
  ) {}

  /** Resolve an org-level mapping (e.g. 'accounts_receivable'); throws if unconfigured. */
  async mapped(key: string, client: any = this.prisma.client): Promise<string> {
    return this.resolver.byMapping(key, client);
  }

  /**
   * Settlement (debit-side) account for a payment method:
   * cash → default_cash, bank/cheque → default_bank, mobile_money / card → clearing.
   */
  async settlementAccount(method: string | null | undefined, client: any = this.prisma.client): Promise<string> {
    switch (method) {
      case 'bank':
      case 'cheque':
        return this.mapped('default_bank', client);
      case 'mobile_money':
      case 'card': {
        const def = SETTLEMENT_CLEARING_ACCOUNTS[method];
        return this.resolver.ensureByCode(def.code, def, client);
      }
      default:
        return this.mapped('default_cash', client);
    }
  }

  async receivableAccount(
    partner: { receivableAccountId?: string | null } | null,
    client: any = this.prisma.client,
  ): Promise<string> {
    return partner?.receivableAccountId ?? this.mapped('accounts_receivable', client);
  }

  async payableAccount(
    partner: { payableAccountId?: string | null } | null,
    client: any = this.prisma.client,
  ): Promise<string> {
    return partner?.payableAccountId ?? this.mapped('accounts_payable', client);
  }

  async incomeAccount(
    opts: { lineAccountId?: string | null; category?: { incomeAccountId?: string | null } | null },
    client: any = this.prisma.client,
  ): Promise<string> {
    return opts.lineAccountId ?? opts.category?.incomeAccountId ?? this.mapped('sales_revenue', client);
  }

  async expenseAccount(
    opts: { lineAccountId?: string | null; category?: { expenseAccountId?: string | null } | null },
    client: any = this.prisma.client,
  ): Promise<string> {
    return (
      opts.lineAccountId ?? opts.category?.expenseAccountId ?? this.mapped('default_expense', client)
    );
  }

  /**
   * Output (sales) tax -> the tax's own account or `tax_payable`.
   * Input (purchase) tax -> always `tax_receivable` (recoverable VAT is an asset).
   */
  async taxAccount(
    tax: { accountId?: string | null } | null,
    client: any = this.prisma.client,
    mappingKey: 'tax_payable' | 'tax_receivable' = 'tax_payable',
  ): Promise<string> {
    if (mappingKey === 'tax_receivable') return this.mapped('tax_receivable', client);
    return tax?.accountId ?? this.mapped(mappingKey, client);
  }
}
