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

/** True when |a - b| <= epsilon (default 0.0001) — for balance checks after rounding. */
export function approxEqual(a: Prisma.Decimal, b: Prisma.Decimal, epsilon = 0.0001): boolean {
  return a.minus(b).abs().lessThanOrEqualTo(epsilon);
}
