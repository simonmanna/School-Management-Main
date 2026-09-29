import { useAuthStore } from '@/stores/auth.store';

/**
 * Org base currency, set in Settings → Company.
 *
 * Audit P3: this fell back to IDR (the café-POS origin), so a Ugandan school
 * whose session had not loaded its organisation briefly showed "IDR" amounts.
 * Every school this ships to is Ugandan; UGX is the only honest default.
 */
export const DEFAULT_CURRENCY = 'UGX';
export function useOrgCurrency(): string {
  return useAuthStore((s) => s.organization?.currencyCode || DEFAULT_CURRENCY);
}

/**
 * The minor units a currency actually uses (UGX 0, USD 2, KWD 3), from the
 * ISO 4217 data the browser ships. "UGX 350,000.00" invents cents that do not
 * exist and makes a fee look a hundred times larger at a glance.
 */
export function currencyFractionDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export function money(value?: string | number | null, currency?: string): string {
  if (value === null || value === undefined || value === '') return '-';
  const n = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(n)) return '-';
  const digits = currency ? currencyFractionDigits(currency) : 2;
  try {
    return new Intl.NumberFormat(undefined, {
      style: currency ? 'currency' : 'decimal',
      currency: currency || undefined,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n);
  } catch {
    return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
}

export function formatMoney(value?: string | number | null, currency?: string): string {
  return money(value, currency);
}

/**
 * A money formatter bound to the ORG's base currency.
 *
 * Exists because page after page had grown its own
 * `` const fmt = (n) => `Rp ${Number(n).toLocaleString('id-ID')}` ``. That is a
 * hardcoded Indonesian Rupiah, so a Ugandan school's payslips and payroll
 * screens read "Rp 3,000,000" — wrong symbol, wrong grouping, and wrong on the
 * one screen where a number must be unambiguous.
 */
export function useMoneyFormatter(): (value?: string | number | null) => string {
  const currency = useOrgCurrency();
  return (value) => money(value, currency);
}

export function date(value?: string | Date | null): string {
  if (!value) return '-';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleDateString();
}

export function dateTime(value?: string | Date | null): string {
  if (!value) return '-';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleString();
}

export function relativeTime(value?: string | Date | null): string {
  if (!value) return '-';
  const d = typeof value === 'string' ? new Date(value) : value;
  const diffMs = Date.now() - d.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

const STATUS_LABELS: Record<string, string> = {
  not_paid: 'Not paid',
  partial: 'Partial',
  paid: 'Paid',
  overpaid: 'Overpaid',
};

export function statusLabel(value?: string | null): string {
  if (!value) return '-';
  return STATUS_LABELS[value] ?? value.replace(/_/g, ' ');
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** The school's zone when the session has none — every current school is Ugandan. */
export const DEFAULT_SCHOOL_TIME_ZONE = 'Africa/Kampala';

/**
 * Today's calendar date (YYYY-MM-DD) in the school's own time zone.
 *
 * `new Date().toISOString().slice(0, 10)` is today in UTC, which in Kampala is
 * yesterday until 03:00 — a register opened for an early boarding roll call
 * defaulted to the previous day (audit R09).
 */
export function schoolToday(timeZone?: string | null, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || DEFAULT_SCHOOL_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_SCHOOL_TIME_ZONE }).format(now);
  }
}

/** `schoolToday` for the signed-in school, outside React (default form values, helpers). */
export function schoolTodayNow(): string {
  return schoolToday(useAuthStore.getState().organization?.timezone);
}

/** `schoolToday` bound to the signed-in school's zone. */
export function useSchoolToday(): string {
  const tz = useAuthStore((s) => s.organization?.timezone);
  return schoolToday(tz);
}

