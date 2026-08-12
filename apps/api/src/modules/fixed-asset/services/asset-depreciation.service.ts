import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { ApprovalsService } from '../../../kernel/approvals/approvals.service';
import { AssetDepreciationStrategy } from './asset-depreciation.strategy';
import { PostingService } from '../../accounting/posting/posting.service';
import { AccountDeterminationService } from '../../accounting/posting/account-determination.service';
import type { RunDepreciationDto } from '../dto/run-depreciation.dto';

@Injectable()
export class AssetDepreciationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly approvals: ApprovalsService,
    private readonly strategy: AssetDepreciationStrategy,
    private readonly posting: PostingService,
    private readonly determination: AccountDeterminationService,
  ) {}

  /**
   * Post the GL effect of a depreciation entry: Dr Depreciation Expense /
   * Cr Accumulated Depreciation, then stamp journalEntryId. Idempotent — skips if
   * already posted. The posting date is derived from the period so it lands in the
   * correct (open) fiscal period.
   */
  private async postDepreciationJE(dep: {
    id: string;
    period: string;
    depreciationAmount: any;
    journalEntryId?: string | null;
  }): Promise<string | null> {
    if (dep.journalEntryId) return dep.journalEntryId;
    const amount = Number(dep.depreciationAmount);
    if (!(amount > 0)) return null;
    const expenseAcct = await this.determination.mapped('depreciation_expense');
    const accumAcct = await this.determination.mapped('accumulated_depreciation');
    const date = /^\d{4}-\d{2}/.test(dep.period)
      ? new Date(`${dep.period.slice(0, 7)}-01T00:00:00.000Z`)
      : new Date();
    const je = await this.posting.post({
      journalCode: 'GEN',
      date,
      description: `Depreciation ${dep.period}`,
      sourceType: 'asset_depreciation',
      sourceId: dep.id,
      lines: [
        { accountId: expenseAcct, debit: amount, credit: 0, description: 'Depreciation expense' },
        { accountId: accumAcct, debit: 0, credit: amount, description: 'Accumulated depreciation' },
      ],
    });
    await this.prisma.client.assetDepreciation.update({
      where: { id: dep.id },
      data: { journalEntryId: je.id, isPosted: true, postedAt: new Date() },
    });
    return je.id;
  }

  async findByAsset(assetId: string): Promise<any[]> {
    return this.prisma.client.assetDepreciation.findMany({
      where: { assetId },
      orderBy: { period: 'desc' },
    });
  }

  async findByPeriod(organizationId: string, period: string): Promise<any[]> {
    return this.prisma.client.assetDepreciation.findMany({
      where: { organizationId, period },
      include: { asset: { select: { name: true, assetCode: true, categoryId: true } } },
      orderBy: { asset: { name: 'asc' } },
    });
  }

  async run(orgId: string, dto: RunDepreciationDto): Promise<any[]> {
    const where: Record<string, any> = { organizationId: orgId, status: 'active', deletedAt: null };
    if (dto.assetId) where.id = dto.assetId;
    const assets = await this.prisma.client.asset.findMany({
      where,
      include: { category: true, depreciations: { where: { period: dto.period }, take: 1 } },
    });
    const results: any[] = [];
    for (const asset of assets) {
      if (asset.depreciations.length > 0) continue;
      const lastDepr = await this.prisma.client.assetDepreciation.findFirst({
        where: { assetId: asset.id },
        orderBy: { period: 'desc' },
      });
      const cost = Number(asset.purchaseCost ?? asset.currentValue ?? 0);
      const salvage = Number(asset.salvageValue ?? 0);
      const usefulLife = asset.usefulLife ?? 60;
      const method = asset.category?.depreciationMethod ?? 'straight_line';
      const accumDepr = lastDepr ? Number(lastDepr.accumulatedDepr) : 0;
      const bookValue = lastDepr ? Number(lastDepr.bookValue) : (cost - accumDepr);
      const input = { cost, salvageValue: salvage, usefulLife, currentBookValue: bookValue, accumulatedDepreciation: accumDepr, period: dto.period };
      const result = this.strategy.calculate(method, input);
      if (result.depreciationAmount <= 0) continue;
      const entry = await this.prisma.client.assetDepreciation.create({
        data: {
          organizationId: orgId,
          assetId: asset.id,
          period: dto.period,
          method: method as any,
          assetCost: cost,
          salvageValue: salvage,
          usefulLife,
          depreciationAmount: result.depreciationAmount,
          accumulatedDepr: result.accumulatedDepreciation,
          bookValue: result.bookValue,
          isPosted: false,
        },
      });
      await this.prisma.client.asset.update({
        where: { id: asset.id },
        data: { currentValue: result.bookValue },
      });
      // Post the GL effect when requested. A posting failure (e.g. closed period)
      // leaves the entry unposted rather than aborting the whole run.
      if (dto.postEntries) {
        try {
          await this.postDepreciationJE(entry);
        } catch (e) {
          console.warn(`[depreciation] GL post failed for ${entry.id}: ${(e as Error).message}`);
        }
      }
      results.push(entry);
    }
    this.events.publish('fixed_asset.depreciation_run', {
      organizationId: orgId,
      period: dto.period,
      entriesCount: results.length,
    });
    return results;
  }

  async postEntry(id: string): Promise<any> {
    const dep = await this.prisma.client.assetDepreciation.findFirst({ where: { id } });
    if (!dep) throw new NotFoundException(`Depreciation entry ${id} not found`);
    // Approval gate (no workflow ⇒ proceeds). Block-and-retry: caller re-posts once approved.
    const gate = await this.approvals.checkOrRequestApproval({
      entityType: 'depreciation_run',
      entityId: dep.id,
      snapshot: { amount: Number(dep.depreciationAmount ?? 0), period: dep.period },
    });
    if (gate?.needsApproval) {
      throw new BadRequestException(
        `Approval required before posting depreciation. Pending approval request ${gate.requestId}.`,
      );
    }
    await this.postDepreciationJE(dep);
    return this.prisma.client.assetDepreciation.findFirst({ where: { id } });
  }
}
