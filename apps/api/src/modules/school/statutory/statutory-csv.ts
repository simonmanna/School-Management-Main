import { STATUTORY_DATASETS, type ColumnTransform, type TemplateColumn } from './statutory.datasets';

/**
 * Rendering a statutory file, as pure functions.
 *
 * Kept out of the service so the rules a board actually rejects files over —
 * quoting, line endings, date order, decimal places — can be tested without a
 * database, and so a change to one of them is a change in one place.
 */

/** Apply a column's transform. Total: every input produces a string. */
export function applyTransform(value: unknown, transform: ColumnTransform = 'none'): string {
  if (value instanceof Date) {
    if (transform === 'date_ddmmyyyy') {
      const d = String(value.getUTCDate()).padStart(2, '0');
      const m = String(value.getUTCMonth() + 1).padStart(2, '0');
      return `${d}/${m}/${value.getUTCFullYear()}`;
    }
    return value.toISOString().slice(0, 10);
  }
  const s = String(value);
  switch (transform) {
    case 'upper': return s.toUpperCase();
    case 'lower': return s.toLowerCase();
    case 'trim': return s.trim();
    case 'integer': return Number.isFinite(Number(s)) ? String(Math.round(Number(s))) : s;
    case 'one_decimal': return Number.isFinite(Number(s)) ? Number(s).toFixed(1) : s;
    default: return s;
  }
}

/** One cell: the row's value for the column's source, or the column's fallback. */
export function renderCell(row: Record<string, unknown>, column: TemplateColumn): string {
  const raw = row[column.source];
  if (raw == null || raw === '') return column.fallback ?? '';
  return applyTransform(raw, column.transform ?? 'none');
}

/**
 * RFC 4180 quoting plus one hardening step.
 *
 * A value beginning `=`, `+`, `-` or `@` is prefixed with an apostrophe so a
 * spreadsheet opening the file treats it as text. A learner's name is not a
 * formula, and the clerk opening the file at the board should not execute one.
 */
export function escapeCell(value: string, delimiter: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  const needsQuote = value.includes('"') || /[\n\r]/.test(value) || guarded.includes(delimiter);
  return needsQuote ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/**
 * The whole file.
 *
 * CRLF line endings: the boards' upload tools are Windows-era and a bare LF has
 * been rejected before.
 */
export function renderCsv(
  rows: Array<Record<string, unknown>>,
  columns: TemplateColumn[],
  delimiter = ',',
  includeHeader = true,
): string {
  const lines: string[] = [];
  if (includeHeader) lines.push(columns.map((c) => escapeCell(c.header, delimiter)).join(delimiter));
  for (const row of rows) lines.push(columns.map((c) => escapeCell(renderCell(row, c), delimiter)).join(delimiter));
  return `${lines.join('\r\n')}\r\n`;
}

/** Why a set of columns cannot be saved against a dataset. Empty means valid. */
export function validateColumns(scope: string, columns: TemplateColumn[]): string[] {
  const dataset = STATUTORY_DATASETS[scope];
  if (!dataset) return [`Unknown export scope '${scope}'.`];

  const problems: string[] = [];
  const allowed = new Set(dataset.fields.map((f) => f.key));
  const unknown = [...new Set(columns.filter((c) => !allowed.has(c.source)).map((c) => c.source))];
  if (unknown.length > 0) {
    problems.push(`These fields are not available on the '${dataset.name}' dataset: ${unknown.join(', ')}.`);
  }
  const headers = columns.map((c) => c.header.trim().toUpperCase());
  const dupes = [...new Set(headers.filter((h, i) => headers.indexOf(h) !== i))];
  if (dupes.length > 0) problems.push(`Duplicate column heading(s): ${dupes.join(', ')}.`);
  return problems;
}
