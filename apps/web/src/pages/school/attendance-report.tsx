import { schoolTodayNow } from '@/lib/format';
import { useMemo, useState } from 'react';
import { BarChart3, Printer } from 'lucide-react';
import {
  useClasses,
  useAttendanceReport,
  useAttendanceStatuses,
  type AttendanceStatusConfig,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

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
  const colorOf = (c: string) => byCode[c]?.color ?? '#6b7280';

  const [classId, setClassId] = useState('');
  const today = schoolTodayNow();
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  const { data: report, isLoading } = useAttendanceReport(
    classId || undefined,
    start || undefined,
    end || undefined,
  );

  const print = () => window.print();

  const summary = report?.summary;
  // The summary only carries present/absent/late buckets; build cards from the
  // configured statuses too (present/absent/late are the seeded defaults).
  const cards = statusList.length
    ? statusList
    : (summary
        ? [
            { code: 'present', label: 'Present', count: summary.present },
            { code: 'absent', label: 'Absent', count: summary.absent },
            { code: 'late', label: 'Late', count: summary.late },
          ]
        : []);

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
            <select className={sel} value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">Select class…</option>{(classes?.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
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
              Daily Attendance Summary
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {new Date(report.start).toLocaleDateString()} – {new Date(report.end).toLocaleDateString()} · {report.byDate.length} day(s)
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {cards.map((c: any) => (
                <div key={c.code} className="rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: colorOf(c.code) }} />
                    <span className="text-2xl font-semibold">{c.count ?? 0}</span>
                  </div>
                  <div className="text-sm text-muted-foreground">{labelOf(c.code)}</div>
                  {summary?.total ? <div className="text-xs text-muted-foreground">{Math.round(((c.count ?? 0) / summary.total) * 100)}% of total</div> : null}
                </div>
              ))}
            </div>

            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Day</th>
                  <th className="px-3 py-2">Total</th>
                  {statusList.map((s) => (
                    <th key={s.code} className="px-3 py-2 capitalize" style={{ color: s.color }}>{s.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.byDate.length === 0 && (
                  <tr><td colSpan={3 + statusList.length} className="px-3 py-6 text-center text-muted-foreground">No attendance records in this range.</td></tr>
                )}
                {report.byDate.map((row) => (
                  <tr key={row.date} className="border-b last:border-0">
                    <td className="px-3 py-2">{new Date(row.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</td>
                    <td className="px-3 py-2">{row.day}</td>
                    <td className="px-3 py-2">{row.total}</td>
                    {statusList.map((s) => (
                      <td key={s.code} className="px-3 py-2">
                        {row.counts[s.code] ? (
                          <Badge style={{ backgroundColor: s.color, color: '#fff' }}>{row.counts[s.code]}</Badge>
                        ) : <span className="text-muted-foreground">0</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
