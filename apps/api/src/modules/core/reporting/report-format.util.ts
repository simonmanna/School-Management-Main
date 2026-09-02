import type { ColumnType, ReportColumn, ReportRow } from './report.types';

/**
 * Presentation-edge formatting. Rounding happens HERE and nowhere earlier:
 * FINANCIAL_INVARIANTS.md requires money to stay at full precision through every
 * calculation and to be rounded only when rendered. A definition that returns a
 * pre-formatted string has already destroyed the value for the XLSX exporter,
 * which needs a real number to give the cell a currency format.
 */

/** Coerce whatever the domain service returned (Decimal, string, number) to a number. */
export function toNumber(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  // Prisma Decimal and Decimal.js both stringify losslessly.
  return Number(String(v));
}

export function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function asDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** '31 Aug 2026' — unambiguous for a Ugandan reader, unlike 08/31 vs 31/08. */
export function formatDate(v: unknown): string {
  const d = asDate(v);
  if (!d) return '';
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatDateTime(v: unknown): string {
  const d = asDate(v);
  if (!d) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${formatDate(d)} ${hh}:${mm}`;
}

/** Thousands-separated, no decimals. UGX has no practical minor unit in schools. */
export function formatMoney(v: unknown, currency = 'UGX'): string {
  const n = toNumber(v);
  const body = Math.round(n).toLocaleString('en-UG');
  return currency ? `${currency} ${body}` : body;
}

export function formatPercent(v: unknown): string {
  if (isBlank(v)) return '';
  return `${Math.round(toNumber(v) * 10) / 10}%`;
}

export function formatInt(v: unknown): string {
  if (isBlank(v)) return '';
  return Math.round(toNumber(v)).toLocaleString('en-UG');
}

/** One cell, rendered for a text target (CSV or PDF). XLSX keeps raw values. */
export function formatCell(value: unknown, column: ReportColumn): string {
  if (isBlank(value)) return '';
  switch (column.type as ColumnType) {
    case 'money':
      // `format` names the currency; '' suppresses the prefix for a column that
      // already says UGX in its header.
      return formatMoney(value, column.format ?? 'UGX');
    case 'percent':
      return formatPercent(value);
    case 'int':
      return formatInt(value);
    case 'date':
      return formatDate(value);
    case 'datetime':
      return formatDateTime(value);
    case 'bool':
      return value ? 'Yes' : 'No';
    default:
      return String(value);
  }
}

/** Numeric excel format string for a column, or undefined for text. */
export function excelNumberFormat(column: ReportColumn): string | undefined {
  switch (column.type) {
    case 'money':
      return '#,##0;[Red]-#,##0';
    case 'int':
      return '#,##0';
    case 'percent':
      return '0.0"%"';
    case 'date':
      return 'dd mmm yyyy';
    case 'datetime':
      return 'dd mmm yyyy hh:mm';
    default:
      return undefined;
  }
}

/**
 * Totals row across the columns that asked for one.
 *
 * `avg` divides by the count of rows carrying a value, not by the row count — a
 * blank mark is an absent pupil, not a zero, and averaging it in understates the
 * class.
 */
export function computeTotals(rows: ReportRow[], columns: ReportColumn[]): ReportRow | undefined {
  const wanted = columns.filter((c) => c.total && c.total !== 'none');
  if (wanted.length === 0) return undefined;

  const totals: ReportRow = {};
  for (const col of wanted) {
    if (col.total === 'count') {
      totals[col.key] = rows.filter((r) => !isBlank(r[col.key])) .length;
      continue;
    }
    const present = rows.map((r) => r[col.key]).filter((v) => !isBlank(v));
    const sum = present.reduce<number>((acc, v) => acc + toNumber(v), 0);
    totals[col.key] = col.total === 'avg'
      ? (present.length > 0 ? sum / present.length : null)
      : sum;
  }
  return totals;
}

/** In-memory sort honouring the column's type (numbers numerically, dates by instant). */
export function sortRows(
  rows: ReportRow[],
  columns: ReportColumn[],
  sortBy: string,
  order: 'asc' | 'desc',
): ReportRow[] {
  const col = columns.find((c) => c.key === sortBy);
  if (!col) return rows;
  const dir = order === 'desc' ? -1 : 1;
  const numeric = col.type === 'money' || col.type === 'int' || col.type === 'percent';
  const temporal = col.type === 'date' || col.type === 'datetime';

  return [...rows].sort((a, b) => {
    const av = a[sortBy];
    const bv = b[sortBy];
    // Blanks sort last in both directions — an unmarked pupil is not "the best".
    if (isBlank(av) && isBlank(bv)) return 0;
    if (isBlank(av)) return 1;
    if (isBlank(bv)) return -1;
    if (numeric) return (toNumber(av) - toNumber(bv)) * dir;
    if (temporal) {
      return ((asDate(av)?.getTime() ?? 0) - (asDate(bv)?.getTime() ?? 0)) * dir;
    }
    return String(av).localeCompare(String(bv)) * dir;
  });
}
