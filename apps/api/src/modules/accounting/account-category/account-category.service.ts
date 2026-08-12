import { Injectable, NotFoundException } from '@nestjs/common';
import type { AccountCategory } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Read-only access to the global account-category catalog.
 *
 * Categories describe accounting *concepts* — "cash", "inventory",
 * "receivable" — not tenant configuration, so they are global rows shared by
 * every organization and **system-managed**: there is no create, update or
 * delete. The sole writer is the boot seeder (`account-category-seeder.ts`),
 * which is version-gated so upgrades are deterministic.
 *
 * Tenants customize the chart of accounts, the account mappings and the
 * hierarchy — never the meaning of a category. If one tenant could rename
 * `inventory` or flip its normal balance, it would change how the posting engine
 * behaves for every other tenant on the instance.
 */
@Injectable()
export class AccountCategoryService {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<AccountCategory[]> {
    return this.prisma.raw.accountCategory.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
    });
  }

  async findOne(id: string): Promise<AccountCategory> {
    const row = await this.prisma.raw.accountCategory.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException(`Account category ${id} not found`);
    return row;
  }

  /**
   * Categories plus how many of *this organization's* accounts use each. The
   * catalog is global; the counts are tenant-scoped, so they go through the
   * tenant client.
   */
  async listWithUsage() {
    const [categories, counts] = await Promise.all([
      this.list(),
      this.prisma.client.account.groupBy({
        by: ['categoryId'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
    ]);
    const usage = new Map((counts as any[]).map((c) => [c.categoryId, c._count._all as number]));
    return (categories as any[]).map((c) => ({ ...c, accountCount: usage.get(c.id) ?? 0 }));
  }
}
