import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Download, Loader2, Play } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ReportTable } from '@/components/reports/report-table';
import {
  exportHrReport,
  useHrReportMeta,
  useRunHrReport,
  type ExportFormat,
  type HrReportFilters,
} from '@/features/hr/reports-api';
import { HrReportFilterBar } from './_components/hr-report-filter-bar';

/**
 * The HR runner — one page for every report in the catalogue.
 *
 * There is deliberately no per-report page. Filters, columns, formatting,
 * exports and caveats all come from the server-side definition, so adding a
 * report to the catalogue adds a working screen with no frontend change.
 *
 * Query parameters seed the filters, which is what makes drilldown work:
 * `/hr/reports/payroll.register?payrollRunId=…` from a payroll run screen.
 */

const PAGE_SIZE = 50;

function filtersFromSearch(search: URLSearchParams): HrReportFilters {
  const out: Record<string, unknown> = {};
  for (const [k, v] of search.entries()) {
    if (v) out[k] = v;
  }
  return out as HrReportFilters;
}

export default function RunHrReportPage() {
  // Report keys are dotted ('payroll.register'), so the route uses a wildcard.
  const params = useParams();
  const key = params['*'] || params.key || '';
  const [search] = useSearchParams();

  const meta = useHrReportMeta(key);
  const run = useRunHrReport(key);

  const [filters, setFilters] = useState<HrReportFilters>(() => filtersFromSearch(search));
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);

  const missing = useMemo(() => {
    if (!meta.data) return [];
    return meta.data.requiredFilters.filter((f) => {
      const v = (filters as Record<string, unknown>)[f];
      return v === undefined || v === null || v === '';
    });
  }, [meta.data, filters]);

  const body = useMemo(() => ({ filters, page, pageSize: PAGE_SIZE }), [filters, page]);

  const execute = (nextPage = page) => {
    if (missing.length > 0) return;
    setPage(nextPage);
    run.mutate({ filters, page: nextPage, pageSize: PAGE_SIZE });
  };

  // Auto-run once everything required is present. Most HR reports require
  // nothing — the payroll ones default to the latest run — so the page should
  // show its answer rather than an empty table and a button.
  useEffect(() => {
    if (meta.data && missing.length === 0 && !run.data && !run.isPending) execute(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.data, missing.length]);

  const download = async (format: ExportFormat) => {
    setExporting(format);
    try {
      await exportHrReport(key, format, body);
    } catch (err: unknown) {
      // The server refuses rather than truncating an oversized report, and the
      // refusal names the fix — surface it verbatim.
      const detail = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(detail ?? 'Export failed.');
    } finally {
      setExporting(null);
    }
  };

  const runError = run.error as { response?: { data?: { message?: string } } } | null;

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            to="/hr/reports"
            className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> All HR reports
          </Link>
          <h1 className="text-2xl font-semibold">{meta.data?.title ?? key}</h1>
          {meta.data && <p className="text-sm text-muted-foreground">{meta.data.description}</p>}
        </div>

        <div className="flex shrink-0 gap-2">
          {(meta.data?.exportFormats ?? []).map((f) => (
            <Button
              key={f}
              variant="outline"
              size="sm"
              disabled={!run.data || exporting !== null}
              onClick={() => download(f)}
            >
              {exporting === f
                ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                : <Download className="mr-1.5 h-3.5 w-3.5" />}
              {f.toUpperCase()}
            </Button>
          ))}
        </div>
      </div>

      {meta.isError && (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm">
          You do not have permission to run this report, or it does not exist.
          Payroll reports additionally require <code className="mx-1">hr:payroll</code>.
        </Card>
      )}

      {meta.data && (
        <>
          <HrReportFilterBar
            meta={meta.data}
            filters={filters}
            onChange={(next) => { setFilters(next); setPage(1); }}
          />

          <div className="flex items-center gap-3">
            <Button onClick={() => execute(1)} disabled={missing.length > 0 || run.isPending}>
              {run.isPending
                ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                : <Play className="mr-1.5 h-4 w-4" />}
              Run report
            </Button>
            {missing.length > 0 && (
              <span className="text-sm text-muted-foreground">
                Select {missing.join(', ')} to run this report.
              </span>
            )}
          </div>
        </>
      )}

      {runError && (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm">
          {runError.response?.data?.message ?? 'The report could not be run.'}
        </Card>
      )}

      {run.data?.caption && <p className="text-xs text-muted-foreground">{run.data.caption}</p>}

      {run.data?.notes.map((note) => (
        // Caveats are not decoration. "This run is CALCULATED and not approved"
        // changes whether the number may be filed or paid.
        <Card key={note} className="flex gap-2 border-amber-300/60 bg-amber-50/60 p-3 text-sm dark:bg-amber-950/20">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>{note}</span>
        </Card>
      ))}

      <ReportTable result={run.data} loading={run.isPending} />

      {run.data && run.data.meta.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {run.data.meta.page} of {run.data.meta.totalPages} · {run.data.meta.total.toLocaleString()} rows
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline" size="sm"
              disabled={page <= 1 || run.isPending}
              onClick={() => execute(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline" size="sm"
              disabled={page >= run.data.meta.totalPages || run.isPending}
              onClick={() => execute(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
