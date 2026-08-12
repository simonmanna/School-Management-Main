import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { PostingService } from '../posting/posting.service';
import { AccountDeterminationService } from '../posting/account-determination.service';
import { BALANCE_AFFECTING_STATUSES } from '../posting/posting.types';
import { dec, ZERO } from '../../../kernel/common/money';
import { AccountResolverService } from '../posting/account-resolver.service';

/**
 * Legacy account types accepted by `createCashAccount`, mapped to the category
 * the new account is created under. Membership in "is this a payment account"
 * is decided by `AccountCategory.isCashEquivalent`, not by this map — see
 * AccountResolverService.cashEquivalentIds().
 */
const PAYMENT_TYPE_TO_CATEGORY: Record<string, string> = {
  cash: 'cash',
  bank: 'bank',
  mobile_money: 'mobile_money',
  petty_cash: 'petty_cash',
};

@Injectable()
export class CashFlowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly posting: PostingService,
    private readonly determination: AccountDeterminationService,
    private readonly accounts: AccountResolverService,
  ) {}

  async getCashAccounts() {
    const orgId = this.tenant.organizationId;
    const accounts = await this.prisma.client.account.findMany({
      where: {
        organizationId: orgId,
        category: { isCashEquivalent: true },
        isActive: true,
        deletedAt: null,
      },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      include: {
        category: { select: { key: true, name: true } },
        cashRegisters: { select: { id: true, name: true, code: true } },
      },
    });

    const grouped = await this.prisma.client.journalLine.groupBy({
      by: ['accountId'],
      where: {
        organizationId: orgId,
        accountId: { in: accounts.map((a) => a.id) },
        // Balance must count both `posted` and `reversed` entries: a reversed
        // entry's lines are still real and are cancelled by the mirror reversal
        // entry. Filtering to `posted` alone keeps the reversal but drops the
        // original, so the balance diverges from the trial balance / GL.
        entry: { status: { in: [...BALANCE_AFFECTING_STATUSES] } },
      },
      _sum: { baseDebit: true, baseCredit: true },
    });

    const balanceMap = new Map<string, Prisma.Decimal>();
    for (const g of grouped) {
      const debit = (g as any)._sum.baseDebit ?? ZERO;
      const credit = (g as any)._sum.baseCredit ?? ZERO;
      balanceMap.set(g.accountId, dec(debit).minus(dec(credit)));
    }

    return accounts.map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      categoryKey: (a as any).category?.key ?? null,
      currencyId: a.currencyId,
      bankName: a.bankName,
      accountNumber: a.accountNumber,
      isDefault: a.isDefault,
      balance: balanceMap.get(a.id)?.toString() ?? '0',
      cashRegister: (a as any).cashRegisters?.[0] ?? null,
    }));
  }

  async create(dto: {
    code: string;
    name: string;
    accountType: string;
    currencyId?: string;
    bankName?: string;
    accountNumber?: string;
    isDefault?: boolean;
  }) {
    const orgId = this.tenant.organizationId;
    if (!dto.code || !dto.name) throw new BadRequestException('Code and name are required');
    const categoryKey = PAYMENT_TYPE_TO_CATEGORY[dto.accountType];
    if (!categoryKey) {
      throw new BadRequestException('Account type must be a payment account type');
    }
    const category = await this.prisma.client.accountCategory.findFirst({
      where: { key: categoryKey },
    });
    if (!category) {
      throw new BadRequestException(
        `Account category '${categoryKey}' is missing for this organization. ` +
          'Run the accounting backfill (prisma/backfill-account-category.ts).',
      );
    }

    const existing = await this.prisma.client.account.findUnique({
      where: { organizationId_code: { organizationId: orgId, code: dto.code } },
    });
    if (existing) throw new BadRequestException('Account code already exists');

    if (dto.isDefault) {
      await this.prisma.client.account.updateMany({
        where: { organizationId: orgId, categoryId: category.id, isDefault: true },
        data: { isDefault: false },
      });
    }

    return this.prisma.client.account.create({
      data: {
        organizationId: orgId,
        code: dto.code,
        name: dto.name,
        categoryId: category.id,
        normalBalance: category.normalBalance,
        currencyId: dto.currencyId ?? null,
        bankName: dto.bankName ?? null,
        accountNumber: dto.accountNumber ?? null,
        isDefault: dto.isDefault ?? false,
        cashFlowCategory: 'operating',
      },
    });
  }

  async update(id: string, dto: {
    name?: string;
    currencyId?: string;
    bankName?: string;
    accountNumber?: string;
    isDefault?: boolean;
  }) {
    const orgId = this.tenant.organizationId;
    const account = await this.prisma.client.account.findFirst({ where: { id, organizationId: orgId } });
    if (!account) throw new NotFoundException('Account not found');

    if (dto.isDefault) {
      await this.prisma.client.account.updateMany({
        where: { organizationId: orgId, categoryId: account.categoryId, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    return this.prisma.client.account.update({
      where: { id },
      data: {
        name: dto.name,
        currencyId: dto.currencyId,
        bankName: dto.bankName,
        accountNumber: dto.accountNumber,
        isDefault: dto.isDefault,
      },
    });
  }

  async remove(id: string) {
    const orgId = this.tenant.organizationId;
    const account = await this.prisma.client.account.findFirst({ where: { id, organizationId: orgId } });
    if (!account) throw new NotFoundException('Account not found');
    return this.prisma.client.account.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  async deposit(accountId: string, amount: number, description?: string) {
    if (amount <= 0) throw new BadRequestException('Amount must be positive');
    const orgId = this.tenant.organizationId;
    const account = await this.prisma.client.account.findFirst({
      where: { id: accountId, organizationId: orgId },
    });
    if (!account) throw new BadRequestException('Account not found');
    const cashIds = await this.accounts.cashEquivalentIds();
    if (!cashIds.includes(account.id)) {
      throw new BadRequestException('Account is not a payment account');
    }
    const suspenseId = await this.determination.mapped('cash_suspense');
    return this.posting.post({
      journalCode: 'CASH',
      date: new Date(),
      description: description ?? 'Cash deposit',
      sourceType: 'cash_flow_deposit',
      sourceId: accountId,
      lines: [
        { accountId, debit: amount },
        { accountId: suspenseId, credit: amount },
      ],
    });
  }

  async withdraw(accountId: string, amount: number, description?: string) {
    if (amount <= 0) throw new BadRequestException('Amount must be positive');
    const orgId = this.tenant.organizationId;
    const account = await this.prisma.client.account.findFirst({
      where: { id: accountId, organizationId: orgId },
    });
    if (!account) throw new BadRequestException('Account not found');
    const cashIds = await this.accounts.cashEquivalentIds();
    if (!cashIds.includes(account.id)) {
      throw new BadRequestException('Account is not a payment account');
    }
    const suspenseId = await this.determination.mapped('cash_suspense');
    return this.posting.post({
      journalCode: 'CASH',
      date: new Date(),
      description: description ?? 'Cash withdrawal',
      sourceType: 'cash_flow_withdrawal',
      sourceId: accountId,
      lines: [
        { accountId: suspenseId, debit: amount },
        { accountId, credit: amount },
      ],
    });
  }

  async getTransactions(accountId: string, page: number, pageSize: number) {
    const orgId = this.tenant.organizationId;
    const account = await this.prisma.client.account.findFirst({
      where: { id: accountId, organizationId: orgId },
    });
    if (!account) throw new BadRequestException('Account not found');

    const where = {
      organizationId: orgId,
      accountId,
      // Match the balance query (getCashAccounts) and the GL: show both posted
      // and reversed lines so a reversed movement isn't silently hidden.
      entry: { status: { in: [...BALANCE_AFFECTING_STATUSES] } },
    };

    const [total, lines] = await Promise.all([
      this.prisma.client.journalLine.count({ where: where as any }),
      this.prisma.client.journalLine.findMany({
        where: where as any,
        include: {
          entry: {
            select: {
              id: true,
              entryNumber: true,
              postingDate: true,
              description: true,
              sourceType: true,
              sourceId: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const rows = lines.map((l) => ({
      id: l.id,
      journalEntryId: l.journalEntryId,
      entryNumber: (l as any).entry.entryNumber,
      postingDate: (l as any).entry.postingDate,
      description: (l as any).entry.description ?? l.description,
      sourceType: (l as any).entry.sourceType,
      debit: l.debit.toString(),
      credit: l.credit.toString(),
      baseDebit: l.baseDebit.toString(),
      baseCredit: l.baseCredit.toString(),
    }));

    return {
      data: rows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      account: {
        id: account.id,
        code: account.code,
        name: account.name,
        categoryId: account.categoryId,
        bankName: account.bankName,
        accountNumber: account.accountNumber,
        currencyId: account.currencyId,
      },
    };
  }
}
