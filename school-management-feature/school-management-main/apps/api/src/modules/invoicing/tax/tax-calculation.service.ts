import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dec, round, sum, ZERO } from '../../../kernel/common/money';

export interface TaxLike {
  id: string;
  rate: Prisma.Decimal | number | string;
  isInclusive: boolean;
  isCompound: boolean;
}

export interface LineTaxResult {
  net: Prisma.Decimal;
  taxTotal: Prisma.Decimal;
  gross: Prisma.Decimal;
  breakdown: { taxId: string; amount: Prisma.Decimal }[];
}

/**
 * Centralized tax engine (ADR-010). Handles exclusive, inclusive and compound
 * taxes for a single line amount. One line currently carries one tax, but the
 * algorithm accepts an array so multi-tax lines are a non-breaking extension.
 */
@Injectable()
export class TaxCalculationService {
  computeLine(amount: Prisma.Decimal, taxes: TaxLike[]): LineTaxResult {
    if (!taxes || taxes.length === 0) {
      const net = round(amount, 6);
      return { net, taxTotal: ZERO, gross: net, breakdown: [] };
    }

    const inclusive = taxes.some((t) => t.isInclusive);
    let net: Prisma.Decimal;
    if (inclusive) {
      // amount is tax-inclusive: extract the net base.
      const totalRate = sum(taxes.map((t) => dec(t.rate)));
      net = amount.dividedBy(dec(1).plus(totalRate.dividedBy(100)));
    } else {
      net = amount;
    }

    let taxTotal = ZERO;
    const breakdown: { taxId: string; amount: Prisma.Decimal }[] = [];
    for (const t of taxes) {
      const base = t.isCompound ? net.plus(taxTotal) : net;
      const amt = round(base.times(dec(t.rate).dividedBy(100)), 6);
      taxTotal = taxTotal.plus(amt);
      breakdown.push({ taxId: t.id, amount: amt });
    }

    net = round(net, 6);
    taxTotal = round(taxTotal, 6);
    return { net, taxTotal, gross: net.plus(taxTotal), breakdown };
  }
}
