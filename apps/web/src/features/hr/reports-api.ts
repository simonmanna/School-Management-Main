import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  ExportFormat,
  ReportCatalogEntry,
  ReportRunResult,
  RunReportBody,
} from '@/features/reports/types';

/**
 * Client for the HR & payroll report centre.
 *
 * Same engine as the school catalogue, different namespace and different
 * filters: HR partitions by department, post and pay period, never by class.
 * The four calls below are all of it — a report is data, so adding one to the
 * server catalogue adds a working screen with no change here.
 *
 * Run and export are POST. Filters carry `employeeId`, and an identifier that
 * resolves to one person's pay must not land in a URL, a browser history entry
 * or a proxy access log.
 */
const R = '/hr/reports/v2';

export type {
  ExportFormat,
  ReportColumn,
  ReportCatalogEntry,
  ReportRow,
  ReportRunResult,
  ReportShape,
} from '@/features/reports/types';

/** Exactly the filters the HR definitions declare. */
export interface HrReportFilters {
  departmentId?: string;
  positionId?: string;
  employeeId?: string;
  payrollPeriodId?: string;
  payrollRunId?: string;
  employmentType?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string[];
}

export type HrRunReportBody = RunReportBody<HrReportFilters>;

/** Only the reports this user may actually run — the API filters by grant. */
export function useHrReportCatalog() {
  return useQuery({
    queryKey: ['hr', 'reports', 'catalog'],
    queryFn: async () => (await api.get<ReportCatalogEntry[]>(`${R}/catalog`)).data,
    // The catalogue changes when code ships, not when data does.
    staleTime: 5 * 60_000,
  });
}

export function useHrReportMeta(key: string | undefined) {
  return useQuery({
    queryKey: ['hr', 'reports', 'meta', key],
    queryFn: async () => (await api.get<ReportCatalogEntry>(`${R}/${key}/meta`)).data,
    enabled: Boolean(key),
    staleTime: 5 * 60_000,
  });
}

/**
 * A mutation, not a query: running a payroll report is an explicit act, and a
 * bursar must never wonder whether a net-pay total is a cached one.
 */
export function useRunHrReport(key: string | undefined) {
  return useMutation({
    mutationFn: async (body: HrRunReportBody) =>
      (await api.post<ReportRunResult>(`${R}/${key}/run`, body)).data,
  });
}

/**
 * Download an export. The response is a blob, so it bypasses the JSON
 * interceptor path; the object URL is revoked immediately after the click.
 */
export async function exportHrReport(
  key: string,
  format: ExportFormat,
  body: HrRunReportBody,
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

/**
 * Download one payslip as a PDF.
 *
 * `self` routes it through the employee's own endpoint, which constrains the
 * lookup to their own record server-side — a teacher downloading their payslip
 * and a bursar downloading anyone's are different permissions, so they are
 * different URLs.
 */
export async function downloadPayslipPdf(payslipId: string, self = false): Promise<void> {
  const path = self ? `/hr/self/payslips/${payslipId}/pdf` : `/hr/payslips/${payslipId}/pdf`;
  const res = await api.get(path, { responseType: 'blob' });

  const disposition = String(res.headers['content-disposition'] ?? '');
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const filename = match?.[1] ?? `payslip-${payslipId}.pdf`;

  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
