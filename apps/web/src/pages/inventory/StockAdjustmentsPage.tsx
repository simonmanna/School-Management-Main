import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus, Trash2, Save, History } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';
import { dateTime } from '@/lib/format';

interface Product { id: string; code: string; name: string; costPrice?: string }
interface Location { id: string; code: string; name: string }
interface AdjustmentItem { id: string; productId: string; productName: string; quantityChange: number }
interface AdjustmentRow {
  id: string; adjCode: string; createdAt: string; reason: string; status: string; notes: string | null;
  location: { id: string; code: string; name: string } | null;
  items: AdjustmentItem[];
  _count?: { items: number };
  approvedAt: string | null; approvedById: string | null; performedById: string | null;
}

interface AdjustmentLine {
  productId: string;
  itemName: string;
  unit: string;
  quantitySystem: number;
  quantityActual: number;
  notes?: string;
}

const ADJUSTMENT_REASONS = [
  { value: 'CYCLE_COUNT', label: 'Cycle Count' },
  { value: 'DAMAGED', label: 'Damaged' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'THEFT', label: 'Theft / Loss' },
  { value: 'RETURNED_TO_SUPPLIER', label: 'Returned to Supplier' },
  { value: 'FOUND', label: 'Found / Surplus' },
  { value: 'INITIAL_COUNT', label: 'Initial Stock Count' },
  { value: 'OTHER', label: 'Other' },
];

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  posted: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-red-100 text-red-700',
};

const REASON_LABELS: Record<string, string> = {
  CYCLE_COUNT: 'Cycle Count', DAMAGED: 'Damaged', EXPIRED: 'Expired',
  THEFT: 'Theft / Loss', RETURNED_TO_SUPPLIER: 'Returned to Supplier',
  FOUND: 'Found / Surplus', INITIAL_COUNT: 'Initial Count', OTHER: 'Other',
};

export function StockAdjustmentsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [locationId, setLocationId] = useState('');
  const [reason, setReason] = useState('CYCLE_COUNT');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<AdjustmentLine[]>([{ productId: '', itemName: '', unit: 'pcs', quantitySystem: 0, quantityActual: 0 }]);

  const adjustments = useQuery<AdjustmentRow[]>({
    queryKey: ['stock-adjustments'],
    queryFn: async () => (await api.get<AdjustmentRow[]>('/inventory/adjustments')).data,
  });

  const products = useQuery<Product[]>({
    queryKey: ['products'],
    queryFn: async () => {
      const res = await api.get<{ data: Product[] }>('/products?pageSize=200');
      return res.data.data ?? [];
    },
  });
  const locations = useQuery<Location[]>({
    queryKey: ['inventory-locations'],
    queryFn: async () => {
      const res = await api.get<{ data: Location[] }>('/inventory/locations');
      return res.data.data ?? [];
    },
  });

  const adjust = useMutation({
    mutationFn: async () => {
      const results = [];
      for (const ln of lines) {
        if (!ln.productId || ln.quantityActual < 0) continue;
        const stk = await api.get<{ items: { quantity: number }[] }>(`/inventory/items/${ln.productId}?locationId=${locationId}`);
        const sysQty = stk.data.items?.[0]?.quantity ?? 0;
        await api.post('/inventory/stock/adjust', {
          productId: ln.productId,
          locationId,
          countedQuantity: ln.quantityActual,
          notes: `${reason}: ${ln.notes || notes || 'adjustment'}`,
        });
        results.push({ productId: ln.productId, system: sysQty, actual: ln.quantityActual });
      }
      return results;
    },
    onSuccess: () => {
      notify.success('Stock adjusted');
      setShowForm(false);
      setLines([{ productId: '', itemName: '', unit: 'pcs', quantitySystem: 0, quantityActual: 0 }]);
      setNotes('');
      qc.invalidateQueries({ queryKey: ['stock-adjustments'] });
      qc.invalidateQueries({ queryKey: ['inventory-items'] });
      qc.invalidateQueries({ queryKey: ['inventory-stats'] });
      qc.invalidateQueries({ queryKey: ['inventory-ledger'] });
    },
    onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Adjustment failed'),
  });

  const pickProduct = (idx: number, productId: string) => {
    const p = products.data?.find((x) => x.id === productId);
    if (!p) return;
    const next = [...lines];
    next[idx] = { ...next[idx], productId, itemName: p.name };
    setLines(next);
  };

  const fetchSystemQty = async (idx: number) => {
    const ln = lines[idx];
    if (!ln.productId || !locationId) return;
    try {
      const res = await api.get<{ items: { quantity: number }[] }>(`/inventory/items/${ln.productId}?locationId=${locationId}`);
      const qty = res.data.items?.[0]?.quantity ?? 0;
      const next = [...lines];
      next[idx] = { ...next[idx], quantitySystem: qty, quantityActual: qty };
      setLines(next);
    } catch (e) { console.warn('fetchSystemQty failed', e); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Stock Adjustments</h1>
          <p className="text-sm text-muted-foreground">Correct stock levels, record damages, cycle counts</p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="mr-2 h-4 w-4" />New Adjustment
        </Button>
      </div>

      {/* Adjustments List */}
      {adjustments.isLoading && <Skeleton className="h-48 w-full" />}
      {adjustments.data && adjustments.data.length === 0 && (
        <Card><CardContent className="p-8 text-center text-muted-foreground">No adjustments yet. Click "New Adjustment" to create one.</CardContent></Card>
      )}
      {adjustments.data && adjustments.data.length > 0 && (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-3 py-2 text-left">Adj #</th>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Location</th>
                <th className="px-3 py-2 text-left">Reason</th>
                <th className="px-3 py-2 text-right">Items</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Notes</th>
              </tr>
            </thead>
            <tbody>
              {adjustments.data.map((adj) => (
                <tr key={adj.id} className="border-b hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono text-xs font-medium">{adj.adjCode}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{dateTime(adj.createdAt)}</td>
                  <td className="px-3 py-2">{adj.location?.code ? `${adj.location.code} — ${adj.location.name}` : '—'}</td>
                  <td className="px-3 py-2"><Badge variant="outline" className="text-xs">{REASON_LABELS[adj.reason] ?? adj.reason}</Badge></td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{adj.items?.length ?? adj._count?.items ?? 0}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex px-2.5 py-0.5 rounded text-xs font-semibold ${STATUS_COLORS[adj.status] ?? 'bg-gray-100 text-gray-700'}`}>
                      {adj.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 max-w-48 truncate text-muted-foreground">{adj.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Adjustment Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Stock Adjustment</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Location</label>
                <Select value={locationId} onValueChange={setLocationId}>
                  <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                  <SelectContent>
                    {locations.data?.map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.code} — {l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Reason</label>
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ADJUSTMENT_REASONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Items</label>
                <Button size="sm" variant="outline" onClick={() => setLines([...lines, { productId: '', itemName: '', unit: 'pcs', quantitySystem: 0, quantityActual: 0 }])}>
                  <Plus className="mr-1 h-3 w-3" />Add Item
                </Button>
              </div>
              <div className="rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-2 py-1 text-left">Product</th>
                      <th className="px-2 py-1 text-right">System</th>
                      <th className="px-2 py-1 text-right">Actual</th>
                      <th className="px-2 py-1 text-right">Diff</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((ln, idx) => (
                      <tr key={idx} className="border-b">
                        <td className="px-2 py-1">
                          <div className="flex gap-1">
                            <select
                              className="flex-1 rounded border bg-background px-1 py-0.5 text-sm"
                              value={ln.productId}
                              onChange={(e) => pickProduct(idx, e.target.value)}
                            >
                              <option value="">Select product…</option>
                              {products.data?.map((p) => (
                                <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
                              ))}
                            </select>
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => fetchSystemQty(idx)} title="Fetch system qty">
                              <History className="h-3 w-3" />
                            </Button>
                          </div>
                        </td>
                        <td className="px-2 py-1">
                          <Input
                            type="number" min="0" className="h-7 text-right"
                            value={ln.quantitySystem}
                            onChange={(e) => {
                              const next = [...lines];
                              next[idx] = { ...next[idx], quantitySystem: Number(e.target.value) };
                              setLines(next);
                            }}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <Input
                            type="number" min="0" className="h-7 text-right"
                            value={ln.quantityActual}
                            onChange={(e) => {
                              const next = [...lines];
                              next[idx] = { ...next[idx], quantityActual: Number(e.target.value) };
                              setLines(next);
                            }}
                          />
                        </td>
                        <td className={`px-2 py-1 text-right font-mono tabular-nums ${
                          ln.quantityActual !== ln.quantitySystem
                            ? (ln.quantityActual > ln.quantitySystem ? 'text-emerald-600' : 'text-destructive')
                            : ''
                        }`}>
                          {ln.quantityActual - ln.quantitySystem}
                        </td>
                        <td className="px-2 py-1">
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setLines(lines.filter((_, i) => i !== idx))}>
                            <Trash2 className="h-3 w-3 text-destructive" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">Notes</label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional adjustment notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button
              onClick={() => adjust.mutate()}
              disabled={!locationId || lines.every((l) => !l.productId) || adjust.isPending}
            >
              <Save className="mr-2 h-4 w-4" />{adjust.isPending ? 'Adjusting…' : 'Apply Adjustment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
