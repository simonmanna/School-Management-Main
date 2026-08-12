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
  /**
   * Cost correction required to restore the valuation invariant
   * `StockValuation == quantity × runningAverageCost` after a receipt that
   * landed on NEGATIVE on-hand.
   *
   * Positive → Dr COGS / Cr Stock Valuation (inventory was overstated because
   * the oversold units were expensed at a stale/zero average).
   * Negative → Dr Stock Valuation / Cr COGS.
   *
   * Zero/undefined on every normal (non-negative) receipt — the weighted-average
   * formula is self-consistent there, so this never fires in ordinary operation.
   */
  costCorrection?: Prisma.Decimal;
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
    /** SPECIFIC only: the actual receipt unit cost of each identified unit being issued
     *  (one entry per unit — e.g. the selected serials). Summed to the total value. */
    specificUnitCosts?: Prisma.Decimal[],
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

      case 'SPECIFIC': {
        // Specific identification: value at the actual receipt cost of the exact
        // units being issued. `specificUnitCosts` carries one cost per unit (the
        // selected serials). When no explicit selection is given, fall back to the
        // FIFO batch valuation, then to the product's standard cost.
        if (specificUnitCosts && specificUnitCosts.length > 0) {
          const totalValue = specificUnitCosts.reduce((sum, c) => sum.plus(c), ZERO);
          return { unitCost: totalValue.dividedBy(quantity), totalValue };
        }
        if (batches && batches.length > 0) {
          return this.resolveIssueCost(
            { costingMethod: 'FIFO', costPrice: product.costPrice },
            stockItem,
            quantity,
            batches,
          );
        }
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
      const receiptValue = receiptUnitCost.times(receiptQty);
      let newAvg: Prisma.Decimal;
      if (oldQty.lte(ZERO)) {
        // On-hand is zero or negative: there is no meaningful prior cost pool to
        // blend with. Blending a negative quantity into the weighted average is
        // what used to drive the average to absurd values (and, at oldAvg = 0,
        // to permanently understate COGS). The incoming cost simply becomes the
        // new basis; the value already mis-expensed is squared up by the
        // costCorrection below.
        newAvg = receiptUnitCost;
      } else {
        newAvg = oldQty.times(oldAvg).plus(receiptValue).dividedBy(newQty);
      }

      // Restore `StockValuation == qty × avg`. Everything the GL currently holds
      // for this quant is `oldQty × oldAvg`; the receipt is about to debit
      // `receiptValue`. Anything left over versus the new target belongs in COGS.
      //
      //   correction = (oldQty × oldAvg) + receiptValue − (newQty × newAvg)
      //
      // On a normal positive-stock receipt the weighted-average definition makes
      // this identically zero, so it is only computed (and only ever non-zero)
      // when the receipt landed on negative on-hand.
      let costCorrection: Prisma.Decimal | undefined;
      if (oldQty.lt(ZERO)) {
        const before = oldQty.times(oldAvg);
        const target = newQty.times(newAvg);
        costCorrection = before.plus(receiptValue).minus(target);
      }

      return {
        unitCost: receiptUnitCost,
        totalValue: receiptValue,
        newRunningAverage: newAvg,
        ...(costCorrection && !costCorrection.isZero() ? { costCorrection } : {}),
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