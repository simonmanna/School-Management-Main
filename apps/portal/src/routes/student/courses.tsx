import { Link } from 'react-router-dom';
import { BookOpen, CalendarClock, ChevronRight } from 'lucide-react';
import { useAuthStore, useActiveStudent } from '@/stores/auth.store';
import { useMyCourses, useDueSoon, type DueItem } from '@/lib/portal-api';
import { Card, CardContent, CardHeader, CardTitle, Skeleton, Empty, PageTitle, Badge } from '@/components/ui';
import { coursePath, modulePath } from '@/lib/learner-paths';

/**
 * Courses and what is due.
 *
 * Reads `school/lms/my/*`, which resolves the learner from the token and accepts
 * `asStudent` only for a guardian naming one of their own children. Progress is
 * real completion, not "modules that exist".
 *
 * Every card is a way in: the list used to be the end of the road, so a pupil
 * could see that homework existed and had no screen on which to do it.
 */
export default function StudentCourses() {
  const kind = useAuthStore((s) => s.portal?.kind);
  const active = useActiveStudent();
  // A pupil is their own subject and must not name one; a guardian must.
  const asStudent = kind === 'guardian' ? active?.studentProfileId : undefined;

  const { data: courses, isLoading, isError, error, refetch } = useMyCourses(asStudent);
  const { data: due } = useDueSoon(asStudent);

  const dueItems: DueItem[] = Array.isArray(due) ? due : (due as any)?.items ?? [];

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>;

  // Audit F14: "unavailable" and "failed" are not "no courses yet".
  if (isError) {
    const status = (error as any)?.response?.status;
    if (status === 404) return <Empty title="Online courses are not offered by this school" />;
    return (
      <div className="space-y-2">
        <Empty title="Courses could not be loaded" />
        <button className="text-sm text-primary underline" onClick={() => void refetch()}>Try again</button>
      </div>
    );
  }

  const list = courses?.courses ?? [];

  return (
    <div className="space-y-4">
      <PageTitle sub={asStudent ? active?.name : undefined}>Courses</PageTitle>

      {dueItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4" /> Due soon
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {dueItems.map((d) => {
              const row = (
                <div className="flex items-center gap-2 rounded-lg border p-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{d.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {d.courseName ?? ''}
                      {d.dueAt && ` · ${new Date(d.dueAt).toLocaleDateString()}`}
                    </div>
                  </div>
                  <Badge variant={d.overdue ? 'destructive' : 'warning'}>{d.overdue ? 'overdue' : 'due'}</Badge>
                </div>
              );
              // Everything on this list is still to do — the server has already
              // dropped work that is handed in, hidden or not yet open.
              return d.courseId ? (
                <Link key={d.id} to={modulePath(kind, d.courseId, d.id)} className="block">
                  {row}
                </Link>
              ) : (
                <div key={d.id}>{row}</div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {list.length === 0 ? (
        <Empty
          icon={<BookOpen className="h-8 w-8" />}
          title="No courses yet"
          hint="Courses appear here once a teacher enrols you."
        />
      ) : (
        <div className="space-y-2">
          {list.map((c) => (
            <Link key={c.id} to={coursePath(kind, c.id)} className="block">
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
        </div>
      )}
    </div>
  );
}
