import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { CoreReportingModule } from '../../core/reporting/core-reporting.module';
import { ReportRegistryService } from '../../core/reporting/report-registry.service';
import type { ReportDefinition } from '../../core/reporting/report.types';
import { buildHrReportDefinitions } from './definitions';
import { HrReportContextService } from './hr-report-context.service';
import {
  HR_REPORT_DEFINITIONS,
  HR_REPORT_DEPS,
  type HrReportDeps,
} from './hr-report-deps';
import { HrReportingDataService } from './hr-reporting-data.service';
import { HrReportsController } from './hr-reports.controller';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The HR report catalogue, mounted over the same domain-free core engine the
 * school catalogue uses. Registering under its own namespace is what lets HR
 * own payroll reporting without `school` importing `hr` —
 * `.dependency-cruiser.cjs` makes that a hard error, and the report registry
 * was built with this split in mind.
 */
@Module({
  imports: [CoreReportingModule],
  controllers: [HrReportsController],
  providers: [
    HrReportingDataService,
    HrReportContextService,
    {
      provide: HR_REPORT_DEPS,
      useFactory: (data: HrReportingDataService): HrReportDeps => ({ data }),
      inject: [HrReportingDataService],
    },
    {
      provide: HR_REPORT_DEFINITIONS,
      useFactory: (deps: HrReportDeps) => buildHrReportDefinitions(deps),
      inject: [HR_REPORT_DEPS],
    },
  ],
  exports: [HrReportingDataService],
})
export class HrReportsModule implements OnModuleInit {
  constructor(
    private readonly registry: ReportRegistryService,
    private readonly context: HrReportContextService,
    @Inject(HR_REPORT_DEFINITIONS) private readonly definitions: ReportDefinition<any>[],
  ) {}

  onModuleInit(): void {
    this.registry.register('hr', this.definitions, this.context);
  }
}
