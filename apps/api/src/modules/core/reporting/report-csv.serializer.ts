import { Injectable } from '@nestjs/common';
import { formatCell } from './report-format.util';
import type { ReportColumn, ReportRow } from './report.types';
import type { RunnerOutput } from './report-runner.service';

/**
 * Neutralise CSV formula injection: a cell starting `= + - @` (or a leading tab
 * or CR, which spreadsheets strip before parsing) is executed as a formula by
 * Excel and Sheets. Pupil names, guardian names, houses and comments are all
 * user-editable free text.
 *
 * Ported deliberately from apps/web/src/lib/export-csv.ts, which has had this
 * guard all along. `csv-stringify` quotes and escapes but does NOT neutralise
 * formulas, so moving export to the server without carrying this across would
 * make the system less safe than the client-side export it replaces.
 */
export function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

@Injectable()
export class ReportCsvSerializer {
  readonly contentType = 'text/csv; charset=utf-8';
  readonly extension = 'csv';

  private line(cells: string[]): string {
    return cells
      .map((c) => `"${csvCell(c).replace(/"/g, '""')}"`)
      .join(',');
  }

  private visible(columns: ReportColumn[]): ReportColumn[] {
    return columns.filter((c) => !c.hideOn?.includes('csv'));
  }

  private row(r: ReportRow, columns: ReportColumn[]): string {
    return this.line(columns.map((c) => formatCell(r[c.key], c)));
  }

  serialize(output: RunnerOutput): string {
    const columns = this.visible(output.columns);
    const lines: string[] = [];

    // Header block. A CSV that lands in an inbox with no filters recorded is a
    // number nobody can reproduce a week later.
    lines.push(this.line([output.title]));
    if (output.caption) lines.push(this.line([output.caption]));
    for (const note of output.notes) lines.push(this.line([`Note: ${note}`]));
    lines.push('');

    lines.push(this.line(columns.map((c) => c.label)));

    if (output.groups?.length) {
      for (const group of output.groups) {
        lines.push(this.line([group.label]));
        for (const r of group.rows) lines.push(this.row(r, columns));
        if (group.totals) {
          lines.push(this.row({ ...group.totals, [columns[0].key]: `${group.label} total` }, columns));
        }
      }
    } else {
      for (const r of output.data) lines.push(this.row(r, columns));
    }

    if (output.totals) {
      lines.push(this.row({ ...output.totals, [columns[0].key]: 'TOTAL' }, columns));
    }

    // BOM so Excel detects UTF-8 and does not mangle non-ASCII names.
    return '﻿' + lines.join('\r\n');
  }

  /** Streaming form for definitions that expose `stream`. */
  header(output: RunnerOutput): string {
    const columns = this.visible(output.columns);
    const lines = [this.line([output.title])];
    if (output.caption) lines.push(this.line([output.caption]));
    lines.push('');
    lines.push(this.line(columns.map((c) => c.label)));
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  chunk(rows: ReportRow[], columns: ReportColumn[]): string {
    const visible = this.visible(columns);
    return rows.map((r) => this.row(r, visible)).join('\r\n') + '\r\n';
  }
}
