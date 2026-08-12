import { Prisma } from '@prisma/client';
import type { CostingMethod } from '@erp/shared';
import { dec, ZERO } from '../../../kernel/common/money';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface CostResolution {
  /** The unit cost to use for the issue/receipt. */
  unitCost: Prisma.Decimal;
  /** Total value (= unitCost × quantity). */
  totalValue: Prisma.Decimal;
  /**
   * Optional AVCO recompute: when a receipt hits an AVCO product, this is the
   * new running average cost. `undefined` for FIFO/STANDARD (no recompute).
   */
  newRunningAverage?: Prisma.Decimal;
}

/**
 * Pure costing math, polymorphic on `product.costingMethod`. The service that
 * orchestrates stock movements calls this to know:
 *   - what unit cost to write on the InventoryLedger row
 *   - whether to update StockItem.runningAverageCost
 *
 * Three methods are supported (ADR for M3):
 *   - AVCO:       weighted-average. Recompute on every receipt. Issue uses
 *                 current average. No batch is required (FIFO-by-expiry still
 *                 works as a secondary sort).
 *   - FIFO:       first-in-first-out across batches by (expiry asc, received
 *                 asc). Requires batchTracking=true (enforced by callers).
 *   - STANDARD:   fixed Product.costPrice. No recompute on receipt.
 *
 * This module does NOT touch the database — it is pure math so the unit tests
 * stay fast and deterministic.
 */
export class CostResolverService {
  /** The unit cost for issuing `quantity` units of `product` from `stockItem`. */
  resolveIssueCost(
    product: { costingMethod: CostingMethod; costPrice: Prisma.Decimal | null },
    stockItem: { quantity: Prisma.Decimal; runningAverageCost: Prisma.Decimal } | null,
    quantity: Prisma.Decimal,
    batches?: { quantity: Prisma.Decimal; unitCost: Prisma.Decimal | null; expiryDate: Date | null; receivedAt: Date }[],
  ): CostResolution {
    if (quantity.lte(ZERO)) {
      return { unitCost: ZERO, totalValue: ZERO };
    }

    switch (product.costingMethod) {
      case 'AVCO': {
        if (!stockItem || stockItem.quantity.lte(ZERO)) {
          throw new Error('No stock to issue');
        }
        const unitCost = stockItem.runningAverageCost;
        return { unitCost, totalValue: unitCost.times(quantity) };
      }

      case 'FIFO': {
        if (!batches || batches.length === 0) {
          throw new Error('FIFO costing requires at least one batch');
        }
        // Compute weighted-average across the batches consumed by FIFO order
        // up to `quantity`. The caller is responsible for actually updating
        // batch quantities; we just compute the cost.
        const sorted = [...batches].sort((a, b) => {
          if (a.expiryDate && b.expiryDate) {
            return a.expiryDate.getTime() - b.expiryDate.getTime();
          }
          if (a.expiryDate) return -1;
          if (b.expiryDate) return 1;
          return a.receivedAt.getTime() - b.receivedAt.getTime();
        });

        let remaining = quantity;
        let totalCost = ZERO;
        for (const b of sorted) {
          if (remaining.lte(ZERO)) break;
          const take = Prisma.Decimal.min(remaining, b.quantity);
          const unitCost = b.unitCost ?? ZERO;
          totalCost = totalCost.plus(unitCost.times(take));
          remaining = remaining.minus(take);
        }
        if (remaining.gt(ZERO)) {
          throw new Error(`Insufficient batch stock to cover ${quantity.toString()} (short by ${remaining.toString()})`);
        }
        // Average unit cost across the consumption (matches ledger expectations)
        const unitCost = totalCost.dividedBy(quantity);
        return { unitCost, totalValue: totalCost };
      }

      case 'STANDARD': {
        const unitCost = product.costPrice ?? ZERO;
        return { unitCost, totalValue: unitCost.times(quantity) };
      }

      default: {
        const _exhaustive: never = product.costingMethod;
        throw new Error(`Unknown costing method: ${String(_exhaustive)}`);
      }
    }
  }

  /**
   * Compute the new running-average cost after a receipt, for AVCO products.
   * Returns `undefined` for FIFO/STANDARD products.
   */
  resolveReceiptCost(
    product: { costingMethod: CostingMethod; costPrice: Prisma.Decimal | null },
    stockItem: { quantity: Prisma.Decimal; runningAverageCost: Prisma.Decimal } | null,
    receiptQty: Prisma.Decimal,
    receiptUnitCost: Prisma.Decimal,
  ): CostResolution {
    if (receiptQty.lte(ZERO)) {
      throw new Error('Receipt quantity must be positive');
    }

    if (product.costingMethod === 'AVCO') {
      const oldQty = stockItem?.quantity ?? ZERO;
      const oldAvg = stockItem?.runningAverageCost ?? ZERO;
      const newQty = oldQty.plus(receiptQty);
      let newAvg: Prisma.Decimal;
      if (newQty.lte(ZERO)) {
        newAvg = receiptUnitCost;
      } else {
        newAvg = oldQty.times(oldAvg).plus(receiptQty.times(receiptUnitCost)).dividedBy(newQty);
      }
      return {
        unitCost: receiptUnitCost,
        totalValue: receiptUnitCost.times(receiptQty),
        newRunningAverage: newAvg,
      };
    }

    // FIFO / STANDARD: no recompute. Unit cost is the receipt's unit cost.
    return { unitCost: receiptUnitCost, totalValue: receiptUnitCost.times(receiptQty) };
  }

  /**
   * For AVCO products, the unit cost used when issuing stock. Returns ZERO if
   * the stock item is missing (caller must check first).
   */
  avcoUnitCost(stockItem: { runningAverageCost: Prisma.Decimal } | null): Prisma.Decimal {
    return stockItem?.runningAverageCost ?? ZERO;
  }
}