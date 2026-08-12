import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { StockMoveType } from '@erp/shared';
import { dec, ZERO } from '../../../kernel/common/money';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { PostingService } from '../../accounting/posting/posting.service';
import { AccountDeterminationService } from '../../accounting/posting/account-determination.service';
import type { PostingLineInput } from '../../accounting/posting/posting.types';
import { CostResolverService, type CostResolution } from '../costing/cost-resolver.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * StockPostingService — bridges inventory movements and the General Ledger.
 *
 * Every stock move that has a financial effect MUST go through here:
 *   - issue         → Dr COGS / Cr Stock Valuation
 *   - receive       → Dr Stock Valuation / Cr GRNI-Accrued (called from VendorBillService.post)
 *   - bill settle   → Dr GRNI-Accrued / Dr VAT-Input / Cr AP (called from VendorBillService.post)
 *   - adjust (-)    → Dr Stock Adj Expense / Cr Stock Valuation
 *   - adjust (+)    → Dr Stock Valuation / Cr Stock Adj Income
 *   - transfer      → no GL effect (same org, same currency)
 *
 * The caller (StockService, InvoiceService, VendorBillService) builds the
 * InventoryLedger row first, then calls this service to compose and post the
 * GL lines inside the same `$transaction`.
 */
@Injectable()
export class StockPostingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly posting: PostingService,
    private readonly determination: AccountDeterminationService,
    private readonly costResolver: CostResolverService,
  ) {}

  /**
   * Issue (sale / consumption): Dr COGS, Cr Stock Valuation.
   * Returns the cost resolution so the caller can write it on the ledger row.
   */
  async postIssue(params: {
    productId: string;
    locationId: string;
    quantity: Prisma.Decimal.Value;
    date: Date;
    sourceType: string;
    sourceId: string;
    description?: string;
    tx: any;
  }): Promise<CostResolution> {
    const qty = dec(params.quantity);
    if (qty.lte(ZERO)) throw new BadRequestException('Issue quantity must be positive');

    const product = await params.tx.product.findFirst({ where: { id: params.productId } });
    if (!product) throw new BadRequestException('Product not found');
    const stockItem = await params.tx.stockItem.findFirst({
      where: { organizationId: this.tenant.organizationId, productId: params.productId, locationId: params.locationId },
    });

    let resolution: CostResolution;
    if (product.costingMethod === 'FIFO') {
      if (!product.batchTracking) {
        throw new BadRequestException('FIFO costing requires batchTracking=true on the product');
      }
      const batches = await params.tx.inventoryBatch.findMany({
        where: { organizationId: this.tenant.organizationId, productId: params.productId, locationId: params.locationId, quantity: { gt: 0 }, isActive: true },
        orderBy: [{ expiryDate: 'asc', nulls: 'last' }, { receivedAt: 'asc' }],
      });
      resolution = this.costResolver.resolveIssueCost(
        { costingMethod: 'FIFO', costPrice: product.costPrice ?? null },
        stockItem ? { quantity: dec(stockItem.quantity), runningAverageCost: dec(stockItem.runningAverageCost) } : null,
        qty,
        batches.map((b: any) => ({
          quantity: dec(b.quantity),
          unitCost: b.unitCost ? dec(b.unitCost) : null,
          expiryDate: b.expiryDate,
          receivedAt: b.receivedAt,
        })),
      );
    } else {
      resolution = this.costResolver.resolveIssueCost(
        { costingMethod: product.costingMethod, costPrice: product.costPrice ?? null },
        stockItem ? { quantity: dec(stockItem.quantity), runningAverageCost: dec(stockItem.runningAverageCost) } : null,
        qty,
      );
    }

    if (resolution.totalValue.lte(ZERO)) {
      // Zero-cost issue (STANDARD without a costPrice, or no-cost batch): skip GL effect.
      return resolution;
    }

    const cogsAccountId = await this.determination.mapped('cogs', params.tx);
    const stockValuationAccountId = await this.determination.mapped('stock_valuation', params.tx);

    const lines: PostingLineInput[] = [
      { accountId: cogsAccountId, debit: resolution.totalValue.toString(), description: params.description ?? `COGS · ${product.name}` },
      { accountId: stockValuationAccountId, credit: resolution.totalValue.toString(), description: params.description ?? `Stock issue · ${product.name}` },
    ];

    await this.posting.post(
      {
        journalCode: 'INV',
        date: params.date,
        description: params.description ?? `Stock issue ${product.name}`,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        lines,
      },
      params.tx,
    );

    return resolution;
  }

  /**
   * Receive stock from a vendor bill (the "GRNI accrual" leg):
   * Dr Stock Valuation / Cr GRNI-Accrued.
   * Called by VendorBillService.post for stockable product lines.
   */
  async postReceiveFromBill(params: {
    productId: string;
    quantity: Prisma.Decimal.Value;
    unitCost: Prisma.Decimal.Value;
    date: Date;
    sourceType: string;
    sourceId: string;
    description?: string;
    tx: any;
  }): Promise<CostResolution> {
    const qty = dec(params.quantity);
    const unitCost = dec(params.unitCost);
    if (qty.lte(ZERO)) throw new BadRequestException('Receive quantity must be positive');
    if (unitCost.lt(ZERO)) throw new BadRequestException('Unit cost cannot be negative');

    const totalValue = unitCost.times(qty);
    if (totalValue.lte(ZERO)) {
      return { unitCost, totalValue, newRunningAverage: unitCost };
    }

    const stockValuationAccountId = await this.determination.mapped('stock_valuation', params.tx);
    const grniAccountId = await this.determination.mapped('grni_accrued', params.tx);

    const lines: PostingLineInput[] = [
      { accountId: stockValuationAccountId, debit: totalValue.toString(), description: params.description ?? 'Stock receipt' },
      { accountId: grniAccountId, credit: totalValue.toString(), description: params.description ?? 'GRNI accrual' },
    ];

    await this.posting.post(
      {
        journalCode: 'INV',
        date: params.date,
        description: params.description ?? 'Stock receipt',
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        lines,
      },
      params.tx,
    );

    return { unitCost, totalValue, newRunningAverage: unitCost };
  }

  /**
   * Variance from a stock adjustment (count vs system):
   * positive (delta > 0) → Dr Stock Valuation / Cr Stock Adj Income
   * negative (delta < 0) → Dr Stock Adj Expense / Cr Stock Valuation
   */
  async postAdjustment(params: {
    productId: string;
    delta: Prisma.Decimal.Value;
    unitCost: Prisma.Decimal.Value;
    date: Date;
    sourceType: string;
    sourceId: string;
    description?: string;
    tx: any;
  }): Promise<void> {
    const delta = dec(params.delta);
    const unitCost = dec(params.unitCost);
    if (delta.isZero()) return;

    const totalValue = unitCost.times(delta.abs());
    if (totalValue.lte(ZERO)) return;

    const stockValuationAccountId = await this.determination.mapped('stock_valuation', params.tx);
    const isPositive = delta.gt(ZERO);

    const lines: PostingLineInput[] = isPositive
      ? [
          { accountId: stockValuationAccountId, debit: totalValue.toString(), description: 'Stock variance gain' },
          { accountId: await this.determination.mapped('stock_adjustment_income', params.tx), credit: totalValue.toString(), description: 'Stock variance gain' },
        ]
      : [
          { accountId: await this.determination.mapped('stock_adjustment_expense', params.tx), debit: totalValue.toString(), description: 'Stock variance loss' },
          { accountId: stockValuationAccountId, credit: totalValue.toString(), description: 'Stock variance loss' },
        ];

    await this.posting.post(
      {
        journalCode: 'ADJ',
        date: params.date,
        description: params.description ?? 'Stock adjustment',
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        lines,
      },
      params.tx,
    );
  }
}