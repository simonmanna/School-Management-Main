import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAdminDashboard, useFinanceDashboard, useTopPerformers } from '@/features/school/api';

const fmt = (n: number) => new Intl.NumberFormat('en-UG', { style: 'currency', currency: 'UGX', maximumFractionDigits: 0 }).format(n);

export function SchoolReportsPage() {
  const admin = useAdminDashboard();
  const finance = useFinanceDashboard();
  const top = useTopPerformers(10);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">School Reports</h1>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard title="Students" value={admin.data?.students} />
        <StatCard title="Staff" value={admin.data?.staff} />
        <StatCard title="Classes" value={admin.data?.classes} />
        <StatCard title="Campuses" value={admin.data?.campuses} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Finance snapshot</CardTitle>
          <CardDescription>This month's collections + outstanding fees</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-sm text-muted-foreground">Collected this month</div>
            <div className="text-2xl font-bold">{finance.data ? fmt(finance.data.collectionsThisMonth) : '—'}</div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Outstanding</div>
            <div className="text-2xl font-bold text-red-600">{finance.data ? fmt(finance.data.outstanding) : '—'}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Top performers (current term)</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/50"><th className="p-2 text-left">Adm. No</th><th className="p-2 text-right">GPA</th></tr></thead>
            <tbody>
              {(top.data ?? []).map((s: any) => (
                <tr key={s.id} className="border-b">
                  <td className="p-2">{s.admissionNo}</td>
                  <td className="p-2 text-right"><Badge>{s.gpa.toFixed(2)}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ title, value }: { title: string; value: number | undefined }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value ?? '—'}</div>
      </CardContent>
    </Card>
  );
}