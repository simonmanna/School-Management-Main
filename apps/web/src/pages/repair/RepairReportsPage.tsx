import { useMemo, useState } from 'react';
import { useRepairOperationalReport, useRepairRevenue, useRepairTechnicianLoad, useRepairWarrantyHealth } from '@/features/repair/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const fmt = (n: number | string) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;

export function RepairReportsPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const { data: report } = useRepairOperationalReport(range.from, range.to);
  const { data: revenue } = useRepairRevenue(range.from, range.to);
  const { data: load } = useRepairTechnicianLoad();
  const { data: warranty } = useRepairWarrantyHealth();

  const revRows = useMemo(() => (revenue ?? []).slice(-12).reverse(), [revenue]);
  const loadRows = useMemo(() => Array.isArray(load) ? load : [], [load]);
  const maxLoad = Math.max(1, ...loadRows.map((t: any) => t.pending + t.in_progress + t.testing));

  const applyRange = () => {
    setRange({ from: from || undefined, to: to || undefined });
  };

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Repair Reports</h1>
        <p className="text-sm text-muted-foreground">Operational KPIs across the repair & maintenance vertical.</p>
      </div>

      <div className="flex items-center gap-2">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        <Button variant="outline" onClick={applyRange}>Apply range</Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <Card><CardContent className="pt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Orders</p>
          <p className="mt-1 text-2xl font-semibold">{report?.totalOrders ?? 0}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Closed</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-600">{report?.closedOrders ?? 0}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Revenue</p>
          <p className="mt-1 text-2xl font-semibold">{fmt(report?.revenue ?? 0)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Labour</p>
          <p className="mt-1 text-2xl font-semibold">{fmt(report?.labourTotal ?? 0)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Parts</p>
          <p className="mt-1 text-2xl font-semibold">{fmt(report?.partsTotal ?? 0)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Jobs</p>
          <p className="mt-1 text-2xl font-semibold">{report?.jobs ?? 0}</p>
        </CardContent></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">Revenue by month</CardTitle></CardHeader>
          <CardContent className="space-y-2 p-4">
            {revRows.length === 0 && <p className="text-sm text-muted-foreground">No closed repairs in range.</p>}
            {revRows.map((r: any) => (
              <div key={r.month} className="flex items-center justify-between text-sm">
                <span className="w-16">{r.month}</span>
                <div className="h-2 flex-1 overflow-hidden rounded bg-muted">
                  <div className="h-full rounded bg-primary" style={{ width: `${Math.max(2, Math.min(100, (r.revenue / (report?.revenue ?? 1)) * 100))}%` }} />
                </div>
                <span className="w-28 text-right">{fmt(r.revenue)}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">Technician load</CardTitle></CardHeader>
          <CardContent className="space-y-2 p-4">
            {loadRows.length === 0 && <p className="text-sm text-muted-foreground">No technicians.</p>}
            {loadRows.map((t: any) => (
              <div key={t.id} className="flex items-center justify-between text-sm">
                <span className="w-40 truncate">{t.name}</span>
                <div className="h-2 flex-1 overflow-hidden rounded bg-muted">
                  <div className="h-full rounded bg-emerald-500" style={{ width: `${(t.pending + t.in_progress + t.testing) / maxLoad * 100}%` }} />
                </div>
                <span className="w-28 text-right text-muted-foreground">
                  {t.in_progress} active · {t.pending} pending{t.testing ? ` · ${t.testing} testing` : ''}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">Order types</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {(report?.byType ?? []).map((t: any) => (
                <div key={t.type} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="capitalize">{t.type.replace(/_/g, ' ')}</span>
                  <span className="text-muted-foreground">{t.count} orders · {fmt(t.revenue)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">Warranty health</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 p-4 text-center">
            <div><p className="text-2xl font-semibold text-emerald-600">{warranty?.active ?? 0}</p><p className="text-xs uppercase tracking-wide text-muted-foreground">Active</p></div>
            <div><p className="text-2xl font-semibold text-amber-600">{warranty?.claimed ?? 0}</p><p className="text-xs uppercase tracking-wide text-muted-foreground">Claimed</p></div>
            <div><p className="text-2xl font-semibold">{warranty?.expired ?? 0}</p><p className="text-xs uppercase tracking-wide text-muted-foreground">Expired</p></div>
            <div><p className="text-2xl font-semibold">{warranty?.void ?? 0}</p><p className="text-xs uppercase tracking-wide text-muted-foreground">Void</p></div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
