import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, BookOpen, Clock, GraduationCap, TrendingUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLmsMyDashboard, useLmsMyChildren } from '@/features/school/api';
import { activityUi } from '@/features/school/lms/activities/registry';
import { formatDue } from '@/features/school/lms/activities/shared';

/**
 * "My learning" (L3.1) — the learner's home.
 *
 * The first student-facing LMS surface in the app: until now every `/school/lms/*`
 * route was staff-only, so a pupil had no way in. A guardian sees the same page
 * with a child picker; which children they may pick is decided server-side from
 * their guardianships, never from the URL.
 */
export function SchoolLmsMyLearningPage() {
  const nav = useNavigate();
  const [child, setChild] = useState<string | undefined>(undefined);
  const { data: children } = useLmsMyChildren();
  const { data, isLoading, error } = useLmsMyDashboard(child);

  const kids: any[] = (children as any[]) ?? [];
  const dash: any = data;

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
  const due: any[] = dash?.dueSoon ?? [];
  const grades: any[] = dash?.recentGrades ?? [];

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

      {/* Due soon — only work that is open, unsubmitted and actually actionable. */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4" />Due soon
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {due.length === 0 && <p className="py-4 text-sm text-muted-foreground">Nothing due in the next two weeks.</p>}
          {due.map((d) => {
            const Icon = activityUi(d.activityType).icon;
            return (
              <button
                key={d.id}
                onClick={() => nav(`/school/lms/modules/${d.id}${child ? `?asStudent=${child}` : ''}`)}
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted/50"
              >
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{d.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{d.courseName}</span>
                </span>
                <span className={`flex items-center gap-1 whitespace-nowrap text-xs ${d.overdue ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {d.overdue && <AlertTriangle className="h-3.5 w-3.5" />}
                  {formatDue(d.dueAt)}
                </span>
              </button>
            );
          })}
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
                onClick={() => nav(`/school/lms/courses/${c.id}${child ? `?asStudent=${child}` : ''}`)}
              >
                <CardContent className="space-y-3 py-4">
                  <div>
                    <p className="truncate text-sm font-medium">{c.subject ?? c.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[c.className, c.term].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  {c.progress?.tracked > 0 ? (
                    <div className="space-y-1">
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${c.progress.percent}%` }} />
                      </div>
                      <p className="text-xs tabular-nums text-muted-foreground">
                        {c.progress.completed}/{c.progress.tracked} done · {c.progress.percent}%
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No tracked activities yet</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

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

      {dash?.viewingAs === 'guardian' && (
        <p className="text-center text-xs text-muted-foreground">
          You are viewing as a parent. You can see your child&rsquo;s work and results, but cannot submit on their behalf.
        </p>
      )}
    </div>
  );
}

