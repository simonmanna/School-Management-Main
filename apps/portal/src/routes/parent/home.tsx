import { Link } from 'react-router-dom';
import { Wallet, CalendarCheck, Megaphone, ChevronRight } from 'lucide-react';
import { useAuthStore, useActiveStudent } from '@/stores/auth.store';
import { useParentDashboard } from '@/lib/portal-api';
import { formatCurrency } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, Skeleton, Stat, Empty, PageTitle, Badge } from '@/components/ui';

/**
 * The guardian's home screen.
 *
 * Two numbers above the fold: what is owed, and whether the child is turning up.
 * Those are the questions that actually bring a parent here; everything else is
 * one tap away rather than competing for the same space.
 */
export default function ParentHome() {
  const students = useAuthStore((s) => s.portal?.students ?? []);
  const active = useActiveStudent();
  const ids = students.map((c) => c.studentProfileId);
  const { data, isLoading } = useParentDashboard(ids);

  const row = data?.find((r) => r.student.id === active?.studentProfileId) ?? data?.[0];

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!row) {
    return (
      <Empty
        title="No pupil linked to this account"
        hint="Ask the school office to connect your account to your child."
      />
    );
  }

  const owed = Number(row.fees.balance ?? 0);
  const announcements = row.announcements ?? [];

  return (
    <div className="space-y-4">
      <PageTitle sub={row.student.currentClass?.name ?? undefined}>
        {active?.name ?? row.student.partner?.name ?? 'Your child'}
      </PageTitle>

      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="Fees owing"
          value={formatCurrency(owed)}
          tone={owed > 0 ? 'bad' : 'good'}
          sub={owed > 0 ? 'Tap Fees to pay' : 'Fully paid'}
        />
        <Stat
          label="Attendance"
          value={row.attendance.rate == null ? '—' : `${row.attendance.rate}%`}
          tone={row.attendance.rate == null ? 'default' : row.attendance.rate >= 90 ? 'good' : row.attendance.rate >= 75 ? 'default' : 'bad'}
          sub={`${row.attendance.present} of ${row.attendance.total} days`}
        />
      </div>

      <div className="grid gap-2">
        <QuickLink to="/parent/fees" icon={<Wallet className="h-5 w-5" />} label="Fees and payments" />
        <QuickLink to="/parent/attendance" icon={<CalendarCheck className="h-5 w-5" />} label="Attendance record" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Megaphone className="h-4 w-4" /> From the school
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          {announcements.length === 0 && (
            <p className="text-sm text-muted-foreground">No announcements right now.</p>
          )}
          {announcements.slice(0, 5).map((a) => (
            <div key={a.id} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium leading-tight">{a.title}</p>
                {a.publishedAt && (
                  <Badge variant="outline">{new Date(a.publishedAt).toLocaleDateString()}</Badge>
                )}
              </div>
              <p className="pt-1 text-sm text-muted-foreground">{a.body}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function QuickLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      to={to}
      className="tap flex items-center gap-3 rounded-xl border bg-card px-4 py-3 font-medium hover:bg-muted"
    >
      <span className="text-primary">{icon}</span>
      <span className="flex-1">{label}</span>
      <ChevronRight className="h-5 w-5 text-muted-foreground" />
    </Link>
  );
}
