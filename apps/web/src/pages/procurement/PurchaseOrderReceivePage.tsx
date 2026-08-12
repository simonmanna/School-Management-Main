import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';

interface PO {
  id: string; orderNumber: string; status: string;
  totalAmount: number; currencyCode: string; paymentType: string;
  lines: Array<{
    id: string; description: string; quantity: number;
    unitPrice: number; receivedQuantity: number;
    productId?: string;
  }>;
}

interface Warehouse { id: string; name: string; code: string }

export function PurchaseOrderReceivePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [notes, setNotes] = useState('');

  const po = useQuery<PO>({
    queryKey: ['purchase-order', id],
    queryFn: async () => (await api.get<PO>(`/procurement/purchase-orders/${id}`)).data,
    enabled: !!id,
  });

  const warehouses = useQuery<Warehouse[]>({
    queryKey: ['warehouses'],
    queryFn: async () => {
      const res = await api.get<{ data: Warehouse[] }>('/inventory/locations?type=warehouse');
      return res.data.data ?? [];
    },
  });

  const [receivedQtys, setReceivedQtys] = useState<Record<string, number>>({});

  const receiveMut = useMutation({
    mutationFn: async () =>
      (await api.post(`/procurement/purchase-orders/${id}/receive`, {
        warehouseId,
        notes,
        lines: po.data?.lines
          .filter((l) => (receivedQtys[l.id] ?? 0) > 0)
          .map((l) => ({
            purchaseOrderLineId: l.id,
            productId: l.productId,
            description: l.description,
            quantity: receivedQtys[l.id] ?? l.quantity,
            unitCost: l.unitPrice,
          })) ?? [],
      })).data,
    onSuccess: () => {
      notify.success('Stock received successfully');
      qc.invalidateQueries({ queryKey: ['purchase-order', id] });
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      navigate(`/procurement/purchase-orders/${id}`);
    },
    onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Failed'),
  });

  if (po.isLoading) return <Skeleton className="h-96 w-full" />;
  if (po.error || !po.data) return <Card><CardContent className="p-8 text-center text-destructive">Not found</CardContent></Card>;

  const data = po.data;
  if (data.status !== 'active' && data.status !== 'partially_received') {
    return (
      <Card><CardContent className="p-8 text-center">
        This PO is {data.status}. Only active or partially received orders can be received.
        <div className="mt-4"><Button onClick={() => navigate(-1)}>Go back</Button></div>
      </CardContent></Card>
    );
  }

  const autoFillAll = () => {
    const all: Record<string, number> = {};
    data.lines.forEach((l) => {
      const remaining = Number(l.quantity) - Number(l.receivedQuantity);
      if (remaining > 0) all[l.id] = remaining;
    });
    setReceivedQtys(all);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">Receive Stock</h1>
          <p className="text-sm text-muted-foreground">{data.orderNumber}</p>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Warehouse & notes</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-sm font-medium">Warehouse</label>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="mt-1 w-full rounded border bg-background px-2 py-1 text-sm"
            >
              <option value="">Select…</option>
              {warehouses.data?.map((w) => (
                <option key={w.id} value={w.id}>{w.code} — {w.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">Notes</label>
            <Input
              className="mt-1"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Items to receive</CardTitle>
            <Button size="sm" variant="outline" onClick={autoFillAll}>
              Receive all remaining
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-3 py-2 text-left">Item</th>
                <th className="px-3 py-2 text-right">Ordered</th>
                <th className="px-3 py-2 text-right">Received</th>
                <th className="px-3 py-2 text-right">Remaining</th>
                <th className="px-3 py-2 text-right">Receiving</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l) => {
                const ordered = Number(l.quantity);
                const received = Number(l.receivedQuantity);
                const remaining = ordered - received;
                return (
                  <tr key={l.id} className="border-b hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium">{l.description}</td>
                    <td className="px-3 py-2 text-right font-mono">{ordered}</td>
                    <td className="px-3 py-2 text-right font-mono">{received}</td>
                    <td className="px-3 py-2 text-right font-mono">{remaining}</td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        type="number"
                        min={0}
                        max={remaining}
                        step="0.01"
                        className="w-24 ml-auto text-right font-mono"
                        value={receivedQtys[l.id] ?? 0}
                        onChange={(e) =>
                          setReceivedQtys((prev) => ({
                            ...prev,
                            [l.id]: Number(e.target.value),
                          }))
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="mt-4 flex items-center justify-between rounded-lg border p-3 bg-green-50">
            <div>
              <p className="text-sm font-medium">
                {data.paymentType === 'cash'
                  ? 'This is a cash purchase — payment will be auto-settled on receive.'
                  : 'This is a credit purchase — payment will be recorded separately.'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate(-1)}>Cancel</Button>
        <Button
          onClick={() => receiveMut.mutate()}
          disabled={!warehouseId || !Object.values(receivedQtys).some((v) => v > 0) || receiveMut.isPending}
        >
          <Save className="mr-2 h-4 w-4" />
          {receiveMut.isPending ? 'Receiving…' : 'Receive Stock'}
        </Button>
      </div>
    </div>
  );
}
