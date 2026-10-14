import { useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, Clock, DoorOpen, Download, MessageSquareWarning, Phone, PhoneMissed, Printer, RotateCcw, Users,
} from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  useFrontDeskReport,
  type CallDirection, type CallStatus, type ComplaintCategory, type ComplaintPriority, type ComplaintStatus,
  type FrontDeskCountRow, type FrontDeskReport, type FrontDeskReportFilters, type FrontDeskReportGroupBy,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable, type Column } from '@/components/data-table';
import { exportCSV } from '@/lib/export-csv';
import { FilterField } from './_components/filter-field';

/* ─────────────── date presets ─────────────── */

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

type Preset = 'today' | 'yesterday' | '7d' | '30d' | 'thisMonth' | 'lastMonth' | '90d' | 'thisYear' | 'custom';
const PRESETS: { value: Preset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'lastMonth', label: 'Last month' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'thisYear', label: 'This year' },
  { value: 'custom', label: 'Custom range' },
];

function presetRange(p: Preset): { from: string; to: string; groupBy: FrontDeskReportGroupBy } | null {
  const t = new Date();
  switch (p) {
    case 'today': return { from: ymd(t), to: ymd(t), groupBy: 'day' };
    case 'yesterday': { const y = addDays(t, -1); return { from: ymd(y), to: ymd(y), groupBy: 'day' }; }
    case '7d': return { from: ymd(addDays(t, -6)), to: ymd(t), groupBy: 'day' };
    case '30d': return { from: ymd(addDays(t, -29)), to: ymd(t), groupBy: 'day' };
    case 'thisMonth': return { from: ymd(new Date(t.getFullYear(), t.getMonth(), 1)), to: ymd(t), groupBy: 'day' };
    case 'lastMonth': return { from: ymd(new Date(t.getFullYear(), t.getMonth() - 1, 1)), to: ymd(new Date(t.getFullYear(), t.getMonth(), 0)), groupBy: 'day' };
    case '90d': return { from: ymd(addDays(t, -89)), to: ymd(t), groupBy: 'week' };
    case 'thisYear': return { from: ymd(new Date(t.getFullYear(), 0, 1)), to: ymd(t), groupBy: 'month' };
    default: return null;
  }
}

/* ─────────────── formatting ─────────────── */

const label = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const hourLabel = (h: number) => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
const fmtDateTime = (d?: string | null) => (d ? new Date(d).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const fmtMins = (m: number | null) => (m == null ? '—' : m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`);
const fmtSecs = (s: number | null) => (s == null ? '—' : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);
const fmtHours = (h: number | null) => (h == null ? '—' : h < 24 ? `${h} h` : `${Math.round((h / 24) * 10) / 10} days`);
const fmtPeriod = (p: string, g: FrontDeskReportGroupBy) => {
  if (g === 'month') return new Date(`${p}-01T00:00:00`).toLocaleDateString([], { month: 'short', year: 'numeric' });
  const d = new Date(`${p}T00:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short' });
  return g === 'week' ? `Wk ${d}` : d;
};
const stayMins = (r: { checkInAt: string; checkOutAt: string | null }) =>
  r.checkOutAt ? Math.max(0, Math.round((new Date(r.checkOutAt).getTime() - new Date(r.checkInAt).getTime()) / 60_000)) : null;

const C = {
  visitors: '#6366f1',
  calls: '#0ea5e9',
  missed: '#ef4444',
  complaints: '#f59e0b',
  resolved: '#10b981',
  inbound: '#22c55e',
  outbound: '#3b82f6',
};
const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316', '#ec4899', '#64748b'];
const STATUS_COLOR: Record<string, string> = {
  completed: '#10b981', missed: '#ef4444', voicemail: '#f59e0b', scheduled: '#0ea5e9', cancelled: '#94a3b8',
  open: '#f59e0b', in_progress: '#0ea5e9', awaiting_response: '#8b5cf6', resolved: '#10b981', closed: '#64748b', escalated: '#ef4444',
  urgent: '#dc2626', high: '#f97316', medium: '#f59e0b', low: '#94a3b8',
  in: '#0ea5e9', out: '#10b981', expected: '#8b5cf6', inbound: C.inbound, outbound: C.outbound,
};
const colorFor = (k: string, i: number) => STATUS_COLOR[k] ?? PALETTE[i % PALETTE.length];
const tooltipStyle = { contentStyle: { borderRadius: 8, fontSize: 12 } };

const CALL_DIRECTIONS: CallDirection[] = ['inbound', 'outbound'];
const CALL_STATUSES: CallStatus[] = ['completed', 'missed', 'voicemail', 'scheduled', 'cancelled'];
const CATEGORIES: ComplaintCategory[] = ['academic', 'behavior', 'facilities', 'staff_conduct', 'communication', 'fees', 'transport', 'meals', 'safety', 'other'];
const PRIORITIES: ComplaintPriority[] = ['urgent', 'high', 'medium', 'low'];
const COMPLAINT_STATUSES: ComplaintStatus[] = ['open', 'in_progress', 'awaiting_response', 'escalated', 'resolved', 'closed'];

const sel = 'w-full rounded-md border bg-card px-3 text-sm';

/* ─────────────── small building blocks ─────────────── */

function Delta({ cur, prev, invert }: { cur: number; prev: number; invert?: boolean }) {
  if (!prev && !cur) return <span className="text-xs text-muted-foreground">no change</span>;
  if (!prev) return <span className="text-xs text-muted-foreground">new this period</span>;
  const d = Math.round(((cur - prev) / prev) * 100);
  if (d === 0) return <span className="text-xs text-muted-foreground">same as previous</span>;
  const up = d > 0;
  const good = invert ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${good ? 'text-emerald-600' : 'text-red-600'}`}>
      <Icon className="h-3 w-3" />{Math.abs(d)}% <span className="font-normal text-muted-foreground">vs prev ({prev})</span>
    </span>
  );
}

function Kpi({ title, value, icon: Icon, hint, tone }: { title: string; value: ReactNode; icon?: typeof Users; hint?: ReactNode; tone?: 'warn' | 'bad' }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
          {Icon && <Icon className={`h-4 w-4 ${tone === 'bad' ? 'text-red-500' : tone === 'warn' ? 'text-amber-500' : 'text-muted-foreground'}`} />}
        </div>
        <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone === 'bad' ? 'text-red-600' : ''}`}>{value}</p>
        {hint && <div className="mt-0.5">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, children, className, empty }: { title: string; children: ReactNode; className?: string; empty?: boolean }) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">{title}</CardTitle></CardHeader>
      <CardContent>
        {empty ? <p className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">No data for this selection.</p> : children}
      </CardContent>
    </Card>
  );
}

function HBar({ rows, color, height }: { rows: FrontDeskCountRow[]; color?: string; height?: number }) {
  const data = rows.map((r) => ({ name: label(r.key), count: r.count, raw: r.key }));
  return (
    <ResponsiveContainer width="100%" height={height ?? Math.max(180, data.length * 30 + 30)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-muted" />
        <XAxis type="number" allowDecimals={false} fontSize={11} />
        <YAxis type="category" dataKey="name" width={120} fontSize={11} tickLine={false} />
        <Tooltip {...tooltipStyle} />
        <Bar dataKey="count" name="Count" radius={[0, 4, 4, 0]}>
          {data.map((d, i) => <Cell key={d.raw} fill={color ?? colorFor(d.raw, i)} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function Donut({ rows }: { rows: FrontDeskCountRow[] }) {
  const data = rows.filter((r) => r.count > 0).map((r) => ({ name: label(r.key), value: r.count, raw: r.key }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
          {data.map((d, i) => <Cell key={d.raw} fill={colorFor(d.raw, i)} />)}
        </Pie>
        <Tooltip {...tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function HourChart<T extends { hour: number }>({ data, keys }: { data: T[]; keys: { key: keyof T & string; name: string; color: string }[] }) {
  // Trim the silent night hours so the working day fills the chart.
  const active = data.map((d, i) => ({ d, i })).filter(({ d }) => keys.some((k) => Number(d[k.key]) > 0));
  const lo = active.length ? Math.max(0, Math.min(7, active[0].i)) : 7;
  const hi = active.length ? Math.min(23, Math.max(18, active[active.length - 1].i)) : 18;
  const rows = data.slice(lo, hi + 1).map((d) => ({ ...d, label: hourLabel(d.hour) }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={rows}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted" />
        <XAxis dataKey="label" fontSize={11} />
        <YAxis allowDecimals={false} fontSize={11} />
        <Tooltip {...tooltipStyle} />
        {keys.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {keys.map((k) => <Bar key={k.key} dataKey={k.key} name={k.name} stackId="h" fill={k.color} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

function WeekdayChart({ data, color }: { data: { day: string; count: number }[]; color: string }) {
  // Monday-first, the way a school week reads.
  const rows = [...data.slice(1), data[0]];
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={rows}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted" />
        <XAxis dataKey="day" fontSize={11} />
        <YAxis allowDecimals={false} fontSize={11} />
        <Tooltip {...tooltipStyle} />
        <Bar dataKey="count" name="Count" fill={color} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function RankTable({ rows, header }: { rows: FrontDeskCountRow[]; header: string }) {
  const total = rows.reduce((a, r) => a + r.count, 0) || 1;
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted-foreground">No data for this selection.</p>;
  return (
    <table className="w-full text-sm">
      <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground"><th className="py-1.5">{header}</th><th className="py-1.5 text-right">Count</th><th className="w-1/3 py-1.5 pl-3">Share</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-b last:border-0">
            <td className="py-1.5">{r.key}</td>
            <td className="py-1.5 text-right tabular-nums">{r.count}</td>
            <td className="py-1.5 pl-3">
              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded bg-muted"><div className="h-1.5 rounded bg-primary" style={{ width: `${(r.count / total) * 100}%` }} /></div>
                <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{Math.round((r.count / total) * 100)}%</span>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const pill = (s: string) => (
  <span className="rounded px-2 py-0.5 text-xs font-medium text-white" style={{ background: STATUS_COLOR[s] ?? '#64748b' }}>{label(s)}</span>
);

/* ─────────────── detail-table columns ─────────────── */

type VisitorRow = FrontDeskReport['rows']['visitors'][number];
type CallRow = FrontDeskReport['rows']['calls'][number];
type ComplaintRow = FrontDeskReport['rows']['complaints'][number];

const visitorCols: Column<VisitorRow>[] = [
  { key: 'checkInAt', header: 'Check-in', render: (r) => fmtDateTime(r.checkInAt), sortValue: (r) => r.checkInAt },
  { key: 'visitorName', header: 'Visitor' },
  { key: 'phone', header: 'Phone', render: (r) => r.phone ?? '—' },
  { key: 'purpose', header: 'Purpose', render: (r) => r.purpose ?? '—' },
  { key: 'personVisited', header: 'Visiting', render: (r) => r.personVisited ?? '—' },
  { key: 'checkOutAt', header: 'Check-out', render: (r) => fmtDateTime(r.checkOutAt), sortValue: (r) => r.checkOutAt },
  { key: 'stay', header: 'Stay', render: (r) => fmtMins(stayMins(r)), sortValue: (r) => stayMins(r) },
  { key: 'status', header: 'Status', render: (r) => pill(r.status) },
];
const callCols: Column<CallRow>[] = [
  { key: 'callAt', header: 'When', render: (r) => fmtDateTime(r.callAt), sortValue: (r) => r.callAt },
  { key: 'direction', header: 'Direction', render: (r) => pill(r.direction) },
  { key: 'contactName', header: 'Contact' },
  { key: 'phone', header: 'Phone' },
  { key: 'subject', header: 'Subject', render: (r) => r.subject ?? '—' },
  { key: 'outcome', header: 'Outcome', render: (r) => r.outcome ?? '—' },
  { key: 'durationSec', header: 'Duration', render: (r) => fmtSecs(r.durationSec) },
  { key: 'status', header: 'Status', render: (r) => pill(r.status) },
];
const complaintCols: Column<ComplaintRow>[] = [
  { key: 'receivedAt', header: 'Received', render: (r) => fmtDateTime(r.receivedAt), sortValue: (r) => r.receivedAt },
  { key: 'subject', header: 'Subject' },
  { key: 'category', header: 'Category', render: (r) => label(r.category) },
  { key: 'priority', header: 'Priority', render: (r) => pill(r.priority), sortValue: (r) => PRIORITIES.indexOf(r.priority) },
  { key: 'status', header: 'Status', render: (r) => pill(r.status) },
  { key: 'resolvedAt', header: 'Resolved', render: (r) => fmtDateTime(r.resolvedAt), sortValue: (r) => r.resolvedAt },
  {
    key: 'age', header: 'Time to resolve / age',
    render: (r) => fmtHours(Math.round(((r.resolvedAt ? new Date(r.resolvedAt) : new Date()).getTime() - new Date(r.receivedAt).getTime()) / 360_000) / 10),
    sortValue: (r) => (r.resolvedAt ? new Date(r.resolvedAt) : new Date()).getTime() - new Date(r.receivedAt).getTime(),
  },
];

/* ─────────────── page ─────────────── */

type Tab = 'overview' | 'visitors' | 'calls' | 'complaints';
const DEFAULT = presetRange('30d')!;

export function FrontDeskReportsPage() {
  const [preset, setPreset] = useState<Preset>('30d');
  const [filters, setFilters] = useState<FrontDeskReportFilters>({ ...DEFAULT });
  const [tab, setTab] = useState<Tab>('overview');
  const report = useFrontDeskReport(filters);
  const r = report.data;

  const set = <K extends keyof FrontDeskReportFilters>(k: K, v: FrontDeskReportFilters[K] | '') =>
    setFilters((f) => ({ ...f, [k]: v === '' ? undefined : v }));
  const pickPreset = (p: Preset) => {
    setPreset(p);
    const range = presetRange(p);
    if (range) setFilters((f) => ({ ...f, ...range }));
  };
  const setDate = (k: 'from' | 'to', v: string) => { setPreset('custom'); setFilters((f) => ({ ...f, [k]: v })); };
  const reset = () => { setPreset('30d'); setFilters({ ...DEFAULT }); };
  const sectionFilters = Boolean(filters.visitorStatus || filters.direction || filters.callStatus || filters.category || filters.priority || filters.complaintStatus);

  const trend = useMemo(() => (r?.trend ?? []).map((t) => ({ ...t, label: fmtPeriod(t.period, r!.range.groupBy) })), [r]);
  const hourly = useMemo(() => (r ? r.visitors.byHour.map((v, i) => ({ hour: v.hour, visitors: v.count, calls: r.calls.byHour[i].count })) : []), [r]);

  const exportTab = () => {
    if (!r) return;
    const stamp = `${r.range.from}_to_${r.range.to}`;
    if (tab === 'visitors') {
      exportCSV(`frontdesk-visitors_${stamp}.csv`, ['Check-in', 'Visitor', 'Phone', 'Purpose', 'Visiting', 'Check-out', 'Stay (min)', 'Status'],
        r.rows.visitors.map((v) => [fmtDateTime(v.checkInAt), v.visitorName, v.phone ?? '', v.purpose ?? '', v.personVisited ?? '', v.checkOutAt ? fmtDateTime(v.checkOutAt) : '', String(stayMins(v) ?? ''), v.status]));
    } else if (tab === 'calls') {
      exportCSV(`frontdesk-calls_${stamp}.csv`, ['When', 'Direction', 'Contact', 'Phone', 'Subject', 'Outcome', 'Duration (s)', 'Status'],
        r.rows.calls.map((c) => [fmtDateTime(c.callAt), c.direction, c.contactName, c.phone, c.subject ?? '', c.outcome ?? '', String(c.durationSec ?? ''), c.status]));
    } else if (tab === 'complaints') {
      exportCSV(`frontdesk-complaints_${stamp}.csv`, ['Received', 'Subject', 'Category', 'Priority', 'Status', 'Resolved'],
        r.rows.complaints.map((c) => [fmtDateTime(c.receivedAt), c.subject, label(c.category), c.priority, label(c.status), c.resolvedAt ? fmtDateTime(c.resolvedAt) : '']));
    } else {
      exportCSV(`frontdesk-summary_${stamp}.csv`, ['Period', 'Visitors', 'Calls', 'Missed calls', 'Complaints', 'Resolved complaints'],
        r.trend.map((t) => [t.period, String(t.visitors), String(t.calls), String(t.missedCalls), String(t.complaints), String(t.resolvedComplaints)]));
    }
  };

  return (
    <div className="space-y-4 p-6 print:p-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Frontdesk Reports</h1>
          <p className="text-sm text-muted-foreground">
            Visitors, phone calls and complaints
            {r && <> · {new Date(`${r.range.from}T00:00:00`).toLocaleDateString()} – {new Date(`${r.range.to}T00:00:00`).toLocaleDateString()} ({r.range.days} day{r.range.days === 1 ? '' : 's'})</>}
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Button variant="outline" size="sm" onClick={exportTab} disabled={!r}><Download className="mr-1.5 h-4 w-4" />Export CSV</Button>
          <Button variant="outline" size="sm" onClick={() => window.print()} disabled={!r}><Printer className="mr-1.5 h-4 w-4" />Print</Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="print:hidden">
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap gap-3">
            <FilterField label="Period">
              <select className={sel} value={preset} onChange={(e) => pickPreset(e.target.value as Preset)}>
                {PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </FilterField>
            <FilterField label="From" wide><Input type="date" value={filters.from} max={filters.to} onChange={(e) => setDate('from', e.target.value)} /></FilterField>
            <FilterField label="To" wide><Input type="date" value={filters.to} min={filters.from} onChange={(e) => setDate('to', e.target.value)} /></FilterField>
            <FilterField label="Group trend by">
              <select className={sel} value={filters.groupBy} onChange={(e) => set('groupBy', e.target.value as FrontDeskReportGroupBy)}>
                <option value="day">Day</option><option value="week">Week</option><option value="month">Month</option>
              </select>
            </FilterField>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <FilterField label="Visitor status">
              <select className={sel} value={filters.visitorStatus ?? ''} onChange={(e) => set('visitorStatus', e.target.value as FrontDeskReportFilters['visitorStatus'])}>
                <option value="">All</option><option value="in">Checked in</option><option value="out">Checked out</option><option value="expected">Expected</option>
              </select>
            </FilterField>
            <FilterField label="Call direction">
              <select className={sel} value={filters.direction ?? ''} onChange={(e) => set('direction', e.target.value as CallDirection)}>
                <option value="">All</option>{CALL_DIRECTIONS.map((d) => <option key={d} value={d}>{label(d)}</option>)}
              </select>
            </FilterField>
            <FilterField label="Call status">
              <select className={sel} value={filters.callStatus ?? ''} onChange={(e) => set('callStatus', e.target.value as CallStatus)}>
                <option value="">All</option>{CALL_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
              </select>
            </FilterField>
            <FilterField label="Complaint category">
              <select className={sel} value={filters.category ?? ''} onChange={(e) => set('category', e.target.value as ComplaintCategory)}>
                <option value="">All</option>{CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}
              </select>
            </FilterField>
            <FilterField label="Priority">
              <select className={sel} value={filters.priority ?? ''} onChange={(e) => set('priority', e.target.value as ComplaintPriority)}>
                <option value="">All</option>{PRIORITIES.map((p) => <option key={p} value={p}>{label(p)}</option>)}
              </select>
            </FilterField>
            <FilterField label="Complaint status">
              <select className={sel} value={filters.complaintStatus ?? ''} onChange={(e) => set('complaintStatus', e.target.value as ComplaintStatus)}>
                <option value="">All</option>{COMPLAINT_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
              </select>
            </FilterField>
            <Button variant="ghost" size="sm" className="h-10" onClick={reset} disabled={preset === '30d' && !sectionFilters && filters.groupBy === 'day'}>
              <RotateCcw className="mr-1.5 h-4 w-4" />Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      {report.isError && (
        <Card><CardContent className="p-4 text-sm text-red-600">Could not load the report. {(report.error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? ''}</CardContent></Card>
      )}
      {report.isLoading && <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Loading report…</CardContent></Card>}
      {r?.truncated && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          Large range: only the most recent 5,000 records per type are included. Narrow the dates for exact figures.
        </p>
      )}

      {r && (
        <div className={report.isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          {/* Headline KPIs */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi title="Visitors" icon={DoorOpen} value={r.visitors.total} hint={<Delta cur={r.visitors.total} prev={r.previous.visitors} />} />
            <Kpi title="Phone calls" icon={Phone} value={r.calls.total} hint={<Delta cur={r.calls.total} prev={r.previous.calls} />} />
            <Kpi title="Missed inbound" icon={PhoneMissed} value={`${r.calls.missedInboundRate}%`} tone={r.calls.missedInboundRate >= 20 ? 'bad' : r.calls.missedInboundRate >= 10 ? 'warn' : undefined}
              hint={<span className="text-xs text-muted-foreground">{r.calls.missed} missed of {r.calls.total}</span>} />
            <Kpi title="Complaints" icon={MessageSquareWarning} value={r.complaints.total} hint={<Delta cur={r.complaints.total} prev={r.previous.complaints} invert />} />
            <Kpi title="Open complaints" icon={AlertTriangle} value={r.complaints.open} tone={r.complaints.overdueCount ? 'bad' : r.complaints.open ? 'warn' : undefined}
              hint={<span className="text-xs text-muted-foreground">{r.complaints.overdueCount} overdue (&gt; {r.thresholds.complaintSlaDays} days)</span>} />
            <Kpi title="Avg resolution" icon={Clock} value={fmtHours(r.complaints.avgResolutionHours)}
              hint={<span className="text-xs text-muted-foreground">{r.complaints.resolutionRate}% resolved</span>} />
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="mt-4">
            <TabsList className="print:hidden">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="visitors">Visitors ({r.visitors.total})</TabsTrigger>
              <TabsTrigger value="calls">Phone calls ({r.calls.total})</TabsTrigger>
              <TabsTrigger value="complaints">Complaints ({r.complaints.total})</TabsTrigger>
            </TabsList>

            {/* ── Overview ── */}
            <TabsContent value="overview" className="space-y-4">
              <ChartCard title={`Activity trend by ${r.range.groupBy}`} empty={!r.visitors.total && !r.calls.total && !r.complaints.total}>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={trend}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="label" fontSize={11} minTickGap={16} />
                    <YAxis allowDecimals={false} fontSize={11} />
                    <Tooltip {...tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="visitors" name="Visitors" stroke={C.visitors} strokeWidth={2} dot={trend.length < 40} />
                    <Line type="monotone" dataKey="calls" name="Calls" stroke={C.calls} strokeWidth={2} dot={trend.length < 40} />
                    <Line type="monotone" dataKey="missedCalls" name="Missed calls" stroke={C.missed} strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
                    <Line type="monotone" dataKey="complaints" name="Complaints" stroke={C.complaints} strokeWidth={2} dot={trend.length < 40} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard title="Busiest hours (visitors + calls)" empty={!r.visitors.total && !r.calls.total}>
                  <HourChart data={hourly} keys={[{ key: 'visitors', name: 'Visitors', color: C.visitors }, { key: 'calls', name: 'Calls', color: C.calls }]} />
                </ChartCard>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Needs attention</CardTitle></CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <Attention n={r.complaints.overdueCount} text={`complaint(s) open longer than ${r.thresholds.complaintSlaDays} days`} onClick={() => setTab('complaints')} />
                    <Attention n={r.complaints.urgentOpen} text="urgent / high-priority complaint(s) unresolved" onClick={() => setTab('complaints')} />
                    <Attention n={r.complaints.unassignedOpen} text="open complaint(s) with nobody assigned" onClick={() => setTab('complaints')} />
                    <Attention n={r.complaints.escalated} text="complaint(s) escalated" onClick={() => setTab('complaints')} />
                    <Attention n={r.visitors.overstays.length} text={`visitor(s) still checked in after ${r.thresholds.overstayHours}+ hours`} onClick={() => setTab('visitors')} />
                    <Attention n={r.calls.missed} text="missed call(s) — consider calling back" onClick={() => setTab('calls')} />
                    {!r.complaints.overdueCount && !r.complaints.urgentOpen && !r.complaints.unassignedOpen && !r.complaints.escalated && !r.visitors.overstays.length && !r.calls.missed && (
                      <p className="text-muted-foreground">Nothing outstanding for this period.</p>
                    )}
                  </CardContent>
                </Card>
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                <ChartCard title="Top visit purposes" empty={!r.visitors.byPurpose.length}><HBar rows={r.visitors.byPurpose.slice(0, 6)} color={C.visitors} height={220} /></ChartCard>
                <ChartCard title="Top call subjects" empty={!r.calls.bySubject.length}><HBar rows={r.calls.bySubject.slice(0, 6)} color={C.calls} height={220} /></ChartCard>
                <ChartCard title="Complaints by category" empty={!r.complaints.total}><HBar rows={r.complaints.byCategory.slice(0, 6)} height={220} /></ChartCard>
              </div>
            </TabsContent>

            {/* ── Visitors ── */}
            <TabsContent value="visitors" className="space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <Kpi title="Total visits" value={r.visitors.total} />
                <Kpi title="Unique visitors" value={r.visitors.uniqueVisitors} hint={<span className="text-xs text-muted-foreground">{r.visitors.repeatVisitors} came more than once</span>} />
                <Kpi title="Still checked in" value={r.visitors.stillIn} tone={r.visitors.overstays.length ? 'warn' : undefined} hint={<span className="text-xs text-muted-foreground">{r.visitors.expected} expected</span>} />
                <Kpi title="Avg stay" value={fmtMins(r.visitors.avgStayMin)} hint={<span className="text-xs text-muted-foreground">median {fmtMins(r.visitors.medianStayMin)}</span>} />
                <Kpi title="Peak hour" value={r.visitors.peakHour == null ? '—' : hourLabel(r.visitors.peakHour)} />
                <Kpi title="Per day" value={Math.round((r.visitors.total / Math.max(1, r.range.days)) * 10) / 10} />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard title="Visits by hour of day" empty={!r.visitors.total}><HourChart data={r.visitors.byHour} keys={[{ key: 'count', name: 'Visitors', color: C.visitors }]} /></ChartCard>
                <ChartCard title="Visits by weekday" empty={!r.visitors.total}><WeekdayChart data={r.visitors.byWeekday} color={C.visitors} /></ChartCard>
                <ChartCard title="Purpose of visit" empty={!r.visitors.byPurpose.length}><HBar rows={r.visitors.byPurpose} color={C.visitors} /></ChartCard>
                <ChartCard title="Who they came to see" empty={!r.visitors.byPersonVisited.length}><HBar rows={r.visitors.byPersonVisited} color="#8b5cf6" /></ChartCard>
                <ChartCard title="Length of stay (checked-out visits)" empty={!r.visitors.checkedOut}><HBar rows={r.visitors.stayBuckets} color="#14b8a6" height={220} /></ChartCard>
                <ChartCard title="Status" empty={!r.visitors.total}><Donut rows={r.visitors.byStatus} /></ChartCard>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Most frequent visitors</CardTitle></CardHeader><CardContent><RankTable rows={r.visitors.topVisitors} header="Visitor" /></CardContent></Card>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Overstays — still in after {r.thresholds.overstayHours}+ hours</CardTitle></CardHeader>
                  <CardContent>
                    {r.visitors.overstays.length ? (
                      <table className="w-full text-sm">
                        <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground"><th className="py-1.5">Visitor</th><th>Visiting</th><th>Checked in</th><th className="text-right">Hours</th></tr></thead>
                        <tbody>{r.visitors.overstays.map((o) => (
                          <tr key={o.id} className="border-b last:border-0"><td className="py-1.5">{o.visitorName}</td><td>{o.personVisited ?? '—'}</td><td>{fmtDateTime(o.checkInAt)}</td><td className="text-right font-medium text-red-600">{o.hoursIn}</td></tr>
                        ))}</tbody>
                      </table>
                    ) : <p className="py-6 text-center text-sm text-muted-foreground">No visitors left checked in.</p>}
                  </CardContent>
                </Card>
              </div>
              <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Visitor log</CardTitle></CardHeader>
                <CardContent><DataTable<VisitorRow> columns={visitorCols} data={r.rows.visitors} getRowId={(x) => x.id} pageSize={25} searchPlaceholder="Search visitors…" emptyMessage="No visitors in this period." /></CardContent>
              </Card>
            </TabsContent>

            {/* ── Phone calls ── */}
            <TabsContent value="calls" className="space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <Kpi title="Inbound" value={r.calls.inbound} />
                <Kpi title="Outbound" value={r.calls.outbound} />
                <Kpi title="Answer rate" value={`${r.calls.answerRate}%`} hint={<span className="text-xs text-muted-foreground">of inbound calls</span>} tone={r.calls.answerRate < 80 && r.calls.inbound ? 'warn' : undefined} />
                <Kpi title="Missed" value={r.calls.missed} tone={r.calls.missed ? 'bad' : undefined} hint={<Delta cur={r.calls.missed} prev={r.previous.missedCalls} invert />} />
                <Kpi title="Avg duration" value={fmtSecs(r.calls.avgDurationSec)} hint={<span className="text-xs text-muted-foreground">completed calls</span>} />
                <Kpi title="Talk time" value={fmtMins(Math.round(r.calls.totalTalkSec / 60))} hint={<span className="text-xs text-muted-foreground">peak {r.calls.peakHour == null ? '—' : hourLabel(r.calls.peakHour)}</span>} />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard title="Calls by hour (inbound vs outbound)" empty={!r.calls.total}>
                  <HourChart data={r.calls.byHour} keys={[{ key: 'inbound', name: 'Inbound', color: C.inbound }, { key: 'outbound', name: 'Outbound', color: C.outbound }]} />
                </ChartCard>
                <ChartCard title="Missed calls by hour" empty={!r.calls.missed}>
                  <HourChart data={r.calls.byHour} keys={[{ key: 'missed', name: 'Missed', color: C.missed }]} />
                </ChartCard>
                <ChartCard title="Call status" empty={!r.calls.total}><Donut rows={r.calls.byStatus} /></ChartCard>
                <ChartCard title="Calls by weekday" empty={!r.calls.total}><WeekdayChart data={r.calls.byWeekday} color={C.calls} /></ChartCard>
                <ChartCard title="Subjects" empty={!r.calls.bySubject.length}><HBar rows={r.calls.bySubject} color={C.calls} /></ChartCard>
                <ChartCard title="Outcomes" empty={!r.calls.byOutcome.length}><HBar rows={r.calls.byOutcome} color="#14b8a6" /></ChartCard>
              </div>
              <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Most frequent contacts</CardTitle></CardHeader><CardContent><RankTable rows={r.calls.topContacts} header="Contact" /></CardContent></Card>
              <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Call log</CardTitle></CardHeader>
                <CardContent><DataTable<CallRow> columns={callCols} data={r.rows.calls} getRowId={(x) => x.id} pageSize={25} searchPlaceholder="Search calls…" emptyMessage="No calls in this period." /></CardContent>
              </Card>
            </TabsContent>

            {/* ── Complaints ── */}
            <TabsContent value="complaints" className="space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <Kpi title="Received" value={r.complaints.total} />
                <Kpi title="Resolved / closed" value={r.complaints.resolved} hint={<span className="text-xs text-muted-foreground">{r.complaints.resolutionRate}% resolution rate</span>} />
                <Kpi title="Open" value={r.complaints.open} tone={r.complaints.open ? 'warn' : undefined} hint={<span className="text-xs text-muted-foreground">{r.complaints.unassignedOpen} unassigned</span>} />
                <Kpi title="Overdue" value={r.complaints.overdueCount} tone={r.complaints.overdueCount ? 'bad' : undefined} hint={<span className="text-xs text-muted-foreground">open &gt; {r.thresholds.complaintSlaDays} days</span>} />
                <Kpi title="Urgent / high open" value={r.complaints.urgentOpen} tone={r.complaints.urgentOpen ? 'bad' : undefined} hint={<span className="text-xs text-muted-foreground">{r.complaints.escalated} escalated</span>} />
                <Kpi title="Median resolution" value={fmtHours(r.complaints.medianResolutionHours)} hint={<span className="text-xs text-muted-foreground">avg {fmtHours(r.complaints.avgResolutionHours)}</span>} />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard title="Received vs resolved" empty={!r.complaints.total}>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={trend}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted" />
                      <XAxis dataKey="label" fontSize={11} minTickGap={16} />
                      <YAxis allowDecimals={false} fontSize={11} />
                      <Tooltip {...tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="complaints" name="Received" fill={C.complaints} />
                      <Bar dataKey="resolvedComplaints" name="Resolved" fill={C.resolved} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
                <ChartCard title="By category" empty={!r.complaints.total}><HBar rows={r.complaints.byCategory} /></ChartCard>
                <ChartCard title="By status" empty={!r.complaints.total}><Donut rows={r.complaints.byStatus} /></ChartCard>
                <ChartCard title="By priority" empty={!r.complaints.total}><Donut rows={r.complaints.byPriority} /></ChartCard>
                <ChartCard title="Age of unresolved complaints" empty={!r.complaints.open}><HBar rows={r.complaints.aging} color={C.complaints} height={200} /></ChartCard>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Performance by category</CardTitle></CardHeader>
                  <CardContent>
                    {r.complaints.categoryPerformance.length ? (
                      <table className="w-full text-sm">
                        <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground"><th className="py-1.5">Category</th><th className="text-right">Total</th><th className="text-right">Resolved</th><th className="text-right">Rate</th><th className="text-right">Avg time</th></tr></thead>
                        <tbody>{r.complaints.categoryPerformance.map((c) => (
                          <tr key={c.key} className="border-b last:border-0">
                            <td className="py-1.5">{label(c.key)}</td><td className="text-right tabular-nums">{c.total}</td><td className="text-right tabular-nums">{c.resolved}</td>
                            <td className={`text-right tabular-nums ${c.resolutionRate < 50 ? 'text-red-600' : ''}`}>{c.resolutionRate}%</td><td className="text-right">{fmtHours(c.avgResolutionHours)}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    ) : <p className="py-6 text-center text-sm text-muted-foreground">No data for this selection.</p>}
                  </CardContent>
                </Card>
              </div>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Overdue complaints (open &gt; {r.thresholds.complaintSlaDays} days)</CardTitle></CardHeader>
                <CardContent>
                  {r.complaints.overdue.length ? (
                    <table className="w-full text-sm">
                      <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground"><th className="py-1.5">Subject</th><th>Category</th><th>Priority</th><th>Status</th><th>Received</th><th className="text-right">Age (days)</th></tr></thead>
                      <tbody>{r.complaints.overdue.map((o) => (
                        <tr key={o.id} className="border-b last:border-0">
                          <td className="py-1.5">{o.subject}</td><td>{label(o.category)}</td><td>{pill(o.priority)}</td><td>{pill(o.status)}</td><td>{fmtDateTime(o.receivedAt)}</td>
                          <td className="text-right font-medium text-red-600">{o.ageDays}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  ) : <p className="py-6 text-center text-sm text-muted-foreground">No overdue complaints.</p>}
                </CardContent>
              </Card>
              <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Complaint register</CardTitle></CardHeader>
                <CardContent><DataTable<ComplaintRow> columns={complaintCols} data={r.rows.complaints} getRowId={(x) => x.id} pageSize={25} searchPlaceholder="Search complaints…" emptyMessage="No complaints in this period." /></CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}

function Attention({ n, text, onClick }: { n: number; text: string; onClick: () => void }) {
  if (!n) return null;
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left hover:bg-muted/50">
      <span className="min-w-8 rounded bg-red-100 px-2 py-0.5 text-center text-sm font-semibold text-red-700 dark:bg-red-950 dark:text-red-300">{n}</span>
      <span>{text}</span>
    </button>
  );
}
