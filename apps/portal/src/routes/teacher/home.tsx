import { Link } from 'react-router-dom';
import { Clock, PencilLine, ChevronRight, FileCheck2 } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { useTeacherDashboard } from '@/lib/portal-api';
import { Card, CardContent, CardHeader, CardTitle, Skeleton, Empty, PageTitle, Stat } from '@/components/ui';

/**
 * The teacher's day, from home.
 *
 * Keyed on `staffProfileId` from `GET school/portals/me`, never on an id typed
 * into a URL. The workspace routes are additionally guarded server-side by
 * `EmployeeIdentityService.assertIsTeacherOrAdmin`, so a teacher cannot read a
 * colleague's classes by editing the address bar — which they could, before
 * that check existed.
 */
export default function TeacherHome() {
  const teacher = useAuthStore((s) => s.portal?.teacher);
  const { data, isLoading } = useTeacherDashboard(teacher?.staffProfileId);

  if (!teacher) {
    return (
      <Empty
        title="No teaching record linked"
        hint="Your login is not connected to a staff profile. The school office can link it."
      />
    );
  }
  if (isLoading) return <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-40" /></div>;

  const marking = data?.marking ?? { pendingApprovals: 0, draftMarks: 0 };
  const schedule = data?.todaySchedule ?? [];

  return (
    <div className="space-y-4">
      <PageTitle sub={teacher.name}>Today</PageTitle>

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Draft marks" value={marking.draftMarks} sub="Not yet submitted" />
        <Stat label="Awaiting approval" value={marking.pendingApprovals} sub="With the head of department" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4" /> Your lessons today
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          {schedule.length === 0 && <p className="text-sm text-muted-foreground">Nothing timetabled today.</p>}
          {schedule.map((slot) => (
            <div key={slot.id} className="flex items-center gap-3 rounded-lg border p-3">
              <div className="w-20 shrink-0 text-sm font-medium tabular-nums text-muted-foreground">
                {slot.period?.startTime ?? '—'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{slot.subject?.name ?? 'Lesson'}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {slot.schoolClass?.name ?? ''}{slot.room ? ` · Room ${slot.room}` : ''}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-2">
        <Row to="/teacher/marking" icon={<PencilLine className="h-5 w-5" />} label="Marks to enter" />
        <Row to="/teacher/classes" icon={<FileCheck2 className="h-5 w-5" />} label="My classes" />
      </div>
    </div>
  );
}

function Row({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link to={to} className="tap flex items-center gap-3 rounded-xl border bg-card px-4 py-3 font-medium hover:bg-muted">
      <span className="text-primary">{icon}</span>
      <span className="flex-1">{label}</span>
      <ChevronRight className="h-5 w-5 text-muted-foreground" />
    </Link>
  );
}
