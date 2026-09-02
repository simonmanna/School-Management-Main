import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import { excelNumberFormat, isBlank, toNumber } from './report-format.util';
import type { ReportColumn, ReportRow } from './report.types';
import type { RunnerOutput } from './report-runner.service';

/**
 * XLSX export via exceljs' STREAMING writer.
 *
 * Streaming rather than the in-memory Workbook because the default builder holds
 * every cell object until `writeBuffer()`, and a 100k-row fee export would sit in
 * RAM on what is often a modest on-prem box.
 *
 * Values are written as real numbers and real dates with a cell format, never as
 * pre-formatted strings. That is the whole reason to prefer xlsx over CSV here:
 * a bursar re-sorting or summing a column gets arithmetic, and an admission
 * number like "0041" survives instead of being autodetected into 41.
 */
@Injectable()
export class ReportXlsxSerializer {
  readonly contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  readonly extension = 'xlsx';

  private visible(columns: ReportColumn[]): ReportColumn[] {
    return columns.filter((c) => !c.hideOn?.includes('xlsx'));
  }

  /** Native value for the cell, so Excel can compute with it. */
  private cellValue(raw: unknown, column: ReportColumn): unknown {
    if (isBlank(raw)) return null;
    switch (column.type) {
      case 'money':
      case 'int':
      case 'percent':
        return toNumber(raw);
      case 'date':
      case 'datetime':
        return raw instanceof Date ? raw : new Date(String(raw));
      case 'bool':
        return raw ? 'Yes' : 'No';
      default:
        // Text, explicitly. Keeps leading zeros on admission numbers.
        return String(raw);
    }
  }

  private writeRow(sheet: ExcelJS.Worksheet, r: ReportRow, columns: ReportColumn[]) {
    return sheet.addRow(columns.map((c) => this.cellValue(r[c.key], c)));
  }

  /**
   * Write the workbook directly to the HTTP response. The caller must have set
   * the headers already; `commit()` ends the response.
   */
  async write(res: Response, output: RunnerOutput): Promise<void> {
    const columns = this.visible(output.columns);
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: res,
      useStyles: true,
      useSharedStrings: false,
    });
    workbook.creator = 'School Management';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet(output.title.slice(0, 31) || 'Report', {
      views: [{ state: 'frozen', ySplit: output.caption ? 4 : 3 }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });

    sheet.columns = columns.map((c) => ({
      // Width in characters. `width` is a relative hint shared with the PDF, so
      // scale rather than use it raw.
      width: Math.min(60, Math.max(10, Math.round((c.width ?? 12) * 1.2))),
      style: { numFmt: excelNumberFormat(c) },
    })) as ExcelJS.Column[];

    const titleRow = sheet.addRow([output.title]);
    titleRow.font = { bold: true, size: 14 };
    titleRow.commit();

    if (output.caption) {
      const cap = sheet.addRow([output.caption]);
      cap.font = { italic: true, size: 9, color: { argb: 'FF666666' } };
      cap.commit();
    }
    for (const note of output.notes) {
      const n = sheet.addRow([`Note: ${note}`]);
      n.font = { italic: true, size: 9, color: { argb: 'FFB45309' } };
      n.commit();
    }

    const header = sheet.addRow(columns.map((c) => c.label));
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
    header.commit();

    const alignRow = (row: ExcelJS.Row) => {
      columns.forEach((c, i) => {
        if (c.align) row.getCell(i + 1).alignment = { horizontal: c.align };
      });
    };

    if (output.groups?.length) {
      for (const group of output.groups) {
        const g = sheet.addRow([group.label]);
        g.font = { bold: true };
        g.commit();
        for (const r of group.rows) {
          const row = this.writeRow(sheet, r, columns);
          alignRow(row);
          row.commit();
        }
        if (group.totals) {
          const t = this.writeRow(sheet, { ...group.totals, [columns[0].key]: `${group.label} total` }, columns);
          t.font = { bold: true };
          t.commit();
        }
      }
    } else {
      for (const r of output.data) {
        const row = this.writeRow(sheet, r, columns);
        alignRow(row);
        row.commit();
      }
    }

    if (output.totals) {
      const t = this.writeRow(sheet, { ...output.totals, [columns[0].key]: 'TOTAL' }, columns);
      t.font = { bold: true };
      t.eachCell((cell) => {
        cell.border = { top: { style: 'double' } };
      });
      t.commit();
    }

    sheet.commit();
    await workbook.commit();
  }
}
