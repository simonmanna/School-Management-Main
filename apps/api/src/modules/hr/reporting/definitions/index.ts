import type { ReportDefinition } from '../../../core/reporting/report.types';
import type { HrReportDeps } from '../hr-report-deps';
import { payrollReports } from './payroll.reports';
import { workforceReports } from './workforce.reports';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The HR report catalogue.
 *
 * Assembled from a plain deps bag rather than discovered through the container,
 * so `hr-report-catalogue.spec.ts` can build and assert on every definition
 * with a stub and no database.
 */
export function buildHrReportDefinitions(deps: HrReportDeps): ReportDefinition<any>[] {
  return [...payrollReports(deps), ...workforceReports(deps)];
}
