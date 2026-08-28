import { BookOpen, CalendarClock } from 'lucide-react';
import { useAuthStore, useActiveStudent } from '@/stores/auth.store';
import { useMyCourses, useDueSoon, type DueItem } from '@/lib/portal-api';
import { Card, CardContent, CardHeader, CardTitle, Skeleton, Empty, PageTitle, Badge } from '@/components/ui';

/**
 * Courses and what is due.
 *
 * Reads `school/lms/my/*`, which resolves the learner from the token and accepts
 * `asStudent` only for a guardian naming one of their own children. Progress is
 * real completion, not "modules that exist".
 */
export default function StudentCourses() {
  const kind = useAuthStore((s) => s.portal?.kind);
  const active = useActiveStudent();
  // A pupil is their own subject and must not name one; a guardian must.
  const asStudent = kind === 'guardian' ? active?.studentProfileId : undefined;

  const { data: courses, isLoading } = useMyCourses(asStudent);
  const { data: due } = useDueSoon(asStudent);

  const dueItems: DueItem[] = Array.isArray(due) ? due : due?.items ?? [];

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>;

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
              const overdue = d.dueAt ? new Date(d.dueAt) < new Date() : false;
              return (
                <div key={d.id} className="flex items-center gap-2 rounded-lg border p-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{d.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {d.courseName ?? ''}
                      {d.dueAt && ` · ${new Date(d.dueAt).toLocaleDateString()}`}
                    </div>
                  </div>
                  {d.submitted
                    ? <Badge variant="success">handed in</Badge>
                    : <Badge variant={overdue ? 'destructive' : 'warning'}>{overdue ? 'overdue' : 'due'}</Badge>}
                </div>
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
            <Card key={c.courseOfferingId}>
              <CardContent className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{c.name}</div>
                    {c.shortName && <div className="truncate text-xs text-muted-foreground">{c.shortName}</div>}
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">{c.progressPercent}%</span>
                </div>
                <div
                  className="h-2 w-full overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-valuenow={c.progressPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${c.name} progress`}
                >
                  <div className="h-full rounded-full bg-primary" style={{ width: `${c.progressPercent}%` }} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
