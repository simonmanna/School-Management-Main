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
