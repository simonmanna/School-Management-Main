import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useRentalAgreements, useRentalUnits, useRentalUtilization } from '@/features/rental/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { date } from '@/lib/format';

const fmt = (n: number | string) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  pending_approval: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-blue-100 text-blue-800',
  checked_out: 'bg-emerald-100 text-emerald-800',
  overdue: 'bg-red-100 text-red-800',
  closed: 'bg-muted text-muted-foreground',
  cancelled: 'bg-muted text-muted-foreground',
};

export function RentalDashboardPage() {
  const { data: agreements } = useRentalAgreements({ pageSize: 6 });
  const { data: units } = useRentalUnits({ pageSize: 1 });
  const { data: utilization } = useRentalUtilization(new Date(Date.now() - 30 * 86_400_000).toISOString(), new Date().toISOString());

  const stats = useMemo(() => {
    const items = agreements?.items ?? [];
    return {
      active: items.filter((a) => a.status === 'checked_out').length,
      overdue: items.filter((a) => a.status === 'overdue' || (a.status === 'checked_out' && new Date(a.dueAt) < new Date())).length,
      pending: items.filter((a) => a.status === 'pending_approval' || a.status === 'confirmed').length,
      fleet: units?.total ?? 0,
      revenue: items.filter((a) => a.status === 'checked_out').reduce((s, a) => s + Number(a.settlementTotal || a.lines?.reduce((x, l) => x + Number(l.lineTotal), 0) || 0), 0),
      utilization: utilization?.rate != null ? `${Math.round(Number(utilization.rate) * 100)}%` : '—',
    };
  }, [agreements, units, utilization]);

  const recent = useMemo(() => (agreements?.items ?? []).slice(0, 6), [agreements]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Rental Management</h1>
        <p className="text-sm text-muted-foreground">Agreements, fleet utilisation, deposits and returns.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Card><CardContent className="pt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Active</p>
          <p className="mt-1 text-2xl font-semibold">{stats.active}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Overdue</p>
          <p className="mt-1 text-2xl font-semibold text-red-600">{stats.overdue}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pending</p>
          <p className="mt-1 text-2xl font-semibold text-amber-600">{stats.pending}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fleet size</p>
          <p className="mt-1 text-2xl font-semibold">{stats.fleet}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Utilisation (30d)</p>
          <p className="mt-1 text-2xl font-semibold">{stats.utilization}</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader className="bg-muted/30 border-b rounded-t-lg">
          <CardTitle className="text-sm">Recent agreements</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {recent.length === 0 && <p className="p-6 text-sm text-muted-foreground">No agreements yet.</p>}
            {recent.map((a) => (
              <Link key={a.id} to={`/rental/agreements/${a.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-muted/40">
                <div className="flex items-center gap-3">
                  {a.status === 'overdue' ? <AlertTriangle className="h-4 w-4 text-red-500" /> : a.status === 'checked_out' ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <CalendarDays className="h-4 w-4 text-muted-foreground" />}
                  <div>
                    <p className="text-sm font-medium">{a.agreementNumber}</p>
                    <p className="text-xs text-muted-foreground">Due {date(a.dueAt)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">{fmt(a.lines?.reduce((s, l) => s + Number(l.lineTotal), 0) ?? 0)}</span>
                  <Badge variant="outline" className={STATUS_STYLES[a.status] ?? ''}>{a.status}</Badge>
                </div>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
