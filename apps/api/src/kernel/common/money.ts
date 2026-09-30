import { Prisma } from '@prisma/client';

/**
 * Money math uses Prisma.Decimal (decimal.js) — never JS floats (ADR-009).
 * Ledger amounts are stored as Decimal(20,6); display rounding is per-currency.
 */
export type Money = Prisma.Decimal;

export const ZERO = new Prisma.Decimal(0);

export function dec(value: Prisma.Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

export function sum(values: Prisma.Decimal[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>((acc, v) => acc.plus(v), new Prisma.Decimal(0));
}

export function round(value: Prisma.Decimal, decimalPlaces = 2): Prisma.Decimal {
  return value.toDecimalPlaces(decimalPlaces, Prisma.Decimal.ROUND_HALF_UP);
}

export function isZero(value: Prisma.Decimal): boolean {
  return value.isZero();
}

export function eq(a: Prisma.Decimal, b: Prisma.Decimal): boolean {
  return a.equals(b);
}

/** ISO-4217 minor units for currencies we commonly see; the Currency table wins when present. */
const MINOR_UNITS: Record<string, number> = { UGX: 0, RWF: 0, BIF: 0, JPY: 0, KRW: 0, XAF: 0, XOF: 0 };

/** Decimal places of a currency code (UGX = 0). Falls back to 2 for unknown codes. */
export function currencyDecimals(code: string | null | undefined, fromTable?: number | null): number {
  if (fromTable !== undefined && fromTable !== null) return fromTable;
  const c = (code ?? '').toUpperCase();
  return c in MINOR_UNITS ? MINOR_UNITS[c] : 2;
}

/** Round to the currency's minor unit (UGX → whole shillings), half-up. */
export function roundToCurrency(value: Prisma.Decimal.Value, code: string | null | undefined, fromTable?: number | null): Prisma.Decimal {
  return round(dec(value), currencyDecimals(code, fromTable));
}

/** True when `value` has no digits beyond the currency's minor unit. */
export function fitsCurrency(value: Prisma.Decimal.Value, code: string | null | undefined, fromTable?: number | null): boolean {
  const d = dec(value);
  return d.equals(roundToCurrency(d, code, fromTable));
}

/** True when |a - b| <= epsilon (default 0.0001) — for balance checks after rounding. */
export function approxEqual(a: Prisma.Decimal, b: Prisma.Decimal, epsilon = 0.0001): boolean {
  return a.minus(b).abs().lessThanOrEqualTo(epsilon);
}
