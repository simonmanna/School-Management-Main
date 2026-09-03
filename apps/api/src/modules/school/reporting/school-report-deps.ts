import type { AnalyticsService } from '../analytics/analytics.service';
import type { ResultRunService } from '../assessment/result-run.service';
import type { StudentAttendanceService } from '../attendance/student-attendance.service';
import type { AdmissionsService } from '../admissions/admissions.service';
import type { TimetableAdvancedService } from '../academics/timetable-advanced.service';
import type { ReportCardPdfService } from '../examinations/report-card-pdf.service';
import type { AdvancedFinanceService } from '../fees/advanced.service';
import type { SchoolFinanceQueryService } from '../fees/school-finance-query.service';
import type { EnrollmentService } from '../people/enrollment.service';
import type { FilterResolverService } from './filter-resolver.service';
import type { AccountingReportingService } from '../../accounting/reporting/accounting-reporting.service';
import type { PnLReportService } from '../../accounting/reporting/pnl-report.service';
import type { BalanceSheetReportService } from '../../accounting/reporting/balance-sheet-report.service';
import type { CashFlowReportService } from '../../accounting/reporting/cash-flow-report.service';
import type { TieOutService } from '../../accounting/reporting/tieout.service';
import type { FiscalPeriodService } from '../../accounting/posting/fiscal-period.service';
import { ReportLookupService } from './report-lookup.service';

/**
 * Everything a school report definition is allowed to touch.
 *
 * One file, deliberately. A definition receives this bag and nothing else — no
 * Prisma client, no repository, no ad-hoc injection. Adding a service here is a
 * visible, reviewable act; reaching around it is not possible.
 *
 * The rule these types encode: a report READS canonical services and never
 * re-derives their arithmetic. A fee figure comes from SchoolFinanceQueryService
 * (which owns the AR identity in FINANCIAL_INVARIANTS.md) or it is wrong; a mark
 * comes from the assessment spine or it is stale. `report-definition-canon.spec.ts`
 * fails the build if a fees/finance/audit definition mentions `prisma.`,
 * `amountResidual`, `payment.amount` or `GradeEntry`.
 */
export interface SchoolReportDeps {
  /** The canonical money surface. The ONLY source of a balance. */
  finance: SchoolFinanceQueryService;
  /** Aging, defaulters, bad debtors, sponsorships, waivers. */
  advancedFinance: AdvancedFinanceService;
  /** Published-result analytics: subject performance, at-risk, distributions. */
  analytics: AnalyticsService;
  /** The result spine. Broadsheets read a ResultSet, never GradeEntry. */
  resultRun: ResultRunService;
  /** Registers, class summaries, threshold breaches. */
  attendance: StudentAttendanceService;
  /** Per-term enrollment truth. */
  enrollment: EnrollmentService;
  /** Admissions pipeline, applications, funnel analytics. */
  admissions: AdmissionsService;
  /** Timetable slots, room grids, teacher schedules. */
  timetable: TimetableAdvancedService;
  /** Report card PDF rendering. */
  reportCardPdf: ReportCardPdfService;
  /** Filter expansion + the pupil-set resolver honouring class basis. */
  resolver: FilterResolverService;

  // Phase 3 — Financial/Control (Accounting module)
  /** General Ledger, Trial Balance, Account Ledger. */
  accounting: AccountingReportingService;
  /** Profit & Loss (Income Statement). */
  pnl: PnLReportService;
  /** Balance Sheet. */
  balanceSheet: BalanceSheetReportService;
  /** Cash Flow Statement. */
  cashFlow: CashFlowReportService;
  /** AR/AP Tie-out (GL vs sub-ledger reconciliation). */
  tieOut: TieOutService;
  /** Fiscal period status and lock dates. */
  fiscalPeriod: FiscalPeriodService;

  /**
   * RPT-01 — canonical reference reads for report definitions.
   *
   * Seven definition files used to reach through an injected service to its
   * private Prisma client (`(deps.timetable as any).prisma.client...`). This
   * is the supported surface for calendar, structure, timetable, curriculum,
   * results metadata and GL reads. It performs no calculation: money still
   * comes from `finance`, marks still come from the result spine.
   */
  lookup: ReportLookupService;
}

export const SCHOOL_REPORT_DEPS = Symbol('SCHOOL_REPORT_DEPS');
export const SCHOOL_REPORT_DEFINITIONS = Symbol('SCHOOL_REPORT_DEFINITIONS');
