import { Link } from 'react-router-dom';
import { BookOpen, CalendarClock, ChevronRight, GraduationCap } from 'lucide-react';
import { useActiveStudent } from '@/stores/auth.store';
import { useMyCourses, useDueSoon, useRecentGrades, type DueItem } from '@/lib/portal-api';
import {
  Card, CardContent, CardHeader, CardTitle, Skeleton, Empty, PageTitle, Badge, Stat,
} from '@/components/ui';
import { coursePath } from '@/lib/learner-paths';

/**
 * How my child is getting on.
 *
 * Reads the same self-scoped `school/lms/my/*` routes the learner's own screens
 * use. A guardian names the child with `asStudent`, which the server checks
 * against the live guardianship rather than the token — so revoking a
 * guardianship takes effect at once, not at token expiry.
 *
 * Read-only by design. A parent can see progress, what is coming and what has
 * been released; they cannot submit work, tick completion or sit a quiz, and
 * the API refuses all three regardless of what this screen renders.
 *
 * Marks obey the release rule: a score reaches this page only once moderation
 * has approved it. Anything still with a teacher is simply absent from the
 * released list rather than shown as a blank or a zero.
 */
export default function ParentLearning() {
  const active = useActiveStudent();
  const asStudent = active?.studentProfileId;

  const { data: courses, isLoading, isError, error, refetch } = useMyCourses(asStudent);
  const { data: due } = useDueSoon(asStudent);
  const { data: grades } = useRecentGrades(asStudent);

  const dueItems: DueItem[] = Array.isArray(due) ? due : (due as any)?.items ?? [];
  const list = courses?.courses ?? [];

  if (!asStudent) {
    return <Empty title="No child is linked to this account" hint="Ask the school office to link your children." />;
  }

  if (isLoading) {
    return <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>;
  }

  if (isError) {
    const status = (error as any)?.response?.status;
    if (status === 404) return <Empty title="Online courses are not offered by this school" />;
    return (
      <div className="space-y-2">
        <Empty title="Learning could not be loaded" />
        <button className="text-sm text-primary underline" onClick={() => void refetch()}>Try again</button>
      </div>
    );
  }

  const tracked = list.reduce((n, c) => n + (c.progress?.tracked ?? 0), 0);
  const completed = list.reduce((n, c) => n + (c.progress?.completed ?? 0), 0);
  const overall = tracked > 0 ? Math.round((completed / tracked) * 100) : null;

  return (
    <div className="space-y-4">
      <PageTitle sub={active?.name}>Learning</PageTitle>

      {list.length === 0 ? (
        <Empty
          icon={<BookOpen className="h-8 w-8" />}
          title="No courses yet"
          hint="Courses appear here once a teacher enrols your child."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Courses" value={list.length} />
            <Stat
              label="Work done"
              value={overall === null ? '—' : `${overall}%`}
              sub={tracked > 0 ? `${completed} of ${tracked} activities` : 'Nothing tracked yet'}
            />
          </div>

          {dueItems.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarClock className="h-4 w-4" /> Coming up
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                {dueItems.map((d) => (
                  <div key={d.id} className="flex items-center gap-2 rounded-lg border p-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{d.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {d.courseName ?? ''}
                        {d.dueAt && ` · ${new Date(d.dueAt).toLocaleDateString()}`}
                      </div>
                    </div>
                    <Badge variant={d.overdue ? 'destructive' : 'warning'}>
                      {d.overdue ? 'overdue' : 'to do'}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <section className="space-y-2">
            <h2 className="pt-1 text-base font-semibold">Subjects</h2>
            {list.map((c) => (
              <Link key={c.id} to={coursePath('guardian', c.id)} className="block">
                <Card>
                  <CardContent className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{c.name}</div>
                        {c.subject && <div className="truncate text-xs text-muted-foreground">{c.subject}</div>}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <span className="text-sm font-semibold tabular-nums">
                          {Math.round(c.progress?.percent ?? 0)}%
                        </span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                    <div
                      className="h-2 w-full overflow-hidden rounded-full bg-muted"
                      role="progressbar"
                      aria-valuenow={Math.round(c.progress?.percent ?? 0)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${c.name} progress`}
                    >
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${c.progress?.percent ?? 0}%` }}
                      />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </section>
        </>
      )}

      {grades && grades.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <GraduationCap className="h-4 w-4" /> Marks released
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {grades.map((g) => (
              <div key={g.assessmentId} className="flex items-center gap-2 rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{g.title}</div>
                  <div className="text-xs text-muted-foreground">{new Date(g.at).toLocaleDateString()}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-semibold tabular-nums">
                    {g.score === null ? '—' : `${g.score} / ${g.maxScore}`}
                  </div>
                  {g.percentage !== null && (
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {Math.round(g.percentage)}%
                    </div>
                  )}
                </div>
              </div>
            ))}
            <p className="px-1 pt-1 text-xs text-muted-foreground">
              Only marks the school has released appear here. Work still being marked is not shown.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
