import { Module } from '@nestjs/common';
import { ReportCsvSerializer } from './report-csv.serializer';
import { ReportExportService } from './report-export.service';
import { ReportPdfSerializer } from './report-pdf.serializer';
import { ReportRegistryService } from './report-registry.service';
import { ReportRunnerService } from './report-runner.service';
import { ReportXlsxSerializer } from './report-xlsx.serializer';
import { ScheduledReportService } from './scheduled-report.service';

/**
 * The domain-free reporting engine (ADR-017).
 *
 * Deliberately has NO controllers: a vertical mounts its own decorated
 * controller over these services. That is what lets `school` and `hr` each own a
 * catalogue without either importing the other — `.dependency-cruiser.cjs` makes
 * `school -> hr` a hard error, and `core` is the only layer both may reach.
 *
 * The registry is a singleton across verticals, so `GET catalog` in one vertical
 * can be scoped by namespace while the runner stays shared.
 *
 * A vertical must pass its own ReportContextBuilder when it calls
 * `registry.register(...)`: resolving a campus to its classes needs domain
 * tables core may not import.
 */
@Module({
  providers: [
    ReportRegistryService,
    ReportRunnerService,
    ReportExportService,
    ReportCsvSerializer,
    ReportXlsxSerializer,
    ReportPdfSerializer,
    ScheduledReportService,
  ],
  exports: [
    ReportRegistryService,
    ReportRunnerService,
    ReportExportService,
    ReportCsvSerializer,
    ReportXlsxSerializer,
    ReportPdfSerializer,
    ScheduledReportService,
  ],
})
export class CoreReportingModule {}
