import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Client for the registry-driven report centre (ADR-017).
 *
 * Mirrors the API contract in
 * apps/api/src/modules/core/reporting/report.types.ts. Kept in its own file
 * rather than appended to the 6700-line features/school/api.ts, because every
 * report in the catalogue goes through exactly these four calls — there is no
 * per-report hook to add.
 *
 * Run and export are POST: filters carry `studentProfileId`, and personal
 * identifiers must not end up in a URL, a browser history entry or a proxy log.
 */
const R = '/school/reports/v2';

export type ReportShape = 'table' | 'grouped' | 'matrix' | 'summary';
export type ColumnType =
  | 'string' | 'int' | 'money' | 'percent' | 'date' | 'datetime' | 'bool' | 'enum';
export type ExportFormat = 'csv' | 'xlsx' | 'pdf';
export type ClassBasis = 'current' | 'enrollment' | 'roster';
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
  classBasisDefault?: ClassBasis;
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

export interface ReportFilters {
  academicYearId?: string;
  termId?: string;
  campusId?: string;
  gradeLevelId?: string;
  classId?: string;
  sectionId?: string;
  streamId?: string;
  studentProfileId?: string;
  staffProfileId?: string;
  subjectId?: string;
  resultSetId?: string;
  studentCategoryId?: string;
  dateFrom?: string;
  dateTo?: string;
  asOf?: string;
  status?: string[];
  gender?: string;
  residenceType?: string;
  house?: string;
  search?: string;
  classBasis?: ClassBasis;
}

export interface RunReportBody {
  filters?: ReportFilters;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/** Only the reports this user may actually run — the API filters by grant. */
export function useReportCatalog() {
  return useQuery({
    queryKey: ['school', 'reports', 'catalog'],
    queryFn: async () => (await api.get<ReportCatalogEntry[]>(`${R}/catalog`)).data,
    // The catalogue changes only when code ships, not when data does.
    staleTime: 5 * 60_000,
  });
}

export function useReportMeta(key: string | undefined) {
  return useQuery({
    queryKey: ['school', 'reports', 'meta', key],
    queryFn: async () => (await api.get<ReportCatalogEntry>(`${R}/${key}/meta`)).data,
    enabled: Boolean(key),
    staleTime: 5 * 60_000,
  });
}

/**
 * A mutation, not a query: running a report is an explicit act with a body, and
 * a bursar must never wonder whether an arrears figure is a cached one.
 */
export function useRunReport(key: string | undefined) {
  return useMutation({
    mutationFn: async (body: RunReportBody) =>
      (await api.post<ReportRunResult>(`${R}/${key}/run`, body)).data,
  });
}

/**
 * Download an export. The response is a blob, so it cannot go through the JSON
 * interceptor path; the object URL is revoked immediately after the click.
 */
export async function exportReport(
  key: string,
  format: ExportFormat,
  body: RunReportBody,
): Promise<void> {
  const res = await api.post(`${R}/${key}/export`, { ...body, format }, {
    responseType: 'blob',
  });

  const disposition = String(res.headers['content-disposition'] ?? '');
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const filename = match?.[1] ?? `${key.replace(/\./g, '-')}.${format}`;

  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
