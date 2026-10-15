import { schoolTodayNow } from '@/lib/format';
import { useMemo, useState } from 'react';
import { BarChart3, Printer } from 'lucide-react';
import {
  useClasses,
  useAttendanceReport,
  useAttendanceStatuses,
  useSectionsForClass,
  type AttendanceStatusConfig,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { attendanceStatusColor } from '@erp/shared';

const sel = 'rounded-md border bg-card px-3 py-2 text-sm';

export function SchoolAttendanceReportPage() {
  const { data: classes } = useClasses();
  const { data: statuses } = useAttendanceStatuses();
  const statusList: AttendanceStatusConfig[] = useMemo(
    () => (statuses && statuses.length ? statuses : []),
    [statuses],
  );
  const byCode = useMemo<Record<string, AttendanceStatusConfig>>(
    () => Object.fromEntries(statusList.map((s) => [s.code, s])),
    [statusList],
  );
  const labelOf = (c: string) => byCode[c]?.label ?? c;
  const colorOf = (c: string) => attendanceStatusColor(byCode[c], c);

  const [classId, setClassId] = useState('');
  // Optional: '' reports the whole class, a stream reports just that stream.
  const [sectionId, setSectionId] = useState('');
  const { data: streams } = useSectionsForClass(classId || undefined);
  const today = schoolTodayNow();
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  const { data: report, isLoading } = useAttendanceReport(
    classId || undefined,
    start || undefined,
    end || undefined,
    sectionId || undefined,
  );
  const streamName = (streams ?? []).find((s) => s.id === sectionId)?.name ?? null;

  const print = () => window.print();

  const summary = report?.summary;
  // `summary` only carries present/absent/late buckets, so a card built from the
  // configured catalog has no count of its own — total each status across the
  // day rows instead (that is where every configured code is reported).
  const totals = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const row of report?.byDate ?? []) {
      for (const [code, n] of Object.entries(row.counts ?? {})) out[code] = (out[code] ?? 0) + (n ?? 0);
    }
    return out;
  }, [report]);
  const cards = statusList.length
    ? statusList.map((st) => ({ code: st.code, label: st.label, count: totals[st.code] ?? 0 }))
    : (summary
        ? [
            { code: 'present', label: 'Present', count: summary.present },
            { code: 'absent', label: 'Absent', count: summary.absent },
            { code: 'late', label: 'Late', count: summary.late },
          ]
        : []);
  const cardTotal = summary?.total || cards.reduce((a, c) => a + (c.count ?? 0), 0);

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2"><BarChart3 className="h-5 w-5" /> Attendance Report</h1>
        <p className="text-sm text-muted-foreground">Daily attendance summary across a date range, broken down by configured status.</p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1">
            <Label className="text-xs">Class</Label>
            <select className={sel} value={classId} onChange={(e) => { setSectionId(''); setClassId(e.target.value); }}>
              <option value="">Select class…</option>{(classes?.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {(streams?.length ?? 0) > 0 && (
            <div className="space-y-1">
              <Label className="text-xs">Stream (optional)</Label>
              <select className={sel} value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
                <option value="">Whole class</option>{(streams ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Start date</Label>
            <input type="date" className={sel} value={start} max={end || today} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">End date</Label>
            <input type="date" className={sel} value={end} min={start} max={today} onChange={(e) => setEnd(e.target.value)} />
          </div>
          <Button variant="outline" size="sm" onClick={print} disabled={!report}><Printer className="h-4 w-4" /> Print</Button>
        </CardContent>
      </Card>

      {!classId && <p className="text-sm text-muted-foreground">Pick a class and a date range to generate the report.</p>}
      {classId && (!start || !end) && <p className="text-sm text-muted-foreground">Select a start and end date.</p>}

      {classId && start && end && isLoading && <p className="text-sm text-muted-foreground">Generating…</p>}

      {report && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Daily Attendance Summary{streamName ? ` · ${streamName}` : ''}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {new Date(report.start).toLocaleDateString()} – {new Date(report.end).toLocaleDateString()} · {report.byDate.length} day(s)
              {streamName ? ` · ${streamName} only` : ''}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {cards.map((c: any) => {
                const pct = cardTotal ? Math.round(((c.count ?? 0) / cardTotal) * 100) : 0;
                return (
                  <div key={c.code} className="rounded-lg border bg-muted/30 p-3" style={{ borderLeft: `3px solid ${colorOf(c.code)}` }}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-2xl font-semibold tabular-nums">{c.count ?? 0}</span>
                      {cardTotal ? <span className="text-xs font-medium text-muted-foreground tabular-nums">{pct}%</span> : null}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colorOf(c.code) }} />{labelOf(c.code)}
                    </div>
                    {cardTotal ? (
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: colorOf(c.code) }} />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 border-b bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Day</th>
                  <th className="px-3 py-2 font-medium">Total</th>
                  {statusList.map((s) => (
                    <th key={s.code} className="px-3 py-2 font-medium">
                      <span className="inline-flex items-center gap-1.5" style={{ color: colorOf(s.code) }}>
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colorOf(s.code) }} />{s.label}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.byDate.length === 0 && (
                  <tr><td colSpan={3 + statusList.length} className="px-3 py-6 text-center text-muted-foreground">No attendance records in this range{streamName ? ` for ${streamName}` : ''}.</td></tr>
                )}
                {report.byDate.map((row) => (
                  <tr key={row.date} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-3 py-2">{new Date(row.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.day}</td>
                    <td className="px-3 py-2 font-medium tabular-nums">{row.total}</td>
                    {statusList.map((s) => (
                      <td key={s.code} className="px-3 py-2">
                        {row.counts[s.code] ? (
                          <Badge style={{ backgroundColor: colorOf(s.code), color: '#fff' }}>{row.counts[s.code]}</Badge>
                        ) : <span className="text-muted-foreground">0</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {report.byDate.length > 0 && (
                <tfoot className="border-t font-medium">
                  <tr>
                    <td className="px-3 py-2">Total</td>
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2 tabular-nums">{report.byDate.reduce((a, r) => a + (r.total ?? 0), 0)}</td>
                    {statusList.map((s) => (
                      <td key={s.code} className="px-3 py-2 tabular-nums" style={{ color: colorOf(s.code) }}>{totals[s.code] ?? 0}</td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
