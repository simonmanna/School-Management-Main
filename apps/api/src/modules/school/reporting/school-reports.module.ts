import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { CoreReportingModule } from '../../core/reporting/core-reporting.module';
import { ReportRegistryService } from '../../core/reporting/report-registry.service';
import type { ReportDefinition } from '../../core/reporting/report.types';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AnalyticsService } from '../analytics/analytics.service';
import { AssessmentModule } from '../assessment/assessment.module';
import { ResultRunService } from '../assessment/result-run.service';
import { AttendanceModule } from '../attendance/attendance.module';
import { StudentAttendanceService } from '../attendance/student-attendance.service';
import { AdmissionsModule } from '../admissions/admissions.module';
import { AdmissionsService } from '../admissions/admissions.service';
import { AcademicsModule } from '../academics/academics.module';
import { TimetableAdvancedService } from '../academics/timetable-advanced.service';
import { AdvancedFinanceService } from '../fees/advanced.service';
import { FeesModule } from '../fees/fees.module';
import { SchoolFinanceQueryService } from '../fees/school-finance-query.service';
import { EnrollmentService } from '../people/enrollment.service';
import { PeopleModule } from '../people/people.module';
import { ReportCardPdfService } from '../examinations/report-card-pdf.service';
import { ExaminationsModule } from '../examinations/examinations.module';
import { AccountingReportingService } from '../../accounting/reporting/accounting-reporting.service';
import { PnLReportService } from '../../accounting/reporting/pnl-report.service';
import { BalanceSheetReportService } from '../../accounting/reporting/balance-sheet-report.service';
import { CashFlowReportService } from '../../accounting/reporting/cash-flow-report.service';
import { TieOutService } from '../../accounting/reporting/tieout.service';
import { FiscalPeriodService } from '../../accounting/posting/fiscal-period.service';
import { AccountingModule } from '../../accounting/accounting.module';
import { buildSchoolReportDefinitions } from './definitions';
import { FilterResolverService } from './filter-resolver.service';
import { ReportLookupService } from './report-lookup.service';
import {
  SCHOOL_REPORT_DEFINITIONS,
  SCHOOL_REPORT_DEPS,
  type SchoolReportDeps,
} from './school-report-deps';
import { SchoolReportsController } from './school-reports.controller';
import { PlacementLookupModule } from '../enrollment/placement-lookup.module';

/**
 * The school report catalogue, mounted over the domain-free core engine.
 *
 * Definitions are assembled by a plain `useFactory` rather than discovered via
 * Nest's DiscoveryService: they are DATA, and building them from one deps bag
 * keeps them unit-testable with a stub and no container. It also means a
 * duplicate key throws at boot instead of last-write-wins.
 *
 * Note what is NOT imported: `modules/hr`. `hr` is a vertical, and
 * `.dependency-cruiser.cjs` makes school → hr a hard error. Staff and payroll
 * reporting therefore gets its own `hr/reporting` catalogue over this same
 * engine, and the web catalogue page merges the two.
 */
@Module({
  imports: [PlacementLookupModule, 
    CoreReportingModule,
    FeesModule,
    AttendanceModule,
    PeopleModule,
    AdmissionsModule,
    AcademicsModule,
    AssessmentModule,
    AnalyticsModule,
    ExaminationsModule,
    AccountingModule,
  ],
  controllers: [SchoolReportsController],
  providers: [
    FilterResolverService,
    ReportLookupService,
    {
      // The one place a definition's reachable surface is enumerated.
      provide: SCHOOL_REPORT_DEPS,
      useFactory: (
        finance: SchoolFinanceQueryService,
        advancedFinance: AdvancedFinanceService,
        analytics: AnalyticsService,
        resultRun: ResultRunService,
        attendance: StudentAttendanceService,
        enrollment: EnrollmentService,
        admissions: AdmissionsService,
        timetable: TimetableAdvancedService,
        reportCardPdf: ReportCardPdfService,
        resolver: FilterResolverService,
        // Phase 3 — Financial/Control (Accounting module)
        accounting: AccountingReportingService,
        pnl: PnLReportService,
        balanceSheet: BalanceSheetReportService,
        cashFlow: CashFlowReportService,
        tieOut: TieOutService,
        fiscalPeriod: FiscalPeriodService,
        lookup: ReportLookupService,
      ): SchoolReportDeps => ({
        finance, advancedFinance, analytics, resultRun, attendance, enrollment,
        admissions, timetable, reportCardPdf, resolver,
        accounting, pnl, balanceSheet, cashFlow, tieOut, fiscalPeriod,
        lookup,
      }),
      inject: [
        SchoolFinanceQueryService,
        AdvancedFinanceService,
        AnalyticsService,
        ResultRunService,
        StudentAttendanceService,
        EnrollmentService,
        AdmissionsService,
        TimetableAdvancedService,
        ReportCardPdfService,
        FilterResolverService,
        // Phase 3 — Financial/Control (Accounting module)
        AccountingReportingService,
        PnLReportService,
        BalanceSheetReportService,
        CashFlowReportService,
        TieOutService,
        FiscalPeriodService,
        ReportLookupService,
      ],
    },
    {
      provide: SCHOOL_REPORT_DEFINITIONS,
      useFactory: (deps: SchoolReportDeps) => buildSchoolReportDefinitions(deps),
      inject: [SCHOOL_REPORT_DEPS],
    },
  ],
  exports: [FilterResolverService],
})
export class SchoolReportsModule implements OnModuleInit {
  constructor(
    private readonly registry: ReportRegistryService,
    private readonly resolver: FilterResolverService,
    @Inject(SCHOOL_REPORT_DEFINITIONS) private readonly definitions: ReportDefinition<any>[],
  ) {}

  onModuleInit(): void {
    // FilterResolverService doubles as this namespace's context builder: core
    // cannot resolve a campus to its classes without importing school tables.
    this.registry.register('school', this.definitions, this.resolver);
  }
}
