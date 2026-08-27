import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Activity, ArrowLeft, BarChart3, Eye, TrendingDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLmsActivityReport, useLmsEngagement, useLmsCoursePage } from '@/features/school/api';
import { activityUi } from '@/features/school/lms/activities/registry';
import type { CoursePageView } from '@/features/school/lms/types';

type Tab = 'engagement' | 'activity';

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
    <div className="mx-auto max-w-4xl space-y-4 p-4">
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

      <div className="flex gap-2 border-b">
        {(['engagement', 'activity'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm capitalize ${tab === t ? 'border-b-2 border-primary font-medium' : 'text-muted-foreground'}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'engagement' ? <Engagement id={id} /> : <ActivityReport id={id} />}
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
