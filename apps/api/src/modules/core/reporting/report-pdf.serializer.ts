import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import PDFDocument from 'pdfkit';
import { formatCell } from './report-format.util';
import type { ReportColumn, ReportRow } from './report.types';
import type { RunnerOutput } from './report-runner.service';

/**
 * Generic landscape table PDF, via pdfkit.
 *
 * pdfkit rather than the documents module's headless-Chrome renderer: that
 * renderer is not exported from DocumentsModule, serialises at concurrency 1,
 * spawns a Chrome process per render with temp-file I/O and a 30s timeout, and
 * its mustache subset hardcodes `{{#each lines}}` so it cannot render dynamic
 * columns. It also needs a Chrome binary present, which a school server may not
 * have. pdfkit is already a dependency and already renders the report cards.
 *
 * Report cards keep their own bespoke renderer — this one is for tabular reports.
 */
@Injectable()
export class ReportPdfSerializer {
  readonly contentType = 'application/pdf';
  readonly extension = 'pdf';

  private static readonly MARGIN = 32;
  private static readonly HEADER_H = 62;
  private static readonly FOOTER_H = 26;
  private static readonly ROW_H = 16;

  private visible(columns: ReportColumn[]): ReportColumn[] {
    return columns.filter((c) => !c.hideOn?.includes('pdf'));
  }

  /** Scale each column's relative width to the printable area. */
  private layout(columns: ReportColumn[], usable: number): number[] {
    const weights = columns.map((c) => c.width ?? (c.type === 'string' ? 16 : 10));
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    return weights.map((w) => (w / sum) * usable);
  }

  write(res: Response, output: RunnerOutput): void {
    const columns = this.visible(output.columns);
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: ReportPdfSerializer.MARGIN,
      bufferPages: true, // needed to stamp "page n of N" once the total is known
    });
    doc.pipe(res);

    const left = ReportPdfSerializer.MARGIN;
    const usable = doc.page.width - ReportPdfSerializer.MARGIN * 2;
    const widths = this.layout(columns, usable);
    const bottom = doc.page.height - ReportPdfSerializer.MARGIN - ReportPdfSerializer.FOOTER_H;

    const drawTitle = () => {
      doc.fontSize(14).fillColor('#0f172a').font('Helvetica-Bold')
        .text(output.title, left, ReportPdfSerializer.MARGIN);
      if (output.caption) {
        doc.fontSize(8).fillColor('#64748b').font('Helvetica')
          .text(output.caption, left, ReportPdfSerializer.MARGIN + 18);
      }
      let y = ReportPdfSerializer.MARGIN + (output.caption ? 30 : 20);
      for (const note of output.notes) {
        doc.fontSize(7.5).fillColor('#b45309').font('Helvetica-Oblique')
          .text(`Note: ${note}`, left, y, { width: usable });
        y = doc.y + 2;
      }
      return Math.max(y, ReportPdfSerializer.MARGIN + ReportPdfSerializer.HEADER_H - 20);
    };

    const drawHeaderRow = (y: number): number => {
      doc.rect(left, y, usable, ReportPdfSerializer.ROW_H + 4).fill('#1e293b');
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
      let x = left;
      columns.forEach((c, i) => {
        doc.text(c.label, x + 3, y + 5, {
          width: widths[i] - 6,
          align: c.align ?? (c.type === 'money' || c.type === 'int' || c.type === 'percent' ? 'right' : 'left'),
          lineBreak: false,
        });
        x += widths[i];
      });
      return y + ReportPdfSerializer.ROW_H + 4;
    };

    let y = drawTitle();
    y = drawHeaderRow(y);
    let zebra = false;

    const newPage = () => {
      doc.addPage();
      y = drawTitle();
      y = drawHeaderRow(y);
      zebra = false;
    };

    const drawRow = (r: ReportRow, opts: { bold?: boolean; rule?: boolean } = {}) => {
      if (y + ReportPdfSerializer.ROW_H > bottom) newPage();
      if (zebra && !opts.bold) doc.rect(left, y, usable, ReportPdfSerializer.ROW_H).fill('#f8fafc');
      zebra = !zebra;
      if (opts.rule) {
        doc.moveTo(left, y - 1).lineTo(left + usable, y - 1).lineWidth(0.7).stroke('#94a3b8');
      }
      doc.fillColor('#0f172a').font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
      let x = left;
      columns.forEach((c, i) => {
        doc.text(formatCell(r[c.key], c), x + 3, y + 4, {
          width: widths[i] - 6,
          align: c.align ?? (c.type === 'money' || c.type === 'int' || c.type === 'percent' ? 'right' : 'left'),
          lineBreak: false,
          ellipsis: true,
        });
        x += widths[i];
      });
      y += ReportPdfSerializer.ROW_H;
    };

    if (output.groups?.length) {
      for (const group of output.groups) {
        if (y + ReportPdfSerializer.ROW_H * 2 > bottom) newPage();
        doc.fillColor('#1e293b').font('Helvetica-Bold').fontSize(9)
          .text(group.label, left + 3, y + 3);
        y += ReportPdfSerializer.ROW_H;
        zebra = false;
        for (const r of group.rows) drawRow(r);
        if (group.totals) {
          drawRow({ ...group.totals, [columns[0].key]: `${group.label} total` }, { bold: true, rule: true });
        }
      }
    } else {
      for (const r of output.data) drawRow(r);
    }

    if (output.totals) {
      drawRow({ ...output.totals, [columns[0].key]: 'TOTAL' }, { bold: true, rule: true });
    }

    // Footers last, once the page count is settled.
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      doc.switchToPage(range.start + i);
      doc.fontSize(7).fillColor('#94a3b8').font('Helvetica')
        .text(
          `Page ${i + 1} of ${range.count}`,
          left,
          doc.page.height - ReportPdfSerializer.MARGIN - 10,
          { width: usable, align: 'right' },
        );
    }

    doc.end();
  }
}
