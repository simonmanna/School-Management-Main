import { useNavigate } from 'react-router-dom';
import { AlertTriangle, BookMarked, CalendarRange, CheckCircle2, ClipboardList, NotebookPen, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { WorkspaceOverview } from '@/features/school/teaching-api';
import { useCourseCoverage } from '@/features/school/teaching-api';
import { EmptyState, Progress, fmtDate } from '../_components/exam-workflow';

/** Where the week stands: what is planned, what was taught, what is owed. */
export function OverviewTab({
  offeringId, overview, isLoading, onGoTo,
}: {
  offeringId: string;
  overview?: WorkspaceOverview;
  isLoading: boolean;
  onGoTo: (tab: string) => void;
}) {
  const navigate = useNavigate();
  const { data: coverage } = useCourseCoverage(offeringId);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!overview) return <EmptyState title="Nothing to show yet" hint="This course has no teaching record." />;

  const { delivery, plans, scheme } = overview;
  const planTotal = Object.values(plans).reduce((n, v) => n + v, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Lessons delivered" value={`${delivery.delivered}/${delivery.scheduled}`} sub={`${delivery.deliveryPct}% of scheduled`} icon={<CalendarRange className="h-4 w-4" />} />
        <Tile label="Scheme covered" value={scheme ? `${scheme.progress.coveragePct}%` : '—'} sub={scheme ? `${scheme.progress.coveredWeeks}/${scheme.progress.totalWeeks} weeks` : 'No scheme of work'} icon={<BookMarked className="h-4 w-4" />} />
        <Tile label="Curriculum taught" value={coverage ? `${coverage.totals.deliveredPct}%` : '—'} sub={coverage ? `${coverage.totals.delivered}/${coverage.totals.total} outcomes` : ''} icon={<ClipboardList className="h-4 w-4" />} />
        <Tile label="Learners" value={String(overview.learners)} sub={`${overview.openFollowUps} open follow-ups`} icon={<Users className="h-4 w-4" />} tone={overview.openFollowUps > 0 ? 'warn' : 'plain'} />
      </div>

      {(overview.lessonsNeedingPlan > 0 || overview.lessonsNeedingReflection > 0 || delivery.outstanding > 0 || !scheme) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-amber-500" /> To close the week</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {!scheme && <Todo text="No scheme of work yet — lay out the term." action={<Button size="sm" variant="outline" onClick={() => onGoTo('plan')}>Open Plan</Button>} />}
            {delivery.outstanding > 0 && <Todo text={`${delivery.outstanding} scheduled lesson(s) not yet confirmed as delivered.`} action={<Button size="sm" variant="outline" onClick={() => onGoTo('lessons')}>Open Lessons</Button>} />}
            {overview.lessonsNeedingPlan > 0 && <Todo text={`${overview.lessonsNeedingPlan} lesson(s) have no plan attached.`} action={<Button size="sm" variant="outline" onClick={() => onGoTo('lessons')}>Attach plans</Button>} />}
            {overview.lessonsNeedingReflection > 0 && <Todo text={`${overview.lessonsNeedingReflection} delivered lesson(s) have no reflection.`} action={<Button size="sm" variant="outline" onClick={() => onGoTo('lessons')}>Reflect</Button>} />}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><CalendarRange className="h-4 w-4" /> Next lessons</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {overview.upcoming.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">Nothing scheduled from here on. Generate the week under Lessons.</p>
            ) : (
              overview.upcoming.map((lesson) => (
                <div key={lesson.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <span>{fmtDate(lesson.plannedDate)}</span>
                  <div className="flex items-center gap-2">
                    {!lesson.lessonPlanId && <Badge variant="outline">No plan</Badge>}
                    <Badge variant="secondary">{lesson.status}</Badge>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><NotebookPen className="h-4 w-4" /> Lesson plans</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {planTotal === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No lesson plans on this course yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {Object.entries(plans).map(([status, count]) => (
                  <div key={status} className="rounded-md border px-3 py-1.5 text-center">
                    <div className="text-lg font-semibold">{count}</div>
                    <div className="text-xs capitalize text-muted-foreground">{status.replaceAll('_', ' ')}</div>
                  </div>
                ))}
              </div>
            )}
            <Button size="sm" variant="ghost" onClick={() => navigate('/school/lms/lesson-plans')}>Open lesson planner</Button>
          </CardContent>
        </Card>
      </div>

      {coverage && coverage.totals.total > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4" /> Curriculum coverage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <CoverageRow label="Planned" done={coverage.totals.planned} total={coverage.totals.total} />
            <CoverageRow label="Taught" done={coverage.totals.delivered} total={coverage.totals.total} />
            <CoverageRow label="Assessed" done={coverage.totals.assessed} total={coverage.totals.total} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CoverageRow({ label, done, total }: { label: string; done: number; total: number }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="w-20 text-muted-foreground">{label}</span>
      <Progress done={done} total={total} className="flex-1" />
    </div>
  );
}

function Todo({ text, action }: { text: string; action: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
      <span>{text}</span>
      {action}
    </div>
  );
}

function Tile({ label, value, sub, icon, tone = 'plain' }: { label: string; value: string; sub?: string; icon: React.ReactNode; tone?: 'plain' | 'warn' }) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between pt-4">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`text-2xl font-semibold ${tone === 'warn' ? 'text-amber-600' : ''}`}>{value}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
        <div className="text-muted-foreground">{icon}</div>
      </CardContent>
    </Card>
  );
}
