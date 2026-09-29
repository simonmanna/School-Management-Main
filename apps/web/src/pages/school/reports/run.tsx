import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CalendarClock, Download, Loader2, Play } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  exportReport,
  SCHEDULE_PRESETS,
  useSaveReport,
  useReportMeta,
  useRunReport,
  type ExportFormat,
  type ReportFilters,
} from '@/features/school/reports-api';
import { ReportFilterBar } from './_components/report-filter-bar';
import { ReportTable } from '@/components/reports/report-table';

/**
 * The runner — one page for every report in the catalogue.
 *
 * There is deliberately no per-report page. A report's filters, columns,
 * formatting, exports and drilldowns all come from its server-side definition,
 * so adding a report to the catalogue adds a working screen with no frontend
 * change at all.
 *
 * Query parameters seed the filters, which is what makes drilldown work: a fee
 * summary links to `/school/reports/fees.student-statement?studentProfileId=…`.
 */

const PAGE_SIZE = 50;

/** Read whatever filter values a drilldown put in the URL. */
function filtersFromSearch(search: URLSearchParams): ReportFilters {
  const out: Record<string, unknown> = {};
  for (const [k, v] of search.entries()) {
    if (v) out[k] = v;
  }
  return out as ReportFilters;
}

export default function RunReportPage() {
  // The key is dotted ('fees.defaulters'), so the route uses a wildcard.
  const params = useParams();
  const key = params['*'] || params.key || '';
  const [search] = useSearchParams();

  const meta = useReportMeta(key);
  const run = useRunReport(key);

  const [filters, setFilters] = useState<ReportFilters>(() => filtersFromSearch(search));
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [scheduling, setScheduling] = useState(false);

  const missing = useMemo(() => {
    if (!meta.data) return [];
    return meta.data.requiredFilters.filter(
      (f) => {
        const v = (filters as Record<string, unknown>)[f];
        return v === undefined || v === null || v === '';
      },
    );
  }, [meta.data, filters]);

  const body = useMemo(() => ({ filters, page, pageSize: PAGE_SIZE }), [filters, page]);

  const execute = (nextPage = page) => {
    if (missing.length > 0) return;
    setPage(nextPage);
    run.mutate({ filters, page: nextPage, pageSize: PAGE_SIZE });
  };

  // Auto-run once everything required is present. A report the user arrived at
  // via a drilldown should already show its answer, not wait for another click.
  useEffect(() => {
    if (meta.data && missing.length === 0 && !run.data && !run.isPending) execute(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.data, missing.length]);

  const download = async (format: ExportFormat) => {
    setExporting(format);
    try {
      await exportReport(key, format, body);
    } catch (err: unknown) {
      // The server refuses rather than truncating an oversized report, and that
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
            to="/school/reports"
            className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> All reports
          </Link>
          <h1 className="text-2xl font-semibold">{meta.data?.title ?? key}</h1>
          {meta.data && (
            <p className="text-sm text-muted-foreground">{meta.data.description}</p>
          )}
        </div>

        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" disabled={!meta.data || missing.length > 0} onClick={() => setScheduling((v) => !v)}>
            <CalendarClock className="mr-1.5 h-3.5 w-3.5" /> Schedule
          </Button>
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

      {scheduling && meta.data && (
        <ScheduleForm
          reportKey={key}
          title={meta.data.title}
          filters={filters as Record<string, unknown>}
          formats={meta.data.exportFormats}
          onDone={() => setScheduling(false)}
        />
      )}

      {meta.isError && (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm">
          You do not have permission to run this report, or it does not exist.
        </Card>
      )}

      {meta.data && (
        <>
          <ReportFilterBar
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

      {run.data?.caption && (
        <p className="text-xs text-muted-foreground">{run.data.caption}</p>
      )}

      {run.data?.notes.map((note) => (
        // Caveats are not decoration: "this cannot reconstruct history" changes
        // how the number should be read.
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

/**
 * Wave 16: save this report, with the filters on screen, to be emailed on a
 * schedule. It runs as you, with your permissions at the time it runs.
 */
function ScheduleForm({ reportKey, title, filters, formats, onDone }: {
  reportKey: string;
  title: string;
  filters: Record<string, unknown>;
  formats: ExportFormat[];
  onDone: () => void;
}) {
  const save = useSaveReport();
  const [name, setName] = useState(title);
  const [cron, setCron] = useState(SCHEDULE_PRESETS[1].cron);
  const [format, setFormat] = useState<ExportFormat>(formats.includes('pdf') ? 'pdf' : formats[0] ?? 'csv');
  const [emails, setEmails] = useState('');
  const submit = async () => {
    try {
      await save.mutateAsync({
        name,
        reportKey,
        parameters: filters,
        schedule: cron || null,
        format: format as 'csv' | 'xlsx' | 'pdf',
        emailTo: emails.split(/[,;\s]+/).map((e) => e.trim()).filter(Boolean),
      });
      toast.success(cron ? 'Scheduled — it will be emailed as set' : 'Saved');
      onDone();
    } catch (err: unknown) {
      const m = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      toast.error(Array.isArray(m) ? m.join(' · ') : m ?? 'Could not save the schedule.');
    }
  };
  const field = 'w-full rounded-md border bg-card px-3 py-2 text-sm';
  return (
    <Card className="space-y-3 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm"><span className="text-muted-foreground">Name</span>
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="space-y-1 text-sm"><span className="text-muted-foreground">When</span>
          <select className={field} value={cron} onChange={(e) => setCron(e.target.value)}>
            {SCHEDULE_PRESETS.map((p) => <option key={p.cron} value={p.cron}>{p.label}</option>)}
            <option value="">Do not schedule (save only)</option>
          </select></label>
        <label className="space-y-1 text-sm"><span className="text-muted-foreground">Format</span>
          <select className={field} value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
            {formats.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
          </select></label>
        <label className="space-y-1 text-sm"><span className="text-muted-foreground">Email to (comma-separated)</span>
          <input className={field} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="head@school.ug, bursar@school.ug" /></label>
      </div>
      <p className="text-xs text-muted-foreground">Uses the filters above. It runs with your permissions at the time it runs — if your access changes, so does what is sent.</p>
      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={!name || save.isPending}>Save</Button>
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </Card>
  );
}
