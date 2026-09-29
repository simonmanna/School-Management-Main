import { BadRequestException, Injectable } from '@nestjs/common';
import { Writable } from 'node:stream';
import type { Response } from 'express';
import { ReportCsvSerializer } from './report-csv.serializer';
import { ReportPdfSerializer } from './report-pdf.serializer';
import { ReportXlsxSerializer } from './report-xlsx.serializer';
import type { ExportReportDto } from './report-params.dto';
import { MAX_PDF_ROWS, ReportRunnerService } from './report-runner.service';

/**
 * Format dispatch for exports.
 *
 * Kept out of the controllers so that each vertical's controller stays a thin,
 * fully-decorated shell — the route-permission specs read those files as text,
 * so generating them would make the guard-rails blind.
 */
@Injectable()
export class ReportExportService {
  constructor(
    private readonly runner: ReportRunnerService,
    private readonly csv: ReportCsvSerializer,
    private readonly xlsx: ReportXlsxSerializer,
    private readonly pdf: ReportPdfSerializer,
  ) {}

  private disposition(res: Response, filename: string, contentType: string) {
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // Reports reflect live figures; a cached copy of "outstanding fees" is a bug.
    res.setHeader('Cache-Control', 'no-store');
  }

  /**
   * Wave 16: the same export, rendered to bytes instead of an HTTP response —
   * for scheduled reports that are stored and emailed.
   */
  async render(key: string, dto: ExportReportDto): Promise<{ filename: string; contentType: string; buffer: Buffer; rows: number }> {
    const output = await this.runner.run(key, dto, true);
    const stem = this.runner.filenameFor(key);
    if (dto.format === 'csv') {
      return { filename: `${stem}.csv`, contentType: this.csv.contentType, buffer: Buffer.from(this.csv.serialize(output), 'utf8'), rows: output.data.length };
    }
    if (dto.format === 'pdf' && output.data.length > MAX_PDF_ROWS) {
      throw new BadRequestException(`This report has ${output.data.length} rows, over the ${MAX_PDF_ROWS}-row PDF limit. Schedule it as Excel or CSV.`);
    }
    const chunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        cb();
      },
    }) as Writable & Record<string, unknown>;
    // The serializers were written against express's Response; they only set
    // headers and stream into it, so a writable with header no-ops suffices.
    for (const m of ['setHeader', 'set', 'status', 'type']) (sink as any)[m] = () => sink;
    const done = new Promise<void>((resolve, reject) => {
      sink.on('finish', () => resolve());
      sink.on('error', reject);
    });
    if (dto.format === 'xlsx') await this.xlsx.write(sink as any, output);
    else if (dto.format === 'pdf') this.pdf.write(sink as any, output);
    else throw new BadRequestException(`Unsupported export format "${dto.format}"`);
    await done;
    const ext = dto.format;
    const contentType = dto.format === 'xlsx' ? this.xlsx.contentType : this.pdf.contentType;
    return { filename: `${stem}.${ext}`, contentType, buffer: Buffer.concat(chunks), rows: output.data.length };
  }

  async export(key: string, dto: ExportReportDto, res: Response): Promise<void> {
    const output = await this.runner.run(key, dto, true);
    const stem = this.runner.filenameFor(key);

    switch (dto.format) {
      case 'csv': {
        this.disposition(res, `${stem}.csv`, this.csv.contentType);
        res.send(this.csv.serialize(output));
        return;
      }
      case 'xlsx': {
        this.disposition(res, `${stem}.xlsx`, this.xlsx.contentType);
        await this.xlsx.write(res, output);
        return;
      }
      case 'pdf': {
        if (output.data.length > MAX_PDF_ROWS) {
          // pdfkit must hold every row to size the columns, and a 20k-row PDF is
          // unreadable anyway. Refuse with the alternative named.
          throw new BadRequestException(
            `This report has ${output.data.length.toLocaleString()} rows, over the ${MAX_PDF_ROWS.toLocaleString()}-row PDF limit. ` +
              'Narrow the filters, or export to Excel or CSV instead.',
          );
        }
        this.disposition(res, `${stem}.pdf`, this.pdf.contentType);
        this.pdf.write(res, output);
        return;
      }
      default:
        throw new BadRequestException(`Unsupported export format "${dto.format}"`);
    }
  }
}
