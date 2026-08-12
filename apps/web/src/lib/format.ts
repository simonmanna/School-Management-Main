import { useAuthStore } from '@/stores/auth.store';

/** Org base currency, set in Settings → Company. Falls back to IDR. */
export function useOrgCurrency(): string {
  return useAuthStore((s) => s.organization?.currencyCode ?? 'IDR');
}

export function money(value?: string | number | null, currency?: string): string {
  if (value === null || value === undefined || value === '') return '-';
  const n = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(n)) return '-';
  try {
    return new Intl.NumberFormat(undefined, {
      style: currency ? 'currency' : 'decimal',
      currency: currency || undefined,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}

export function formatMoney(value?: string | number | null, currency?: string): string {
  return money(value, currency);
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
