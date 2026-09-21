/**
 * The reporting contract (ADR-017).
 *
 * A report is DATA, not a class: a `ReportDefinition` describes what a report is
 * called, who may run it, which filters it accepts, what its columns are, and
 * one `run` function that delegates to a canonical domain service. The engine in
 * this directory knows nothing about schools, fees or marks — it validates,
 * dispatches, pages, totals and serialises. That split is enforced by
 * `.dependency-cruiser.cjs`: `core` may not import a vertical, accounting,
 * invoicing or inventory, so a definition can reach a domain service but the
 * engine never can.
 *
 * Types only. No Nest decorators here, so definitions stay unit-testable
 * without a DI container.
 */

/** Shape drives how the web runner and the PDF/XLSX serialisers lay a report out. */
export type ReportShape =
  /** Flat rows against fixed columns. The common case. */
  | 'table'
  /** Rows partitioned into `groups`, each with its own subtotal row. */
  | 'grouped'
  /** Columns discovered at run time (broadsheet subjects, timetable periods). */
  | 'matrix'
  /** A handful of labelled figures rather than a row set (dashboards). */
  | 'summary';

export type ColumnType =
  | 'string'
  | 'int'
  | 'money'
  | 'percent'
  | 'date'
  | 'datetime'
  | 'bool'
  | 'enum';

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

/** Where a cell can take the reader next. */
export type ReportColumnLink =
  | { reportKey: string; paramFrom: Record<string, string> }
  | { route: string; paramFrom: Record<string, string> };

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
  align?: 'left' | 'right' | 'center';
  /** Relative width. Shared by the pdfkit table and the xlsx column widths. */
  width?: number;
  /** Type-specific hint: 'UGX' for money, a date mask for date/datetime. */
  format?: string;
  total?: 'sum' | 'avg' | 'count' | 'none';
  hideOn?: Array<'screen' | ExportFormat>;
  /**
   * Drilldown hangs off the COLUMN, not the report: one row of a fee summary
   * drills into the pupil from the name cell and into their ledger from the
   * balance cell. A report-level drilldown could only ever express one of those.
   */
  link?: ReportColumnLink;
}

/**
 * Every filter any report may declare. Kept in lockstep with `ReportFilterDto`
 * — `report-registry-catalog.spec.ts` fails the build if they drift.
 */
export type ReportFilterKey =
  | 'academicYearId'
  | 'termId'
  | 'campusId'
  | 'gradeLevelId'
  | 'classId'
  | 'sectionId'
  | 'streamId'
  | 'studentProfileId'
  | 'staffProfileId'
  | 'subjectId'
  | 'resultSetId'
  | 'dateFrom'
  | 'dateTo'
  | 'asOf'
  | 'status'
  | 'gender'
  | 'residenceType'
  | 'house'
  | 'studentCategoryId'
  | 'search'
  | 'classBasis'
  // ── HR / payroll ──────────────────────────────────────────────────────────
  // The workforce catalogue partitions by employer structures, not by class.
  // These live in the shared vocabulary (rather than an HR-only one) because
  // the runner validates every filter against this single list.
  | 'departmentId'
  | 'positionId'
  | 'employeeId'
  | 'payrollPeriodId'
  | 'payrollRunId'
  | 'employmentType';

export const REPORT_FILTER_KEYS: readonly ReportFilterKey[] = [
  'academicYearId', 'termId', 'campusId', 'gradeLevelId', 'classId',
  'sectionId', 'streamId', 'studentProfileId', 'staffProfileId', 'subjectId',
  'resultSetId', 'dateFrom', 'dateTo', 'asOf', 'status', 'gender',
  'residenceType', 'house', 'studentCategoryId', 'search', 'classBasis',
  'departmentId', 'positionId', 'employeeId', 'payrollPeriodId', 'payrollRunId',
  'employmentType',
] as const;

/**
 * Which notion of "class" a report means. These three disagree the moment a
 * pupil moves mid-term, and the disagreement is silent:
 *
 *   current    — the placement open today (ADR-027). Where the pupil sits now.
 *   enrollment — Enrollment.classId for the term. Historical truth.
 *   roster     — the frozen AcademicRoster. Academic truth; the only basis a
 *                results report may use (the live class is an input to roster
 *                capture, never academic truth).
 *
 * Every definition declares a default and the runner records the resolved basis
 * in the report caption, so two reports that disagree say why on their face.
 */
export type ClassBasis = 'current' | 'enrollment' | 'roster';

export const CLASS_BASES: readonly ClassBasis[] = ['current', 'enrollment', 'roster'] as const;

/**
 * How honestly a report can answer "as at <date>".
 *
 *   live         — a point-in-time snapshot of now. `asOf` is meaningless.
 *   as-of        — genuinely reconstructs the past (GL-backed).
 *   current-only — accepts `asOf` but CANNOT honour it. The runner pins asOf to
 *                  now and attaches a visible note. Used where the underlying
 *                  service mixes a current cached figure with a historical date
 *                  filter, which FINANCIAL_INVARIANTS.md names as forbidden.
 */
export type AsOfMode = 'live' | 'as-of' | 'current-only';

export type ReportDomain =
  | 'student'
  | 'enrollment'
  | 'admissions'
  | 'attendance'
  | 'academics'
  | 'fees'
  | 'finance'
  | 'staff'
  | 'timetable'
  | 'curriculum'
  | 'lms'
  | 'meals'
  | 'inventory'
  | 'documents'
  | 'executive'
  | 'audit'
  /** People, posts and employment lifecycle. */
  | 'hr'
  /** Money paid to staff, and the statutory returns that follow it. */
  | 'payroll';

export const REPORT_DOMAINS: readonly ReportDomain[] = [
  'student', 'enrollment', 'admissions', 'attendance', 'academics', 'fees',
  'finance', 'staff', 'timetable', 'curriculum', 'lms', 'meals', 'inventory',
  'documents', 'executive', 'audit', 'hr', 'payroll',
] as const;

export interface ReportScope {
  /** own | class | department | school, from DataScopeService.effective(). */
  effective: string;
  /** Class ids the caller may see, or 'all'. From DataScopeService.classIds(). */
  classIds: string[] | 'all';
}

/**
 * What a definition is handed. Note what is NOT here: `prisma`. A definition
 * that can reach the database will eventually re-derive a balance instead of
 * calling SchoolFinanceQueryService, and the whole point of the layer dies. The
 * awkward cases are meant to be awkward — they belong as new methods on the
 * canonical service.
 */
export interface ReportContext {
  organizationId: string;
  userId?: string;
  scope: ReportScope;
  /** Filters after FilterResolverService has expanded the indirections. */
  resolved: {
    /** campusId/gradeLevelId/classId collapsed to a concrete id list. */
    classIds?: string[];
    termId?: string;
    academicYearId?: string;
    classBasis: ClassBasis;
    /** dateFrom/dateTo, or the term's own window when only a term was given. */
    window?: { from: Date; to: Date };
    /** Pinned to now for asOfMode 'current-only'. */
    asOf: Date;
  };
  logger: { warn(message: string): void };
}

export interface ReportRunOptions {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  /** Set on export paths: the runner ignores paging and raises the row cap. */
  unpaged?: boolean;
}

export type ReportRow = Record<string, unknown>;

export interface ReportGroup {
  key: string;
  label: string;
  rows: ReportRow[];
  totals?: ReportRow;
}

export interface ReportResult {
  rows: ReportRow[];
  groups?: ReportGroup[];
  /** shape:'matrix' only — the columns this particular run discovered. */
  columns?: ReportColumn[];
  totals?: ReportRow;
  /** Set only when the definition paged in the service layer (paging:'service'). */
  total?: number;
  /** Printed on screen and in every export header. */
  caption?: string;
  /** Non-fatal caveats the reader must see (e.g. an as-of that could not be honoured). */
  notes?: string[];
}

export interface ReportDefinition<P = ReportRow> {
  /** Dotted and stable: 'fees.defaulters'. Appears in URLs and SavedReport.reportKey. */
  key: string;
  title: string;
  domain: ReportDomain;
  description: string;
  /** Must exist in ALL_PERMISSIONS or the catalog spec fails the build. */
  permission: string;
  /** ANDed on top of `permission`. Money reports add the finance grant here. */
  alsoRequires?: string[];
  shape: ReportShape;
  filters: ReportFilterKey[];
  requiredFilters?: ReportFilterKey[];
  classBasisDefault?: ClassBasis;
  asOfMode?: AsOfMode;
  columns: ReportColumn[] | ((ctx: ReportContext, params: P) => Promise<ReportColumn[]>);
  defaultSort?: { key: string; order: 'asc' | 'desc' };
  /** Column key to partition on for shape:'grouped'. */
  groupBy?: string;
  /**
   * service — the definition honours skip/take and sets `total`.
   * memory  — the runner slices; the query already fetched everything.
   * none    — a summary or a naturally small set.
   */
  paging: 'service' | 'memory' | 'none';
  /** Advisory ceiling; the runner warns past it and hard-caps at MAX_REPORT_ROWS. */
  rowCapHint?: number;
  cacheTtlSeconds?: number;
  run(ctx: ReportContext, params: P, opts: ReportRunOptions): Promise<ReportResult>;
  /** Preferred by the CSV/XLSX exporters when present — avoids materialising. */
  stream?(ctx: ReportContext, params: P): AsyncIterable<ReportRow>;
}

/** What `GET catalog` and `GET :key/meta` return — no `run`, no closures. */
export interface ReportCatalogEntry {
  key: string;
  title: string;
  domain: ReportDomain;
  description: string;
  shape: ReportShape;
  filters: ReportFilterKey[];
  requiredFilters: ReportFilterKey[];
  classBasisDefault?: ClassBasis;
  asOfMode: AsOfMode;
  /** Absent when the definition resolves its columns at run time. */
  columns?: ReportColumn[];
  defaultSort?: { key: string; order: 'asc' | 'desc' };
  groupBy?: string;
  exportFormats: ExportFormat[];
}

/**
 * Building a ReportContext needs domain knowledge the engine is forbidden to
 * have: resolving `campusId` to class ids means reading SchoolClass, and
 * `.dependency-cruiser.cjs` bars `core` from importing a vertical.
 *
 * So each vertical supplies its own builder when it registers a catalogue, and
 * the registry hands the right one to the runner. School's implementation is
 * `FilterResolverService`; HR's will differ, which is why this is per namespace
 * rather than a single global provider.
 */
export interface ReportContextBuilder {
  build(def: ReportDefinition<any>, filters: Record<string, unknown>): Promise<ReportContext>;
}
