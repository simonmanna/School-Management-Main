import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { CreateExpenseCategoryDto, UpdateExpenseCategoryDto } from './dto/expense.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Dynamic, user-managed expense categories. Each category may point at a GL
 * expense account (`ledgerAccountId`) that its expenses debit when paid.
 */
@Injectable()
export class ExpenseCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /** Attach the resolved ledger account `{id,name,code}` for display. */
  private async withLedger(categories: any[]): Promise<any[]> {
    const ids = [...new Set(categories.map((c) => c.ledgerAccountId).filter(Boolean))] as string[];
    if (ids.length === 0) return categories.map((c) => ({ ...c, ledgerAccount: null }));
    const accounts = await this.prisma.client.account.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, code: true },
    });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    return categories.map((c) => ({
      ...c,
      ledgerAccount: c.ledgerAccountId ? (byId.get(c.ledgerAccountId) ?? null) : null,
    }));
  }

  async list() {
    const rows = await this.prisma.client.expenseCategory.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
    });
    return this.withLedger(rows);
  }

  async findOne(id: string) {
    const cat = await this.prisma.client.expenseCategory.findFirst({ where: { id, deletedAt: null } });
    if (!cat) throw new NotFoundException('Expense category not found');
    return (await this.withLedger([cat]))[0];
  }

  async create(dto: CreateExpenseCategoryDto) {
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('Name is required');
    await this.assertLedgerValid(dto.ledgerAccountId);
    const created = await this.prisma.client.expenseCategory.create({
      // organizationId is injected by the tenancy extension at runtime.
      data: {
        name,
        icon: dto.icon ?? null,
        description: dto.description ?? null,
        ledgerAccountId: dto.ledgerAccountId ?? null,
        createdBy: this.tenant.userId ?? null,
      } as any,
    });
    return (await this.withLedger([created]))[0];
  }

  async update(id: string, dto: UpdateExpenseCategoryDto) {
    const cat = await this.prisma.client.expenseCategory.findFirst({ where: { id, deletedAt: null } });
    if (!cat) throw new NotFoundException('Expense category not found');
    if (dto.ledgerAccountId !== undefined) await this.assertLedgerValid(dto.ledgerAccountId);
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.icon !== undefined) data.icon = dto.icon || null;
    if (dto.description !== undefined) data.description = dto.description || null;
    if (dto.ledgerAccountId !== undefined) data.ledgerAccountId = dto.ledgerAccountId || null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    await this.prisma.client.expenseCategory.updateMany({ where: { id }, data });
    return this.findOne(id);
  }

  /** Soft-delete. Existing expenses keep their `categoryName` snapshot. */
  async remove(id: string) {
    const cat = await this.prisma.client.expenseCategory.findFirst({ where: { id, deletedAt: null } });
    if (!cat) throw new NotFoundException('Expense category not found');
    await this.prisma.client.expenseCategory.updateMany({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { id, deleted: true };
  }

  private async assertLedgerValid(ledgerAccountId?: string | null) {
    if (!ledgerAccountId) return;
    const acc = await this.prisma.client.account.findFirst({ where: { id: ledgerAccountId } });
    if (!acc) throw new BadRequestException('Ledger account not found');
    if (!acc.isPostable || !acc.isActive) {
      throw new BadRequestException('Ledger account must be a postable (non-group, active) account');
    }
  }
}
