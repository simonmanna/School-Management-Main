import { BarChart3, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useReport } from '@/features/manufacturing/api';

export function ManufacturingReportsPage() {
  const wip = useReport('wip-reconciliation');
  const kpis = useReport('kpis');
  const trends = useReport('trends');
  const usage = useReport('ingredient-usage');
  const capacity = useReport('capacity'); // served under work-centers; harmless if 404 → empty

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold"><BarChart3 className="h-6 w-6" /> Manufacturing Reports</h1>
        <p className="text-sm text-muted-foreground">Costing controls and production analytics.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2">WIP Reconciliation
            {wip.data && (wip.data.balanced
              ? <Badge variant="default"><CheckCircle2 className="mr-1 h-3 w-3" /> Balanced</Badge>
              : <Badge variant="destructive"><AlertTriangle className="mr-1 h-3 w-3" /> Drift</Badge>)}
          </CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <Row label="GL WIP balance" value={wip.data?.glBalance} />
            <Row label="Open orders' WIP" value={wip.data?.openOrdersWip} />
            <Row label="Drift" value={wip.data?.drift} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>KPIs</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <Row label="Completed orders" value={kpis.data?.orders} />
            <Row label="Yield %" value={kpis.data?.yieldPct} />
            <Row label="Waste %" value={kpis.data?.wastePct} />
            <Row label="Avg cost / batch" value={kpis.data?.avgCostPerBatch} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Production trends</CardTitle></CardHeader>
        <CardContent>
          {!trends.data?.length ? <p className="text-sm text-muted-foreground">No completed orders yet.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead className="text-right">Orders</TableHead><TableHead className="text-right">Produced</TableHead><TableHead className="text-right">Cost</TableHead></TableRow></TableHeader>
              <TableBody>
                {trends.data.map((t: any) => (
                  <TableRow key={t.date}>
                    <TableCell>{t.date}</TableCell>
                    <TableCell className="text-right">{t.orders}</TableCell>
                    <TableCell className="text-right">{Number(t.produced)}</TableCell>
                    <TableCell className="text-right">{Number(t.cost).toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Ingredient usage</CardTitle></CardHeader>
        <CardContent>
          {!usage.data?.length ? <p className="text-sm text-muted-foreground">Nothing consumed yet.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Ingredient</TableHead><TableHead className="text-right">Qty consumed</TableHead><TableHead className="text-right">Cost</TableHead></TableRow></TableHeader>
              <TableBody>
                {usage.data.map((u: any) => (
                  <TableRow key={u.productId}>
                    <TableCell>{u.name}</TableCell>
                    <TableCell className="text-right">{Number(u.qtyConsumed)}</TableCell>
                    <TableCell className="text-right">{Number(u.cost).toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {!!capacity.data?.length && (
        <Card>
          <CardHeader><CardTitle>Work-centre capacity</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Work centre</TableHead><TableHead className="text-right">Load (min)</TableHead><TableHead className="text-right">Capacity/day</TableHead><TableHead className="text-right">Utilisation</TableHead></TableRow></TableHeader>
              <TableBody>
                {capacity.data.map((c: any) => (
                  <TableRow key={c.workCenterId}>
                    <TableCell>{c.name}</TableCell>
                    <TableCell className="text-right">{c.loadMins}</TableCell>
                    <TableCell className="text-right">{c.capacityMinsPerDay}</TableCell>
                    <TableCell className="text-right">{c.utilizationPct != null ? `${c.utilizationPct}%` : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number | undefined }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value ?? '—'}</span>
    </div>
  );
}

export default ManufacturingReportsPage;
