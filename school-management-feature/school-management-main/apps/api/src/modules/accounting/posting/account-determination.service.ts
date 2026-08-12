import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Account determination (ADR-009). Resolution order, most specific first:
 *   line override -> partner override -> product category -> tax -> org mapping.
 * Business modules call these helpers; they never hardcode account ids.
 */
@Injectable()
export class AccountDeterminationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolve an org-level mapping (e.g. 'accounts_receivable'); throws if unconfigured. */
  async mapped(key: string, client: any = this.prisma.client): Promise<string> {
    const mapping = await client.accountMapping.findFirst({ where: { key } });
    if (!mapping) {
      throw new BadRequestException(
        `Account mapping '${key}' is not configured. Set it under Accounting > Account Mapping.`,
      );
    }
    return mapping.accountId;
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
