import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, Award, BookOpen, CalendarDays, Clock, GraduationCap, Medal, TrendingUp,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLmsMyBadges, useLmsMyChildren, useLmsMyDashboard } from '@/features/school/api';
import { activityUi } from '@/features/school/lms/activities/registry';
import { formatDue } from '@/features/school/lms/activities/shared';

/**
 * "My learning" (L3.1) — the learner's home.
 *
 * The first student-facing LMS surface in the app: until now every `/school/lms/*`
 * route was staff-only, so a pupil had no way in. A guardian sees the same page
 * with a child picker; which children they may pick is decided server-side from
 * their guardianships, never from the URL.
 *
 * Deadlines are grouped into a TIMELINE (overdue / today / this week / later)
 * rather than one flat list — a pupil with eleven pieces of homework needs to
 * know which two are today, and a flat list buries that.
 */
export function SchoolLmsMyLearningPage() {
  const nav = useNavigate();
  const [child, setChild] = useState<string | undefined>(undefined);
  const { data: children } = useLmsMyChildren();
  const { data, isLoading, error } = useLmsMyDashboard(child);
  const { data: badgeData } = useLmsMyBadges(child);

  const kids: any[] = (children as any[]) ?? [];
  const dash: any = data;

  const due: any[] = dash?.dueSoon ?? [];
  const buckets = useMemo(() => groupByUrgency(due), [due]);

  if (isLoading) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  if (error) {
    return (
      <Card className="m-4"><CardContent className="py-10 text-center">
        <p className="text-sm text-muted-foreground">
          {(error as any)?.response?.data?.message ?? 'This dashboard is not available for your account.'}
        </p>
      </CardContent></Card>
    );
  }

  const courses: any[] = dash?.courses ?? [];
  const grades: any[] = dash?.recentGrades ?? [];
  const badges: any[] = (badgeData as any[]) ?? dash?.badges ?? [];
  const overdue = due.filter((d) => d.overdue).length;

  // One overall progress figure across every course, from tracked completions —
  // not a count of activities that merely exist.
  const tracked = courses.reduce((n, c) => n + (c.progress?.tracked ?? 0), 0);
  const completed = courses.reduce((n, c) => n + (c.progress?.completed ?? 0), 0);
  const overall = tracked > 0 ? Math.round((completed / tracked) * 100) : null;

  const link = (path: string) => `${path}${child ? `?asStudent=${child}` : ''}`;

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <GraduationCap className="h-6 w-6" />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">My learning</h1>
          {dash?.student?.name && (
            <p className="text-sm text-muted-foreground">
              {dash.student.name}
              {dash.student.admissionNo ? ` · ${dash.student.admissionNo}` : ''}
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => nav(link('/school/lms/calendar'))}>
          <CalendarDays className="mr-1 h-4 w-4" />Calendar
        </Button>
        {/* Guardians with more than one child switch here. */}
        {kids.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {kids.map((k) => (
              <button
                key={k.studentProfileId}
                onClick={() => setChild(k.studentProfileId)}
                className={`rounded border px-2 py-1 text-xs ${
                  (child ?? kids[0]?.studentProfileId) === k.studentProfileId
                    ? 'border-primary bg-primary/10' : 'bg-card'
                }`}
              >
                {k.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Courses" value={String(courses.length)} icon={BookOpen} />
        <StatTile
          label="Due soon"
          value={String(due.length)}
          icon={Clock}
          tone={overdue > 0 ? 'warn' : undefined}
          hint={overdue > 0 ? `${overdue} overdue` : undefined}
        />
        <StatTile label="Progress" value={overall == null ? '—' : `${overall}%`} icon={TrendingUp} />
        <StatTile label="Badges" value={String(badges.length)} icon={Award} />
      </div>

      {/* Timeline — only work that is open, unsubmitted and actually actionable. */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4" />Timeline
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {due.length === 0 && (
            <p className="py-4 text-sm text-muted-foreground">Nothing due in the next two weeks.</p>
          )}
          {buckets.map(({ label, items, tone }) => (
            items.length === 0 ? null : (
              <div key={label} className="space-y-1">
                <p className={`text-xs font-medium uppercase tracking-wide ${
                  tone === 'warn' ? 'text-destructive' : 'text-muted-foreground'
                }`}>
                  {label} <span className="tabular-nums">({items.length})</span>
                </p>
                {items.map((d) => {
                  const Icon = activityUi(d.activityType).icon;
                  return (
                    <button
                      key={d.id}
                      onClick={() => nav(link(`/school/lms/modules/${d.id}`))}
                      className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted/50"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{d.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{d.courseName}</span>
                      </span>
                      <span className={`flex items-center gap-1 whitespace-nowrap text-xs ${
                        d.overdue ? 'text-destructive' : 'text-muted-foreground'
                      }`}>
                        {d.overdue && <AlertTriangle className="h-3.5 w-3.5" />}
                        {formatDue(d.dueAt)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )
          ))}
        </CardContent>
      </Card>

      {/* Courses with real progress, computed from completion rather than module count. */}
      <div>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-medium">
          <BookOpen className="h-4 w-4" />My courses
        </h2>
        {courses.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
            You are not enrolled in any courses yet.
          </CardContent></Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {courses.map((c) => (
              <Card
                key={c.id}
                className="cursor-pointer transition hover:border-primary/50"
                onClick={() => nav(link(`/school/lms/courses/${c.id}`))}
              >
                <CardContent className="flex items-center gap-3 py-4">
                  <ProgressRing percent={c.progress?.tracked > 0 ? c.progress.percent : null} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.subject ?? c.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[c.className, c.term].filter(Boolean).join(' · ')}
                    </p>
                    <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                      {c.progress?.tracked > 0
                        ? `${c.progress.completed}/${c.progress.tracked} activities done`
                        : 'No tracked activities yet'}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Only APPROVED marks reach this list — see LearnerService.recentGrades. */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4" />Recent results
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {grades.length === 0 && <p className="py-4 text-sm text-muted-foreground">No results released yet.</p>}
            {grades.map((g) => (
              <div key={g.assessmentId} className="flex items-center gap-3 px-2 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{g.title}</span>
                <span className="tabular-nums">{g.score}/{g.maxScore}</span>
                {g.percentage != null && <Badge variant="secondary">{g.percentage}%</Badge>}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Award className="h-4 w-4" />Badges
            </CardTitle>
          </CardHeader>
          <CardContent>
            {badges.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">No badges yet.</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {badges.map((b: any) => (
                  <li key={b.id} className="flex items-center gap-2 rounded border p-2">
                    {b.imageUrl ? (
                      <img src={b.imageUrl} alt="" className="h-8 w-8 rounded object-cover" />
                    ) : (
                      <span className="flex h-8 w-8 items-center justify-center rounded bg-muted">
                        <Medal className="h-4 w-4 text-muted-foreground" />
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{b.name ?? b.badge?.name}</span>
                      {b.awardedAt && (
                        <span className="block text-[11px] text-muted-foreground">
                          {new Date(b.awardedAt).toLocaleDateString()}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {dash?.viewingAs === 'guardian' && (
        <p className="text-center text-xs text-muted-foreground">
          You are viewing as a parent. You can see your child&rsquo;s work and results, but cannot submit on their behalf.
        </p>
      )}
    </div>
  );
}

/** Overdue first, then today, this week, later — the order a pupil acts in. */
function groupByUrgency(due: any[]): { label: string; items: any[]; tone?: 'warn' }[] {
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).getTime();
  const endOfWeek = endOfToday + 6 * 86400000;

  const overdue: any[] = [];
  const today: any[] = [];
  const week: any[] = [];
  const later: any[] = [];

  for (const d of due) {
    const at = d.dueAt ? new Date(d.dueAt).getTime() : null;
    if (d.overdue) overdue.push(d);
    else if (at == null) later.push(d);
    else if (at <= endOfToday) today.push(d);
    else if (at <= endOfWeek) week.push(d);
    else later.push(d);
  }
  return [
    { label: 'Overdue', items: overdue, tone: 'warn' },
    { label: 'Today', items: today },
    { label: 'This week', items: week },
    { label: 'Later', items: later },
  ];
}

function StatTile({
  label, value, icon: Icon, tone, hint,
}: {
  label: string; value: string; icon: any; tone?: 'warn'; hint?: string;
}) {
  return (
    <Card className={tone === 'warn' ? 'border-amber-500/40 bg-amber-500/5' : undefined}>
      <CardContent className="flex items-center gap-3 py-4">
        <Icon className={`h-5 w-5 ${tone === 'warn' ? 'text-amber-600' : 'text-muted-foreground'}`} />
        <div className="min-w-0">
          <p className="text-lg font-semibold tabular-nums leading-none">{value}</p>
          <p className="truncate text-xs text-muted-foreground">{hint ?? label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

/** Progress as a ring. `null` means nothing is completion-tracked, not zero done. */
function ProgressRing({ percent }: { percent: number | null }) {
  const size = 44;
  const stroke = 4;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = percent ?? 0;

  return (
    <svg width={size} height={size} className="shrink-0" role="img" aria-label={percent == null ? 'Not tracked' : `${pct}% complete`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-muted" />
      {percent != null && (
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          className="stroke-primary"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      )}
      <text
        x="50%" y="50%" dominantBaseline="central" textAnchor="middle"
        className="fill-foreground text-[10px] font-medium tabular-nums"
      >
        {percent == null ? '—' : `${pct}%`}
      </text>
    </svg>
  );
}
