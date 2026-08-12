import { useMemo, useState } from 'react';
import { TrendingUp, BarChart3, Boxes } from 'lucide-react';
import { useRentalUtilization, useRentalRevenue, useRentalFleet } from '@/features/rental/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { date } from '@/lib/format';

const fmt = (n: number | string) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;

const STATUS_STYLES: Record<string, string> = {
  available: 'bg-emerald-100 text-emerald-800',
  rented: 'bg-blue-100 text-blue-800',
  maintenance: 'bg-amber-100 text-amber-800',
  damaged: 'bg-red-100 text-red-800',
  retired: 'bg-muted text-muted-foreground',
};

export function RentalReportsPage() {
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  const fromIso = from ? new Date(from).toISOString() : undefined;
  const toIso = to ? new Date(to + 'T23:59:59').toISOString() : undefined;

  const { data: utilization } = useRentalUtilization(fromIso, toIso);
  const { data: revenue } = useRentalRevenue(fromIso, toIso);
  const { data: fleet } = useRentalFleet();

  const fleetRows = useMemo(() => {
    if (!fleet) return [];
    return Array.isArray(fleet) ? fleet : (fleet as any).items ?? [];
  }, [fleet]);

  const utilizationRows = useMemo(() => {
    if (!utilization) return [];
    return Array.isArray(utilization) ? utilization : (utilization as any).lines ?? [];
  }, [utilization]);

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Rental Reports</h1>
        <p className="text-sm text-muted-foreground">Utilisation, revenue and fleet status.</p>
      </div>

      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-md border bg-card px-3 py-2 text-sm" />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md border bg-card px-3 py-2 text-sm" />
        </label>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg">
            <CardTitle className="flex items-center gap-2 text-sm"><TrendingUp className="h-4 w-4" /> Revenue</CardTitle>
          </CardHeader>
          <CardContent className="pt-5">
            <p className="text-2xl font-semibold">{fmt((revenue as any)?.total ?? (revenue as any)?.rentalIncome ?? 0)}</p>
            <p className="text-xs text-muted-foreground">{date(from)} → {date(to)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg">
            <CardTitle className="flex items-center gap-2 text-sm"><BarChart3 className="h-4 w-4" /> Utilisation</CardTitle>
          </CardHeader>
          <CardContent className="pt-5">
            <p className="text-2xl font-semibold">{(utilization as any)?.rate != null ? `${Math.round(Number((utilization as any).rate) * 100)}%` : '—'}</p>
            <p className="text-xs text-muted-foreground">{utilizationRows.length} active line(s)</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg">
            <CardTitle className="flex items-center gap-2 text-sm"><Boxes className="h-4 w-4" /> Fleet</CardTitle>
          </CardHeader>
          <CardContent className="pt-5">
            <p className="text-2xl font-semibold">{fleetRows.length}</p>
            <p className="text-xs text-muted-foreground">{fleetRows.filter((u: any) => u.status === 'rented').length} rented</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="bg-muted/30 border-b rounded-t-lg">
          <CardTitle className="text-sm">Utilisation by product</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {utilizationRows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No active rentals in this window.</p>}
            {utilizationRows.map((u: any, i: number) => (
              <div key={i} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{u.product?.name ?? u.productId?.slice(0, 8)}</p>
                  <p className="text-xs text-muted-foreground">{u.quantity ?? 1} unit(s) · {u.ratePeriod ?? 'day'}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium">{fmt(u.lineTotal ?? u.unitRate ?? 0)}</p>
                  <p className="text-xs text-muted-foreground">due {u.dueAt ? date(u.dueAt) : '—'}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="bg-muted/30 border-b rounded-t-lg">
          <CardTitle className="text-sm">Fleet status</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {fleetRows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No units.</p>}
            {fleetRows.map((u: any) => (
              <div key={u.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{u.unitCode}</p>
                  <p className="text-xs text-muted-foreground">{u.product?.name ?? u.productId?.slice(0, 8)}</p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[u.status] ?? 'bg-muted text-muted-foreground'}`}
                >
                  {u.status}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
