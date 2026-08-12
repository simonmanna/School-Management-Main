export function money(value?: string | number | null): string {
  if (value === null || value === undefined || value === '') return '-';
  const n = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(n)) return '-';
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function date(value?: string | Date | null): string {
  if (!value) return '-';
  const d = typeof value === 'string' ? new Date(value) : value;
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
