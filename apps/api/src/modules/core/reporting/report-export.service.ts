import { BadRequestException, Injectable } from '@nestjs/common';
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
