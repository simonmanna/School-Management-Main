// KDS — kitchen performance reports + live-ops dashboard.
import React, { useState } from 'react';
import { useAuthStore } from '@/stores/auth.store';
import { PERMISSIONS } from '@erp/shared';
import { ChefHat, Clock, AlertTriangle, RotateCcw, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useKdsReportSummary, useKdsLive } from './pos-features-api';

const Stat: React.FC<{ label: string; value: React.ReactNode; sub?: string; tone?: string }> = ({ label, value, sub, tone }) => (
  <div className="rounded-xl border p-3">
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className={`text-2xl font-extrabold ${tone ?? ''}`}>{value}</div>
    {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
  </div>
);

const KdsReportsPage: React.FC = () => {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canView = hasPermission(PERMISSIONS.pos.reports);

  const today = new Date();
  const weekAgo = new Date(today.getTime() - 7 * 24 * 3600 * 1000);
  const [from, setFrom] = useState(weekAgo.toISOString().slice(0, 10));
  const [to, setTo] = useState(today.toISOString().slice(0, 10));

  const { data: live } = useKdsLive();
  const { data: sum, isLoading } = useKdsReportSummary(from ? `${from}T00:00:00.000Z` : undefined, to ? `${to}T23:59:59.999Z` : undefined);

  if (!canView) {
    return <div className="p-8 text-center text-muted-foreground">You need POS reports permission (pos:reports).</div>;
  }

  const maxHour = Math.max(1, ...(sum?.peakHours.map((h) => h.count) ?? [1]));

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-5">
      <h1 className="text-2xl font-extrabold flex items-center gap-2"><ChefHat className="h-6 w-6" /> Kitchen Reports</h1>

      {/* Live ops */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4" /> Live now</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Stat label="Active" value={live?.totalActive ?? '—'} />
          <Stat label="New" value={live?.counts.new ?? '—'} tone="text-blue-600" />
          <Stat label="Preparing" value={live?.counts.preparing ?? '—'} tone="text-amber-600" />
          <Stat label="Ready" value={live?.counts.ready ?? '—'} tone="text-emerald-600" />
          <Stat label="Avg age" value={`${live?.avgAgeMin ?? 0}m`} />
          <Stat label="Longest wait" value={`${live?.longestWaitMin ?? 0}m`} tone={(live?.longestWaitMin ?? 0) >= 10 ? 'text-rose-600' : ''} />
        </CardContent>
      </Card>

      {/* Range picker */}
      <div className="flex items-end gap-3">
        <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>

      {isLoading && <div className="text-muted-foreground">Loading…</div>}
      {sum && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Tickets" value={sum.totals.tickets} />
            <Stat label="Avg prep" value={`${sum.prepTime.avg}m`} sub={`p50 ${sum.prepTime.p50}m · p90 ${sum.prepTime.p90}m`} />
            <Stat label="Avg wait" value={`${sum.waitTime.avg}m`} sub={`p50 ${sum.waitTime.p50}m · p90 ${sum.waitTime.p90}m`} />
            <Stat label="Delayed" value={sum.totals.delayed} tone={sum.totals.delayed ? 'text-rose-600' : ''} sub={`>10m prep`} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Per station</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {sum.perStation.length === 0 && <div className="text-sm text-muted-foreground">No data.</div>}
                {sum.perStation.map((s) => (
                  <div key={s.station} className="flex items-center justify-between text-sm">
                    <span className="font-semibold capitalize">{s.station}</span>
                    <span className="text-muted-foreground">{s.tickets} tickets · avg {s.avgPrep}m</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Per chef</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {sum.perChef.length === 0 && <div className="text-sm text-muted-foreground">No chef attribution yet.</div>}
                {sum.perChef.map((c) => (
                  <div key={c.chefUserId} className="flex items-center justify-between text-sm">
                    <span className="font-mono text-xs truncate max-w-[60%]">{c.chefUserId}</span>
                    <span className="text-muted-foreground">{c.tickets} · avg {c.avgPrep}m</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><RotateCcw className="h-4 w-4" /> Recall causes</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {sum.recallCauses.length === 0 && <div className="text-sm text-muted-foreground">No recalls 🎉</div>}
                {sum.recallCauses.map((r) => (
                  <div key={r.reason} className="flex items-center justify-between text-sm">
                    <span className="capitalize">{r.reason}</span><span className="text-muted-foreground">{r.count}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Top dishes</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {sum.topDishes.slice(0, 8).map((d) => (
                  <div key={d.name} className="flex items-center justify-between text-sm">
                    <span className="truncate max-w-[70%]">{d.name}</span><span className="text-muted-foreground">{d.qty}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Peak hours (UTC)</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-end gap-0.5 h-24">
                {sum.peakHours.map((h) => (
                  <div key={h.hour} className="flex-1 flex flex-col items-center justify-end gap-1" title={`${h.hour}:00 — ${h.count}`}>
                    <div className="w-full rounded-t bg-sky-400" style={{ height: `${(h.count / maxHour) * 100}%` }} />
                    <span className="text-[9px] text-muted-foreground">{h.hour}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1"><XCircle className="h-4 w-4" /> {sum.totals.cancelled} cancelled</span>
            <span className="flex items-center gap-1"><RotateCcw className="h-4 w-4" /> {sum.totals.recalls} recalls</span>
          </div>
        </>
      )}
    </div>
  );
};

export default KdsReportsPage;
