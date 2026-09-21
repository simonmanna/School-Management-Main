import type { HrReportingDataService } from './hr-reporting-data.service';

/**
 * The one place a HR report definition's reachable surface is enumerated.
 *
 * Definitions get this bag and nothing else — no Prisma, no other module's
 * services. Widening it is a deliberate act, which is what keeps a report from
 * quietly growing its own second version of a payroll figure.
 */
export interface HrReportDeps {
  data: HrReportingDataService;
}

export const HR_REPORT_DEPS = Symbol('HR_REPORT_DEPS');
export const HR_REPORT_DEFINITIONS = Symbol('HR_REPORT_DEFINITIONS');
