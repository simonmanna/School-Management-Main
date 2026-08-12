import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Trash2, Truck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';

interface Warehouse { id: string; code: string; name: string; type: string }
interface Product { id: string; name: string; code: string }
interface POLine { id: string; productId: string | null; description: string; quantity: number; receivedQuantity: number; unitPrice: number }
interface PO { id: string; orderNumber: string; lines: POLine[] }

interface Line {
  purchaseOrderLineId?: string;
  productId?: string;
  description: string;
  quantity: number;
  unitCost?: number;
  batchNumber?: string;
  expiryDate?: string;
}

export function GoodsReceiptCreatePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const poId = params.get('poId') ?? '';
  const [warehouseId, setWarehouseId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([{ description: '', quantity: 1, unitCost: 0 }]);

  const warehouses = useQuery<Warehouse[]>({
    queryKey: ['warehouses'],
    queryFn: async () => {
      const res = await api.get<{ data: Warehouse[] }>('/inventory/locations?type=warehouse');
      return res.data.data ?? [];
    },
  });
  const po = useQuery<PO>({
    queryKey: ['po-for-grn', poId],
    queryFn: async () => (await api.get<PO>(`/procurement/purchase-orders/${poId}`)).data,
    enabled: !!poId,
  });
  const products = useQuery<Product[]>({
    queryKey: ['products'],
    queryFn: async () => (await api.get<Product[]>('/products?pageSize=200')).data,
  });

  // When PO loads, prefill lines from PO lines.
  useEffect(() => {
    if (po.data) {
      setLines(
        po.data.lines.map((ln) => ({
          purchaseOrderLineId: ln.id,
          productId: ln.productId ?? undefined,
          description: ln.description,
          quantity: Math.max(0, Number(ln.quantity) - Number(ln.receivedQuantity)),
          unitCost: Number(ln.unitPrice) || 0,
        })).filter((l) => l.quantity > 0),
      );
    }
  }, [po.data]);

  const create = useMutation({
    mutationFn: async () => (await api.post('/procurement/goods-receipts', {
      purchaseOrderId: poId || undefined,
      warehouseId,
      notes,
      lines: lines.filter((l) => l.description && l.quantity > 0).map((l) => ({
        ...l,
        batchNumber: l.batchNumber || undefined,
        expiryDate: l.expiryDate || undefined,
      })),
    })).data,
    onSuccess: async (data: any) => {
      // Immediately post it (commits the stock-in).
      await api.patch(`/procurement/goods-receipts/${data.id}/post`);
      notify.success(`GRN ${data.receiptNumber} posted`);
      qc.invalidateQueries({ queryKey: ['goods-receipts'] });
      navigate('/procurement/goods-receipts');
    },
    onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Failed'),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">New Goods Receipt</h1>

      <Card>
        <CardHeader>
          <CardTitle>Receipt details</CardTitle>
          <CardDescription>Receipts post stock-in moves automatically.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-sm font-medium">PO (optional)</label>
            <Input
              className="mt-1"
              value={poId}
              onChange={(e) => {
                const newId = e.target.value;
                navigate(`/procurement/goods-receipts/new?poId=${newId}`, { replace: true });
              }}
              placeholder="PO id (auto-fills lines)"
            />
            {po.data && <p className="mt-1 text-xs text-muted-foreground">{po.data.orderNumber}</p>}
          </div>
          <div>
            <label className="text-sm font-medium">Warehouse</label>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="mt-1 w-full rounded border bg-background px-2 py-1 text-sm"
            >
              <option value="">Select warehouse…</option>
              {warehouses.data?.map((w) => (
                <option key={w.id} value={w.id}>{w.code} — {w.name}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="text-sm font-medium">Notes</label>
            <Input className="mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Lines</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setLines([...lines, { description: '', quantity: 1 }])}>
              <Plus className="mr-2 h-3 w-3" />Add line
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {lines.map((ln, idx) => (
            <div key={idx} className="grid gap-2 md:grid-cols-12 items-center">
              <div className="md:col-span-3">
                <select
                  className="w-full rounded border bg-background px-2 py-1 text-sm"
                  onChange={(e) => {
                    const product = products.data?.find((p) => p.id === e.target.value);
                    const next = [...lines];
                    next[idx] = {
                      ...next[idx],
                      productId: e.target.value,
                      description: product?.name ?? next[idx].description,
                    };
                    setLines(next);
                  }}
                  defaultValue={ln.productId ?? ''}
                >
                  <option value="">Pick product…</option>
                  {products.data?.map((p) => (
                    <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-3">
                <Input
                  placeholder="Description"
                  value={ln.description}
                  onChange={(e) => {
                    const next = [...lines];
                    next[idx] = { ...next[idx], description: e.target.value };
                    setLines(next);
                  }}
                />
              </div>
              <div className="md:col-span-1">
                <Input
                  type="number" step="0.01" min="0"
                  value={ln.quantity}
                  onChange={(e) => {
                    const next = [...lines];
                    next[idx] = { ...next[idx], quantity: Number(e.target.value) };
                    setLines(next);
                  }}
                />
              </div>
              <div className="md:col-span-1">
                <Input
                  type="number" step="0.01" min="0"
                  placeholder="Cost"
                  value={ln.unitCost ?? 0}
                  onChange={(e) => {
                    const next = [...lines];
                    next[idx] = { ...next[idx], unitCost: Number(e.target.value) };
                    setLines(next);
                  }}
                />
              </div>
              <div className="md:col-span-1">
                <Input
                  placeholder="Batch #"
                  value={ln.batchNumber ?? ''}
                  onChange={(e) => {
                    const next = [...lines];
                    next[idx] = { ...next[idx], batchNumber: e.target.value };
                    setLines(next);
                  }}
                />
              </div>
              <div className="md:col-span-1">
                <Input
                  type="date"
                  value={ln.expiryDate ?? ''}
                  onChange={(e) => {
                    const next = [...lines];
                    next[idx] = { ...next[idx], expiryDate: e.target.value };
                    setLines(next);
                  }}
                />
              </div>
              <Button size="icon" variant="ghost" onClick={() => setLines(lines.filter((_, i) => i !== idx))}>
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate(-1)}>Cancel</Button>
        <Button onClick={() => create.mutate()} disabled={!warehouseId || lines.length === 0 || create.isPending}>
          <Truck className="mr-2 h-4 w-4" />Save & post
        </Button>
      </div>
    </div>
  );
}
