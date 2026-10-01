import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';

/**
 * Reads a pupil spreadsheet (.xlsx or .csv) into header + string rows so the
 * import page can show the columns and let the operator map them to pupil
 * fields. Nothing is written here; the mapped rows go to `bulkImport`.
 */
export const MAX_IMPORT_ROWS = 5000;

export interface ParsedSheet {
  fileName: string;
  sheetName: string | null;
  headers: string[];
  rows: Array<Record<string, string>>;
}

interface UploadedSheetFile {
  originalname?: string;
  mimetype?: string;
  buffer?: Buffer;
}

export async function parseStudentSheet(file: UploadedSheetFile | undefined): Promise<ParsedSheet> {
  if (!file?.buffer?.length) throw new BadRequestException('Choose a .xlsx or .csv file to import.');
  const fileName = file.originalname ?? 'upload';
  const ext = fileName.toLowerCase().split('.').pop();

  let sheetName: string | null = null;
  let grid: string[][];
  if (ext === 'csv' || ext === 'txt') {
    grid = parseCsv(stripBom(file.buffer.toString('utf8')));
  } else if (ext === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file.buffer as any);
    } catch {
      throw new BadRequestException('The file could not be read as an Excel workbook (.xlsx).');
    }
    const ws = wb.worksheets.find((s) => s.actualRowCount > 0) ?? wb.worksheets[0];
    if (!ws) throw new BadRequestException('The workbook has no sheets.');
    sheetName = ws.name;
    grid = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) cells.push(cellText(row.getCell(c).value));
      grid.push(cells);
    });
  } else if (ext === 'xls') {
    throw new BadRequestException('Old .xls workbooks are not supported. Save the file as .xlsx or .csv and try again.');
  } else {
    throw new BadRequestException('Upload a .xlsx or .csv file.');
  }

  // First non-blank row is the header row.
  const firstIdx = grid.findIndex((r) => r.some((c) => c.trim()));
  if (firstIdx < 0) throw new BadRequestException('The file is empty.');
  const rawHeaders = grid[firstIdx].map((h) => h.trim());
  // Trim trailing blank header columns; name blank/duplicate ones so every column is addressable.
  while (rawHeaders.length && !rawHeaders[rawHeaders.length - 1]) rawHeaders.pop();
  const seen = new Map<string, number>();
  const headers = rawHeaders.map((h, i) => {
    const base = h || `Column ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n > 1 ? `${base} (${n})` : base;
  });
  if (!headers.length) throw new BadRequestException('The first row must hold column headings.');

  const rows: Array<Record<string, string>> = [];
  for (const r of grid.slice(firstIdx + 1)) {
    if (!r.some((c) => c.trim())) continue;
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => (rec[h] = (r[i] ?? '').trim()));
    rows.push(rec);
  }
  if (!rows.length) throw new BadRequestException('The file has headings but no pupil rows.');
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new BadRequestException(`The file has ${rows.length} rows; import at most ${MAX_IMPORT_ROWS} at a time.`);
  }
  return { fileName, sheetName, headers, rows };
}

function stripBom(s: string) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** RFC 4180 CSV: quoted fields, escaped quotes, newlines inside quotes. Detects `;` delimiters. */
export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); out.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); out.push(row); }
  return out;
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as any;
    if (Array.isArray(o.richText)) return o.richText.map((t: any) => t.text).join('');
    if ('result' in o) return cellText(o.result);
    if ('text' in o) return String(o.text ?? '');
    if ('error' in o) return '';
    return '';
  }
  return String(v);
}
