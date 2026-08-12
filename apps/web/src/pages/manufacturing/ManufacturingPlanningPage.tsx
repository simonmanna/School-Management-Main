import { useState } from 'react';
import { Sparkles, PackagePlus, Wand2, CheckCircle2, ClipboardList } from 'lucide-react';
import { PERMISSIONS } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuthStore } from '@/stores/auth.store';
import { notify } from '@/lib/notify';
import {
  useCreateProductionPlan,
  useMrpAction,
  usePlanAction,
  useProductionPlans,
  useProductionRequests,
  useReport,
  useRequestAction,
} from '@/features/manufacturing/api';

export function ManufacturingPlanningPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canPlan = hasPermission(PERMISSIONS.productionPlan.create);

  const { data: requests } = useProductionRequests();
  const { data: plans } = useProductionPlans();
  const forecast = useReport('forecast');
  const createPlan = useCreateProductionPlan();
  const planConfirm = usePlanAction('confirm');
  const reqApprove = useRequestAction('approve');
  const mrp = useMrpAction();
  const [tab, setTab] = useState('requests');

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); notify.success(ok); } catch (e: any) { notify.error('Failed', e?.response?.data?.message ?? e?.message); }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold"><ClipboardList className="h-6 w-6" /> Planning</h1>
          <p className="text-sm text-muted-foreground">Demand → requests → plan → orders. Never auto-starts.</p>
        </div>
        {canPlan && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => run(() => mrp.mutateAsync({ path: 'scan-min-stock' }), 'Scanned min-stock.')}><PackagePlus className="mr-2 h-4 w-4" /> Scan min-stock</Button>
            <Button variant="outline" onClick={() => run(() => mrp.mutateAsync({ path: 'run' }), 'MRP run — purchase request drafted for shortfalls.')}><Wand2 className="mr-2 h-4 w-4" /> Run MRP</Button>
            <Button onClick={() => run(() => createPlan.mutateAsync({ fromOpenRequests: true, name: `Plan ${new Date().toLocaleDateString()}` }), 'Plan created from open requests.')}><Sparkles className="mr-2 h-4 w-4" /> Plan from requests</Button>
          </div>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="requests">Requests</TabsTrigger>
          <TabsTrigger value="plans">Plans</TabsTrigger>
          <TabsTrigger value="forecast">Forecast</TabsTrigger>
        </TabsList>

        <TabsContent value="requests">
          <Card>
            <CardContent className="pt-6">
              {!requests?.length ? <p className="text-sm text-muted-foreground">No requests.</p> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Request</TableHead><TableHead>Source</TableHead><TableHead>Lines</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {requests.map((r: any) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">{r.requestNumber}</TableCell>
                        <TableCell className="text-sm">{r.sourceType}</TableCell>
                        <TableCell>{r.lines?.length ?? 0}</TableCell>
                        <TableCell><Badge variant="outline">{r.status}</Badge></TableCell>
                        <TableCell className="text-right">
                          {r.status === 'submitted' && <Button size="sm" variant="outline" onClick={() => run(() => reqApprove.mutateAsync({ id: r.id }), 'Approved.')}>Approve</Button>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="plans">
          <Card>
            <CardContent className="pt-6">
              {!plans?.length ? <p className="text-sm text-muted-foreground">No plans.</p> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Plan</TableHead><TableHead>Name</TableHead><TableHead>Lines</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {plans.map((p: any) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-xs">{p.planNumber}</TableCell>
                        <TableCell>{p.name ?? '—'}</TableCell>
                        <TableCell>{p.lines?.length ?? 0}</TableCell>
                        <TableCell><Badge variant="outline">{p.status}</Badge></TableCell>
                        <TableCell className="text-right">
                          {p.status === 'draft' && <Button size="sm" onClick={() => run(() => planConfirm.mutateAsync(p.id), 'Confirmed — draft orders generated.')}><CheckCircle2 className="mr-1 h-3 w-3" /> Confirm → orders</Button>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="forecast">
          <Card>
            <CardHeader><CardTitle>Demand forecast (from sales history)</CardTitle></CardHeader>
            <CardContent>
              {!forecast.data?.suggestions?.length ? <p className="text-sm text-muted-foreground">Not enough sales history yet.</p> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>For</TableHead><TableHead className="text-right">Suggested qty</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {forecast.data.suggestions.map((s: any) => (
                      <TableRow key={s.productId}>
                        <TableCell>{s.code} · {s.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{forecast.data.targetWeekday}</TableCell>
                        <TableCell className="text-right font-semibold">{s.suggestedQty}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default ManufacturingPlanningPage;
