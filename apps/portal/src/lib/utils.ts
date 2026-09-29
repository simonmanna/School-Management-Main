import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useAuthStore } from '@/stores/auth.store';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * The school's own currency (Organization.currencyCode, from the session).
 * Formatters used to hard-code UGX, so a school configured in another currency
 * saw every amount mislabelled (E2E audit P2). UGX until the session is known.
 */
export function orgCurrency(): string {
  try {
    return useAuthStore.getState().organization?.currencyCode || 'UGX';
  } catch {
    return 'UGX';
  }
}

/** Minor units the currency actually uses (UGX 0, USD 2, KWD 3). */
function fractionDigits(code: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? 0;
  } catch {
    return 0;
  }
}

export function formatCurrency(n: number | string | null | undefined, currency: string = orgCurrency()): string {
  const digits = fractionDigits(currency);
  const v = n == null ? 0 : typeof n === 'string' ? Number(n) : n;
  const safe = Number.isNaN(v) ? 0 : v;
  return `${currency} ${safe.toLocaleString('en-UG', { minimumFractionDigits: 0, maximumFractionDigits: digits })}`;
}

/**
 * Today's calendar date (YYYY-MM-DD) in the school's own time zone. UTC's
 * `toISOString()` is yesterday in Kampala until 03:00 (audit R09).
 */
export function schoolToday(timeZone?: string | null, now: Date = new Date()): string {
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  try {
    return fmt(timeZone || 'Africa/Kampala');
  } catch {
    return fmt('Africa/Kampala');
  }
}
