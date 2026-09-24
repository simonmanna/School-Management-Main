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
 * Renders a class placement the way a school secretary reads it, hiding the
 * section/stream machinery unless it's actually used:
 *   class only           → "P4"
 *   class + section      → "P4 A"
 *   class + section + stream → "P4 A — East"
 * Empty inputs collapse gracefully so we never print "undefined" or stray dashes.
 */
export function formatClass(opts: {
  className?: string | null;
  sectionName?: string | null;
  streamName?: string | null;
}): string {
  const { className, sectionName, streamName } = opts;
  const base = [className, sectionName].filter(Boolean).join(' ').trim();
  if (!base) return '—';
  return streamName ? `${base} — ${streamName}` : base;
}
