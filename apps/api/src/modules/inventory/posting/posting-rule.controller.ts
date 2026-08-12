import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { InventoryMovementType } from '@erp/shared';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { PostingService } from '../../accounting/posting/posting.service';
import { dec, ZERO } from '../../../kernel/common/money';
import type { PostingLineInput } from '../../accounting/posting/posting.types';
import { InventoryPostingRuleService } from './posting-rule.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * M3 — Configurable Inventory Posting Rule Controller.
 * API surface for CRUD of InventoryPostingRule + resolve preview.
 */
@Injectable()
export class InventoryPostingRuleControllerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly rule: InventoryPostingRuleService,
    private readonly posting: PostingService,
  ) {}

  // ─── Read ────────────────────────────────────────────────────────────────

  /** List all rules for this org, optionally filtered. */
  async list(movementType?: string, productId?: string, categoryId?: string) {
    const where: any = { organizationId: this.tenant.organizationId };
    if (movementType) where.movementType = movementType;
    if (productId !== undefined) where.productId = productId;
    if (categoryId !== undefined) where.categoryId = categoryId;
    return this.prisma.client.inventoryPostingRule.findMany({
      where,
      orderBy: [{ movementType: 'asc' }, { lineIndex: 'asc' }],
    });
  }

  /** Get all movement types with their default rules (for UI overview). */
  async overview() {
    const orgId = this.tenant.organizationId;
    const rules = await this.prisma.client.inventoryPostingRule.findMany({
      where: { organizationId: orgId, productId: null, categoryId: null },
      orderBy: [{ movementType: 'asc' }, { lineIndex: 'asc' }],
    });
    // Group by movement type
    const grouped: Record<string, any[]> = {};
    for (const r of rules) {
      if (!grouped[r.movementType]) grouped[r.movementType] = [];
      grouped[r.movementType].push(r);
    }
    return grouped;
  }

  // ─── Create ──────────────────────────────────────────────────────────────

  async create(dto: {
    movementType: InventoryMovementType;
    lineIndex: number;
    debitOrCredit: 'debit' | 'credit';
    accountSource: string;
    accountMappingKey?: string;
    literalAccountId?: string;
    productId?: string;
    categoryId?: string;
  }) {
    return this.prisma.client.inventoryPostingRule.create({
      data: {
        organizationId: this.tenant.organizationId,
        movementType: dto.movementType,
        lineIndex: dto.lineIndex,
        debitOrCredit: dto.debitOrCredit,
        accountSource: dto.accountSource,
        accountMappingKey: dto.accountMappingKey ?? null,
        literalAccountId: dto.literalAccountId ?? null,
        productId: dto.productId ?? null,
        categoryId: dto.categoryId ?? null,
      },
    });
  }

  // ─── Update ──────────────────────────────────────────────────────────────

  async update(id: string, dto: {
    accountSource?: string;
    accountMappingKey?: string;
    literalAccountId?: string;
    isActive?: boolean;
  }) {
    const rule = await this.prisma.client.inventoryPostingRule.findFirst({
      where: { id, organizationId: this.tenant.organizationId },
    });
    if (!rule) throw new NotFoundException('Posting rule not found');

    return this.prisma.client.inventoryPostingRule.update({
      where: { id },
      data: {
        ...(dto.accountSource !== undefined ? { accountSource: dto.accountSource } : {}),
        ...(dto.accountMappingKey !== undefined ? { accountMappingKey: dto.accountMappingKey } : {}),
        ...(dto.literalAccountId !== undefined ? { literalAccountId: dto.literalAccountId } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  // ─── Delete ──────────────────────────────────────────────────────────────

  async remove(id: string) {
    const rule = await this.prisma.client.inventoryPostingRule.findFirst({
      where: { id, organizationId: this.tenant.organizationId },
    });
    if (!rule) throw new NotFoundException('Posting rule not found');
    await this.prisma.client.inventoryPostingRule.delete({ where: { id } });
    return { ok: true };
  }

  // ─── Resolve Preview ────────────────────────────────────────────────────

  /**
   * Preview what posting lines a movement would produce for a given product,
   * without actually posting anything. Shows the resolved account IDs and
   * the resolution level (product/category/movement-type).
   */
  async resolvePreview(productId: string, movementType: InventoryMovementType) {
    const structure = await this.rule.resolveStructure(movementType, productId);
    // Fetch account names for display
    const accountIds = structure
      .flatMap((s) => [s.debitAccountId, s.creditAccountId])
      .filter(Boolean) as string[];
    const accounts = accountIds.length > 0
      ? await this.prisma.client.account.findMany({
          where: { id: { in: accountIds } },
          select: { id: true, code: true, name: true },
        })
      : [];
    const accountMap = new Map(accounts.map((a: any) => [a.id, a]));

    // Determine specificity level
    const rules = await this.prisma.client.inventoryPostingRule.findMany({
      where: {
        organizationId: this.tenant.organizationId,
        movementType,
        isActive: true,
      },
      select: { productId: true, categoryId: true },
    });
    const hasProductOverride = rules.some((r: any) => r.productId === productId);
    const product = await this.prisma.client.product.findFirst({ where: { id: productId } });
    const hasCategoryDefault = rules.some((r: any) => r.categoryId === (product?.categoryId ?? '__none__'));

    let resolutionLevel = 'org_default';
    if (hasProductOverride) resolutionLevel = 'product_override';
    else if (hasCategoryDefault) resolutionLevel = 'category_default';

    return {
      movementType,
      resolutionLevel,
      lines: structure.map((s) => ({
        debit: s.debitAccountId
          ? { id: s.debitAccountId, ...(accountMap.get(s.debitAccountId) ?? {}) }
          : null,
        credit: s.creditAccountId
          ? { id: s.creditAccountId, ...(accountMap.get(s.creditAccountId) ?? {}) }
          : null,
        accountSource: s.accountSource,
      })),
    };
  }
}
