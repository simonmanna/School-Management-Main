import { Injectable } from '@nestjs/common';
import type { Account, AccountType } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

/**
 * Map an AccountType to its default Cash Flow section (D3).
 * Expense / COGS always flow through Operating. Asset accounts default to
 * Investing. Liability / equity accounts default to Financing. Revenue is
 * always Operating.
 */
function defaultCashFlowCategory(accountType: AccountType): 'operating' | 'investing' | 'financing' | null {
  switch (accountType) {
    case 'revenue':
    case 'expense':
    case 'cost_of_goods_sold':
      return 'operating';
    case 'asset':
    case 'bank':
    case 'cash':
    case 'receivable':
    case 'contra_asset':
      return 'investing';
    case 'liability':
    case 'payable':
    case 'tax':
    case 'contra_liability':
    case 'equity':
      return 'financing';
    default:
      return null;
  }
}

@Injectable()
export class AccountService extends BaseCrudService<Account, CreateAccountDto, UpdateAccountDto> {
  protected readonly entityName = 'Account';
  protected readonly searchFields = ['code', 'name'];
  protected readonly defaultOrderBy = { code: 'asc' as const };

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {
    super(prisma.client.account as unknown as CrudDelegate);
  }

  /** Override `create` so cashFlowCategory gets a sensible default. */
  async create(data: CreateAccountDto): Promise<Account> {
    const organizationId = this.tenant.organizationId;
    const cashFlowCategory =
      (data as any).cashFlowCategory ?? defaultCashFlowCategory(data.accountType as AccountType);
    return this.prisma.client.$transaction(async (tx) => {
      const created = await tx.account.create({ data: { ...data, cashFlowCategory } as any });
      return created;
    });
  }

  async update(id: string, data: UpdateAccountDto): Promise<Account> {
    return super.update(id, data as any);
  }
}