import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dec, round, sum, ZERO } from '../../../kernel/common/money';

export interface TaxLike {
  id: string;
  rate: Prisma.Decimal | number | string;
  isInclusive: boolean;
  isCompound: boolean;
  /**
   * Tax type. `withholding` taxes are NOT output tax: they are computed
   * separately and never folded into the line's tax total / gross / invoice
   * value. (Previously a withholding tax assigned to a line was mistakenly
   * treated as output VAT — inflating the invoice and mis-posting to tax_payable.)
   */
  type?: string;
}

export interface LineTaxResult {
  net: Prisma.Decimal;
  taxTotal: Prisma.Decimal;
  gross: Prisma.Decimal;
  breakdown: { taxId: string; amount: Prisma.Decimal }[];
  /** Withholding computed on the net base — informational, NOT part of gross. */
  withholdingTotal: Prisma.Decimal;
  withholdingBreakdown: { taxId: string; amount: Prisma.Decimal }[];
}

/**
 * Centralized tax engine (ADR-010). Handles exclusive, inclusive and compound
 * output taxes for a single line amount, accepting an array so multi-tax lines
 * are a non-breaking extension. Withholding-type taxes are partitioned out and
 * returned separately — they never affect the line's net/gross/total.
 */
@Injectable()
export class TaxCalculationService {
  computeLine(amount: Prisma.Decimal, taxes: TaxLike[]): LineTaxResult {
    const output = (taxes ?? []).filter((t) => t.type !== 'withholding');
    const withholding = (taxes ?? []).filter((t) => t.type === 'withholding');

    // ── Output tax (VAT / GST / sales tax) determines net, gross and total ──
    let net: Prisma.Decimal;
    if (output.length === 0) {
      net = round(amount, 6);
    } else if (output.some((t) => t.isInclusive)) {
      // amount is tax-inclusive: extract the net base from the output rates.
      const totalRate = sum(output.map((t) => dec(t.rate)));
      net = amount.dividedBy(dec(1).plus(totalRate.dividedBy(100)));
    } else {
      net = amount;
    }

    let taxTotal = ZERO;
    const breakdown: { taxId: string; amount: Prisma.Decimal }[] = [];
    for (const t of output) {
      const base = t.isCompound ? net.plus(taxTotal) : net;
      const amt = round(base.times(dec(t.rate).dividedBy(100)), 6);
      taxTotal = taxTotal.plus(amt);
      breakdown.push({ taxId: t.id, amount: amt });
    }

    net = round(net, 6);
    taxTotal = round(taxTotal, 6);

    // ── Withholding tax (separate; on the net base; never part of gross) ──
    let withholdingTotal = ZERO;
    const withholdingBreakdown: { taxId: string; amount: Prisma.Decimal }[] = [];
    for (const t of withholding) {
      const amt = round(net.times(dec(t.rate).dividedBy(100)), 6);
      withholdingTotal = withholdingTotal.plus(amt);
      withholdingBreakdown.push({ taxId: t.id, amount: amt });
    }
    withholdingTotal = round(withholdingTotal, 6);

    return {
      net,
      taxTotal,
      gross: net.plus(taxTotal),
      breakdown,
      withholdingTotal,
      withholdingBreakdown,
    };
  }
}
