import { Prisma } from '@prisma/client';
import { approxEqual, dec, round, sum } from '../../../kernel/common/money';
import type { PostingLineInput } from './posting.types';

export interface NormalizedLine {
  accountId: string;
  partnerId?: string;
  description?: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  baseDebit: Prisma.Decimal;
  baseCredit: Prisma.Decimal;
}

/** Convert raw inputs to Decimal lines with functional-currency (base) amounts. */
export function normalizeLines(lines: PostingLineInput[], exchangeRate: Prisma.Decimal): NormalizedLine[] {
  return lines.map((l) => {
    const debit = round(dec(l.debit ?? 0), 6);
    const credit = round(dec(l.credit ?? 0), 6);
    return {
      accountId: l.accountId,
      partnerId: l.partnerId,
      description: l.description,
      debit,
      credit,
      baseDebit: round(debit.times(exchangeRate), 6),
      baseCredit: round(credit.times(exchangeRate), 6),
    };
  });
}

export function totals(lines: NormalizedLine[]): { debit: Prisma.Decimal; credit: Prisma.Decimal } {
  return {
    debit: sum(lines.map((l) => l.baseDebit)),
    credit: sum(lines.map((l) => l.baseCredit)),
  };
}

/** Balanced check on the functional (base) currency — the rule that defines a valid entry. */
export function isBalanced(lines: NormalizedLine[]): boolean {
  const t = totals(lines);
  return approxEqual(t.debit, t.credit);
}

export interface LineValidationError {
  index: number;
  message: string;
}

export function validateLines(lines: NormalizedLine[]): LineValidationError[] {
  const errors: LineValidationError[] = [];
  lines.forEach((l, i) => {
    if (l.debit.greaterThan(0) && l.credit.greaterThan(0)) {
      errors.push({ index: i, message: 'A line cannot have both a debit and a credit' });
    }
    if (l.debit.isZero() && l.credit.isZero()) {
      errors.push({ index: i, message: 'A line must have either a debit or a credit' });
    }
    if (l.debit.lessThan(0) || l.credit.lessThan(0)) {
      errors.push({ index: i, message: 'Line amounts cannot be negative' });
    }
  });
  return errors;
}
