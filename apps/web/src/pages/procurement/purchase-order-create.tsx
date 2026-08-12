import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Save } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';

interface Partner { id: string; name: string; code: string }
interface Product { id: string; name: string; code: string; salesPrice?: number; costPrice?: number; taxId?: string }
interface Warehouse { id: string; name: string; code: string }

interface Line {
  productId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxId?: string;
}

export function PurchaseOrderCreatePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [partnerId, setPartnerId] = useState('');
  const [description, setDescription] = useState('');
  const [paymentType, setPaymentType] = useState<'cash' | 'credit'>('cash');
  const [warehouseId, setWarehouseId] = useState('');
  const [lines, setLines] = useState<Line[]>([{ description: '', quantity: 1, unitPrice: 0 }]);

  const partners = useQuery<Partner[]>({
    queryKey: ['partners-supplier'],
    queryFn: async () => {
      const res = await api.get<{ data: Partner[] }>('/partners?pageSize=100&search=SUPP');
      return res.data.data ?? [];
    },
  });
  const products = useQuery<Product[]>({
    queryKey: ['products'],
    queryFn: async () => {
      const res = await api.get<{ data: Product[] }>('/products?pageSize=200');
      return res.data.data ?? [];
    },
  });
  const warehouses = useQuery<Warehouse[]>({
    queryKey: ['warehouses'],
    queryFn: async () => {
      const res = await api.get<{ data: Warehouse[] }>('/inventory/locations?type=warehouse');
      return res.data.data ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async () =>
      (await api.post('/procurement/purchase-orders', {
        partnerId,
        description,
        paymentType,
        warehouseId,
        lines: lines.filter((l) => l.quantity > 0),
      })).data,
    onSuccess: (data: any) => {
      notify.success(`Purchase ${data.orderNumber} created`);
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      navigate('/procurement/purchase-orders');
    },
    onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Failed'),
  });

  const total = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unitPrice || 0), 0);

  const addLine = () => setLines([...lines, { description: '', quantity: 1, unitPrice: 0 }]);
  const removeLine = (idx: number) => setLines(lines.filter((_, i) => i !== idx));
  const pickProduct = (idx: number, productId: string) => {
    const product = products.data?.find((p) => p.id === productId);
    if (!product) return;
    const next = [...lines];
    next[idx] = {
      productId,
      description: product.name,
      quantity: next[idx].quantity || 1,
      unitPrice: Number(product.costPrice ?? product.salesPrice ?? 0),
      taxId: product.taxId,
    };
    setLines(next);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">New Purchase</h1>

      <Card>
        <CardHeader>
          <CardTitle>Supplier & details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-sm font-medium">Supplier</label>
            <select
              value={partnerId}
              onChange={(e) => setPartnerId(e.target.value)}
              className="mt-1 w-full rounded border bg-background px-2 py-1 text-sm"
            >
              <option value="">Select supplier…</option>
              {partners.data?.map((p) => (
                <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">Description / notes</label>
            <Input
              className="mt-1"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Payment type</label>
            <select
              value={paymentType}
              onChange={(e) => setPaymentType(e.target.value as 'cash' | 'credit')}
              className="mt-1 w-full rounded border bg-background px-2 py-1 text-sm"
            >
              <option value="cash">Cash — auto-pay on receive</option>
              <option value="credit">Credit — pay later</option>
            </select>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Products</CardTitle>
              <CardDescription>Fill products purchased</CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={addLine}><Plus className="mr-2 h-3 w-3" />Add item</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-12 items-center text-xs text-muted-foreground font-medium px-1 pb-1 border-b mb-1">
            <div className="md:col-span-4">Product</div>
            <div className="md:col-span-4">Description</div>
            <div className="md:col-span-1 text-right">Qty</div>
            <div className="md:col-span-2 text-right">Unit Price</div>
            <div className="md:col-span-1 text-right">Total</div>
          </div>
          <div className="space-y-2">
            {lines.map((ln, idx) => (
              <div key={idx} className="grid gap-2 md:grid-cols-12 items-center">
                <div className="md:col-span-4">
                  <select
                    className="w-full rounded border bg-background px-2 py-1 text-sm"
                    onChange={(e) => pickProduct(idx, e.target.value)}
                    defaultValue=""
                  >
                    <option value="">Pick product (optional)…</option>
                    {products.isLoading ? (
                      <option>Loading…</option>
                    ) : (
                      products.data?.map((p) => (
                        <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
                      ))
                    )}
                  </select>
                </div>
                <div className="md:col-span-4">
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
                    type="number"
                    step="0.01"
                    min="0"
                    value={ln.quantity}
                    onChange={(e) => {
                      const next = [...lines];
                      next[idx] = { ...next[idx], quantity: Number(e.target.value) };
                      setLines(next);
                    }}
                  />
                </div>
                <div className="md:col-span-2">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={ln.unitPrice}
                    onChange={(e) => {
                      const next = [...lines];
                      next[idx] = { ...next[idx], unitPrice: Number(e.target.value) };
                      setLines(next);
                    }}
                  />
                </div>
                <div className="md:col-span-1 text-right text-sm tabular-nums">
                  {(ln.quantity * ln.unitPrice).toFixed(2)}
                </div>
                <div className="md:col-span-0">
                  <Button size="icon" variant="ghost" onClick={() => removeLine(idx)} aria-label="Remove line">
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between border-t pt-3">
            <span className="text-sm font-medium">Total</span>
            <span className="text-lg font-bold tabular-nums">{total.toFixed(2)}</span>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate(-1)}>Cancel</Button>
        <Button
          onClick={() => create.mutate()}
          disabled={!partnerId || !warehouseId || lines.length === 0 || create.isPending}
        >
          <Save className="mr-2 h-4 w-4" />
          {create.isPending ? 'Saving…' : 'Save Purchase'}
        </Button>
      </div>
    </div>
  );
}
