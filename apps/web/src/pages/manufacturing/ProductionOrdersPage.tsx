import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { PERMISSIONS } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuthStore } from '@/stores/auth.store';
import { notify } from '@/lib/notify';
import { useBoms, useCreateProductionOrder, useProductionOrders } from '@/features/manufacturing/api';
import { useLocationOptions } from '@/features/manufacturing/options';
import type { ProductionOrderStatus } from '@/features/manufacturing/types';

export const ORDER_STATUS_VARIANT: Record<ProductionOrderStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  draft: 'secondary',
  confirmed: 'outline',
  in_progress: 'default',
  qc_hold: 'outline',
  completed: 'default',
  cancelled: 'destructive',
};

export function ProductionOrdersPage() {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate = hasPermission(PERMISSIONS.productionOrder.create);

  const { data: orders, isLoading } = useProductionOrders();
  const { data: activeBoms } = useBoms({ status: 'active' });
  const { data: locations } = useLocationOptions();
  const createOrder = useCreateProductionOrder();

  const [open, setOpen] = useState(false);
  const [bomId, setBomId] = useState('');
  const [runs, setRuns] = useState('1');
  const [locationId, setLocationId] = useState('');

  const productionLocations = useMemo(
    () => (locations ?? []).filter((l) => l.isActive),
    [locations],
  );

  const submit = async () => {
    if (!bomId) {
      notify.error('Pick an active BOM.');
      return;
    }
    try {
      const order = await createOrder.mutateAsync({
        bomId,
        runs: Number(runs) || 1,
        locationId: locationId || undefined,
      });
      notify.success(`Order ${order.orderCode} created.`);
      setOpen(false);
      setBomId('');
      setRuns('1');
      setLocationId('');
      navigate(`/manufacturing/orders/${order.id}`);
    } catch (e: any) {
      notify.error('Could not create order', e?.response?.data?.message ?? e?.message);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Production Orders</h1>
          <p className="text-sm text-muted-foreground">Consume raw materials into WIP, receive finished goods out.</p>
        </div>
        {canCreate && (
          <Button onClick={() => setOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New Order
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Orders</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !orders?.length ? (
            <p className="text-sm text-muted-foreground">No production orders yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead className="text-right">Planned</TableHead>
                  <TableHead className="text-right">Produced</TableHead>
                  <TableHead className="text-right">Unit cost</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => (
                  <TableRow key={o.id} className="cursor-pointer" onClick={() => navigate(`/manufacturing/orders/${o.id}`)}>
                    <TableCell className="font-mono text-xs">{o.orderCode}</TableCell>
                    <TableCell className="text-right">{Number(o.plannedQty)}</TableCell>
                    <TableCell className="text-right">{Number(o.producedQty)}</TableCell>
                    <TableCell className="text-right">{o.status === 'completed' ? Number(o.outputUnitCost).toFixed(2) : '—'}</TableCell>
                    <TableCell><Badge variant={ORDER_STATUS_VARIANT[o.status]}>{o.status.replace('_', ' ')}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Production Order</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Recipe (active BOM)</Label>
              <Select value={bomId} onValueChange={setBomId}>
                <SelectTrigger><SelectValue placeholder="Select a recipe…" /></SelectTrigger>
                <SelectContent>
                  {(activeBoms ?? []).map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.code} · {b.name} (makes {Number(b.outputQuantity)})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Runs (× batch size)</Label>
              <Input type="number" value={runs} onChange={(e) => setRuns(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Production location (optional — defaults to the BOM's)</Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger><SelectValue placeholder="Default" /></SelectTrigger>
                <SelectContent>
                  {productionLocations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.name} ({l.type})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={createOrder.isPending}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ProductionOrdersPage;
