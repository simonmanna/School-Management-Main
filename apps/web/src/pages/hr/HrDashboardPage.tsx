import { useHrDashboard } from '@/features/hr/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';
import { Users, Clock, CalendarCheck, CalendarX2, Wallet, Building2 } from 'lucide-react';

const fmt = (n: number | string) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;

const RUN_STATUS: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  CALCULATED: 'bg-cyan-100 text-cyan-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  PAID: 'bg-sky-100 text-sky-800',
  REVERSED: 'bg-amber-100 text-amber-800',
};

export function HrDashboardPage() {
  const { data, isLoading } = useHrDashboard();

  const cards = [
    { label: 'Total headcount', value: data?.headcount ?? 0, icon: Users },
    { label: 'Active employees', value: data?.activeCount ?? 0, icon: Building2 },
    { label: 'Present today', value: data?.today?.present ?? 0, icon: CalendarCheck },
    { label: 'Late today', value: data?.today?.late ?? 0, icon: Clock },
    { label: 'Pending leave', value: data?.pendingLeave ?? 0, icon: CalendarX2 },
    { label: 'Open periods', value: data?.openPeriods ?? 0, icon: Wallet },
  ];

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Workforce Management</h1>
        <p className="text-sm text-muted-foreground">
          Employees, attendance, timesheets, leave and payroll in one place.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="p-4">
              <c.icon className="h-4 w-4 text-muted-foreground" />
              <p className="mt-2 text-2xl font-semibold">{c.value}</p>
              <p className="text-xs text-muted-foreground">{c.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg">
            <CardTitle className="text-sm">Today's attendance</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="grid grid-cols-2 divide-x divide-y sm:grid-cols-4">
              {[
                ['Records', data?.today?.attendanceRecords ?? 0],
                ['Present', data?.today?.present ?? 0],
                ['Late', data?.today?.late ?? 0],
                ['Absent', data?.today?.absent ?? 0],
              ].map(([label, value]) => (
                <div key={String(label)} className="p-4 text-center">
                  <p className="text-xl font-semibold">{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg">
            <CardTitle className="text-sm">Latest payroll run</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {!isLoading && !data?.lastRun && (
              <p className="text-sm text-muted-foreground">No payroll runs yet.</p>
            )}
            {data?.lastRun && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Link to={`/hr/payroll/runs/${data.lastRun.id}`} className="text-sm font-medium hover:underline">
                    {data.lastRun.runNumber}
                  </Link>
                  <Badge variant="outline" className={RUN_STATUS[data.lastRun.status] ?? ''}>
                    {data.lastRun.status.replace(/_/g, ' ')}
                  </Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-md bg-muted/30 p-2">
                    <p className="text-xs text-muted-foreground">Gross</p>
                    <p className="text-sm font-semibold">{fmt(data.lastRun.totalGross)}</p>
                  </div>
                  <div className="rounded-md bg-muted/30 p-2">
                    <p className="text-xs text-muted-foreground">Deductions</p>
                    <p className="text-sm font-semibold">{fmt(data.lastRun.totalDeductions)}</p>
                  </div>
                  <div className="rounded-md bg-muted/30 p-2">
                    <p className="text-xs text-muted-foreground">Net</p>
                    <p className="text-sm font-semibold">{fmt(data.lastRun.totalNet)}</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
