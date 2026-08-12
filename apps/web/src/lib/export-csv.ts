/**
 * Neutralise CSV formula injection: a cell that starts with = + - @ (or a
 * leading tab/CR that spreadsheets strip before parsing) is treated as a
 * formula by Excel/Sheets. Item, waiter and customer names are user-editable,
 * so prefix such cells with a single quote to force them to render as text.
 */
function csvCell(v: string): string {
  const s = String(v ?? '');
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function exportCSV(filename: string, headers: string[], rows: string[][]) {
  const csv = [
    headers.map(csvCell).join(','),
    ...rows.map((r) => r.map(csvCell).join(',')),
  ].join('\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
