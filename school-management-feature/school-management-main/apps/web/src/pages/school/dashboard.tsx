import { Link } from 'react-router-dom';
import { Users, GraduationCap, Building2, BookOpen, DollarSign, Calendar as CalendarIcon } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useOverview, useFinanceDashboard, useCalendar } from '@/features/school/api';

export function SchoolDashboardPage() {
  const { data: overview } = useOverview();
  const { data: finance } = useFinanceDashboard();
  const { data: calendar } = useCalendar();

  const fmt = (n: number) => new Intl.NumberFormat('en-UG', { style: 'currency', currency: 'UGX' }).format(n);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">School Dashboard</h1>
        <p className="text-muted-foreground">Sunrise Academy · Sunrise campus overview</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Students</CardTitle>
            <GraduationCap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{overview?.students ?? '—'}</div>
            <p className="text-xs text-muted-foreground">{overview?.classes ?? '—'} classes</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Staff</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{overview?.staff ?? '—'}</div>
            <p className="text-xs text-muted-foreground">{overview?.campuses ?? '—'} campuses</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Outstanding Fees</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{finance ? fmt(finance.outstanding) : '—'}</div>
            <p className="text-xs text-muted-foreground">
              {finance ? `Collected this month: ${fmt(finance.collectionsThisMonth)}` : '—'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sections</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{overview?.sections ?? '—'}</div>
            <p className="text-xs text-muted-foreground">{overview?.terms ?? '—'} active terms</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Quick links</CardTitle>
            <CardDescription>Common school operations</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <Link to="/school/students" className="rounded border p-3 hover:bg-muted">
              <GraduationCap className="h-4 w-4" /> Students
            </Link>
            <Link to="/school/staff" className="rounded border p-3 hover:bg-muted">
              <Users className="h-4 w-4" /> Staff
            </Link>
            <Link to="/school/attendance" className="rounded border p-3 hover:bg-muted">
              <BookOpen className="h-4 w-4" /> Attendance
            </Link>
            <Link to="/school/fees" className="rounded border p-3 hover:bg-muted">
              <DollarSign className="h-4 w-4" /> Fees
            </Link>
            <Link to="/school/exams" className="rounded border p-3 hover:bg-muted">
              <BookOpen className="h-4 w-4" /> Exams
            </Link>
            <Link to="/school/calendar" className="rounded border p-3 hover:bg-muted">
              <CalendarIcon className="h-4 w-4" /> Calendar
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Upcoming events</CardTitle>
            <CardDescription>This term's calendar</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(calendar ?? []).slice(0, 5).map((e: any) => (
              <div key={e.id} className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{e.title}</div>
                  <div className="text-xs text-muted-foreground">{new Date(e.startDate).toLocaleDateString()}</div>
                </div>
                <Badge>{e.type}</Badge>
              </div>
            ))}
            {(calendar ?? []).length === 0 && <div className="text-sm text-muted-foreground">No upcoming events</div>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}