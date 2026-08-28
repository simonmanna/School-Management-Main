import { useAuthStore, useActiveStudent } from '@/stores/auth.store';
import { useParentDashboard } from '@/lib/portal-api';
import { Card, CardContent, CardHeader, CardTitle, Skeleton, Stat, Empty, PageTitle } from '@/components/ui';

/**
 * Attendance, as a guardian sees it.
 *
 * The rate the school uses counts a late arrival as half a day present, which is
 * not obvious from a bare percentage — so the breakdown is shown alongside it
 * rather than leaving a parent to reverse-engineer the figure.
 */
export default function ParentAttendance() {
  const students = useAuthStore((s) => s.portal?.students ?? []);
  const active = useActiveStudent();
  const { data, isLoading } = useParentDashboard(students.map((c) => c.studentProfileId));

  const row = data?.find((r) => r.student.id === active?.studentProfileId) ?? data?.[0];

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (!row) return <Empty title="No attendance recorded yet" />;

  const a = row.attendance;

  return (
    <div className="space-y-4">
      <PageTitle sub={active?.name}>Attendance</PageTitle>

      <Stat
        label="Attendance rate"
        value={`${a.rate}%`}
        tone={a.rate >= 90 ? 'good' : a.rate >= 75 ? 'default' : 'bad'}
        sub="Late arrivals count as half a day present"
      />

      <Card>
        <CardHeader><CardTitle className="text-base">This term so far</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-3 gap-3 text-center">
            <Tally label="Present" value={a.present} />
            <Tally label="Late" value={a.late} />
            <Tally label="Absent" value={a.absent} tone="bad" />
          </div>
          <p className="pt-4 text-sm text-muted-foreground">
            {a.total} school day{a.total === 1 ? '' : 's'} recorded.
            {a.absent > 0 && ' Speak to the class teacher if an absence looks wrong.'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Tally({ label, value, tone }: { label: string; value: number; tone?: 'bad' }) {
  return (
    <div className="rounded-lg border p-3">
      <div className={`text-2xl font-bold tabular-nums ${tone === 'bad' ? 'text-destructive' : ''}`}>{value}</div>
      <div className="pt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
