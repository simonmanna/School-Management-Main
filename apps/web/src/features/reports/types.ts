/**
 * The report-engine contract, shared by every namespace's report centre.
 *
 * Mirrors `apps/api/src/modules/core/reporting/report.types.ts`. It lives here
 * rather than inside `features/school` because the engine is domain-free and
 * more than one catalogue now runs on it — school and HR — and the API makes a
 * point of keeping those apart (`school` may not import `hr`). Having the HR
 * client import its types from the school client would quietly reintroduce on
 * the frontend the coupling the backend forbids.
 *
 * Filters are the one part that is NOT shared: each namespace declares its own
 * subset, because "which class" and "which payroll period" are not the same
 * question.
 */

export type ReportShape = 'table' | 'grouped' | 'matrix' | 'summary';

export type ColumnType =
  | 'string' | 'int' | 'money' | 'percent' | 'date' | 'datetime' | 'bool' | 'enum';

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

export type AsOfMode = 'live' | 'as-of' | 'current-only';

export type ReportColumnLink =
  | { reportKey: string; paramFrom: Record<string, string> }
  | { route: string; paramFrom: Record<string, string> };

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
  align?: 'left' | 'right' | 'center';
  width?: number;
  format?: string;
  total?: 'sum' | 'avg' | 'count' | 'none';
  hideOn?: Array<'screen' | ExportFormat>;
  link?: ReportColumnLink;
}

export interface ReportCatalogEntry {
  key: string;
  title: string;
  domain: string;
  description: string;
  shape: ReportShape;
  filters: string[];
  requiredFilters: string[];
  classBasisDefault?: string;
  asOfMode: AsOfMode;
  columns?: ReportColumn[];
  defaultSort?: { key: string; order: 'asc' | 'desc' };
  groupBy?: string;
  exportFormats: ExportFormat[];
}

export type ReportRow = Record<string, unknown>;

export interface ReportRunResult {
  key: string;
  title: string;
  columns: ReportColumn[];
  data: ReportRow[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  totals?: ReportRow;
  groups?: Array<{ key: string; label: string; rows: ReportRow[]; totals?: ReportRow }>;
  caption?: string;
  notes: string[];
}

export interface RunReportBody<F = Record<string, unknown>> {
  filters?: F;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}
