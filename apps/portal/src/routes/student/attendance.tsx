import { useActiveStudent } from '@/stores/auth.store';
import { useStudentDashboard } from '@/lib/portal-api';
import { Card, CardContent, CardHeader, CardTitle, Skeleton, Empty, PageTitle, Stat } from '@/components/ui';

/** The pupil's own attendance record. */
export default function StudentAttendance() {
  const active = useActiveStudent();
  const { data, isLoading } = useStudentDashboard(active?.studentProfileId);

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (!data) return <Empty title="No attendance recorded yet" />;

  const a = data.attendance;

  return (
    <div className="space-y-4">
      <PageTitle>Attendance</PageTitle>
      <Stat
        label="Your attendance"
        value={`${a.rate}%`}
        tone={a.rate >= 90 ? 'good' : a.rate >= 75 ? 'default' : 'bad'}
        sub="Arriving late counts as half a day present"
      />
      <Card>
        <CardHeader><CardTitle className="text-base">This term so far</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-3 gap-3 pt-0 text-center">
          <div className="rounded-lg border p-3">
            <div className="text-2xl font-bold tabular-nums">{a.present}</div>
            <div className="pt-0.5 text-xs text-muted-foreground">Present</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-2xl font-bold tabular-nums">{a.late}</div>
            <div className="pt-0.5 text-xs text-muted-foreground">Late</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-2xl font-bold tabular-nums text-destructive">{a.absent}</div>
            <div className="pt-0.5 text-xs text-muted-foreground">Absent</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
