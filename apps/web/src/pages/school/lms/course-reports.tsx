import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Activity, ArrowLeft, BarChart3, Eye, EyeOff, ListTree, ScrollText, TrendingDown, Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  useLmsActivityReport, useLmsCoursePage, useLmsEngagement, useLmsLogs, useLmsNotViewed,
  useLmsOutline, useLmsParticipation,
} from '@/features/school/api';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { activityUi } from '@/features/school/lms/activities/registry';
import type { CoursePageView } from '@/features/school/lms/types';

type Tab = 'engagement' | 'activity' | 'participation' | 'outline' | 'logs';

const TABS: { key: Tab; label: string }[] = [
  { key: 'engagement', label: 'Engagement' },
  { key: 'activity', label: 'Activity' },
  { key: 'participation', label: 'Participation' },
  { key: 'outline', label: 'Outline' },
  { key: 'logs', label: 'Logs' },
];

/**
 * Course reports (L6).
 *
 * Every figure is a read model over `LmsEvent`, the standard log the plugin base
 * already writes on every mutation — no reporting tables, so nothing can drift out
 * of step with what actually happened.
 */
export function SchoolLmsCourseReportsPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>('engagement');

  const { data: page } = useLmsCoursePage(id);
  const course = (page as CoursePageView | undefined)?.course;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => nav(`/school/lms/courses/${id}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <BarChart3 className="h-5 w-5" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">Reports</h1>
          <p className="truncate text-sm text-muted-foreground">{course?.name}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm ${tab === t.key ? 'border-b-2 border-primary font-medium' : 'text-muted-foreground'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'engagement' && <Engagement id={id} />}
      {tab === 'activity' && <ActivityReport id={id} />}
      {tab === 'participation' && <Participation id={id} />}
      {tab === 'outline' && <Outline id={id} />}
      {tab === 'logs' && <Logs id={id} />}
    </div>
  );
}

/** Who has stopped working — sorted so the quietest pupils surface first. */
function Engagement({ id }: { id: string }) {
  const { data, isLoading } = useLmsEngagement(id);
  const rows: any[] = (data as any[]) ?? [];
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const silent = rows.filter((r) => !r.lastSeen).length;

  return (
    <div className="space-y-3">
      {silent > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-center gap-2 py-3 text-sm">
            <TrendingDown className="h-4 w-4 text-amber-600" />
            {silent} pupil(s) have never opened this course.
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="overflow-x-auto py-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-4">Pupil</th>
                <th className="px-3 py-2">Events</th>
                <th className="px-3 py-2">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.studentProfileId} className="border-b">
                  <td className="py-2 pr-4">
                    <span className="block">{r.studentName}</span>
                    {r.admissionNo && <span className="text-xs text-muted-foreground">{r.admissionNo}</span>}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{r.events}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.lastSeen
                      ? new Date(r.lastSeen).toLocaleDateString()
                      : <Badge variant="outline" className="text-[10px]">Never</Badge>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={3} className="py-6 text-center text-muted-foreground">No enrolled pupils.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

/** Which activities are actually being used. */
function ActivityReport({ id }: { id: string }) {
  const { data, isLoading } = useLmsActivityReport(id);
  const rows: any[] = (data as any[]) ?? [];
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (rows.length === 0) {
    return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
      No activity recorded yet.
    </CardContent></Card>;
  }
  const max = Math.max(...rows.map((r) => r.total), 1);

  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4" />Activity</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((r) => {
          const Icon = activityUi(r.activityType).icon;
          return (
            <div key={r.courseModuleId} className="space-y-1">
              <div className="flex items-center gap-2 text-sm">
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Eye className="h-3 w-3" />{r.counts.viewed ?? 0}
                </span>
                <span className="tabular-nums text-xs text-muted-foreground">{r.total}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${(r.total / max) * 100}%` }} />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/**
 * Participation — who did what, per action.
 *
 * The server groups `LmsEvent` by pupil and action; the names come from the
 * engagement report, which is the one call that already resolves them. Reading
 * raw uuid rows was the reason this report had no screen.
 */
function Participation({ id }: { id: string }) {
  const [action, setAction] = useState<string>('__all__');
  const { data, isLoading } = useLmsParticipation(id, action === '__all__' ? undefined : action);
  const { data: engagement } = useLmsEngagement(id);

  const rows: any[] = (data as any[]) ?? [];
  const names = new Map<string, { name: string; admissionNo: string | null }>(
    ((engagement as any[]) ?? []).map((e) => [e.studentProfileId, { name: e.studentName, admissionNo: e.admissionNo }]),
  );

  // Actions present in the data, so the filter never offers an empty option.
  const actions = Array.from(new Set(rows.map((r) => r.action))).sort();

  const byStudent = new Map<string, { total: number; counts: Record<string, number> }>();
  for (const r of rows) {
    const cur = byStudent.get(r.studentProfileId) ?? { total: 0, counts: {} };
    cur.counts[r.action] = (cur.counts[r.action] ?? 0) + r._count._all;
    cur.total += r._count._all;
    byStudent.set(r.studentProfileId, cur);
  }
  const ordered = Array.from(byStudent.entries()).sort((a, b) => b[1].total - a[1].total);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All actions</SelectItem>
            {actions.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Card>
        <CardContent className="overflow-x-auto py-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-4">Pupil</th>
                {actions.map((a) => <th key={a} className="px-3 py-2">{a}</th>)}
                <th className="px-3 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map(([studentProfileId, agg]) => (
                <tr key={studentProfileId} className="border-b">
                  <td className="py-2 pr-4">
                    <span className="block">{names.get(studentProfileId)?.name ?? 'Unknown pupil'}</span>
                    {names.get(studentProfileId)?.admissionNo && (
                      <span className="text-xs text-muted-foreground">{names.get(studentProfileId)!.admissionNo}</span>
                    )}
                  </td>
                  {actions.map((a) => (
                    <td key={a} className="px-3 py-2 tabular-nums">{agg.counts[a] ?? 0}</td>
                  ))}
                  <td className="px-3 py-2 font-medium tabular-nums">{agg.total}</td>
                </tr>
              ))}
              {ordered.length === 0 && (
                <tr><td colSpan={actions.length + 2} className="py-6 text-center text-muted-foreground">
                  Nothing recorded yet.
                </td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Course outline — every activity with when it was last touched, and a follow-up
 * list of pupils who have never opened the one you select. That last list is the
 * point of the report: "nobody has opened week 6" is only actionable with names.
 */
function Outline({ id }: { id: string }) {
  const [picked, setPicked] = useState<string | null>(null);
  const { data, isLoading } = useLmsOutline(id);
  const { data: notViewed, isLoading: loadingNotViewed } = useLmsNotViewed(id, picked ?? undefined);
  const rows: any[] = (data as any[]) ?? [];

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (rows.length === 0) {
    return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
      This course has no activities yet.
    </CardContent></Card>;
  }

  return (
    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_280px]">
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="flex items-center gap-2 text-base"><ListTree className="h-4 w-4" />Outline</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y">
            {rows.map((r) => {
              const Icon = activityUi(r.activityType).icon;
              const last = r.activity?._max?.createdAt ?? null;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setPicked(r.id)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50 ${
                      picked === r.id ? 'bg-primary/10' : ''
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {last ? new Date(last).toLocaleDateString() : 'never opened'}
                    </span>
                    <Badge variant="outline" className="text-[10px] tabular-nums">
                      {r.activity?._count?._all ?? 0}
                    </Badge>
                  </button>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="flex items-center gap-2 text-base"><EyeOff className="h-4 w-4" />Not opened</CardTitle>
        </CardHeader>
        <CardContent>
          {!picked && <p className="text-sm text-muted-foreground">Pick an activity to see who has not opened it.</p>}
          {picked && loadingNotViewed && <p className="text-sm text-muted-foreground">Loading…</p>}
          {picked && !loadingNotViewed && ((notViewed as any[]) ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Everyone enrolled has opened this.</p>
          )}
          <ul className="space-y-1 text-sm">
            {((notViewed as any[]) ?? []).map((s) => (
              <li key={s.studentProfileId} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{s.studentName}</span>
                {s.admissionNo && <span className="text-xs text-muted-foreground">{s.admissionNo}</span>}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

/** The standard log, newest first — the audit trail behind every other report. */
function Logs({ id }: { id: string }) {
  const [action, setAction] = useState<string>('__all__');
  const { data, isLoading } = useLmsLogs(id, action === '__all__' ? {} : { action });
  const rows: any[] = (data as any[]) ?? [];
  const actions = Array.from(new Set(rows.map((r) => r.action))).sort();

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ScrollText className="h-4 w-4 text-muted-foreground" />
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All actions</SelectItem>
            {actions.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">Most recent 500 events</span>
      </div>
      <Card>
        <CardContent className="overflow-x-auto py-3">
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-4">When</th>
                <th className="px-3 py-2">Event</th>
                <th className="px-3 py-2">Component</th>
                <th className="px-3 py-2">Target</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b">
                  <td className="whitespace-nowrap py-2 pr-4 text-xs">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">{r.eventName}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{r.component}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{r.target}</td>
                </tr>
              ))}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">No events logged.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
