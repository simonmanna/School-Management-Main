import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatCurrency(n: number | string | null | undefined): string {
  if (n == null) return 'UGX 0';
  const v = typeof n === 'string' ? Number(n) : n;
  if (Number.isNaN(v)) return 'UGX 0';
  return `UGX ${v.toLocaleString('en-UG', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
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
