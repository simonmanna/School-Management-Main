import { Clock, Megaphone, ClipboardList } from 'lucide-react';
import { useActiveStudent } from '@/stores/auth.store';
import { useStudentDashboard } from '@/lib/portal-api';
import { Card, CardContent, CardHeader, CardTitle, Skeleton, Empty, PageTitle, Badge } from '@/components/ui';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * The pupil's home screen: what is happening today, and what is due.
 *
 * Today's lessons are filtered client-side from the week's timetable the
 * dashboard already returns, rather than asking the server for a second, nearly
 * identical payload.
 */
export default function StudentHome() {
  const active = useActiveStudent();
  const { data, isLoading } = useStudentDashboard(active?.studentProfileId);

  if (isLoading) {
    return <div className="space-y-3"><Skeleton className="h-8 w-40" /><Skeleton className="h-40 w-full" /></div>;
  }
  if (!data?.profile) return <Empty title="Your pupil record is not set up yet" hint="Ask the school office." />;

  const todayIndex = new Date().getDay();
  const today = (data.timetable ?? []).filter((s) => s.dayOfWeek === todayIndex);
  const open = (data.assignments ?? []).filter((a) => a.status !== 'submitted' && a.status !== 'graded');

  return (
    <div className="space-y-4">
      <PageTitle sub={data.profile.currentClass?.name ?? undefined}>
        {data.profile.partner?.name ?? 'Your day'}
      </PageTitle>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4" /> {DAY_NAMES[todayIndex]}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          {today.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {todayIndex === 0 || todayIndex === 6 ? 'No lessons at the weekend.' : 'No lessons timetabled today.'}
            </p>
          )}
          {today.map((slot) => (
            <div key={slot.id} className="flex items-center gap-3 rounded-lg border p-3">
              <div className="w-20 shrink-0 text-sm font-medium tabular-nums text-muted-foreground">
                {slot.period?.startTime ?? '—'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{slot.subject?.name ?? 'Lesson'}</div>
                {slot.room && <div className="truncate text-xs text-muted-foreground">Room {slot.room}</div>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="h-4 w-4" /> Work to hand in
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          {open.length === 0 && <p className="text-sm text-muted-foreground">Nothing outstanding.</p>}
          {open.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-lg border p-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{a.title}</div>
                {a.dueDate && (
                  <div className="text-xs text-muted-foreground">
                    Due {new Date(a.dueDate).toLocaleDateString()}
                  </div>
                )}
              </div>
              <Badge variant="secondary">{a.status}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Megaphone className="h-4 w-4" /> Notices
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          {(data.announcements ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Nothing new.</p>
          )}
          {(data.announcements ?? []).slice(0, 5).map((a) => (
            <div key={a.id} className="rounded-lg border p-3">
              <p className="font-medium leading-tight">{a.title}</p>
              <p className="pt-1 text-sm text-muted-foreground">{a.body}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
