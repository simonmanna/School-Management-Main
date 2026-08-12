import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Account } from '@prisma/client';
import type { ReportSection } from '@erp/shared';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AccountResolverService } from '../posting/account-resolver.service';
import { balanceSheetSideOf, rollupTree } from '../reporting/account-classification';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Guards against a malformed tree walking forever. */
const MAX_TREE_DEPTH = 32;

export interface AccountTreeQuery {
  includeInactive?: boolean;
  includeBalances?: boolean;
  asOf?: string;
  categoryKey?: string;
  classification?: string;
}

@Injectable()
export class AccountService extends BaseCrudService<Account, CreateAccountDto, UpdateAccountDto> {
  protected readonly entityName = 'Account';
  protected readonly searchFields = ['code', 'name'];
  protected readonly defaultOrderBy: Array<Record<string, 'asc' | 'desc'>> = [
    { sortOrder: 'asc' },
    { code: 'asc' },
  ];
  protected readonly defaultInclude = {
    category: {
      select: {
        id: true,
        key: true,
        name: true,
        classification: true,
        normalBalance: true,
        reportSection: true,
        cashFlowClass: true,
        isContra: true,
        isCashEquivalent: true,
        allowReconciliation: true,
        allowManualPosting: true,
        allowBudgeting: true,
      },
    },
    parent: { select: { id: true, code: true, name: true } },
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly resolver: AccountResolverService,
  ) {
    super(prisma.client.account as unknown as CrudDelegate);
  }

  async create(data: CreateAccountDto): Promise<Account> {
    const organizationId = this.tenant.organizationId;
    const derived = await this.validate(data, null);
    const created = await this.prisma.client.account.create({
      data: { ...(data as any), organizationId, ...derived },
    });
    this.resolver.invalidate(organizationId);
    return created as Account;
  }

  async update(id: string, data: UpdateAccountDto): Promise<Account> {
    const existing = await this.prisma.client.account.findFirst({
      where: { id },
      include: { category: true },
    });
    if (!existing) throw new NotFoundException(`Account ${id} not found`);
    const derived = await this.validate(data, existing);
    const updated = await super.update(id, { ...(data as any), ...derived });
    this.resolver.invalidate(this.tenant.organizationId);
    return updated;
  }

  /**
   * Everything that must hold for an account to be well-formed.
   *
   * None of this existed before: `create` only defaulted the cash-flow class and
   * `update` was a straight passthrough, so an account's code or type could be
   * changed after it had been posted to, a group could be made its own parent,
   * and a duplicate code surfaced as an opaque Prisma P2002.
   *
   * Returns the fields the service owns and the client may not set.
   */
  private async validate(
    data: Partial<CreateAccountDto & UpdateAccountDto>,
    existing: any | null,
  ): Promise<Record<string, unknown>> {
    const organizationId = this.tenant.organizationId;
    const id: string | undefined = existing?.id;

    const isPostable: boolean = (data as any).isPostable ?? existing?.isPostable ?? true;

    // --- category -----------------------------------------------------------
    // Structural invariant: `isPostable === (categoryId !== null)`.
    //
    // A category describes accounting *behavior*, which only a postable account
    // has. Group nodes ("Assets", "Revenue") are folders in the reporting tree —
    // giving them a category would blend structure with behavior, which is the
    // conflation this whole design removes.
    const categoryId: string | null =
      (data as any).categoryId !== undefined
        ? ((data as any).categoryId || null)
        : (existing?.categoryId ?? null);

    if (isPostable && !categoryId) {
      throw new BadRequestException(
        'A postable account requires a category. It determines how the accounting engine treats this account.',
      );
    }
    if (!isPostable && categoryId) {
      throw new BadRequestException(
        'A group account is a structural node in the reporting tree and must not have a category.',
      );
    }

    const category = categoryId
      ? await this.prisma.client.accountCategory.findFirst({ where: { id: categoryId } })
      : null;
    if (categoryId && !category) throw new BadRequestException('Account category not found');
    if (category && !category.isActive) {
      throw new BadRequestException('Account category is inactive');
    }

    // --- code ---------------------------------------------------------------
    const code: string | undefined = (data as any).code ?? existing?.code;
    if (!code) throw new BadRequestException('Account code is required');
    if (!existing || code !== existing.code) {
      const clash = await this.prisma.client.account.findFirst({
        where: { code, deletedAt: null, ...(id ? { id: { not: id } } : {}) },
        select: { id: true, name: true },
      });
      if (clash) {
        throw new ConflictException(`Account code '${code}' is already used by '${clash.name}'`);
      }
    }

    const postedLines = id
      ? await this.prisma.client.journalLine.count({ where: { accountId: id } })
      : 0;

    if (existing && code !== existing.code && postedLines > 0) {
      throw new BadRequestException(
        `Account ${existing.code} has posted journal entries; its code cannot be changed. ` +
          'Create a new account instead.',
      );
    }

    // --- category change on a posted account --------------------------------
    // Moving between categories of the same classification and normal balance is
    // a pure reclassification. Anything else restates posted history: it flips a
    // sign or moves the account between statements.
    if (existing && categoryId !== existing.categoryId && postedLines > 0) {
      const before = existing.category;
      if (
        !before ||
        !category ||
        before.classification !== category.classification ||
        before.normalBalance !== category.normalBalance
      ) {
        throw new BadRequestException(
          `Account ${existing.code} has posted journal entries. Moving it from ` +
            `'${before?.key ?? 'none'}' to '${category?.key ?? 'none'}' would restate reported ` +
            'history because it changes the classification or normal balance. ' +
            'Create a new account and reclassify future postings instead.',
        );
      }
    }

    // --- postable flag -------------------------------------------------------
    if (existing && isPostable !== existing.isPostable) {
      if (!isPostable) {
        // Becoming a group node. Its balance would stop being its own, so any
        // posted history would silently move under a roll-up.
        if (postedLines > 0) {
          throw new BadRequestException(
            'This account has posted journal entries and cannot become a group account. ' +
              'Group accounts are structural nodes and cannot be posted to.',
          );
        }
      } else {
        // Becoming postable. Only group nodes may have children, so a parent
        // cannot be turned into a leaf while it still has any.
        const childCount = await this.prisma.client.account.count({
          where: { parentAccountId: id, deletedAt: null },
        });
        if (childCount > 0) {
          throw new BadRequestException(
            'This account has child accounts, so it must remain a group account.',
          );
        }
      }
    }

    // --- parent -------------------------------------------------------------
    const parentAccountId: string | null =
      (data as any).parentAccountId !== undefined
        ? (data as any).parentAccountId || null
        : (existing?.parentAccountId ?? null);

    if (parentAccountId) {
      if (id && parentAccountId === id) {
        throw new BadRequestException('An account cannot be its own parent.');
      }
      const parent = await this.prisma.client.account.findFirst({
        where: { id: parentAccountId },
        include: { category: true },
      });
      // RLS scopes the query, but assert explicitly for a clear error.
      if (!parent || parent.organizationId !== organizationId) {
        throw new BadRequestException('Parent account not found in this organization.');
      }
      // Only group nodes may have children. A postable account is a leaf: giving
      // it children would double-count its balance against their roll-up.
      if (parent.isPostable) {
        throw new BadRequestException(
          `'${parent.code} ${parent.name}' is a postable account, so it cannot have children. ` +
            'Only group accounts can.',
        );
      }
      // Group parents carry no category, so there is nothing to compare against.
      // The guard applies between two categorized accounts.
      if (parent.category && category && parent.category.classification !== category.classification) {
        throw new BadRequestException(
          `Cannot file a ${category.classification} account under ` +
            `'${parent.code} ${parent.name}', which is ${parent.category.classification}. ` +
            'The hierarchy must stay within one classification.',
        );
      }
      if (id) await this.assertNoCycle(id, parentAccountId);
    }

    // --- report-section override --------------------------------------------
    // An override may only move an account within its own side of the accounts:
    // a balance-sheet account to another balance-sheet section, a P&L account to
    // another P&L section. Without this, inventory could be silently reported on
    // the profit & loss statement.
    const reportSection: string | null =
      (data as any).reportSection !== undefined
        ? ((data as any).reportSection || null)
        : (existing?.reportSection ?? null);

    if (reportSection && category) {
      const target = balanceSheetSideOf(reportSection as ReportSection);
      const natural = balanceSheetSideOf(category.reportSection as ReportSection);
      if (target !== natural) {
        throw new BadRequestException(
          `Report section '${reportSection}' is not compatible with a ` +
            `${category.key} account, which reports under '${category.reportSection}'. ` +
            'An override cannot move an account between the balance sheet and the profit & loss statement.',
        );
      }
    }

    // --- derived, service-owned fields --------------------------------------
    return {
      categoryId,
      // Mirrored from the category — it is what every report signs balances by.
      // Group nodes keep the column default; their balance is always a roll-up.
      ...(category ? { normalBalance: category.normalBalance } : {}),
      cashFlowCategory:
        (data as any).cashFlowCategory ?? existing?.cashFlowCategory ?? category?.cashFlowClass ?? null,
    };
  }

  /** Walk up from `parentId`; if we reach `id` the reparent would create a cycle. */
  private async assertNoCycle(id: string, parentId: string): Promise<void> {
    let cursor: string | null = parentId;
    for (let depth = 0; cursor && depth < MAX_TREE_DEPTH; depth += 1) {
      if (cursor === id) {
        throw new BadRequestException(
          'That parent is a descendant of this account; the change would create a cycle.',
        );
      }
      const row: { parentAccountId: string | null } | null =
        await this.prisma.client.account.findFirst({
          where: { id: cursor },
          select: { parentAccountId: true },
        });
      cursor = row?.parentAccountId ?? null;
    }
    if (cursor) {
      throw new BadRequestException(
        `Account hierarchy is deeper than ${MAX_TREE_DEPTH} levels; refusing to reparent.`,
      );
    }
  }

  /**
   * The chart of accounts as a forest, with optional balance roll-ups.
   *
   * The tree exists in the schema but nothing built it server-side before, so
   * the web client re-derived it from a flat 200-row page and no report ever
   * rolled a child into its parent.
   */
  async tree(query: AccountTreeQuery = {}) {
    const accounts = await this.prisma.client.account.findMany({
      where: {
        deletedAt: null,
        ...(query.includeInactive ? {} : { isActive: true }),
        ...(query.categoryKey ? { category: { key: query.categoryKey } } : {}),
        ...(query.classification
          ? { category: { classification: query.classification as any } }
          : {}),
      },
      include: {
        category: {
          select: {
            key: true,
            name: true,
            classification: true,
            normalBalance: true,
            reportSection: true,
          },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });

    // Debit and credit are kept separate so the sign can follow normalBalance.
    const balanceByAccount = new Map<string, { debit: Prisma.Decimal | null; credit: Prisma.Decimal | null }>();
    if (query.includeBalances) {
      const asOf = query.asOf ? new Date(query.asOf) : new Date();
      const grouped = await this.prisma.client.journalLine.groupBy({
        by: ['accountId'],
        where: { entry: { status: { in: ['posted', 'reversed'] }, postingDate: { lte: asOf } } },
        _sum: { baseDebit: true, baseCredit: true },
      });
      for (const g of grouped as any[]) {
        balanceByAccount.set(g.accountId, { debit: g._sum.baseDebit, credit: g._sum.baseCredit });
      }
    }

    const roots = rollupTree(accounts as any[], (a: any) => {
      // Non-postable accounts (summary nodes) cannot be posted to, so their
      // own balance is always zero and their subtotal is a pure roll-up of the
      // accounts beneath them.
      if (!a.isPostable) return new Prisma.Decimal(0);
      const sums = balanceByAccount.get(a.id);
      if (!sums) return new Prisma.Decimal(0);
      const net = new Prisma.Decimal(sums.debit ?? 0).minus(sums.credit ?? 0);
      return a.normalBalance === 'credit' ? net.negated() : net;
    });

    const shape = (n: any): any => ({
      id: n.node.id,
      code: n.node.code,
      name: n.node.name,
      isPostable: n.node.isPostable,
      isActive: n.node.isActive,
      deprecatedAt: n.node.deprecatedAt,
      sortOrder: n.node.sortOrder,
      controlAccountType: n.node.controlAccountType ?? null,
      categoryKey: n.node.category?.key ?? null,
      categoryName: n.node.category?.name ?? null,
      classification: n.node.category?.classification ?? null,
      normalBalance: n.node.normalBalance,
      reportSection: n.node.reportSection ?? n.node.category?.reportSection ?? null,
      level: n.level,
      ...(query.includeBalances
        ? { ownBalance: n.ownBalance.toString(), subtotal: n.subtotal.toString() }
        : {}),
      children: n.children.map(shape),
    });

    return { nodes: roots.map(shape) };
  }

  /** Drag-reorder support: bulk set sortOrder and/or parent. */
  async reorder(items: Array<{ id: string; sortOrder?: number; parentAccountId?: string | null }>) {
    for (const item of items) {
      await this.update(item.id, {
        ...(item.sortOrder !== undefined ? { sortOrder: item.sortOrder } : {}),
        ...(item.parentAccountId !== undefined ? { parentAccountId: item.parentAccountId } : {}),
      } as UpdateAccountDto);
    }
    return { updated: items.length };
  }

  /**
   * Soft-retire an account: hidden from pickers and blocked from NEW postings,
   * but its history stays intact. The middle ground between "still in use" and
   * "delete", which the guards below make impossible for any real account.
   */
  async deprecate(id: string, deprecated = true): Promise<Account> {
    const acct = await this.prisma.client.account.findFirst({ where: { id } });
    if (!acct) throw new NotFoundException(`Account ${id} not found`);
    const mapping = await this.prisma.client.accountMapping.findFirst({ where: { accountId: id } });
    if (deprecated && mapping) {
      throw new BadRequestException(
        `Account is used by account mapping '${mapping.key}'. Reassign the mapping first.`,
      );
    }
    const updated = await this.prisma.client.account.update({
      where: { id },
      data: { deprecatedAt: deprecated ? new Date() : null },
    });
    this.resolver.invalidate(this.tenant.organizationId);
    return updated as Account;
  }

  /**
   * Guarded delete. A system/protected account, a group with children, an account
   * that already carries journal lines, or one wired into an AccountMapping cannot
   * be deleted — deactivate or deprecate it instead (audit fix #4).
   */
  async remove(id: string): Promise<void> {
    const acct = await this.prisma.client.account.findFirst({ where: { id } });
    if (!acct) throw new NotFoundException(`Account ${id} not found`);
    if ((acct as any).isSystem || (acct as any).isProtected) {
      throw new BadRequestException(
        'This is a protected system account and cannot be deleted. Deactivate or deprecate it instead.',
      );
    }
    const childCount = await this.prisma.client.account.count({ where: { parentAccountId: id } });
    if (childCount > 0) {
      throw new BadRequestException('Account has child accounts. Reassign or delete them first.');
    }
    const lineCount = await this.prisma.client.journalLine.count({ where: { accountId: id } });
    if (lineCount > 0) {
      throw new BadRequestException(
        'Account has journal entries and cannot be deleted. Deprecate it instead so history is preserved.',
      );
    }
    const mapping = await this.prisma.client.accountMapping.findFirst({ where: { accountId: id } });
    if (mapping) {
      throw new BadRequestException(
        `Account is used by account mapping '${mapping.key}'. Reassign the mapping first.`,
      );
    }
    await super.remove(id);
    this.resolver.invalidate(this.tenant.organizationId);
  }
}
