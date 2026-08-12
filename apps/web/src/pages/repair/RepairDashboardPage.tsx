import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Wrench, CheckCircle2, Clock, FileText } from 'lucide-react';
import { useRepairDashboard, useRepairOrders } from '@/features/repair/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { date } from '@/lib/format';

const fmt = (n: number | string) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;

const STATUS_STYLES: Record<string, string> = {
  received: 'bg-blue-100 text-blue-800',
  diagnosis: 'bg-violet-100 text-violet-800',
  waiting_approval: 'bg-amber-100 text-amber-800',
  approved: 'bg-cyan-100 text-cyan-800',
  repairing: 'bg-emerald-100 text-emerald-800',
  testing: 'bg-teal-100 text-teal-800',
  ready_pickup: 'bg-indigo-100 text-indigo-800',
  delivered: 'bg-sky-100 text-sky-800',
  closed: 'bg-muted text-muted-foreground',
  cancelled: 'bg-muted text-muted-foreground',
};

export function RepairDashboardPage() {
  const { data } = useRepairDashboard();
  const { data: orders } = useRepairOrders({ pageSize: 8 });

  const stats = useMemo(
    () => ({
      openOrders: data?.openOrders ?? 0,
      inWorkshop: data?.inWorkshop ?? 0,
      readyPickup: data?.readyPickup ?? 0,
      awaitingApproval: data?.awaitingApproval ?? 0,
      completed30: data?.completed30 ?? 0,
      revenue30: data?.revenue30 ?? 0,
    }),
    [data],
  );

  const recent = useMemo(() => (orders?.items ?? []).slice(0, 8), [orders]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Repair & Maintenance</h1>
        <p className="text-sm text-muted-foreground">Repair orders, workshop jobs, quotations, parts, warranties and contracts.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Card><CardContent className="pt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Open orders</p>
          <p className="mt-1 text-2xl font-semibold">{stats.openOrders}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">In workshop</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-600">{stats.inWorkshop}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ready for pickup</p>
          <p className="mt-1 text-2xl font-semibold text-indigo-600">{stats.readyPickup}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Awaiting approval</p>
          <p className="mt-1 text-2xl font-semibold text-amber-600">{stats.awaitingApproval}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Revenue (30d)</p>
          <p className="mt-1 text-2xl font-semibold">{fmt(stats.revenue30)}</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader className="bg-muted/30 border-b rounded-t-lg">
          <CardTitle className="text-sm">Recent repair orders</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {recent.length === 0 && <p className="p-6 text-sm text-muted-foreground">No repair orders yet.</p>}
            {recent.map((o: any) => (
              <Link key={o.id} to={`/repair/orders/${o.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-muted/40">
                <div className="flex items-center gap-3">
                  {o.status === 'ready_pickup' ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : o.status === 'repairing' || o.status === 'testing' ? <Wrench className="h-4 w-4 text-blue-500" /> : <FileText className="h-4 w-4 text-muted-foreground" />}
                  <div>
                    <p className="text-sm font-medium">{o.repairNumber}</p>
                    <p className="text-xs text-muted-foreground">
                      {o.itemType ?? 'Item'} {o.brand && o.model ? `· ${o.brand} ${o.model}` : o.brand ? `· ${o.brand}` : ''} · {o.partner?.name ?? 'Walk-in'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {o.dueDate && <span className="hidden text-xs text-muted-foreground sm:flex items-center gap-1"><Clock className="h-3 w-3" />{date(o.dueDate)}</span>}
                  <span className="text-sm font-medium">{fmt(o.totalAmount)}</span>
                  <Badge variant="outline" className={STATUS_STYLES[o.status] ?? ''}>{o.status.replace(/_/g, ' ')}</Badge>
                </div>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
