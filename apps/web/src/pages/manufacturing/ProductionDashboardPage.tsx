import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Factory, ClipboardList, PlayCircle, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useProductionOrders } from '@/features/manufacturing/api';
import { ORDER_STATUS_VARIANT } from './ProductionOrdersPage';

export function ProductionDashboardPage() {
  const { data: orders, isLoading } = useProductionOrders();

  const stats = useMemo(() => {
    const list = orders ?? [];
    const by = (s: string) => list.filter((o) => o.status === s).length;
    const today = new Date().toDateString();
    return {
      draft: by('draft'),
      confirmed: by('confirmed'),
      inProgress: by('in_progress'),
      completedToday: list.filter((o) => o.status === 'completed' && o.completedAt && new Date(o.completedAt).toDateString() === today).length,
      active: list.filter((o) => o.status === 'confirmed' || o.status === 'in_progress'),
    };
  }, [orders]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold"><Factory className="h-6 w-6" /> Production</h1>
          <p className="text-sm text-muted-foreground">Today's floor at a glance.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline"><Link to="/manufacturing/boms">Recipes</Link></Button>
          <Button asChild><Link to="/manufacturing/orders">Orders</Link></Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={<ClipboardList className="h-5 w-5" />} label="Draft" value={stats.draft} />
        <StatCard icon={<ClipboardList className="h-5 w-5" />} label="Confirmed" value={stats.confirmed} />
        <StatCard icon={<PlayCircle className="h-5 w-5" />} label="In progress" value={stats.inProgress} />
        <StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="Completed today" value={stats.completedToday} />
      </div>

      <Card>
        <CardHeader><CardTitle>Active orders</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !stats.active.length ? (
            <p className="text-sm text-muted-foreground">Nothing on the floor right now.</p>
          ) : (
            stats.active.map((o) => {
              const planned = Number(o.plannedQty) || 1;
              const pct = Math.min(100, Math.round((Number(o.producedQty) / planned) * 100));
              return (
                <Link key={o.id} to={`/manufacturing/orders/${o.id}`} className="block rounded-md border p-3 hover:bg-muted/50">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm">{o.orderCode}</span>
                    <Badge variant={ORDER_STATUS_VARIANT[o.status]}>{o.status.replace('_', ' ')}</Badge>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{Number(o.producedQty)} / {Number(o.plannedQty)} produced</p>
                </Link>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="text-muted-foreground">{icon}</div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default ProductionDashboardPage;
