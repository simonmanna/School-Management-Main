import { useState } from 'react';
import { BarChart3, TrendingDown, AlertTriangle, Wine, Percent } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency } from '@/lib/utils';
import {
  useBeverageDashboard, useBeverageVariance, useBeverageYield, useBeverageBartender,
} from '@/features/beverage/api';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

function Kpi({ label, value, icon: Icon, tone }: { label: string; value: string; icon: any; tone?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{label}</span>
          <Icon className={`h-4 w-4 ${tone ?? 'text-muted-foreground'}`} />
        </div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

const CONF: Record<string, string> = {
  GOOD: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  SUSPICIOUS: 'bg-amber-100 text-amber-700 border-amber-200',
  OUT_OF_RANGE: 'bg-red-100 text-red-700 border-red-200',
};

export function BeverageDashboardPage() {
  const [tab, setTab] = useState<'variance' | 'yield' | 'bartender'>('variance');
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 864e5)));
  const [to, setTo] = useState(iso(new Date()));

  const dash = useBeverageDashboard();
  const variance = useBeverageVariance();
  const yields = useBeverageYield(from, to);
  const bartender = useBeverageBartender(from, to);

  const d = dash.data;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <BarChart3 className="h-6 w-6" /> Beverage Control
        </h1>
        <p className="text-sm text-muted-foreground">Alcohol shrinkage, yield and pour variance across your bar.</p>
      </div>

      {dash.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : d && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Kpi label="Today's alcohol sales" value={formatCurrency(d.todaysAlcoholSales)} icon={Wine} tone="text-sky-600" />
          <Kpi label="Open variances" value={String(d.openVariances)} icon={AlertTriangle} tone={d.openVariances ? 'text-amber-600' : 'text-emerald-600'} />
          <Kpi label="Loss value (latest)" value={formatCurrency(d.totalLossValue)} icon={TrendingDown} tone="text-red-600" />
          <Kpi label="Shrinkage this month" value={`${fmt(d.shrinkage.thisMonth)}%`} icon={Percent} tone="text-amber-600" />
          <Kpi label="Bottles counted" value={String(d.openBottles)} icon={Wine} />
        </div>
      )}

      {d && (
        <Card>
          <CardContent className="p-4 flex flex-wrap items-center gap-6 text-sm">
            <span className="text-muted-foreground">Alcohol shrinkage trend:</span>
            <span>This week <strong>{fmt(d.shrinkage.thisWeek)}%</strong></span>
            <span>This month <strong>{fmt(d.shrinkage.thisMonth)}%</strong></span>
            <span>Last month <strong>{fmt(d.shrinkage.lastMonth)}%</strong></span>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-1 border-b pb-2">
        <Button size="sm" variant={tab === 'variance' ? 'default' : 'outline'} onClick={() => setTab('variance')}>Bottle Variance</Button>
        <Button size="sm" variant={tab === 'yield' ? 'default' : 'outline'} onClick={() => setTab('yield')}>Yield</Button>
        <Button size="sm" variant={tab === 'bartender' ? 'default' : 'outline'} onClick={() => setTab('bartender')}>Bartender</Button>
      </div>

      {(tab === 'yield' || tab === 'bartender') && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">From</span>
          <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="text-muted-foreground">To</span>
          <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      )}

      {tab === 'variance' && (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-3 py-2 text-left">Product</th>
                <th className="px-3 py-2 text-right">System ml</th>
                <th className="px-3 py-2 text-right">Counted ml</th>
                <th className="px-3 py-2 text-right">Variance ml</th>
                <th className="px-3 py-2 text-right">Variance g</th>
                <th className="px-3 py-2 text-right">Loss value</th>
                <th className="px-3 py-2 text-center">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {(variance.data ?? []).map((r) => (
                <tr key={r.productId} className="border-b hover:bg-muted/20">
                  <td className="px-3 py-2">{r.product}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(r.systemMl)}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.countedMl != null ? fmt(r.countedMl) : '—'}</td>
                  <td className={`px-3 py-2 text-right font-mono ${r.varianceMl < 0 ? 'text-red-600' : r.varianceMl > 0 ? 'text-emerald-600' : ''}`}>{r.varianceMl > 0 ? '+' : ''}{fmt(r.varianceMl)}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.varianceG > 0 ? '+' : ''}{fmt(r.varianceG)}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.lossValue ? formatCurrency(r.lossValue) : '—'}</td>
                  <td className="px-3 py-2 text-center">{r.confidence && <Badge variant="outline" className={CONF[r.confidence]}>{r.confidence.replace('_', ' ').toLowerCase()}</Badge>}</td>
                </tr>
              ))}
              {variance.data && variance.data.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">No bottle counts yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'yield' && (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-3 py-2 text-left">Product</th>
                <th className="px-3 py-2 text-right">Shots / bottle</th>
                <th className="px-3 py-2 text-right">Sold ml</th>
                <th className="px-3 py-2 text-right">Shots sold</th>
                <th className="px-3 py-2 text-right">Bottles sold</th>
              </tr>
            </thead>
            <tbody>
              {(yields.data ?? []).map((r) => (
                <tr key={r.productId} className="border-b hover:bg-muted/20">
                  <td className="px-3 py-2">{r.product}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(r.shotsPerBottle)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(r.soldMl)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(r.soldShots)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(r.bottlesSold)}</td>
                </tr>
              ))}
              {yields.data && yields.data.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">No data</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'bartender' && (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-3 py-2 text-left">Bartender</th>
                <th className="px-3 py-2 text-right">Alcohol poured (ml)</th>
                <th className="px-3 py-2 text-right">Sales value</th>
              </tr>
            </thead>
            <tbody>
              {(bartender.data ?? []).map((r) => (
                <tr key={r.waiterId} className="border-b hover:bg-muted/20">
                  <td className="px-3 py-2">{r.bartender}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(r.soldMl)}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatCurrency(r.salesValue)}</td>
                </tr>
              ))}
              {bartender.data && bartender.data.length === 0 && (
                <tr><td colSpan={3} className="px-3 py-8 text-center text-muted-foreground">No sales in range</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
